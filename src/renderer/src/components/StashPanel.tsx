import React, { useEffect, useState } from 'react'
import { api, confirmDialog, StashEntry } from '../api'
import { IconClose } from "./Icons"

export default function StashPanel({
  cwd,
  aiAvailable,
  onChanged,
  onClose,
  toast
}: {
  cwd: string
  aiAvailable?: boolean
  onChanged: () => void
  onClose: () => void
  toast: (kind: 'ok' | 'err', text: string) => void
}) {
  const [list, setList] = useState<StashEntry[]>([])
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)

  const reload = () => {
    setLoading(true)
    api()
      .stashList(cwd)
      .then(setList)
      .catch((e) => toast('err', e.message))
      .finally(() => setLoading(false))
  }

  useEffect(reload, [cwd])

  async function act(fn: () => Promise<any>, ok: string) {
    setBusy(true)
    try {
      await fn()
      toast('ok', ok)
      reload()
      onChanged()
    } catch (e: any) {
      toast('err', e.message)
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm" onClick={onClose}>
      <div className="card flex max-h-[80vh] w-[560px] flex-col overflow-hidden shadow-2xl" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between border-b border-ink-700/60 px-5 py-4">
          <div>
            <h2 className="text-base font-semibold text-white">Stashes</h2>
            <p className="text-xs text-slate-400">Apply keeps the stash; pop applies then removes it.</p>
          </div>
          <div className="flex items-center gap-2">
            {aiAvailable && (
              <button
                className="btn-ghost"
                disabled={busy}
                title="Stash with an AI-generated label"
                onClick={() =>
                  act(async () => {
                    const m = await api().aiStashMessage(cwd)
                    await api().stash(cwd, m)
                  }, 'Stashed with an AI label.')
                }
              >
                AI stash
              </button>
            )}
            <button
              className="btn-soft"
              disabled={busy}
              onClick={() => act(() => api().stash(cwd, ''), 'Stashed working changes.')}
            >
              + Stash changes
            </button>
            <button className="btn-ghost px-2" onClick={onClose}>
              <IconClose className="w-4 h-4" />
            </button>
          </div>
        </div>

        <div className="flex-1 overflow-auto px-3 py-2">
          {loading && <div className="p-4 text-sm text-slate-500">Loading...</div>}
          {!loading && list.length === 0 && (
            <div className="rounded-lg border border-dashed border-ink-700 py-10 text-center text-sm text-slate-500">
              No stashes. Use "Stash changes" to shelve your working tree.
            </div>
          )}
          <ul className="space-y-1.5">
            {list.map((s) => (
              <li
                key={s.ref}
                className="group flex items-center gap-3 rounded-lg border border-ink-700/50 bg-ink-800 px-3 py-2.5"
              >
                <span className="font-mono text-xs text-accent">{s.ref}</span>
                <div className="min-w-0 flex-1">
                  <div className="truncate text-sm text-slate-100">{s.subject}</div>
                  <div className="text-[11px] text-slate-500">
                    {s.branch && <span>on {s.branch} | </span>}
                    {s.relDate}
                  </div>
                </div>
                <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100">
                  <button
                    className="rounded px-2 py-0.5 text-[11px] font-semibold text-slate-300 hover:bg-ink-700"
                    disabled={busy}
                    onClick={() => act(() => api().stashApply(cwd, s.ref), 'Applied stash.')}
                  >
                    apply
                  </button>
                  <button
                    className="rounded px-2 py-0.5 text-[11px] font-semibold text-accent hover:bg-accent/15"
                    disabled={busy}
                    onClick={() => act(() => api().stashPopRef(cwd, s.ref), 'Popped stash.')}
                  >
                    pop
                  </button>
                  <button
                    className="rounded px-2 py-0.5 text-[11px] font-semibold text-bad hover:bg-bad/15"
                    disabled={busy}
                    onClick={async () => {
                      const ok = await confirmDialog({
                        title: 'Drop stash',
                        danger: true,
                        message: `Drop ${s.ref}?`,
                        detail: 'This cannot be undone.',
                        confirmLabel: 'Drop',
                        cancelLabel: 'Cancel'
                      })
                      if (ok) act(() => api().stashDrop(cwd, s.ref), 'Dropped stash.')
                    }}
                  >
                    drop
                  </button>
                </div>
              </li>
            ))}
          </ul>
        </div>
      </div>
    </div>
  )
}
