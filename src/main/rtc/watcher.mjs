// watcher.mjs - local change detection. Watches only what the manifest (or
// the exclusion rules for brand-new files) allows, debounces bursts, and
// hands batches to the caller for attribution. Raw writes never sync out.

import { watch, existsSync, lstatSync } from 'node:fs'
import { join, relative } from 'node:path'
import { DEFAULT_EXCLUDES, compileMatcher, loadRtcIgnore } from './fileselect.mjs'

/**
 * Start watching cwd. onBatch receives [{ path, kind }] with kind one of
 * create | edit | delete; onPresence fires when an agent presence file
 * under .rtc/presence changes. Returns { close }.
 *
 * @param {string} cwd
 * @param {string[]} manifestPaths
 * @param {(batch: { path: string, kind: string }[]) => void} onBatch
 * @param {((path: string) => void) | null} [onPresence]
 * @param {number} [debounceMs]
 */
export function startWatcher(cwd, manifestPaths, onBatch, onPresence = null, debounceMs = 400) {
  const known = new Set(manifestPaths)
  const excluded = compileMatcher([...DEFAULT_EXCLUDES, ...loadRtcIgnore(cwd)])
  let pending = new Map()
  let timer = null
  let closed = false

  const flush = () => {
    timer = null
    if (closed || !pending.size) return
    const batch = [...pending.values()]
    pending = new Map()
    onBatch(batch)
  }

  const consider = (rel) => {
    const p = rel.replace(/\\/g, '/')
    if (p.startsWith('.git/') || p === '.git') return
    if (p.startsWith('.rtc/') || p === '.rtc') {
      if (onPresence && p.startsWith('.rtc/presence/') && p.endsWith('.json')) onPresence(p)
      return
    }
    // Files outside the manifest are still interesting when they are new and
    // not excluded (someone just created a source file); everything else is noise.
    if (!known.has(p) && excluded(p)) return
    const abs = join(cwd, p)
    let kind = 'delete'
    if (existsSync(abs)) {
      try {
        const st = lstatSync(abs)
        if (!st.isFile() || st.isSymbolicLink()) return
      } catch {
        return
      }
      kind = known.has(p) ? 'edit' : 'create'
    } else if (!known.has(p)) {
      return
    }
    pending.set(p, { path: p, kind })
    if (!timer) timer = setTimeout(flush, debounceMs)
  }

  let fsWatcher = null
  try {
    fsWatcher = watch(cwd, { recursive: true }, (_event, filename) => {
      if (!filename) return
      consider(relative(cwd, join(cwd, filename.toString())))
    })
  } catch (err) {
    throw new Error(`Could not watch ${cwd}: ${err.message || err}`)
  }

  return {
    close() {
      closed = true
      if (timer) clearTimeout(timer)
      fsWatcher?.close()
    },
    /** New files become known once recorded so later events read as edits. */
    markKnown(path) {
      known.add(path.replace(/\\/g, '/'))
    }
  }
}
