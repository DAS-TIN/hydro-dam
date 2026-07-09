// store.mjs - JSON persistence for one session, everything under <repo>/.rtc/.
//
// MVP storage is plain JSON files so the state is easy to inspect and diff.
// The .rtc folder is kept out of git via .git/info/exclude (local only, the
// project's .gitignore is never touched).

import { mkdirSync, readFileSync, writeFileSync, existsSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { readJson, writeJson } from './util.mjs'

export function rtcDir(cwd) {
  return join(cwd, '.rtc')
}

/** Add a pattern to .git/info/exclude (local only, never touches .gitignore). */
export function excludeLocally(cwd, pattern) {
  if (!existsSync(join(cwd, '.git'))) return
  try {
    mkdirSync(join(cwd, '.git', 'info'), { recursive: true })
    const excl = join(cwd, '.git', 'info', 'exclude')
    const cur = existsSync(excl) ? readFileSync(excl, 'utf8') : ''
    if (!cur.split(/\r?\n/).includes(pattern)) {
      writeFileSync(excl, cur + (cur.endsWith('\n') || !cur ? '' : '\n') + pattern + '\n', 'utf8')
    }
  } catch {
    // Local exclude is a nicety; a read-only .git must not break sessions.
  }
}

/** Create .rtc and make sure git ignores it locally. */
export function ensureRtc(cwd) {
  const dir = rtcDir(cwd)
  mkdirSync(join(dir, 'tasks'), { recursive: true })
  mkdirSync(join(dir, 'agents'), { recursive: true })
  mkdirSync(join(dir, 'presence'), { recursive: true })
  excludeLocally(cwd, '.rtc/')
  return dir
}

export function hasSession(cwd) {
  return existsSync(join(rtcDir(cwd), 'session.json'))
}

const FILES = {
  session: 'session.json',
  actors: 'actors.json',
  tasks: 'tasks.json',
  locks: 'locks.json',
  patches: 'patches.json',
  checkpoints: 'checkpoints.json',
  suggestions: 'suggestions.json',
  changes: 'changes.json',
  liveblame: 'liveblame.json',
  violations: 'violations.json',
  contracts: 'contracts.json',
  manifest: 'manifest.json',
  settings: 'settings.json',
  local: 'local.json'
}

export function loadColl(cwd, name, fallback) {
  return readJson(join(rtcDir(cwd), FILES[name]), fallback)
}

export function saveColl(cwd, name, data) {
  writeJson(join(rtcDir(cwd), FILES[name]), data)
}

export const DEFAULT_SESSION_SETTINGS = {
  includeUntracked: false,
  maxFileSize: 5 * 1024 * 1024,
  terminalAccess: false,
  autoApplyRemote: false,
  allowRunCommands: false
}

/** Everything the UI needs in one read. */
export function loadState(cwd) {
  if (!hasSession(cwd)) return null
  return {
    session: loadColl(cwd, 'session', null),
    actors: loadColl(cwd, 'actors', []),
    tasks: loadColl(cwd, 'tasks', []),
    locks: loadColl(cwd, 'locks', []),
    patches: loadColl(cwd, 'patches', []),
    checkpoints: loadColl(cwd, 'checkpoints', []),
    suggestions: loadColl(cwd, 'suggestions', []),
    changes: loadColl(cwd, 'changes', []),
    liveblame: loadColl(cwd, 'liveblame', []),
    violations: loadColl(cwd, 'violations', []),
    contracts: loadColl(cwd, 'contracts', []),
    manifest: loadColl(cwd, 'manifest', { entries: [], manifestHash: '' }),
    settings: { ...DEFAULT_SESSION_SETTINGS, ...loadColl(cwd, 'settings', {}) },
    local: loadColl(cwd, 'local', { activeActorId: null, activeTaskId: null }),
    presence: loadPresence(cwd)
  }
}

// Actor ids contain ':' which Windows cannot put in a filename (it becomes
// an NTFS alternate data stream and the file silently disappears), so the
// filename is sanitized and the real id travels inside the JSON.
function presenceFile(cwd, actorId) {
  return join(rtcDir(cwd), 'presence', `${actorId.replace(/[:/\\]/g, '_')}.json`)
}

/**
 * Presence files let external processes (an assistant working in the same
 * checkout) report what they are doing: write
 * .rtc/presence/<actor id with : replaced by _>.json containing
 * { actorId, activeFiles, cursor: {path,line}, note }.
 */
export function loadPresence(cwd) {
  const dir = join(rtcDir(cwd), 'presence')
  const out = {}
  if (!existsSync(dir)) return out
  for (const f of readdirSync(dir)) {
    if (!f.endsWith('.json')) continue
    const data = readJson(join(dir, f), null)
    if (data) out[data.actorId || f.slice(0, -5)] = data
  }
  return out
}

export function savePresence(cwd, actorId, data) {
  writeJson(presenceFile(cwd, actorId), { actorId, ...data })
}
