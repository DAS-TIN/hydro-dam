// Lock conflicts, folder coverage, expiry and violation records.

import test from 'node:test'
import assert from 'node:assert/strict'
import {
  acquireLock, releaseLock, conflictingLock, checkViolations, suggestHardLock, activeLocks
} from '../src/main/rtc/locks.mjs'
import { addActor } from '../src/main/rtc/actors.mjs'

function fixtures() {
  const actors = []
  const alice = addActor(actors, { type: 'human', displayName: 'Alice' })
  const bob = addActor(actors, { type: 'human', displayName: 'Bob' })
  return { actors, alice, bob }
}

test('two actors cannot lock the same file', () => {
  const { actors, alice, bob } = fixtures()
  const locks = []
  acquireLock(locks, actors, { path: 'src/app.ts', actorId: alice.id, reason: 'refactor' })
  assert.throws(() => acquireLock(locks, actors, { path: 'src/app.ts', actorId: bob.id }), /already locked/)
  // the holder can stack another lock on their own file
  acquireLock(locks, actors, { path: 'src/app.ts', actorId: alice.id })
})

test('a folder lock covers everything under it', () => {
  const { actors, alice, bob } = fixtures()
  const locks = []
  acquireLock(locks, actors, { lockType: 'folder', path: 'src/api', actorId: alice.id })
  assert.ok(conflictingLock(locks, 'src/api/users.ts', bob.id))
  assert.ok(conflictingLock(locks, 'src/api', bob.id))
  assert.equal(conflictingLock(locks, 'src/apiary.ts', bob.id), null)
  assert.equal(conflictingLock(locks, 'src/api/users.ts', alice.id), null)
})

test('locks expire and can be released', () => {
  const { actors, alice, bob } = fixtures()
  const locks = []
  const now = 1_000_000
  const l = acquireLock(locks, actors, { path: 'a.txt', actorId: alice.id, ttlMinutes: 10 }, now)
  assert.ok(conflictingLock(locks, 'a.txt', bob.id, now + 5 * 60_000))
  assert.equal(conflictingLock(locks, 'a.txt', bob.id, now + 11 * 60_000), null)
  assert.equal(activeLocks(locks, now + 11 * 60_000).length, 0)

  const l2 = acquireLock(locks, actors, { path: 'b.txt', actorId: alice.id }, now)
  releaseLock(locks, l2.id, now + 1)
  assert.equal(conflictingLock(locks, 'b.txt', bob.id, now + 2), null)
  assert.equal(l.id === l2.id, false)
})

test('editing a file someone else locked records a violation', () => {
  const { actors, alice, bob } = fixtures()
  const locks = []
  const violations = []
  acquireLock(locks, actors, { path: 'src/core.ts', actorId: alice.id })
  const found = checkViolations(locks, violations, ['src/core.ts', 'src/free.ts'], bob.id)
  assert.equal(found.length, 1)
  assert.equal(found[0].path, 'src/core.ts')
  assert.equal(found[0].actorId, bob.id)
  assert.equal(found[0].lockedByActorId, alice.id)
  assert.equal(violations.length, 1)
  // the lock holder editing their own file is not a violation
  assert.equal(checkViolations(locks, violations, ['src/core.ts'], alice.id).length, 0)
})

test('risky files default to hard locks', () => {
  assert.equal(suggestHardLock('package-lock.json'), true)
  assert.equal(suggestHardLock('backend/pnpm-lock.yaml'), true)
  assert.equal(suggestHardLock('db/migrations/001_init.sql'), true)
  assert.equal(suggestHardLock('logo.png'), true)
  assert.equal(suggestHardLock('vendor/lib.min.js'), true)
  assert.equal(suggestHardLock('src/app.ts'), false)
  const { actors, alice } = fixtures()
  const locks = []
  const l = acquireLock(locks, actors, { path: 'yarn.lock', actorId: alice.id })
  assert.equal(l.hardLock, true)
})
