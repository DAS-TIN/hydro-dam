import React, { useEffect, useState } from 'react'
import { api, CommitPreview as Preview } from '../api'
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

  const reload = () => {
    setLoading(true)
    Promise.all([api().commitPreview(cwd), api().logStat(cwd, 1)])
      .then(([p, l]) => {
        setData(p)
        setLastCommit(l)
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
                <ul className="mb-4 max-h-44 overflow-auto rounded-lg border border-ink-800 bg-ink-900">
                  {files.map((f) => (
                    <li
                      key={f.path}
                      className="flex items-center gap-2 border-b border-ink-850 px-3 py-1.5 text-sm last:border-0"
                    >
                      <span className={`w-4 font-bold ${statusColor(f.status)}`}>{f.status}</span>
                      <span className="min-w-0 flex-1 truncate text-slate-200">{f.path}</span>
                      <span className="font-mono text-[11px] text-slate-500">
                        {f.add < 0 ? 'bin' : <><span className="text-good">+{f.add}</span> <span className="text-bad">-{f.del}</span></>}
                      </span>
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
