// checkpoints.mjs - stable review points built from one or more patches,
// plus the progress heuristic the task cards show.

import { newId } from './util.mjs'
import { getTask } from './tasks.mjs'
import { suggestHardLock } from './locks.mjs'

function recommend(patches) {
  if (patches.some((p) => p.status === 'conflicted')) return 'resolve conflict first'
  if (patches.some((p) => p.testStatus === 'failing')) return 'request cleanup'
  if (patches.some((p) => p.riskLevel === 'high')) return 'review'
  if (patches.every((p) => p.status === 'accepted' || p.status === 'applied')) return 'commit'
  return 'review'
}

/**
 * Create a checkpoint from patches on one task. The related task moves to
 * needs_review, or straight to checkpointed when every patch is already
 * accepted.
 */
export function createCheckpoint(state, { taskId, patchIds, actorId, summary = '' }, now = Date.now()) {
  const patches = patchIds.map((id) => {
    const p = state.patches.find((x) => x.id === id)
    if (!p) throw new Error(`Patch not found: ${id}`)
    return p
  })
  if (!patches.length) throw new Error('A checkpoint needs at least one patch.')

  const files = [...new Set(patches.flatMap((p) => p.filesChanged))]
  const risks = []
  for (const f of files) if (suggestHardLock(f)) risks.push(`${f} is a risky file (lockfile, binary or migration)`)
  for (const p of patches) {
    if (p.lockWarnings?.length) risks.push(...p.lockWarnings)
    if (p.riskLevel === 'high') risks.push(`Patch ${p.id} is high risk`)
  }

  const actor = state.actors.find((a) => a.id === actorId)
  const cp = {
    id: newId('checkpoint'),
    taskId,
    patchIds,
    createdByActorId: actorId,
    humanOwnerActorId: actor && actor.type !== 'human' ? actor.humanOwnerActorId : actorId,
    summary: summary || `${files.length} file${files.length === 1 ? '' : 's'} across ${patches.length} patch${patches.length === 1 ? '' : 'es'}`,
    files,
    risks: [...new Set(risks)],
    recommendation: recommend(patches),
    createdAt: now
  }
  state.checkpoints.push(cp)

  for (const p of patches) {
    if (p.status === 'draft' || p.status === 'needs_review') p.status = 'checkpointed'
  }
  const task = taskId ? getTask(state.tasks, taskId) : null
  if (task) {
    const allAccepted = patches.every((p) => ['accepted', 'applied'].includes(p.status))
    if (task.status === 'in_progress') task.status = 'needs_review'
    if (task.status === 'needs_review' && allAccepted) task.status = 'checkpointed'
    task.updatedAt = now
  }
  return cp
}

// Baseline percentage for each task status; criteria completion fills the gap.
const STATUS_WEIGHT = {
  backlog: 0,
  ready: 5,
  claimed: 15,
  in_progress: 35,
  blocked: 35,
  needs_review: 70,
  checkpointed: 85,
  merged: 100,
  rejected: 0,
  abandoned: 0
}

/**
 * How far along a task is on its way to a reviewed checkpoint, 0..100.
 * Blends the status ladder with acceptance criteria and patch activity so
 * the number moves as real work lands, not only on status flips.
 */
export function taskProgress(task, patches = []) {
  let pct = STATUS_WEIGHT[task.status] ?? 0
  if (task.status === 'merged') return 100

  const crits = task.acceptanceCriteria || []
  if (crits.length) {
    const done = crits.filter((c) => c.done).length / crits.length
    pct = Math.round(pct * 0.6 + done * 100 * 0.4)
  }
  if (task.status === 'in_progress') {
    const mine = patches.filter((p) => p.taskId === task.id)
    pct += Math.min(mine.length, 3) * 5
  }
  return Math.max(0, Math.min(99, pct))
}
