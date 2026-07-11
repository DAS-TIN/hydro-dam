import React, { useEffect, useMemo, useState } from 'react'
import { IconClose } from './Icons'
import { api, GitLogEntry, relTime } from '../api'

// git subcommands that only ever read - handy to hide when you want to see the
// writes (commit, push, checkout...) without the status/diff/log noise.
const READ_ONLY = new Set([
  'status', 'diff', 'log', 'show', 'blame', 'rev-parse', 'rev-list', 'cat-file', 'ls-files',
  'for-each-ref', 'branch', 'remote', 'config', 'symbolic-ref', 'merge-base', 'name-rev',
  'describe', 'shortlog', 'count-objects', 'var', 'reflog'
])

export default function CommandLogPanel({
  toast,
  onClose
}: {
  toast: (kind: 'ok' | 'err' | 'info', text: string) => void
  onClose: () => void
}) {
  const [entries, setEntries] = useState<GitLogEntry[]>([])
  const [writesOnly, setWritesOnly] = useState(false)
  const [copied, setCopied] = useState<number | null>(null)
  const [, tick] = useState(0) // 1s heartbeat so the "3s ago" column keeps ticking

  useEffect(() => {
    api().commandLog().then(setEntries).catch((e) => toast('err', e?.message || String(e)))
    // then keep it live - new commands stream in as the app runs them
    const off = api().onGitCommand((e) => setEntries((prev) => [...prev.slice(-400), e]))
    const beat = setInterval(() => tick((n) => n + 1), 1000)
    return () => {
      off()
      clearInterval(beat)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const shown = useMemo(
    () => [...entries].reverse().filter((e) => !writesOnly || !READ_ONLY.has(e.args[0])),
    [entries, writesOnly]
  )

  const copy = (e: GitLogEntry) => {
    navigator.clipboard.writeText(`git ${e.args.join(' ')}`)
    setCopied(e.id)
    setTimeout(() => setCopied((c) => (c === e.id ? null : c)), 1200)
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm" onClick={onClose}>
      <div className="card flex h-[84vh] w-[860px] flex-col overflow-hidden shadow-2xl" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between border-b border-ink-700/60 px-5 py-4">
          <div>
            <h2 className="text-base font-semibold text-white">Command log</h2>
            <p className="text-xs text-slate-400">
              Every git command Hydrodam runs, newest first - click one to copy it.
            </p>
          </div>
          <div className="flex items-center gap-2">
            <label className="flex cursor-pointer select-none items-center gap-1.5 text-[11px] text-slate-400">
              <input
                type="checkbox"
                checked={writesOnly}
                onChange={(e) => setWritesOnly(e.target.checked)}
                className="accent-accent"
              />
              Writes only
            </label>
            <button className="btn-ghost px-2" onClick={onClose} title="Close">
              <IconClose className="w-4 h-4" />
            </button>
          </div>
        </div>

        <div className="min-h-0 flex-1 overflow-auto bg-ink-950 font-mono text-[12px] leading-relaxed">
          {shown.length === 0 && (
            <div className="p-4 text-sm text-slate-500">
              {writesOnly ? 'No write commands yet.' : 'No commands recorded yet.'}
            </div>
          )}
          {shown.map((e) => (
            <button
              key={e.id}
              onClick={() => copy(e)}
              title="Click to copy"
              className={`flex w-full items-baseline gap-2 border-b border-ink-900 px-4 py-1 text-left hover:bg-ink-850 ${
                e.ok ? '' : 'bg-bad/10'
              }`}
            >
              <span className={`w-3 shrink-0 ${e.ok ? 'text-good' : 'text-bad'}`}>{e.ok ? '>' : '!'}</span>
              <span className="min-w-0 flex-1 truncate">
                <span className="text-slate-500">git </span>
                <span className="text-accent">{e.args[0]}</span>
                <span className="text-slate-200"> {e.args.slice(1).join(' ')}</span>
                {!e.ok && e.error && <span className="text-bad"> - {e.error}</span>}
              </span>
              {copied === e.id && <span className="shrink-0 text-[10px] text-accent">copied</span>}
              <span className="shrink-0 tabular-nums text-slate-600">{e.ms}ms</span>
              <span className="w-16 shrink-0 text-right text-slate-600">{relTime(e.at)}</span>
            </button>
          ))}
        </div>
      </div>
    </div>
  )
}
