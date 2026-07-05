import React, { useEffect, useState } from 'react'
import { IconClose } from './Icons'
import { api, confirmDialog, Submodule } from '../api'

const STATUS_LABEL: Record<string, { label: string; cls: string }> = {
  ' ': { label: 'ok', cls: 'bg-good/15 text-good' },
  '+': { label: 'changed', cls: 'bg-warn/15 text-warn' },
  '-': { label: 'not init', cls: 'bg-ink-750 text-slate-400' },
  U: { label: 'conflict', cls: 'bg-bad/15 text-bad' }
}

export default function SubmodulesPanel({
  cwd,
  toast,
  onChanged,
  onOpenRepo,
  onClose
}: {
  cwd: string
  toast: (kind: 'ok' | 'err' | 'info', text: string) => void
  onChanged: () => void
  onOpenRepo?: (root: string) => void
  onClose: () => void
}) {
  const [subs, setSubs] = useState<Submodule[]>([])
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)
  const [url, setUrl] = useState('')
  const [path, setPath] = useState('')

  const load = () => {
    setLoading(true)
    api()
      .submodulesList(cwd)
      .then(setSubs)
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

  const add = () => {
    if (!url.trim() || !path.trim()) return
    act(() => api().submoduleAdd(cwd, url.trim(), path.trim()), 'Submodule added.').then(() => {
      setUrl('')
      setPath('')
    })
  }

  const open = async (s: Submodule) => {
    const root = await api()
      .validateRepo(`${cwd}/${s.path}`)
      .catch(() => null)
    if (root && onOpenRepo) {
      onClose()
      onOpenRepo(root)
    } else {
      toast('err', 'Submodule is not checked out. Update it first.')
    }
  }

  const deinit = (s: Submodule) =>
    confirmDialog({
      title: 'Deinit submodule',
      danger: true,
      message: `Deinit ${s.path}?`,
      detail: 'Empties the submodule working tree. Its config stays in .gitmodules, so you can update to restore it.',
      confirmLabel: 'Deinit'
    }).then((ok) => {
      if (ok) act(() => api().submoduleDeinit(cwd, s.path, true), `Deinitialised ${s.path}.`)
    })

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm" onClick={onClose}>
      <div className="card flex max-h-[84vh] w-[640px] flex-col overflow-hidden shadow-2xl" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between border-b border-ink-700/60 px-5 py-4">
          <div>
            <h2 className="text-base font-semibold text-white">Submodules</h2>
            <p className="text-xs text-slate-400">Nested repositories pinned to a commit.</p>
          </div>
          <div className="flex items-center gap-2">
            <button
              className="btn-soft text-xs"
              disabled={busy || subs.length === 0}
              onClick={() => act(() => api().submodulesUpdate(cwd), 'All submodules updated.')}
            >
              Update all
            </button>
            <button className="btn-ghost px-2" onClick={onClose} title="Close">
              <IconClose className="w-4 h-4" />
            </button>
          </div>
        </div>

        <div className="min-h-0 flex-1 overflow-auto px-5 py-3">
          {loading && <div className="text-sm text-slate-500">Loading...</div>}
          {!loading && subs.length === 0 && (
            <div className="py-8 text-center text-sm text-slate-500">
              No submodules. Add one below with a repository URL and a path.
            </div>
          )}
          <div className="space-y-1">
            {subs.map((s) => {
              const st = STATUS_LABEL[s.status] ?? { label: s.status, cls: 'bg-ink-750 text-slate-400' }
              return (
                <div key={s.path} className="group flex items-center gap-2.5 rounded-lg border border-ink-800 bg-ink-900 px-3 py-2">
                  <span className={`chip ${st.cls} shrink-0`}>{st.label}</span>
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-sm font-medium text-slate-100">{s.path}</div>
                    <div className="truncate font-mono text-[11px] text-slate-500">
                      {s.head}
                      {s.describe ? `  (${s.describe})` : ''}
                    </div>
                  </div>
                  <span className="flex shrink-0 items-center gap-1 opacity-0 group-hover:opacity-100">
                    <button className="btn-ghost text-xs" disabled={busy} onClick={() => open(s)} title="Open this submodule as a repository">
                      Open
                    </button>
                    <button
                      className="btn-ghost text-xs"
                      disabled={busy}
                      onClick={() => act(() => api().submoduleUpdateOne(cwd, s.path), `Updated ${s.path}.`)}
                      title="git submodule update --init for this path"
                    >
                      Update
                    </button>
                    <button
                      className="btn-ghost text-xs"
                      disabled={busy}
                      onClick={() => act(() => api().submoduleSync(cwd, s.path), `Synced URL for ${s.path}.`)}
                      title="Re-sync its URL from .gitmodules"
                    >
                      Sync
                    </button>
                    <button className="btn-ghost text-xs text-bad" disabled={busy} onClick={() => deinit(s)}>
                      Deinit
                    </button>
                  </span>
                </div>
              )
            })}
          </div>
        </div>

        <div className="flex gap-2 border-t border-ink-800 bg-ink-900 px-5 py-3">
          <input
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            placeholder="Repository URL"
            className="flex-1 rounded-md border border-ink-700 bg-ink-950 px-3 py-1.5 text-sm outline-none focus:border-accent select-text"
          />
          <input
            value={path}
            onChange={(e) => setPath(e.target.value)}
            placeholder="path (e.g. libs/foo)"
            className="w-44 rounded-md border border-ink-700 bg-ink-950 px-3 py-1.5 text-sm outline-none focus:border-accent select-text"
          />
          <button className="btn-accent text-sm" disabled={busy || !url.trim() || !path.trim()} onClick={add}>
            Add
          </button>
        </div>
      </div>
    </div>
  )
}
