// patches.mjs - changes never sync raw; they become actor-owned patches that
// others preview, accept, reject or apply with a 3-way merge.

import { writeFileSync, rmSync, mkdtempSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { git, newId } from './util.mjs'
import { conflictingLock, suggestHardLock } from './locks.mjs'

export const PATCH_STATUSES = ['draft', 'needs_review', 'checkpointed', 'accepted', 'rejected', 'applied', 'conflicted']

/**
 * Record watcher output in the change log. Each entry is one file with the
 * actor/task it is attributed to; "unknown" until someone claims it.
 * Latest event per path wins.
 */
export function recordChanges(changes, events, actorId, taskId, now = Date.now()) {
  for (const ev of events) {
    const path = ev.path.replace(/\\/g, '/')
    const existing = changes.find((c) => c.path === path)
    const entry = {
      path,
      kind: ev.kind,
      actorId: actorId || 'unknown',
      taskId: taskId || null,
      at: now
    }
    if (existing) Object.assign(existing, entry)
    else changes.push(entry)
  }
  return changes
}

/** Re-attribute pending changes (e.g. external edits marked unknown). */
export function assignChanges(changes, paths, actorId, taskId) {
  const set = new Set(paths.map((p) => p.replace(/\\/g, '/')))
  for (const c of changes) {
    if (set.has(c.path)) {
      c.actorId = actorId
      c.taskId = taskId || null
    }
  }
  return changes
}

/** Pending changes grouped by actor then task, for the file activity screen. */
export function groupChanges(changes) {
  const groups = {}
  for (const c of changes) {
    const key = `${c.actorId}|${c.taskId || ''}`
    if (!groups[key]) groups[key] = { actorId: c.actorId, taskId: c.taskId || null, files: [] }
    groups[key].files.push(c)
  }
  return Object.values(groups)
}

function riskFor(files) {
  if (files.some((f) => suggestHardLock(f))) return 'high'
  if (files.length > 10) return 'medium'
  return 'low'
}

/**
 * Turn an actor's pending changes (or an explicit file list) into a patch:
 * a unified diff against the session base commit. Untracked files are
 * included via intent-to-add so they show up in the diff.
 *
 * @param {string} cwd
 * @param {any} state
 * @param {{ actorId: string, taskId?: string | null, paths?: string[] | null, summary?: string }} opts
 */
export async function createPatch(cwd, state, { actorId, taskId = null, paths = null, summary = '' }, now = Date.now()) {
  const mine = state.changes.filter(
    (c) => c.actorId === actorId && (taskId ? c.taskId === taskId : true)
  )
  const files = (paths || mine.map((c) => c.path)).filter((p, i, a) => a.indexOf(p) === i)
  if (!files.length) throw new Error('No changed files to turn into a patch.')

  const base = state.session.baseCommit
  // Intent-to-add makes brand new files diffable without staging content.
  const untracked = (await git(cwd, ['ls-files', '-z', '--others', '--exclude-standard']))
    .split('\0')
    .filter(Boolean)
  const newOnes = files.filter((f) => untracked.includes(f))
  if (newOnes.length) await git(cwd, ['add', '-N', '--', ...newOnes])

  const diff = await git(cwd, ['diff', '--no-color', base, '--', ...files])
  if (!diff.trim()) throw new Error('Those files have no differences against the session base.')

  const lockClashes = files
    .map((f) => ({ path: f, lock: conflictingLock(state.locks, f, actorId, now) }))
    .filter((x) => x.lock)

  const creator = state.actors.find((a) => a.id === actorId)
  const patch = {
    id: newId('patch'),
    taskId,
    createdByActorId: actorId,
    humanOwnerActorId:
      creator && creator.type !== 'human' ? creator.humanOwnerActorId : actorId,
    baseCommit: base,
    baseManifestHash: state.session.baseManifestHash,
    summary: summary || `${files.length} file${files.length === 1 ? '' : 's'} changed`,
    filesChanged: files,
    diff,
    status: 'draft',
    testStatus: 'unknown',
    riskLevel: lockClashes.length ? 'high' : riskFor(files),
    lockWarnings: lockClashes.map((x) => `${x.path} locked by ${x.lock.lockedByActorId}`),
    createdAt: now
  }
  state.patches.push(patch)
  // Consume the change-log entries this patch covers.
  state.changes = state.changes.filter((c) => !(c.actorId === actorId && files.includes(c.path)))
  return patch
}

export function setPatchStatus(patches, patchId, status) {
  if (!PATCH_STATUSES.includes(status)) throw new Error(`Unknown patch status: ${status}`)
  const p = patches.find((x) => x.id === patchId)
  if (!p) throw new Error('Patch not found.')
  p.status = status
  return p
}

/**
 * Apply (or with checkOnly just test) a patch using git apply --3way.
 * Never silently overwrites: on any conflict the patch is marked conflicted
 * and nothing is written to the working tree.
 */
export async function applyPatch(cwd, patches, patchId, { checkOnly = false } = {}) {
  const p = patches.find((x) => x.id === patchId)
  if (!p) throw new Error('Patch not found.')
  const dir = mkdtempSync(join(tmpdir(), 'rtc-patch-'))
  const file = join(dir, 'p.diff')
  try {
    writeFileSync(file, p.diff.endsWith('\n') ? p.diff : p.diff + '\n', 'utf8')
    try {
      await git(cwd, ['apply', '--3way', '--check', file])
    } catch (err) {
      p.status = 'conflicted'
      return { ok: false, conflicted: true, error: String(err.message || err) }
    }
    if (checkOnly) return { ok: true, conflicted: false }
    await git(cwd, ['apply', '--3way', file])
    p.status = 'applied'
    return { ok: true, conflicted: false }
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
}
