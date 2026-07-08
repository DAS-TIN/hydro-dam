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

/** Create .rtc and make sure git ignores it locally. */
export function ensureRtc(cwd) {
  const dir = rtcDir(cwd)
  mkdirSync(join(dir, 'tasks'), { recursive: true })
  mkdirSync(join(dir, 'agents'), { recursive: true })
  mkdirSync(join(dir, 'presence'), { recursive: true })
  const excl = join(cwd, '.git', 'info', 'exclude')
  if (existsSync(join(cwd, '.git'))) {
    try {
      mkdirSync(join(cwd, '.git', 'info'), { recursive: true })
      const cur = existsSync(excl) ? readFileSync(excl, 'utf8') : ''
      if (!cur.split(/\r?\n/).includes('.rtc/')) {
        writeFileSync(excl, cur + (cur.endsWith('\n') || !cur ? '' : '\n') + '.rtc/\n', 'utf8')
      }
    } catch {
      // Local exclude is a nicety; a read-only .git must not break sessions.
    }
  }
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
  violations: 'violations.json',
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
    violations: loadColl(cwd, 'violations', []),
    manifest: loadColl(cwd, 'manifest', { entries: [], manifestHash: '' }),
    settings: { ...DEFAULT_SESSION_SETTINGS, ...loadColl(cwd, 'settings', {}) },
    local: loadColl(cwd, 'local', { activeActorId: null, activeTaskId: null }),
    presence: loadPresence(cwd)
  }
}

/**
 * Presence files let external processes (a Claude Code agent working in the
 * same checkout) report what they are doing: the agent writes
 * .rtc/presence/<actorId>.json with { activeFiles, cursor: {path,line}, note }.
 */
export function loadPresence(cwd) {
  const dir = join(rtcDir(cwd), 'presence')
  const out = {}
  if (!existsSync(dir)) return out
  for (const f of readdirSync(dir)) {
    if (!f.endsWith('.json')) continue
    const data = readJson(join(dir, f), null)
    if (data) out[f.slice(0, -5)] = data
  }
  return out
}

export function savePresence(cwd, actorId, data) {
  writeJson(join(rtcDir(cwd), 'presence', `${actorId}.json`), data)
}
