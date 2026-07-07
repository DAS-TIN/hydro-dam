import React, { useEffect, useState } from 'react'
import { api, CommitPreview as Preview } from '../api'
import DiffView from './DiffView'
import { IconClose } from "./Icons"

function statusColor(s: string): string {
  if (s === 'A') return 'text-good'
  if (s === 'D') return 'text-bad'
  if (s === 'R' || s === 'C') return 'text-accent'
  return 'text-warn'
}

export default function CommitPreview({
  cwd,
  message,
  busy,
  onCommit,
  onStash,
  onUndo,
  onClose
}: {
  cwd: string
  message: string
  busy: boolean
  onCommit: (push: boolean) => void
  onStash: () => void
  onUndo: () => void
  onClose: () => void
}) {
  const [data, setData] = useState<Preview | null>(null)
  const [lastCommit, setLastCommit] = useState('')
  const [loading, setLoading] = useState(true)
  const [openPath, setOpenPath] = useState<string | null>(null)
  const [diffs, setDiffs] = useState<Record<string, string>>({})

  const loadDiff = (path: string) => {
    setDiffs((d) => (path in d ? d : { ...d, [path]: '' }))
    api()
      .fileDiff(cwd, path, true, false)
      .then((t) => setDiffs((d) => ({ ...d, [path]: t })))
      .catch((e) => setDiffs((d) => ({ ...d, [path]: e.message })))
  }

  const toggleDiff = (path: string) => {
    if (openPath === path) {
      setOpenPath(null)
      return
    }
    setOpenPath(path)
    loadDiff(path)
  }

  const reload = () => {
    setLoading(true)
    Promise.all([api().commitPreview(cwd), api().logStat(cwd, 1)])
      .then(([p, l]) => {
        setData(p)
        setLastCommit(l)
        // Show the changed lines straight away, not just the counts.
        const first = p.files[0]?.path
        if (first) {
          setOpenPath(first)
          loadDiff(first)
        }
      })
      .catch(() => {})
      .finally(() => setLoading(false))
  }
  useEffect(reload, [cwd])

  const files = data?.files ?? []
  const totalAdd = files.reduce((n, f) => n + Math.max(0, f.add), 0)
  const totalDel = files.reduce((n, f) => n + Math.max(0, f.del), 0)
  const co = data?.coauthors ?? []
  const nothing = files.length === 0

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm">
      <div className="card flex max-h-[86vh] w-[640px] flex-col overflow-hidden shadow-2xl">
        <div className="flex items-center justify-between border-b border-ink-700/60 px-5 py-4">
          <div>
            <h2 className="text-base font-semibold text-white">Review commit</h2>
            <p className="text-xs text-slate-400">Exactly what will be committed - check before you push.</p>
          </div>
          <button className="btn-ghost px-2" onClick={onClose}>
            <IconClose className="w-4 h-4" />
          </button>
        </div>

        <div className="flex-1 overflow-auto px-5 py-4">
          {loading && <div className="text-sm text-slate-500">Loading...</div>}

          {!loading && (
            <>
              {/* summary */}
              <div className="mb-3 flex items-center gap-3 text-sm">
                <span className="text-slate-200">
                  <b>{files.length}</b> file{files.length === 1 ? '' : 's'} staged
                </span>
                <span className="text-good">+{totalAdd}</span>
                <span className="text-bad">-{totalDel}</span>
              </div>

              {/* files */}
              {nothing ? (
                <div className="rounded-lg border border-dashed border-ink-700 py-6 text-center text-sm text-slate-500">
                  Nothing staged. Stage files first, then commit.
                </div>
              ) : (
                <ul className="mb-4 max-h-80 overflow-auto rounded-lg border border-ink-800 bg-ink-900">
                  {files.map((f) => (
                    <li key={f.path} className="border-b border-ink-850 last:border-0">
                      <button
                        onClick={() => toggleDiff(f.path)}
                        title={openPath === f.path ? 'Hide the changed lines' : 'Show the changed lines'}
                        className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-sm hover:bg-ink-850"
                      >
                        <span className="w-3 text-[10px] text-slate-600">
                          {openPath === f.path ? 'v' : '>'}
                        </span>
                        <span className={`w-4 font-bold ${statusColor(f.status)}`}>{f.status}</span>
                        <span className="min-w-0 flex-1 truncate text-slate-200">{f.path}</span>
                        <span className="font-mono text-[11px] text-slate-500">
                          {f.add < 0 ? 'bin' : <><span className="text-good">+{f.add}</span> <span className="text-bad">-{f.del}</span></>}
                        </span>
                      </button>
                      {openPath === f.path && (
                        <div className="max-h-56 overflow-auto border-t border-ink-850 bg-ink-950">
                          {diffs[f.path] === '' ? (
                            <div className="px-3 py-2 text-xs text-slate-500">Loading diff...</div>
                          ) : (
                            <DiffView text={diffs[f.path] ?? ''} empty="Binary file or no textual diff." />
                          )}
                        </div>
                      )}
                    </li>
                  ))}
                </ul>
              )}

              {/* author + co-authors */}
              <div className="mb-4 grid grid-cols-2 gap-3">
                <div className="rounded-lg border border-ink-800 bg-ink-900 px-3 py-2">
                  <div className="text-[11px] uppercase tracking-wide text-slate-500">Author</div>
                  <div className="truncate text-sm text-slate-200">
                    {data?.author.name || '(unset)'}
                  </div>
                  <div className="truncate text-xs text-slate-500">{data?.author.email || '(git config unset)'}</div>
                </div>
                <div className="rounded-lg border border-ink-800 bg-ink-900 px-3 py-2">
                  <div className="text-[11px] uppercase tracking-wide text-slate-500">
                    Co-authors {co.length > 0 && `(${co.length})`}
                  </div>
                  {co.length === 0 ? (
                    <div className="text-sm text-slate-500">none</div>
                  ) : (
                    co.map((c) => (
                      <div key={c.email} className="truncate text-sm text-accent" title={`${c.name} <${c.email}>`}>
                        {c.name}
                      </div>
                    ))
                  )}
                </div>
              </div>

              {/* message preview */}
              <div className="mb-4">
                <div className="mb-1 text-[11px] uppercase tracking-wide text-slate-500">Message</div>
                <pre className="whitespace-pre-wrap rounded-lg border border-ink-800 bg-ink-950 px-3 py-2 font-mono text-[12.5px] text-slate-300">
{message.trim() || '(empty - write a message before committing)'}
{co.length > 0 ? '\n\n' + co.map((c) => `Co-Authored-By: ${c.name} <${c.email}>`).join('\n') : ''}
                </pre>
              </div>

              {/* last commit review */}
              <details className="rounded-lg border border-ink-800 bg-ink-900">
                <summary className="cursor-pointer px-3 py-2 text-xs font-semibold text-slate-400">
                  Last commit (git log -1 --stat)
                </summary>
                <pre className="max-h-44 overflow-auto border-t border-ink-800 px-3 py-2 font-mono text-[11.5px] text-slate-400">
                  {lastCommit || '(no commits yet)'}
                </pre>
              </details>
            </>
          )}
        </div>

        {/* actions */}
        <div className="flex flex-wrap items-center gap-2 border-t border-ink-700/60 bg-ink-900 px-5 py-3">
          <button className="btn-ghost text-xs" disabled={busy} onClick={onStash} title="Shelve working changes">
            Stash
          </button>
          <button
            className="btn-ghost text-xs text-bad"
            disabled={busy}
            onClick={onUndo}
            title="Undo the last commit (keeps changes staged)"
          >
            Undo last commit
          </button>
          <div className="flex-1" />
          <button className="btn-soft" disabled={busy || nothing || !message.trim()} onClick={() => onCommit(false)}>
            Commit
          </button>
          <button
            className="btn-accent"
            disabled={busy || nothing || !message.trim()}
            onClick={() => onCommit(true)}
          >
            Commit &amp; Push
          </button>
        </div>
      </div>
    </div>
  )
}
