// session.mjs - create and manage collaboration sessions on top of a repo.

import { copyFileSync, mkdirSync, existsSync, lstatSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { git, newId, writeJson } from './util.mjs'
import { insideRoot } from './paths.mjs'
import { buildManifest, DEFAULT_EXCLUDES, DEFAULT_MAX_FILE_SIZE, loadRtcIgnore } from './fileselect.mjs'
import * as Store from './store.mjs'
import { addActor } from './actors.mjs'

/** What the host sees before starting: repo? branch? base commit? dirty? */
export async function probe(cwd) {
  let root = null
  try {
    root = (await git(cwd, ['rev-parse', '--show-toplevel'])).trim()
  } catch {
    return { isRepo: false, root: null, branch: null, baseCommit: null, dirty: false, hasSession: false }
  }
  const branch = (await git(cwd, ['rev-parse', '--abbrev-ref', 'HEAD']).catch(() => '')).trim()
  const baseCommit = (await git(cwd, ['rev-parse', 'HEAD']).catch(() => '')).trim()
  const dirty = !!(await git(cwd, ['status', '--porcelain']).catch(() => '')).trim()
  let remoteUrl = null
  try {
    remoteUrl = (await git(cwd, ['remote', 'get-url', 'origin'])).trim() || null
  } catch {
    remoteUrl = null
  }
  return { isRepo: true, root, branch, baseCommit, dirty, remoteUrl, hasSession: Store.hasSession(cwd) }
}

/**
 * Start a session from the current repo state. The caller (UI) is expected
 * to have warned about uncommitted changes already; we still record them.
 */
export async function createSession(cwd, opts = {}, now = Date.now()) {
  const p = await probe(cwd)
  if (!p.isRepo) throw new Error('This folder is not a git repository.')
  if (!p.baseCommit) throw new Error('The repository has no commits yet - make an initial commit first.')

  Store.ensureRtc(cwd)
  const settings = {
    ...Store.DEFAULT_SESSION_SETTINGS,
    includeUntracked: !!opts.includeUntracked,
    maxFileSize: opts.maxFileSize || DEFAULT_MAX_FILE_SIZE
  }
  const manifest = await buildManifest(cwd, {
    includeUntracked: settings.includeUntracked,
    maxFileSize: settings.maxFileSize
  })

  const actors = []
  const host = addActor(actors, { type: 'human', displayName: opts.hostName || 'Host', email: opts.hostEmail || null }, now)
  addActor(actors, { type: 'system', displayName: 'rtc' }, now)

  const session = {
    id: newId('session'),
    repoName: p.root.replace(/\\/g, '/').split('/').pop(),
    hostActorId: host.id,
    joinMode: opts.joinMode || 'clone',
    baseBranch: p.branch,
    baseCommit: p.baseCommit,
    baseManifestHash: manifest.manifestHash,
    createdAt: now,
    participants: [host.id],
    allowedFileStrategy: settings.includeUntracked ? 'tracked+untracked' : 'tracked',
    excludedPatterns: [...DEFAULT_EXCLUDES, ...loadRtcIgnore(cwd)],
    remoteUrl: p.remoteUrl || null,
    dirtyAtStart: p.dirty,
    status: 'active'
  }

  Store.saveColl(cwd, 'session', session)
  Store.saveColl(cwd, 'actors', actors)
  Store.saveColl(cwd, 'manifest', manifest)
  Store.saveColl(cwd, 'settings', settings)
  Store.saveColl(cwd, 'local', { activeActorId: host.id, activeTaskId: null })
  for (const name of ['tasks', 'locks', 'patches', 'checkpoints', 'suggestions', 'changes', 'violations']) {
    Store.saveColl(cwd, name, [])
  }
  return Store.loadState(cwd)
}

export function endSession(cwd, now = Date.now()) {
  const session = Store.loadColl(cwd, 'session', null)
  if (!session) throw new Error('No session here.')
  session.status = 'ended'
  session.endedAt = now
  Store.saveColl(cwd, 'session', session)
  return session
}

/**
 * Write an invite file for clone-based joins: session metadata, the actor
 * list and the manifest, but no file contents. The guest clones the repo
 * themselves.
 */
export function inviteExport(cwd, destFile) {
  const session = Store.loadColl(cwd, 'session', null)
  if (!session) throw new Error('Start a session first.')
  writeJson(destFile, {
    kind: 'rtc-invite',
    version: 1,
    session,
    actors: Store.loadColl(cwd, 'actors', []),
    manifest: Store.loadColl(cwd, 'manifest', { entries: [], manifestHash: '' }),
    settings: Store.loadColl(cwd, 'settings', Store.DEFAULT_SESSION_SETTINGS)
  })
  return destFile
}

/**
 * Sanitized snapshot for guests without repo access: allowed files only,
 * copied into destDir next to an rtc-snapshot.json describing them. .git is
 * never included; the manifest cannot contain it by construction.
 */
export function snapshotExport(cwd, destDir) {
  const session = Store.loadColl(cwd, 'session', null)
  if (!session) throw new Error('Start a session first.')
  const manifest = Store.loadColl(cwd, 'manifest', null)
  if (!manifest || !manifest.entries.length) throw new Error('The session manifest is empty.')

  mkdirSync(destDir, { recursive: true })
  let copied = 0
  const missing = []
  for (const e of manifest.entries) {
    const src = insideRoot(cwd, e.path)
    const dst = insideRoot(destDir, e.path)
    if (!src || !dst) continue
    if (!existsSync(src) || lstatSync(src).isSymbolicLink()) {
      missing.push(e.path)
      continue
    }
    mkdirSync(dirname(dst), { recursive: true })
    copyFileSync(src, dst)
    copied++
  }
  writeJson(join(destDir, 'rtc-snapshot.json'), {
    kind: 'rtc-snapshot',
    version: 1,
    session,
    actors: Store.loadColl(cwd, 'actors', []),
    manifest,
    settings: Store.loadColl(cwd, 'settings', Store.DEFAULT_SESSION_SETTINGS)
  })
  return { copied, missing, dest: destDir }
}
