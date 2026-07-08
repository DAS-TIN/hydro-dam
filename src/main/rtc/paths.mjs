// paths.mjs - path safety for snapshot import/export and manifest handling.
//
// Every relative path that crosses a trust boundary (snapshot manifests,
// invite files, patch file lists) goes through these checks so a malicious
// manifest cannot write outside the destination folder.

import { resolve, sep } from 'node:path'

/**
 * True when p is a plain repo-relative path: no absolute paths, no drive
 * letters, no ".." segments, no NUL bytes and nothing empty. Both slash
 * styles are checked because manifests may come from another OS.
 */
export function isSafeRelPath(p) {
  if (typeof p !== 'string' || !p.length) return false
  if (p.includes('\0')) return false
  const norm = p.replace(/\\/g, '/')
  if (norm.startsWith('/') || /^[a-zA-Z]:/.test(norm)) return false
  const parts = norm.split('/')
  for (const part of parts) {
    if (part === '' || part === '.' || part === '..') return false
  }
  return true
}

/**
 * Resolve rel against root and verify the result stays inside root.
 * Returns the absolute path, or null when the path escapes.
 */
export function insideRoot(root, rel) {
  if (!isSafeRelPath(rel)) return null
  const rootAbs = resolve(root)
  const abs = resolve(rootAbs, rel)
  if (abs !== rootAbs && !abs.startsWith(rootAbs + sep)) return null
  return abs
}
