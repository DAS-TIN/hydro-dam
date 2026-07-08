// Actor registry: ids, ownership, presence and multi-actor attribution.

import test from 'node:test'
import assert from 'node:assert/strict'
import { addActor, humanOwnerOf, touchActor, agentsOf } from '../src/main/rtc/actors.mjs'
import { recordChanges, assignChanges, groupChanges } from '../src/main/rtc/patches.mjs'

test('actor ids are readable and unique', () => {
  const actors = []
  const a = addActor(actors, { type: 'human', displayName: 'Dastin' })
  assert.equal(a.id, 'human:dastin')
  const b = addActor(actors, { type: 'human', displayName: 'Dastin' })
  assert.equal(b.id, 'human:dastin-2')
})

test('agents must belong to a human in the session', () => {
  const actors = []
  assert.throws(
    () => addActor(actors, { type: 'agent', displayName: 'stray-claude' }),
    /must belong to a person/
  )
  const alice = addActor(actors, { type: 'human', displayName: 'Alice' })
  const agent = addActor(actors, { type: 'agent', displayName: 'alice-claude', humanOwnerActorId: alice.id })
  assert.equal(agent.humanOwnerActorId, alice.id)
  assert.equal(humanOwnerOf(actors, agent.id).id, alice.id)
  assert.equal(humanOwnerOf(actors, alice.id).id, alice.id)
  assert.deepEqual(agentsOf(actors, alice.id).map((x) => x.id), [agent.id])
})

test('presence updates track files, cursor and task', () => {
  const actors = []
  const alice = addActor(actors, { type: 'human', displayName: 'Alice' }, 100)
  touchActor(actors, alice.id, { activeFiles: ['src/a.ts'], cursor: { path: 'src/a.ts', line: 42 } }, 200)
  assert.equal(alice.lastSeenAt, 200)
  assert.deepEqual(alice.activeFiles, ['src/a.ts'])
  assert.equal(alice.cursor.line, 42)
})

test('changes from different actors stay attributed separately', () => {
  const changes = []
  recordChanges(changes, [{ path: 'a.ts', kind: 'edit' }], 'human:alice', 'task-1')
  recordChanges(changes, [{ path: 'b.ts', kind: 'edit' }], 'agent:alice-claude', 'task-1')
  recordChanges(changes, [{ path: 'c.ts', kind: 'create' }], 'human:bob', null)
  recordChanges(changes, [{ path: 'd.ts', kind: 'edit' }], null, null) // external

  const groups = groupChanges(changes)
  const byActor = Object.fromEntries(groups.map((g) => [g.actorId, g.files.map((f) => f.path)]))
  assert.deepEqual(byActor['human:alice'], ['a.ts'])
  assert.deepEqual(byActor['agent:alice-claude'], ['b.ts'])
  assert.deepEqual(byActor['human:bob'], ['c.ts'])
  assert.deepEqual(byActor['unknown'], ['d.ts'])

  // the unknown external edit gets assigned to an actor later
  assignChanges(changes, ['d.ts'], 'human:bob', 'task-2')
  assert.equal(changes.find((c) => c.path === 'd.ts').actorId, 'human:bob')
  assert.equal(changes.find((c) => c.path === 'd.ts').taskId, 'task-2')
})

test('a re-edit of the same path keeps one entry with the latest attribution', () => {
  const changes = []
  recordChanges(changes, [{ path: 'a.ts', kind: 'create' }], 'human:alice', null)
  recordChanges(changes, [{ path: 'a.ts', kind: 'edit' }], 'human:alice', 'task-9')
  assert.equal(changes.length, 1)
  assert.equal(changes[0].kind, 'edit')
  assert.equal(changes[0].taskId, 'task-9')
})
