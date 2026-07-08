// join.mjs - how guests enter a session.
//
// Clone join: the guest already cloned the real repo; we verify their HEAD
// matches the session base and lay down .rtc metadata. Snapshot join: the
// guest gets sanitized files, every hash is verified, then a fresh repo is
// initialised with one commit called "RTC session base". Nothing is ever
// executed from the downloaded code.

import { copyFileSync, mkdirSync, existsSync, lstatSync, readdirSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { git, sha256File, readJson } from './util.mjs'
import { insideRoot, isSafeRelPath } from './paths.mjs'
import * as Store from './store.mjs'
import { addActor } from './actors.mjs'

function initGuestState(cwd, invite, guest, now) {
  Store.ensureRtc(cwd)
  const actors = invite.actors || []
  Store.saveColl(cwd, 'session', invite.session)
  Store.saveColl(cwd, 'actors', actors)
  Store.saveColl(cwd, 'manifest', invite.manifest || { entries: [], manifestHash: invite.manifestHash || '' })
  Store.saveColl(cwd, 'settings', invite.settings || Store.DEFAULT_SESSION_SETTINGS)
  Store.saveColl(cwd, 'local', { activeActorId: guest.id, activeTaskId: null })
  for (const name of ['tasks', 'locks', 'patches', 'checkpoints', 'suggestions', 'changes', 'violations']) {
    Store.saveColl(cwd, name, Store.loadColl(cwd, name, []))
  }
}

/**
 * Join with an existing clone of the real repository.
 * Verifies the session base commit exists and matches HEAD.
 */
export async function cloneJoin(cwd, inviteFile, guestName, now = Date.now()) {
  const invite = readJson(inviteFile, null)
  if (!invite || !invite.session) throw new Error('Invalid invite file.')
  const base = invite.session.baseCommit

  try {
    await git(cwd, ['cat-file', '-e', `${base}^{commit}`])
  } catch {
    throw new Error(
      `Your clone does not contain the session base commit ${base.slice(0, 10)}. Fetch or pull first.`
    )
  }
  const head = (await git(cwd, ['rev-parse', 'HEAD'])).trim()
  if (head !== base) {
    throw new Error(
      `Your HEAD (${head.slice(0, 10)}) is not the session base (${base.slice(0, 10)}). Check out that commit first.`
    )
  }

  const actors = invite.actors || []
  const guest = addActor(actors, { type: 'human', displayName: guestName || 'Guest' }, now)
  invite.actors = actors
  invite.session.participants = [...new Set([...(invite.session.participants || []), guest.id])]
  invite.session.joinMode = invite.session.joinMode === 'snapshot' ? 'mixed' : invite.session.joinMode
  initGuestState(cwd, invite, guest, now)
  return { state: Store.loadState(cwd), guest }
}

/**
 * Verify a snapshot folder against its manifest without copying anything.
 * Returns { ok, problems } - the UI shows this before the security warning.
 */
export function snapshotVerify(srcDir) {
  const desc = readJson(join(srcDir, 'rtc-snapshot.json'), null)
  if (!desc || desc.kind !== 'rtc-snapshot') {
    return { ok: false, problems: ['No rtc-snapshot.json found in that folder.'] }
  }
  const problems = []
  for (const e of desc.manifest.entries) {
    if (!isSafeRelPath(e.path)) {
      problems.push(`Unsafe path in manifest: ${e.path}`)
      continue
    }
    const src = insideRoot(srcDir, e.path)
    if (!src || !existsSync(src)) {
      problems.push(`Missing file: ${e.path}`)
      continue
    }
    if (lstatSync(src).isSymbolicLink()) {
      problems.push(`Symlink not allowed: ${e.path}`)
      continue
    }
    if (sha256File(src) !== e.sha256) problems.push(`Hash mismatch: ${e.path}`)
  }
  return { ok: problems.length === 0, problems, session: desc.session }
}

/**
 * Import a snapshot into destDir: verify, copy, git init, commit
 * "RTC session base", write .rtc state. destDir must be empty or new.
 */
export async function snapshotImport(srcDir, destDir, guestName, now = Date.now()) {
  const desc = readJson(join(srcDir, 'rtc-snapshot.json'), null)
  if (!desc || desc.kind !== 'rtc-snapshot') throw new Error('No rtc-snapshot.json found in that folder.')

  const check = snapshotVerify(srcDir)
  if (!check.ok) throw new Error(`Snapshot failed verification:\n${check.problems.join('\n')}`)

  mkdirSync(destDir, { recursive: true })
  if (readdirSync(destDir).length) throw new Error('Choose an empty destination folder for the snapshot.')

  for (const e of desc.manifest.entries) {
    const src = insideRoot(srcDir, e.path)
    const dst = insideRoot(destDir, e.path)
    if (!src || !dst) throw new Error(`Unsafe path in manifest: ${e.path}`)
    mkdirSync(dirname(dst), { recursive: true })
    copyFileSync(src, dst)
  }

  await git(destDir, ['init', '-q'])
  await git(destDir, ['add', '-A'])
  // A local identity fallback keeps the base commit working on machines with
  // no git identity configured; real commits later use the guest's own.
  await git(destDir, [
    '-c', 'user.name=RTC Session',
    '-c', 'user.email=rtc@localhost',
    'commit', '-qm', 'RTC session base'
  ])
  const base = (await git(destDir, ['rev-parse', 'HEAD'])).trim()

  const actors = desc.actors || []
  const guest = addActor(actors, { type: 'human', displayName: guestName || 'Guest' }, now)
  const session = {
    ...desc.session,
    joinMode: 'snapshot',
    // In snapshot mode the guest tracks changes against their own base commit.
    baseCommit: base,
    participants: [...new Set([...(desc.session.participants || []), guest.id])]
  }
  initGuestState(destDir, { ...desc, session, actors }, guest, now)
  return { state: Store.loadState(destDir), guest, root: destDir }
}
