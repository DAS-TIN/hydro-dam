import React, { useEffect, useState } from 'react'
import { IconClose } from './Icons'
import { api, confirmDialog, Workspace, basename } from '../api'

export default function WorkspacesPanel({
  cwd,
  onOpenRepo,
  toast,
  onClose
}: {
  cwd: string
  onOpenRepo: (root: string) => void
  toast: (kind: 'ok' | 'err' | 'info', text: string) => void
  onClose: () => void
}) {
  const [workspaces, setWorkspaces] = useState<Workspace[]>([])
  const [name, setName] = useState('')
  const [busy, setBusy] = useState(false)

  const load = () => api().workspacesList().then(setWorkspaces).catch((e) => toast('err', e?.message || String(e)))
  useEffect(() => {
    load()
  }, [])

  const create = async () => {
    if (!name.trim()) return
    setBusy(true)
    try {
      setWorkspaces(await api().workspacesSave(name.trim(), cwd ? [cwd] : []))
      setName('')
      toast('ok', 'Workspace created.')
    } catch (e: any) {
      toast('err', e?.message || String(e))
    } finally {
      setBusy(false)
    }
  }

  const addCurrent = async (w: Workspace) => {
    if (!cwd || w.repos.includes(cwd)) return
    setWorkspaces(await api().workspacesSave(w.name, [...w.repos, cwd]))
    toast('ok', `Added ${basename(cwd)} to ${w.name}.`)
  }

  const removeRepo = async (w: Workspace, repo: string) =>
    setWorkspaces(await api().workspacesSave(w.name, w.repos.filter((r) => r !== repo)))

  const remove = (w: Workspace) =>
    confirmDialog({ title: 'Delete workspace', danger: true, message: `Delete workspace "${w.name}"?`, confirmLabel: 'Delete' }).then(
      async (ok) => {
        if (ok) setWorkspaces(await api().workspacesRemove(w.id))
      }
    )

  const open = async (repo: string) => {
    const root = await api().validateRepo(repo)
    if (root) {
      onOpenRepo(root)
      onClose()
    } else toast('err', 'Repo no longer found.')
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm" onClick={onClose}>
      <div className="card flex max-h-[88vh] w-[680px] flex-col overflow-hidden shadow-2xl" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between border-b border-ink-700/60 px-5 py-4">
          <div>
            <h2 className="text-base font-semibold text-white">Workspaces</h2>
            <p className="text-xs text-slate-400">Group repositories you work on together.</p>
          </div>
          <button className="btn-ghost px-2" onClick={onClose} title="Close">
            <IconClose className="w-4 h-4" />
          </button>
        </div>

        <div className="flex items-center gap-2 border-b border-ink-800 bg-ink-900 px-5 py-3">
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && create()}
            placeholder="New workspace name..."
            className="flex-1 rounded-md border border-ink-700 bg-ink-950 px-3 py-1.5 text-sm outline-none focus:border-accent select-text"
          />
          <button className="btn-accent text-sm" disabled={busy || !name.trim()} onClick={create}>
            Create
          </button>
        </div>

        <div className="overflow-auto px-5 py-3">
          {workspaces.length === 0 && (
            <div className="rounded-lg border border-dashed border-ink-700 py-6 text-center text-sm text-slate-500">
              No workspaces yet.
            </div>
          )}
          <div className="space-y-3">
            {workspaces.map((w) => (
              <div key={w.id} className="rounded-lg border border-ink-800 bg-ink-900 p-3">
                <div className="mb-2 flex items-center gap-2">
                  <span className="flex-1 text-sm font-semibold text-slate-100">{w.name}</span>
                  <span className="text-[11px] text-slate-500">{w.repos.length} repos</span>
                  <button className="btn-ghost text-xs" disabled={!cwd || w.repos.includes(cwd)} onClick={() => addCurrent(w)}>
                    Add current
                  </button>
                  <button className="btn-ghost text-xs text-bad" onClick={() => remove(w)}>
                    Delete
                  </button>
                </div>
                <div className="space-y-1">
                  {w.repos.length === 0 && <div className="text-xs text-slate-600">No repos - use "Add current".</div>}
                  {w.repos.map((r) => (
                    <div key={r} className="flex items-center gap-2 rounded-md border border-ink-800 bg-ink-950 px-2 py-1.5">
                      <span className="text-sm text-slate-200">{basename(r)}</span>
                      <span className="min-w-0 flex-1 truncate text-[11px] text-slate-500">{r}</span>
                      <button className="btn-ghost text-xs" onClick={() => open(r)}>
                        Open
                      </button>
                      <button className="btn-ghost text-xs text-bad" onClick={() => removeRepo(w, r)}>
                        Remove
                      </button>
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  )
}
