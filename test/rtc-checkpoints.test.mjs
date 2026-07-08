// Checkpoints: creation from patches, task status effects, progress numbers.

import test from 'node:test'
import assert from 'node:assert/strict'
import { createCheckpoint, taskProgress } from '../src/main/rtc/checkpoints.mjs'
import { createTask } from '../src/main/rtc/tasks.mjs'
import { addActor } from '../src/main/rtc/actors.mjs'

function makeState() {
  const actors = []
  const alice = addActor(actors, { type: 'human', displayName: 'Alice' })
  const agent = addActor(actors, { type: 'agent', displayName: 'alice-claude', humanOwnerActorId: alice.id })
  const tasks = []
  const task = createTask(tasks, { title: 'Feature X', acceptanceCriteria: ['a', 'b'] })
  task.status = 'in_progress'
  const patch = (id, extra = {}) => ({
    id,
    taskId: task.id,
    createdByActorId: agent.id,
    humanOwnerActorId: alice.id,
    summary: id,
    filesChanged: ['src/x.ts'],
    diff: '',
    status: 'draft',
    testStatus: 'unknown',
    riskLevel: 'low',
    lockWarnings: [],
    createdAt: 1,
    ...extra
  })
  return {
    actors, alice, agent, tasks, task,
    state: { actors, tasks, patches: [patch('patch-1'), patch('patch-2')], checkpoints: [] }
  }
}

test('a checkpoint gathers files, credits the human owner and moves the task to review', () => {
  const { state, task, agent, alice } = makeState()
  const cp = createCheckpoint(state, {
    taskId: task.id,
    patchIds: ['patch-1', 'patch-2'],
    actorId: agent.id
  })
  assert.deepEqual(cp.files, ['src/x.ts'])
  assert.equal(cp.createdByActorId, agent.id)
  assert.equal(cp.humanOwnerActorId, alice.id)
  assert.equal(task.status, 'needs_review')
  assert.equal(state.patches[0].status, 'checkpointed')
  assert.equal(cp.recommendation, 'review')
})

test('risky files show up in the checkpoint risks', () => {
  const { state, task, agent } = makeState()
  state.patches[0].filesChanged = ['package-lock.json']
  const cp = createCheckpoint(state, { taskId: task.id, patchIds: ['patch-1'], actorId: agent.id })
  assert.ok(cp.risks.some((r) => r.includes('package-lock.json')))
})

test('conflicted patches force resolve-first, accepted ones suggest commit', () => {
  const { state, task, agent } = makeState()
  state.patches[0].status = 'conflicted'
  const cp1 = createCheckpoint(state, { taskId: task.id, patchIds: ['patch-1'], actorId: agent.id })
  assert.equal(cp1.recommendation, 'resolve conflict first')

  state.patches[1].status = 'accepted'
  const cp2 = createCheckpoint(state, { taskId: task.id, patchIds: ['patch-2'], actorId: agent.id })
  assert.equal(cp2.recommendation, 'commit')
})

test('progress climbs the ladder and criteria move the needle', () => {
  const { state, task } = makeState()
  task.status = 'backlog'
  assert.equal(taskProgress(task, []), 0)
  task.status = 'in_progress'
  const early = taskProgress(task, [])
  task.acceptanceCriteria[0].done = true
  const half = taskProgress(task, [])
  assert.ok(half > early, 'ticking a criterion raises the percentage')
  task.status = 'needs_review'
  const review = taskProgress(task, [])
  assert.ok(review > half)
  task.status = 'merged'
  assert.equal(taskProgress(task, []), 100)
  task.status = 'checkpointed'
  assert.ok(taskProgress(task, []) < 100, 'only merged is 100')
})
