// fileselect.mjs - decides which files belong to a collaboration session.
//
// Strategy: git-tracked files first (git ls-files), untracked only when the
// host opts in, ignored files never. On top of that a fixed exclusion list
// keeps dependencies, build output and secrets out, and a project can add
// its own patterns via .rtcignore. Symlinks are always dropped.

import { lstatSync, readFileSync, existsSync, openSync, readSync, closeSync } from 'node:fs'
import { join } from 'node:path'
import { git, sha256, sha256File } from './util.mjs'
import { isSafeRelPath } from './paths.mjs'

export const DEFAULT_EXCLUDES = [
  '.git/',
  '.rtc/',
  'node_modules/',
  'dist/',
  'build/',
  'out/',
  '.next/',
  '.turbo/',
  'coverage/',
  '.cache/',
  '.venv/',
  '__pycache__/',
  '.env',
  '.env.*',
  '*.pem',
  '*.key',
  '.ssh/',
  'id_rsa*',
  '*.pfx',
  '*.p12',
  '*.keystore',
  '.npmrc',
  '.netrc'
]

export const DEFAULT_MAX_FILE_SIZE = 5 * 1024 * 1024

/** Parse .rtcignore text: one pattern per line, # comments, blank lines skipped. */
export function parseIgnoreFile(text) {
  return String(text)
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => l && !l.startsWith('#'))
}

// One gitignore-style pattern -> RegExp over a forward-slash relative path.
function patternToRegex(pattern) {
  let p = pattern.replace(/\\/g, '/')
  const dirOnly = p.endsWith('/')
  if (dirOnly) p = p.slice(0, -1)
  const anchored = p.startsWith('/')
  if (anchored) p = p.slice(1)
  const hasSlash = p.includes('/')

  let re = ''
  for (let i = 0; i < p.length; i++) {
    const c = p[i]
    if (c === '*') {
      if (p[i + 1] === '*') {
        re += '.*'
        i++
        if (p[i + 1] === '/') i++
      } else {
        re += '[^/]*'
      }
    } else if (c === '?') {
      re += '[^/]'
    } else if ('.+^${}()|[]'.includes(c)) {
      re += '\\' + c
    } else {
      re += c
    }
  }
  // Unanchored patterns without a slash match at any depth, like gitignore.
  const prefix = anchored || hasSlash ? '^' : '(^|/)'
  const suffix = dirOnly ? '(/|$)' : '$'
  return new RegExp(prefix + re + suffix)
}

export function compileMatcher(patterns) {
  const regs = patterns.map(patternToRegex)
  return (relPath) => {
    const p = String(relPath).replace(/\\/g, '/')
    return regs.some((r) => r.test(p))
  }
}

export function isExcluded(relPath, extraPatterns = []) {
  return compileMatcher([...DEFAULT_EXCLUDES, ...extraPatterns])(relPath)
}

/** Binary sniff: a NUL byte in the first 8KB. */
export function looksBinary(absPath) {
  const fd = openSync(absPath, 'r')
  try {
    const buf = Buffer.alloc(8192)
    const n = readSync(fd, buf, 0, 8192, 0)
    return buf.subarray(0, n).includes(0)
  } finally {
    closeSync(fd)
  }
}

export function loadRtcIgnore(cwd) {
  const f = join(cwd, '.rtcignore')
  if (!existsSync(f)) return []
  return parseIgnoreFile(readFileSync(f, 'utf8'))
}

/**
 * Build the session manifest.
 * opts: { includeUntracked?, maxFileSize?, extraPatterns? }
 * Returns { entries, manifestHash, skipped } where skipped lists files
 * dropped with the reason (excluded, symlink, missing).
 */
export async function buildManifest(cwd, opts = {}) {
  const includeUntracked = !!opts.includeUntracked
  const maxSize = opts.maxFileSize || DEFAULT_MAX_FILE_SIZE
  const extra = [...(opts.extraPatterns || []), ...loadRtcIgnore(cwd)]
  const excluded = compileMatcher([...DEFAULT_EXCLUDES, ...extra])

  const tracked = (await git(cwd, ['ls-files', '-z'])).split('\0').filter(Boolean)
  const trackedSet = new Set(tracked)
  let candidates = tracked.map((p) => ({ path: p, gitTracked: true }))
  if (includeUntracked) {
    const others = (await git(cwd, ['ls-files', '-z', '--others', '--exclude-standard']))
      .split('\0')
      .filter(Boolean)
    for (const p of others) if (!trackedSet.has(p)) candidates.push({ path: p, gitTracked: false })
  }

  const entries = []
  const skipped = []
  for (const c of candidates) {
    const rel = c.path
    if (!isSafeRelPath(rel)) {
      skipped.push({ path: rel, reason: 'unsafe-path' })
      continue
    }
    if (excluded(rel)) {
      skipped.push({ path: rel, reason: 'excluded' })
      continue
    }
    const abs = join(cwd, rel)
    let st
    try {
      st = lstatSync(abs)
    } catch {
      skipped.push({ path: rel, reason: 'missing' })
      continue
    }
    if (st.isSymbolicLink()) {
      skipped.push({ path: rel, reason: 'symlink' })
      continue
    }
    if (!st.isFile()) {
      skipped.push({ path: rel, reason: 'not-a-file' })
      continue
    }
    const largeFile = st.size > maxSize
    const binary = largeFile ? true : looksBinary(abs)
    entries.push({
      path: rel,
      size: st.size,
      sha256: sha256File(abs),
      gitTracked: c.gitTracked,
      binary,
      largeFile,
      collaborativeMode: binary || largeFile ? 'locked' : 'live',
      lastKnownHash: null
    })
  }
  entries.sort((a, b) => (a.path < b.path ? -1 : 1))

  const manifestHash = sha256(entries.map((e) => `${e.path}:${e.sha256}`).join('\n'))
  return { entries, manifestHash, skipped }
}
