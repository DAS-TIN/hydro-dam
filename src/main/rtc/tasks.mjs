// tasks.mjs - work items with a strict status machine, dependencies and
// per-task file rules (allowed / forbidden / locked).

import { newId } from './util.mjs'
import { humanOwnerOf } from './actors.mjs'

export const TASK_TYPES = ['feature', 'bugfix', 'refactor', 'test', 'docs', 'investigation', 'chore']

export const TASK_STATUSES = [
  'backlog', 'ready', 'claimed', 'in_progress', 'blocked',
  'needs_review', 'checkpointed', 'merged', 'rejected', 'abandoned'
]

// Which statuses a task may move to from each state.
export const TRANSITIONS = {
  backlog: ['ready', 'abandoned'],
  ready: ['claimed', 'backlog', 'abandoned'],
  claimed: ['in_progress', 'ready', 'abandoned'],
  in_progress: ['blocked', 'needs_review', 'ready', 'abandoned'],
  blocked: ['in_progress', 'abandoned'],
  needs_review: ['checkpointed', 'in_progress', 'rejected'],
  checkpointed: ['merged', 'in_progress'],
  merged: [],
  rejected: ['in_progress', 'abandoned'],
  abandoned: ['backlog']
}

export function canTransition(from, to) {
  return (TRANSITIONS[from] || []).includes(to)
}

export function createTask(tasks, opts, now = Date.now()) {
  const title = String(opts.title || '').trim()
  if (!title) throw new Error('Task needs a title.')
  const type = TASK_TYPES.includes(opts.type) ? opts.type : 'feature'
  const task = {
    id: newId('task'),
    title,
    description: opts.description || '',
    type,
    status: 'backlog',
    ownerActorId: null,
    humanOwnerActorId: null,
    priority: opts.priority || 'normal',
    dependsOn: opts.dependsOn || [],
    blocks: opts.blocks || [],
    acceptanceCriteria: (opts.acceptanceCriteria || []).map((c) =>
      typeof c === 'string' ? { text: c, done: false } : c
    ),
    lockedFiles: opts.lockedFiles || [],
    allowedFiles: opts.allowedFiles || [],
    forbiddenFiles: opts.forbiddenFiles || [],
    createdAt: now,
    updatedAt: now
  }
  tasks.push(task)
  return task
}

export function getTask(tasks, id) {
  return tasks.find((t) => t.id === id) || null
}

/** Claim assigns the task to an actor and records who answers for it. */
export function claimTask(tasks, actors, taskId, actorId, now = Date.now()) {
  const task = getTask(tasks, taskId)
  if (!task) throw new Error('Task not found.')
  if (!['backlog', 'ready'].includes(task.status)) {
    throw new Error(`Task is ${task.status}; only backlog or ready tasks can be claimed.`)
  }
  const human = humanOwnerOf(actors, actorId)
  if (!human) throw new Error('The claiming actor has no owner in the session.')
  task.ownerActorId = actorId
  task.humanOwnerActorId = human.id
  task.status = 'claimed'
  task.updatedAt = now
  return task
}

export function transitionTask(tasks, taskId, to, now = Date.now()) {
  const task = getTask(tasks, taskId)
  if (!task) throw new Error('Task not found.')
  if (!TASK_STATUSES.includes(to)) throw new Error(`Unknown status: ${to}`)
  if (!canTransition(task.status, to)) {
    throw new Error(`A ${task.status} task cannot move to ${to}.`)
  }
  task.status = to
  task.updatedAt = now
  return task
}

/** A task is dependency-blocked until everything in dependsOn is merged. */
export function isDependencyBlocked(tasks, task) {
  return (task.dependsOn || []).some((id) => {
    const dep = getTask(tasks, id)
    return dep && dep.status !== 'merged'
  })
}

/** Tasks whose blocked status no longer matches their dependencies. */
export function staleBlocks(tasks) {
  const out = []
  for (const t of tasks) {
    const blocked = isDependencyBlocked(tasks, t)
    if (t.status === 'blocked' && !blocked) out.push({ task: t, shouldBe: 'in_progress' })
    if (t.status === 'in_progress' && blocked) out.push({ task: t, shouldBe: 'blocked' })
  }
  return out
}
