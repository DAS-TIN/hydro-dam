import React, { useEffect, useState } from 'react'
import { api, confirmDialog, DiscardEntry, basename, dirname, humanSize, relTime } from '../api'
import { IconClose } from './Icons'

/**
 * Safety net for "Discard changes": Hydrodam copies a file's contents into its
 * own data folder right before discarding, so the last 50 discards per repo
 * can be brought back.
 */
export default function DiscardsPanel({
  cwd,
  toast,
  onChanged,
  onClose
}: {
  cwd: string
  toast: (kind: 'ok' | 'err', text: string) => void
  onChanged: () => void
  onClose: () => void
}) {
  const [entries, setEntries] = useState<DiscardEntry[]>([])
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)

  const load = () => {
    setLoading(true)
    api()
      .discardsList(cwd)
      .then(setEntries)
      .catch((e) => toast('err', e?.message || String(e)))
      .finally(() => setLoading(false))
  }
  useEffect(load, [cwd])

  const restore = async (d: DiscardEntry) => {
    const ok = await confirmDialog({
      title: 'Restore discarded file',
      message: `Restore ${basename(d.path)} as it was when discarded?`,
      detail: 'The current file on disk (if any) is overwritten with the cached copy.',
      confirmLabel: 'Restore'
    })
    if (!ok) return
    setBusy(true)
    try {
      const p = await api().discardsRestore(cwd, d.id)
      toast('ok', `Restored ${p} as a working change.`)
      onChanged()
    } catch (e: any) {
      toast('err', e?.message || String(e))
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm" onClick={onClose}>
      <div className="card flex max-h-[80vh] w-[600px] flex-col overflow-hidden shadow-2xl" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between border-b border-ink-700/60 px-5 py-4">
          <div>
            <h2 className="text-base font-semibold text-white">Recently discarded</h2>
            <p className="text-xs text-slate-400">
              Snapshots taken just before a discard. Stored in the app data folder, never inside the repo.
            </p>
          </div>
          <button className="btn-ghost px-2" onClick={onClose}>
            <IconClose className="w-4 h-4" />
          </button>
        </div>

        <div className="min-h-0 flex-1 overflow-auto px-5 py-3">
          {loading && <div className="text-sm text-slate-500">Loading...</div>}
          {!loading && entries.length === 0 && (
            <div className="py-10 text-center text-sm text-slate-500">
              Nothing here yet. When you discard changes, the file's last contents land here first.
            </div>
          )}
          <div className="space-y-1">
            {entries.map((d) => (
              <div key={d.id} className="group flex items-center gap-2.5 rounded-lg border border-ink-800 bg-ink-900 px-3 py-2">
                <div className="min-w-0 flex-1" title={d.path}>
                  <div className="truncate text-sm text-slate-100">
                    {basename(d.path)}
                    <span className="ml-1.5 text-[11px] text-slate-500">{dirname(d.path)}</span>
                  </div>
                  <div className="text-[11px] text-slate-500">
                    discarded {relTime(d.when)} - {humanSize(d.size)}
                  </div>
                </div>
                <button
                  className="btn-soft text-xs opacity-0 group-hover:opacity-100"
                  disabled={busy}
                  onClick={() => restore(d)}
                >
                  Restore
                </button>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  )
}
