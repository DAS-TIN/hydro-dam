import React, { useEffect, useMemo, useRef, useState } from 'react'
import { api, FileEntry } from '../api'
import DiffView from './DiffView'
import RepoTree from './RepoTree'

// Ultra file list: changed files by default, the whole tracked tree on
// toggle. The card alongside follows the selection with its diff.
export default function UltraFiles({
  cwd,
  statusMap,
  onPick
}: {
  cwd: string
  statusMap: Map<string, FileEntry>
  onPick: (path: string) => void
}) {
  const [paths, setPaths] = useState<string[]>([])
  const [changesOnly, setChangesOnly] = useState(true)
  const [selected, setSelected] = useState<string | null>(null)
  const [diff, setDiff] = useState('')
  const boxRef = useRef<HTMLDivElement>(null)
  const diffSeq = useRef(0)

  useEffect(() => {
    api()
      .tree(cwd)
      .then(setPaths)
      .catch(() => setPaths([]))
  }, [cwd])

  useEffect(() => {
    boxRef.current?.focus()
  }, [])

  const shown = useMemo(
    () => (changesOnly ? [...statusMap.keys()].sort() : paths),
    [changesOnly, paths, statusMap]
  )

  // pick the first row up front so the list opens with a visible selection
  useEffect(() => {
    if (selected) return
    const first = boxRef.current?.querySelector<HTMLElement>('[data-tree-path]')
    if (first?.dataset.treePath) setSelected(first.dataset.treePath)
  }, [shown, selected])

  // Debounced diff for the side card. Replies for a selection that has
  // already moved on get ignored, so holding an arrow key stays smooth.
  useEffect(() => {
    if (!selected) {
      setDiff('')
      return
    }
    const seq = ++diffSeq.current
    const t = setTimeout(() => {
      const f = statusMap.get(selected)
      api()
        .fileDiff(cwd, selected, !!f && f.staged && !f.unstaged, f?.untracked ?? false)
        .then((d) => seq === diffSeq.current && setDiff(d))
        .catch((e) => seq === diffSeq.current && setDiff(e.message))
    }, 150)
    return () => clearTimeout(t)
  }, [cwd, selected, statusMap])

  const onKey = (e: React.KeyboardEvent) => {
    if (e.shiftKey) return // Shift+arrows switch ultra views at the app level
    if (e.key === 'Enter' && selected) {
      e.preventDefault()
      e.stopPropagation()
      onPick(selected)
      return
    }
    if (e.key !== 'ArrowUp' && e.key !== 'ArrowDown') return
    e.preventDefault()
    e.stopPropagation()
    const rows = [...(boxRef.current?.querySelectorAll<HTMLElement>('[data-tree-path]') ?? [])]
    if (rows.length === 0) return
    const at = rows.findIndex((r) => r.dataset.treePath === selected)
    const dir = e.key === 'ArrowDown' ? 1 : -1
    const next = rows[at === -1 ? 0 : Math.min(Math.max(at + dir, 0), rows.length - 1)]
    if (next?.dataset.treePath) setSelected(next.dataset.treePath)
  }

  const changed = statusMap.size

  return (
    <div
      data-ultra
      ref={boxRef}
      tabIndex={-1}
      className="fixed inset-0 z-40 flex gap-4 bg-gradient-to-br from-ink-950 via-ink-900 to-ink-850 px-6 pb-12 pt-6 outline-none"
      onKeyDown={onKey}
    >
      <div className="flex w-[400px] shrink-0 flex-col">
        <div className="mb-3 flex items-center">
          <h1 className="text-lg font-semibold text-white">
            {changesOnly ? 'Changed files' : 'Repository files'}
            <span className="ml-2 text-sm font-normal text-slate-500">{shown.length}</span>
          </h1>
          <button className="btn-soft ml-auto text-xs" onClick={() => setChangesOnly((v) => !v)}>
            {changesOnly ? `Show all files (${paths.length})` : `Show changed only (${changed})`}
          </button>
        </div>
        <div className="card flex min-h-0 flex-1 flex-col overflow-hidden">
          <RepoTree paths={shown} statusMap={statusMap} selected={selected} onSelect={setSelected} />
        </div>
        <div className="mt-2 text-center text-[11px] text-slate-600">
          Up/Down move, Enter opens the file in the main view
        </div>
      </div>
      <div className="card min-h-0 min-w-0 flex-1 overflow-hidden">
        <DiffView
          text={diff}
          empty={selected ? 'No working changes in this file.' : 'Pick a file on the left.'}
        />
      </div>
    </div>
  )
}
