import React, { useEffect, useState } from 'react'
import { IconClose } from './Icons'
import { api, RebaseAction } from '../api'

interface Row {
  sha: string
  shortHash: string
  subject: string
  action: RebaseAction
  message: string
}

const ACTIONS: { value: RebaseAction; label: string; hint: string }[] = [
  { value: 'pick', label: 'pick', hint: 'keep the commit as-is' },
  { value: 'reword', label: 'reword', hint: 'keep changes, edit the message' },
  { value: 'squash', label: 'squash', hint: 'meld into previous, combine messages' },
  { value: 'fixup', label: 'fixup', hint: 'meld into previous, drop this message' },
  { value: 'drop', label: 'drop', hint: 'remove the commit entirely' }
]

const actionColor: Record<RebaseAction, string> = {
  pick: 'text-slate-200',
  reword: 'text-info',
  squash: 'text-warn',
  fixup: 'text-warn',
  drop: 'text-bad'
}

export default function InteractiveRebasePanel({
  cwd,
  base,
  currentBranch,
  toast,
  onChanged,
  onClose
}: {
  cwd: string
  base: string
  currentBranch: string
  toast: (kind: 'ok' | 'err' | 'info', text: string) => void
  onChanged: () => void
  onClose: () => void
}) {
  const [rows, setRows] = useState<Row[]>([])
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    setLoading(true)
    api()
      .rebaseList(cwd, base)
      .then((cs) =>
        setRows(cs.map((c) => ({ sha: c.hash, shortHash: c.shortHash, subject: c.subject, action: 'pick', message: c.subject })))
      )
      .catch((e) => toast('err', e?.message || String(e)))
      .finally(() => setLoading(false))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cwd, base])

  const setAction = (i: number, action: RebaseAction) =>
    setRows((r) => r.map((row, k) => (k === i ? { ...row, action } : row)))
  const setMessage = (i: number, message: string) =>
    setRows((r) => r.map((row, k) => (k === i ? { ...row, message } : row)))
  const move = (i: number, dir: -1 | 1) =>
    setRows((r) => {
      const j = i + dir
      if (j < 0 || j >= r.length) return r
      const next = r.slice()
      ;[next[i], next[j]] = [next[j], next[i]]
      return next
    })

  const firstKept = rows.find((r) => r.action !== 'drop')
  const invalidFirst = firstKept && (firstKept.action === 'squash' || firstKept.action === 'fixup')
  const allDropped = rows.length > 0 && rows.every((r) => r.action === 'drop')

  const start = async () => {
    setBusy(true)
    try {
      const items = rows.map((r) => ({
        sha: r.sha,
        action: r.action,
        message: r.action === 'reword' ? r.message : undefined
      }))
      await api().rebaseInteractive(cwd, base, items)
      toast('ok', 'Rebase complete.')
      onChanged()
      onClose()
    } catch (e: any) {
      //A conflict pauses the rebase; the main banner takes over from here.
      toast('err', e?.message || String(e))
      onChanged()
      onClose()
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="fixed inset-0 z-[55] flex items-center justify-center bg-black/60 backdrop-blur-sm">
      <div className="card flex max-h-[88vh] w-[760px] flex-col overflow-hidden shadow-2xl">
        <div className="flex items-center justify-between border-b border-ink-700/60 px-5 py-4">
          <div>
            <h2 className="text-base font-semibold text-white">Interactive rebase</h2>
            <p className="text-xs text-slate-400">
              {currentBranch || 'branch'} onto <span className="font-mono text-accent">{base.slice(0, 7)}</span> -
              reorder, squash, reword or drop. Oldest at top (the order git applies).
            </p>
          </div>
          <button className="btn-ghost px-2" onClick={onClose} title="Close">
            <IconClose className="w-4 h-4" />
          </button>
        </div>

        <div className="overflow-auto px-5 py-4">
          {loading && <div className="text-sm text-slate-500">Loading...</div>}
          {!loading && rows.length === 0 && (
            <div className="rounded-lg border border-dashed border-ink-700 py-6 text-center text-sm text-slate-500">
              No commits after the base to rebase.
            </div>
          )}
          <div className="space-y-1">
            {rows.map((r, i) => (
              <div
                key={r.sha}
                className={`rounded-lg border px-2 py-1.5 ${
                  r.action === 'drop' ? 'border-ink-800 bg-ink-900 opacity-50' : 'border-ink-800 bg-ink-900'
                }`}
              >
                <div className="flex items-center gap-2">
                  <div className="flex flex-col">
                    <button
                      className="px-1 text-[10px] leading-none text-slate-500 hover:text-white disabled:opacity-30"
                      disabled={i === 0}
                      onClick={() => move(i, -1)}
                      title="Move up"
                    >
                      up
                    </button>
                    <button
                      className="px-1 text-[10px] leading-none text-slate-500 hover:text-white disabled:opacity-30"
                      disabled={i === rows.length - 1}
                      onClick={() => move(i, 1)}
                      title="Move down"
                    >
                      dn
                    </button>
                  </div>
                  <select
                    value={r.action}
                    onChange={(e) => setAction(i, e.target.value as RebaseAction)}
                    className={`w-24 rounded-md border border-ink-700 bg-ink-950 px-2 py-1 text-xs outline-none focus:border-accent ${actionColor[r.action]}`}
                    title={ACTIONS.find((a) => a.value === r.action)?.hint}
                  >
                    {ACTIONS.map((a) => (
                      <option key={a.value} value={a.value}>
                        {a.label}
                      </option>
                    ))}
                  </select>
                  <span className="font-mono text-xs text-accent">{r.shortHash}</span>
                  <span
                    className={`min-w-0 flex-1 truncate text-sm ${
                      r.action === 'drop' ? 'text-slate-500 line-through' : 'text-slate-200'
                    }`}
                  >
                    {r.subject}
                  </span>
                </div>
                {r.action === 'reword' && (
                  <input
                    value={r.message}
                    onChange={(e) => setMessage(i, e.target.value)}
                    placeholder="New commit message"
                    className="mt-1.5 w-full rounded-md border border-ink-700 bg-ink-950 px-2 py-1 text-sm outline-none focus:border-accent select-text"
                  />
                )}
              </div>
            ))}
          </div>

          {invalidFirst && (
            <div className="mt-3 rounded-lg border border-bad/30 bg-bad/5 px-3 py-2 text-xs text-bad">
              The first kept commit cannot be squash/fixup - there is nothing before it to meld into.
            </div>
          )}
          <div className="mt-3 text-[11px] text-slate-600">
            Conflicts during the rebase pause it; resolve them from the banner (Continue / Skip / Abort).
            Working changes are auto-stashed and restored.
          </div>
        </div>

        <div className="flex items-center justify-end gap-2 border-t border-ink-700/60 bg-ink-900 px-5 py-3">
          <button className="btn-ghost text-sm" onClick={onClose}>
            Cancel
          </button>
          <button
            className="btn-accent text-sm"
            disabled={busy || loading || rows.length === 0 || !!invalidFirst || allDropped}
            onClick={start}
          >
            Start rebase
          </button>
        </div>
      </div>
    </div>
  )
}
