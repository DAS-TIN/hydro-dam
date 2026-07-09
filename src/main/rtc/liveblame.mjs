// liveblame.mjs - who wrote which uncommitted lines. Git blame covers
// committed history; these segments cover the gap between HEAD and the
// working tree, so the UI can say "Alex edited lines 4-6 just now".
//
// A segment is { path, startLine, endLine, actorId, at, hash } in working-tree
// line numbers. After every change batch the diff against HEAD is re-derived;
// a segment whose range and content survived keeps its author and time, and
// everything else is attributed to whoever is editing locally. Edits above a
// range shift its line numbers and re-attribute it - the same approximation
// editors accept for uncommitted blame. Once the file is committed the
// segments disappear and regular git blame takes over.

import { readFileSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import { git, sha256 } from './util.mjs'

/** New-side line ranges from `git diff -U0` output. Pure deletions have no
 *  surviving lines, so they contribute nothing. */
export function parseNewRanges(diffText) {
  const out = []
  const re = /^@@ -\d+(?:,\d+)? \+(\d+)(?:,(\d+))? @@/gm
  let m
  while ((m = re.exec(diffText))) {
    const start = parseInt(m[1], 10)
    const count = m[2] === undefined ? 1 : parseInt(m[2], 10)
    if (count > 0) out.push({ startLine: start, endLine: start + count - 1 })
  }
  return out
}

export function rangeHash(lines, startLine, endLine) {
  return sha256(lines.slice(startLine - 1, endLine).join('\n'))
}

/**
 * Reconcile one path's segments against the ranges currently changed vs HEAD.
 * Mutates and returns the whole collection.
 *
 * @param {Array<{path:string,startLine:number,endLine:number,actorId:string,at:number,hash:string}>} segments
 * @param {string} path
 * @param {{startLine:number,endLine:number}[]} ranges
 * @param {string[]} lines current working-tree lines of the file
 * @param {string} actorId
 * @param {number} [now]
 */
export function mergeSegments(segments, path, ranges, lines, actorId, now = Date.now()) {
  const old = segments.filter((s) => s.path === path)
  const rest = segments.filter((s) => s.path !== path)
  const next = ranges.map((r) => {
    const hash = rangeHash(lines, r.startLine, r.endLine)
    const kept = old.find((s) => s.startLine === r.startLine && s.endLine === r.endLine && s.hash === hash)
    return kept || { path, startLine: r.startLine, endLine: r.endLine, actorId, at: now, hash }
  })
  segments.length = 0
  segments.push(...rest, ...next)
  return segments
}

/**
 * Refresh segments for a batch of watcher events. Deletions drop their
 * segments; edits and creates re-derive theirs from the diff against HEAD.
 *
 * @param {string} cwd
 * @param {Array} segments
 * @param {{path:string,kind:string}[]} batch
 * @param {string} actorId
 * @param {number} [now]
 */
export async function updateLiveBlame(cwd, segments, batch, actorId, now = Date.now()) {
  for (const ev of batch) {
    const path = ev.path.replace(/\\/g, '/')
    if (ev.kind === 'delete' || !existsSync(join(cwd, path))) {
      for (let i = segments.length - 1; i >= 0; i--) if (segments[i].path === path) segments.splice(i, 1)
      continue
    }
    let lines
    try {
      lines = readFileSync(join(cwd, path), 'utf8').split('\n')
    } catch {
      continue
    }
    let ranges = []
    try {
      const diff = await git(cwd, ['diff', '-U0', 'HEAD', '--', path])
      ranges = parseNewRanges(diff)
      // untracked files have no diff against HEAD: the whole file is live
      if (!ranges.length && ev.kind === 'create') ranges = [{ startLine: 1, endLine: lines.length }]
    } catch {
      ranges = [{ startLine: 1, endLine: lines.length }]
    }
    mergeSegments(segments, path, ranges, lines, actorId, now)
  }
  return segments
}
