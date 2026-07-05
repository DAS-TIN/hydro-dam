import React, { useEffect, useState } from 'react'
import { IconClose } from './Icons'
import { api, confirmDialog, ReflogEntry } from '../api'

export default function ReflogPanel({
  cwd,
  currentBranch,
  toast,
  onChanged,
  onClose
}: {
  cwd: string
  currentBranch: string
  toast: (kind: 'ok' | 'err' | 'info', text: string) => void
  onChanged: () => void
  onClose: () => void
}) {
  const [entries, setEntries] = useState<ReflogEntry[]>([])
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)

  const load = () => {
    setLoading(true)
    api()
      .reflog(cwd)
      .then(setEntries)
      .catch((e) => toast('err', e?.message || String(e)))
      .finally(() => setLoading(false))
  }
  useEffect(load, [cwd])

  const act = async (fn: () => Promise<any>, msg: string) => {
    setBusy(true)
    try {
      await fn()
      toast('ok', msg)
      onChanged()
      load()
    } catch (e: any) {
      toast('err', e?.message || String(e))
    } finally {
      setBusy(false)
    }
  }

  const prev = entries[1] // HEAD@{1} - state before the last change
  const undoLast = () =>
    confirmDialog({
      title: 'Undo last change',
      danger: true,
      message: `Reset ${currentBranch || 'HEAD'} back to ${prev?.shortHash} (${prev?.action})?`,
      detail: 'Hard reset to the state before your last action. Uncommitted changes are discarded.',
      confirmLabel: 'Undo'
    }).then((ok) => {
      if (ok) act(() => api().resetTo(cwd, 'HEAD@{1}', 'hard'), 'Undone (reset to previous state).')
    })

  const resetTo = (e: ReflogEntry, mode: 'hard' | 'mixed') =>
    confirmDialog({
      title: `Reset (${mode})`,
      danger: mode === 'hard',
      message: `Reset ${currentBranch || 'HEAD'} to ${e.shortHash}?`,
      detail: mode === 'hard' ? 'Discards working changes and later commits.' : 'Keeps working changes.',
      confirmLabel: 'Reset'
    }).then((ok) => {
      if (ok) act(() => api().resetTo(cwd, e.selector, mode), `Reset (${mode}) to ${e.shortHash}.`)
    })

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm" onClick={onClose}>
      <div className="card flex max-h-[88vh] w-[760px] flex-col overflow-hidden shadow-2xl" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between border-b border-ink-700/60 px-5 py-4">
          <div>
            <h2 className="text-base font-semibold text-white">Undo history (reflog)</h2>
            <p className="text-xs text-slate-400">Every HEAD movement - reset to any point to undo.</p>
          </div>
          <div className="flex items-center gap-2">
            <button className="btn-accent text-sm" disabled={busy || !prev} onClick={undoLast}>
              Undo last change
            </button>
            <button className="btn-ghost px-2" onClick={onClose} title="Close">
              <IconClose className="w-4 h-4" />
            </button>
          </div>
        </div>

        <div className="overflow-auto px-5 py-3">
          {loading && <div className="text-sm text-slate-500">Loading...</div>}
          <div className="space-y-1">
            {entries.map((e, i) => (
              <div
                key={e.selector + i}
                className={`flex items-center gap-3 rounded-lg border px-3 py-2 ${
                  i === 0 ? 'border-accent/40 bg-accent/5' : 'border-ink-800 bg-ink-900'
                }`}
              >
                <span className="w-20 shrink-0 font-mono text-[11px] text-slate-500">{e.selector}</span>
                <span className="font-mono text-xs text-accent">{e.shortHash}</span>
                <div className="min-w-0 flex-1">
                  <div className="truncate text-sm text-slate-200">{e.action}</div>
                  <div className="truncate text-[11px] text-slate-500">
                    {e.subject} - {e.relDate}
                  </div>
                </div>
                {i === 0 ? (
                  <span className="chip bg-accent/15 text-accent">current</span>
                ) : (
                  <>
                    <button className="btn-ghost text-xs" disabled={busy} onClick={() => resetTo(e, 'mixed')}>
                      Reset (mixed)
                    </button>
                    <button className="btn-ghost text-xs text-bad" disabled={busy} onClick={() => resetTo(e, 'hard')}>
                      Reset (hard)
                    </button>
                  </>
                )}
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  )
}
