import React, { useEffect, useState } from 'react'
import { IconClose } from './Icons'
import { api, confirmDialog, Worktree, SparseState, basename } from '../api'

export default function WorktreesPanel({
  cwd,
  toast,
  onChanged,
  onClose
}: {
  cwd: string
  toast: (kind: 'ok' | 'err' | 'info', text: string) => void
  onChanged: () => void
  onClose: () => void
}) {
  const [worktrees, setWorktrees] = useState<Worktree[]>([])
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)
  const [path, setPath] = useState('')
  const [branch, setBranch] = useState('')
  const [sparse, setSparse] = useState<SparseState | null>(null)
  const [sparseText, setSparseText] = useState('')

  const load = () => {
    setLoading(true)
    Promise.all([
      api().worktreesList(cwd),
      api().sparseState(cwd).catch(() => ({ enabled: false, patterns: [] }))
    ])
      .then(([w, sp]) => {
        setWorktrees(w)
        setSparse(sp)
        setSparseText(sp.patterns.join('\n'))
      })
      .catch((e) => toast('err', e?.message || String(e)))
      .finally(() => setLoading(false))
  }
  useEffect(load, [cwd])

  const applySparse = () =>
    act(() => api().sparseSet(cwd, sparseText.split('\n')), 'Sparse-checkout applied.')
  const disableSparse = () => act(() => api().sparseDisable(cwd), 'Sparse-checkout disabled.')

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

  const browse = async () => {
    const dir = await api().browseDir('Folder for the new worktree')
    if (dir) setPath(dir)
  }

  const add = () => {
    if (!path.trim() || !branch.trim()) return
    act(() => api().worktreesAdd(cwd, path.trim(), branch.trim()), `Worktree added for ${branch.trim()}.`).then(() => {
      setPath('')
      setBranch('')
    })
  }

  const remove = (w: Worktree) =>
    confirmDialog({
      title: 'Remove worktree',
      danger: true,
      message: `Remove worktree at ${basename(w.path)}?`,
      detail: w.path,
      confirmLabel: 'Remove'
    }).then((ok) => {
      if (ok) act(() => api().worktreesRemove(cwd, w.path, true), 'Worktree removed.')
    })

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm" onClick={onClose}>
      <div className="card flex max-h-[88vh] w-[680px] flex-col overflow-hidden shadow-2xl" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between border-b border-ink-700/60 px-5 py-4">
          <div>
            <h2 className="text-base font-semibold text-white">Worktrees</h2>
            <p className="text-xs text-slate-400">Check out multiple branches at once.</p>
          </div>
          <button className="btn-ghost px-2" onClick={onClose} title="Close">
            <IconClose className="w-4 h-4" />
          </button>
        </div>

        {/* add worktree */}
        <div className="flex items-center gap-2 border-b border-ink-800 bg-ink-900 px-5 py-3">
          <input
            value={path}
            onChange={(e) => setPath(e.target.value)}
            placeholder="New worktree folder..."
            className="flex-1 rounded-md border border-ink-700 bg-ink-950 px-3 py-1.5 text-sm outline-none focus:border-accent select-text"
          />
          <button className="btn-ghost text-xs" onClick={browse}>
            Browse
          </button>
          <input
            value={branch}
            onChange={(e) => setBranch(e.target.value)}
            placeholder="Branch"
            className="w-36 rounded-md border border-ink-700 bg-ink-950 px-3 py-1.5 text-sm outline-none focus:border-accent select-text"
          />
          <button className="btn-accent text-sm" disabled={busy || !path.trim() || !branch.trim()} onClick={add}>
            Add
          </button>
        </div>

        <div className="overflow-auto px-5 py-3">
          {loading && <div className="text-sm text-slate-500">Loading...</div>}

          <div className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-slate-500">
            Worktrees ({worktrees.length})
          </div>
          <div className="space-y-1">
            {worktrees.map((w) => (
              <div
                key={w.path}
                className={`flex items-center gap-2 rounded-lg border px-3 py-2 ${
                  w.current ? 'border-accent/40 bg-accent/5' : 'border-ink-800 bg-ink-900'
                }`}
              >
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <span className="truncate text-sm font-medium text-slate-100">{basename(w.path)}</span>
                    {w.current && <span className="chip bg-accent/15 text-accent">current</span>}
                    {w.locked && <span className="chip bg-warn/15 text-warn">locked</span>}
                  </div>
                  <div className="truncate text-[11px] text-slate-500">
                    {w.detached ? 'detached' : w.branch || '(no branch)'} - {w.head} - {w.path}
                  </div>
                </div>
                <button className="btn-ghost text-xs" disabled={busy} onClick={() => api().openExternal(w.path)}>
                  Open
                </button>
                {!w.current && (
                  <button className="btn-ghost text-xs text-bad" disabled={busy} onClick={() => remove(w)}>
                    Remove
                  </button>
                )}
              </div>
            ))}
          </div>

          {/* sparse-checkout */}
          <div className="mt-4 border-t border-ink-800 pt-3">
            <div className="mb-1 flex items-center gap-2">
              <span className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">
                Sparse-checkout
              </span>
              <span className={`chip ${sparse?.enabled ? 'bg-good/20 text-good' : 'bg-ink-750 text-slate-400'}`}>
                {sparse?.enabled ? 'on' : 'off'}
              </span>
            </div>
            <p className="mb-2 text-xs text-slate-500">One path or pattern per line; only matching paths stay checked out.</p>
            <textarea
              value={sparseText}
              onChange={(e) => setSparseText(e.target.value)}
              rows={3}
              placeholder={'src/\ndocs/'}
              className="w-full resize-none rounded-md border border-ink-700 bg-ink-950 px-3 py-1.5 font-mono text-sm outline-none focus:border-accent select-text"
            />
            <div className="mt-2 flex gap-2">
              <button className="btn-accent text-sm" disabled={busy || !sparseText.trim()} onClick={applySparse}>
                Apply
              </button>
              {sparse?.enabled && (
                <button className="btn-ghost text-sm" disabled={busy} onClick={disableSparse}>
                  Disable (full checkout)
                </button>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
