// Task state machine: legal transitions, claiming, dependency blocking.

import test from 'node:test'
import assert from 'node:assert/strict'
import {
  createTask, claimTask, transitionTask, canTransition, isDependencyBlocked, staleBlocks
} from '../src/main/rtc/tasks.mjs'
import { addActor } from '../src/main/rtc/actors.mjs'

function fixtures() {
  const actors = []
  const alice = addActor(actors, { type: 'human', displayName: 'Alice' })
  const agent = addActor(actors, { type: 'agent', displayName: 'alice-claude', humanOwnerActorId: alice.id })
  return { actors, alice, agent }
}

test('tasks walk the ladder: backlog -> ready -> claimed -> in_progress -> needs_review', () => {
  const { actors, alice } = fixtures()
  const tasks = []
  const t = createTask(tasks, { title: 'Build the thing', type: 'feature' })
  assert.equal(t.status, 'backlog')
  transitionTask(tasks, t.id, 'ready')
  claimTask(tasks, actors, t.id, alice.id)
  assert.equal(t.status, 'claimed')
  transitionTask(tasks, t.id, 'in_progress')
  transitionTask(tasks, t.id, 'needs_review')
  transitionTask(tasks, t.id, 'checkpointed')
  transitionTask(tasks, t.id, 'merged')
  assert.equal(t.status, 'merged')
})

test('illegal transitions throw', () => {
  const tasks = []
  const t = createTask(tasks, { title: 'x' })
  assert.throws(() => transitionTask(tasks, t.id, 'merged'), /cannot move/)
  assert.throws(() => transitionTask(tasks, t.id, 'in_progress'), /cannot move/)
  assert.equal(canTransition('merged', 'in_progress'), false)
  assert.equal(canTransition('blocked', 'in_progress'), true)
})

test('claiming records both the actor and its human owner', () => {
  const { actors, alice, agent } = fixtures()
  const tasks = []
  const t = createTask(tasks, { title: 'agent work' })
  transitionTask(tasks, t.id, 'ready')
  claimTask(tasks, actors, t.id, agent.id)
  assert.equal(t.ownerActorId, agent.id)
  assert.equal(t.humanOwnerActorId, alice.id)
})

test('a claimed task cannot be claimed again', () => {
  const { actors, alice } = fixtures()
  const tasks = []
  const t = createTask(tasks, { title: 'once' })
  transitionTask(tasks, t.id, 'ready')
  claimTask(tasks, actors, t.id, alice.id)
  assert.throws(() => claimTask(tasks, actors, t.id, alice.id), /only backlog or ready/)
})

test('dependencies block until merged, and staleBlocks spots the drift', () => {
  const tasks = []
  const dep = createTask(tasks, { title: 'the API' })
  const t = createTask(tasks, { title: 'the UI', dependsOn: [dep.id] })
  assert.equal(isDependencyBlocked(tasks, t), true)

  // UI task went in_progress even though the API is unfinished
  t.status = 'in_progress'
  assert.deepEqual(staleBlocks(tasks).map((s) => s.shouldBe), ['blocked'])

  dep.status = 'merged'
  assert.equal(isDependencyBlocked(tasks, t), false)
  t.status = 'blocked'
  assert.deepEqual(staleBlocks(tasks).map((s) => s.shouldBe), ['in_progress'])
})

test('acceptance criteria normalise from strings', () => {
  const tasks = []
  const t = createTask(tasks, { title: 'x', acceptanceCriteria: ['builds', 'tests pass'] })
  assert.deepEqual(t.acceptanceCriteria, [
    { text: 'builds', done: false },
    { text: 'tests pass', done: false }
  ])
})
