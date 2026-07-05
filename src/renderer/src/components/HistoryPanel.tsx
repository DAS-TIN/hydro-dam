import React, { useEffect, useState } from 'react'
import { api, Commit, basename } from '../api'
import DiffView from './DiffView'
import { IconClose } from "./Icons"

export default function HistoryPanel({
  cwd,
  path,
  onClose
}: {
  cwd: string
  path: string
  onClose: () => void
}) {
  const [commits, setCommits] = useState<Commit[]>([])
  const [sel, setSel] = useState<Commit | null>(null)
  const [mode, setMode] = useState<'diff' | 'full'>('diff')
  const [content, setContent] = useState('')
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    setLoading(true)
    api()
      .fileLog(cwd, path)
      .then((c) => {
        setCommits(c)
        setSel(c[0] ?? null)
      })
      .finally(() => setLoading(false))
  }, [cwd, path])

  useEffect(() => {
    if (!sel) return
    if (mode === 'diff') {
      api().commitFileDiff(cwd, sel.hash, path).then(setContent).catch((e) => setContent(e.message))
    } else {
      api()
        .fileAtCommit(cwd, sel.hash, path)
        .then(setContent)
        .catch((e) => setContent('// ' + e.message))
    }
  }, [sel, mode, cwd, path])

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm" onClick={onClose}>
      <div className="card flex h-[82vh] w-[1000px] overflow-hidden shadow-2xl" onClick={(e) => e.stopPropagation()}>
        {/* commit list */}
        <div className="flex w-72 shrink-0 flex-col border-r border-ink-700/60">
          <div className="flex items-center justify-between border-b border-ink-700/60 px-4 py-3">
            <div className="min-w-0">
              <div className="text-xs uppercase tracking-wide text-slate-500">History</div>
              <div className="truncate text-sm font-medium text-white">{basename(path)}</div>
            </div>
          </div>
          <div className="flex-1 overflow-auto">
            {loading && <div className="p-4 text-sm text-slate-500">Loading...</div>}
            {!loading && commits.length === 0 && (
              <div className="p-4 text-sm text-slate-500">No history (file may be untracked).</div>
            )}
            {commits.map((c) => (
              <button
                key={c.hash}
                onClick={() => setSel(c)}
                className={`block w-full border-b border-ink-800 px-4 py-2.5 text-left transition-colors ${
                  sel?.hash === c.hash ? 'bg-ink-750' : 'hover:bg-ink-850'
                }`}
              >
                <div className="truncate text-sm text-slate-100">{c.subject}</div>
                <div className="mt-0.5 flex items-center gap-2 text-[11px] text-slate-500">
                  <span className="font-mono text-accent">{c.shortHash}</span>
                  <span className="truncate">{c.author}</span>
                  <span>| {c.relDate}</span>
                </div>
              </button>
            ))}
          </div>
        </div>

        {/* content */}
        <div className="flex min-w-0 flex-1 flex-col">
          <div className="flex items-center justify-between border-b border-ink-700/60 px-4 py-2.5">
            <div className="flex gap-1 rounded-lg bg-ink-900 p-0.5">
              <button
                className={`rounded-md px-3 py-1 text-xs font-medium ${
                  mode === 'diff' ? 'bg-ink-750 text-white' : 'text-slate-400'
                }`}
                onClick={() => setMode('diff')}
              >
                Changes
              </button>
              <button
                className={`rounded-md px-3 py-1 text-xs font-medium ${
                  mode === 'full' ? 'bg-ink-750 text-white' : 'text-slate-400'
                }`}
                onClick={() => setMode('full')}
              >
                Full file at this revision
              </button>
            </div>
            <button className="btn-ghost px-2" onClick={onClose}>
              <IconClose className="w-4 h-4" />
            </button>
          </div>
          <div className="min-h-0 flex-1">
            {mode === 'diff' ? (
              <DiffView text={content} />
            ) : (
              <pre className="h-full overflow-auto bg-ink-900 p-3 font-mono text-[12.5px] leading-[1.55] text-slate-300 select-text">
                {content}
              </pre>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}
