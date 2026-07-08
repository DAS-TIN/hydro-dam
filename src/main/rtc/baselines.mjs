// baselines.mjs - per-actor file snapshots. An assistant claims a baseline
// when it reads a file and re-claims after each write; a check right before
// writing tells it whether anyone else (usually the user) edited the file
// in the meantime, which must be treated as a merge conflict.

import { existsSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { readJson, writeJson, sha256File } from './util.mjs'
import { insideRoot } from './paths.mjs'

function fileFor(cwd, actorId) {
  return join(cwd, '.rtc', 'baselines', `${actorId.replace(/[:/\\]/g, '_')}.json`)
}

/** Record the current hash of each path (null when the file does not exist yet). */
export function claimBaselines(cwd, actorId, paths) {
  const file = fileFor(cwd, actorId)
  const map = readJson(file, {})
  for (const p of paths) {
    const abs = insideRoot(cwd, p)
    if (!abs) throw new Error(`Unsafe path: ${p}`)
    map[p.replace(/\\/g, '/')] = existsSync(abs) ? sha256File(abs) : null
  }
  writeJson(file, map)
  return map
}

/**
 * Compare claimed baselines to what is on disk now. Statuses:
 * clean, changed (someone edited it since the claim), appeared (was going
 * to be created but now exists), deleted, unclaimed.
 *
 * @param {string} cwd
 * @param {string} actorId
 * @param {string[] | null} [paths] defaults to every claimed path
 */
export function checkBaselines(cwd, actorId, paths = null) {
  const map = readJson(fileFor(cwd, actorId), {})
  const list = (paths ? paths.map((p) => p.replace(/\\/g, '/')) : Object.keys(map))
  return list.map((path) => {
    if (!(path in map)) return { path, status: 'unclaimed' }
    const abs = insideRoot(cwd, path)
    if (!abs) return { path, status: 'unclaimed' }
    const was = map[path]
    const exists = existsSync(abs)
    if (was === null) return { path, status: exists ? 'appeared' : 'clean' }
    if (!exists) return { path, status: 'deleted' }
    return { path, status: sha256File(abs) === was ? 'clean' : 'changed' }
  })
}

export function releaseBaselines(cwd, actorId) {
  rmSync(fileFor(cwd, actorId), { force: true })
}
