// util.mjs - small shared helpers for the RTC collaboration modules.
//
// The RTC backend is plain ESM JavaScript (not TypeScript) so the same files
// run inside the Electron main process and directly under `node --test`.

import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { createHash, randomUUID } from 'node:crypto'
import { readFileSync, writeFileSync, renameSync, mkdirSync } from 'node:fs'
import { dirname } from 'node:path'

const pExecFile = promisify(execFile)
const MAX_BUFFER = 1024 * 1024 * 64

/** Run git <args> in cwd, resolve with stdout, throw with git's stderr. */
export async function git(cwd, args, opts = {}) {
  try {
    const child = pExecFile('git', args, {
      cwd,
      maxBuffer: MAX_BUFFER,
      windowsHide: true,
      encoding: 'utf8'
    })
    if (opts.input !== undefined && child.child.stdin) {
      child.child.stdin.write(opts.input)
      child.child.stdin.end()
    }
    const { stdout } = await child
    return stdout
  } catch (err) {
    const msg = (err?.stderr || err?.message || String(err)).trim()
    throw new Error(msg)
  }
}

/** Short readable id, e.g. "task-3f9c2a1b". */
export function newId(prefix) {
  return `${prefix}-${randomUUID().slice(0, 8)}`
}

/** Slug an actor display name: "Alice M." -> "alice-m". */
export function slug(name) {
  return (
    String(name)
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '') || 'actor'
  )
}

export function sha256(buf) {
  return createHash('sha256').update(buf).digest('hex')
}

export function sha256File(absPath) {
  return sha256(readFileSync(absPath))
}

export function readJson(file, fallback) {
  try {
    return JSON.parse(readFileSync(file, 'utf8'))
  } catch {
    return fallback
  }
}

/** Write JSON via a temp file + rename so a crash never leaves half a file. */
export function writeJson(file, data) {
  mkdirSync(dirname(file), { recursive: true })
  const tmp = `${file}.${randomUUID().slice(0, 6)}.tmp`
  writeFileSync(tmp, JSON.stringify(data, null, 2), 'utf8')
  renameSync(tmp, file)
}
