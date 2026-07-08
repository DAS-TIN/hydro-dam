// locks.mjs - collision avoidance. Soft locks warn, hard locks are for files
// where a merge tool cannot save you (lockfiles, binaries, migrations).

import { newId } from './util.mjs'
import { humanOwnerOf } from './actors.mjs'

export const LOCK_TYPES = ['file', 'folder', 'task', 'contract', 'binary']

// Files that get a hard lock by default: concurrent edits to these are
// effectively unmergeable.
export const HARD_LOCK_PATTERNS = [
  /(^|\/)package-lock\.json$/,
  /(^|\/)yarn\.lock$/,
  /(^|\/)pnpm-lock\.yaml$/,
  /(^|\/)Cargo\.lock$/,
  /(^|\/)Gemfile\.lock$/,
  /(^|\/)composer\.lock$/,
  /(^|\/)poetry\.lock$/,
  /(^|\/)go\.sum$/,
  /(^|\/)migrations\//,
  /\.(png|jpg|jpeg|gif|ico|pdf|zip|exe|dll|so|dylib|woff2?)$/i,
  /\.min\.(js|css)$/
]

export function suggestHardLock(path) {
  const p = String(path).replace(/\\/g, '/')
  return HARD_LOCK_PATTERNS.some((r) => r.test(p))
}

function normalize(p) {
  return String(p).replace(/\\/g, '/').replace(/\/+$/, '')
}

function isActive(lock, now) {
  return !lock.releasedAt && (!lock.expiresAt || lock.expiresAt > now)
}

/** Does an active lock cover this path? Folder locks cover everything under them. */
function covers(lock, path) {
  const lp = normalize(lock.path)
  const p = normalize(path)
  if (lock.lockType === 'folder') return p === lp || p.startsWith(lp + '/')
  return p === lp
}

/** The first active lock on path held by someone other than actorId, or null. */
export function conflictingLock(locks, path, actorId, now = Date.now()) {
  return (
    locks.find((l) => isActive(l, now) && covers(l, path) && l.lockedByActorId !== actorId) || null
  )
}

/** Every active lock covering the path, regardless of holder. */
export function locksOn(locks, path, now = Date.now()) {
  return locks.filter((l) => isActive(l, now) && covers(l, path))
}

/**
 * Take a lock. Throws when another actor already holds a covering lock.
 * ttlMinutes of 0/null means no expiry.
 */
export function acquireLock(locks, actors, opts, now = Date.now()) {
  const { lockType = 'file', path, taskId = null, actorId, reason = '', ttlMinutes = null } = opts
  if (!LOCK_TYPES.includes(lockType)) throw new Error(`Unknown lock type: ${lockType}`)
  if (!path) throw new Error('A lock needs a path.')
  const clash = conflictingLock(locks, path, actorId, now)
  if (clash) {
    throw new Error(`${path} is already locked by ${clash.lockedByActorId} (${clash.reason || 'no reason given'}).`)
  }
  const human = humanOwnerOf(actors, actorId)
  const lock = {
    id: newId('lock'),
    lockType,
    path: normalize(path),
    taskId,
    lockedByActorId: actorId,
    humanOwnerActorId: human ? human.id : null,
    reason,
    hardLock: opts.hardLock !== undefined ? !!opts.hardLock : suggestHardLock(path),
    createdAt: now,
    expiresAt: ttlMinutes ? now + ttlMinutes * 60_000 : null,
    releasedAt: null
  }
  locks.push(lock)
  return lock
}

export function releaseLock(locks, lockId, now = Date.now()) {
  const lock = locks.find((l) => l.id === lockId)
  if (!lock) throw new Error('Lock not found.')
  lock.releasedAt = now
  return lock
}

export function activeLocks(locks, now = Date.now()) {
  return locks.filter((l) => isActive(l, now))
}

/**
 * Check a set of edited paths against the lock table and record violations
 * for anything touched while locked by someone else. Returns the violations.
 */
export function checkViolations(locks, violations, paths, actorId, now = Date.now()) {
  const found = []
  for (const p of paths) {
    const clash = conflictingLock(locks, p, actorId, now)
    if (clash) {
      const v = {
        id: newId('violation'),
        path: normalize(p),
        actorId,
        lockId: clash.id,
        lockedByActorId: clash.lockedByActorId,
        hardLock: clash.hardLock,
        at: now
      }
      violations.push(v)
      found.push(v)
    }
  }
  return found
}
