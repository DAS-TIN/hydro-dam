import React, { useEffect, useState } from 'react'
import { IconClose } from './Icons'
import { api, confirmDialog, TrackerView, TrackerItem, TrackerType } from '../api'

function branchFromItem(id: string, title: string): string {
  const slug = (id + '-' + title)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 48)
  return slug || 'task'
}

export default function TrackersPanel({
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
  const [trackers, setTrackers] = useState<TrackerView[]>([])
  const [active, setActive] = useState<string | null>(null)
  const [items, setItems] = useState<TrackerItem[]>([])
  const [loadingItems, setLoadingItems] = useState(false)
  const [busy, setBusy] = useState(false)

  // connect form
  const [type, setType] = useState<TrackerType>('jira')
  const [label, setLabel] = useState('')
  const [site, setSite] = useState('')
  const [email, setEmail] = useState('')
  const [token, setToken] = useState('')
  const [key, setKey] = useState('')
  const [boardUrl, setBoardUrl] = useState('')

  const load = () => api().trackersList().then(setTrackers).catch((e) => toast('err', e?.message || String(e)))
  useEffect(() => {
    load()
  }, [])

  const connect = async () => {
    setBusy(true)
    try {
      const boardId = boardUrl.trim().match(/trello\.com\/b\/([^/]+)/)?.[1]
      const t =
        type === 'jira'
          ? { type, label: label.trim() || site, site: site.trim(), email: email.trim(), token: token.trim() }
          : { type, label: label.trim() || 'Trello', key: key.trim(), token: token.trim(), boardId }
      const next = await api().trackersAdd(t)
      setTrackers(next)
      setLabel('')
      setSite('')
      setEmail('')
      setToken('')
      setKey('')
      setBoardUrl('')
      toast('ok', 'Tracker connected.')
    } catch (e: any) {
      toast('err', e?.message || String(e))
    } finally {
      setBusy(false)
    }
  }

  const viewItems = async (t: TrackerView) => {
    setActive(t.id)
    setLoadingItems(true)
    setItems([])
    try {
      setItems(await api().trackersItems(t.id))
    } catch (e: any) {
      toast('err', e?.message || String(e))
    } finally {
      setLoadingItems(false)
    }
  }

  const remove = (t: TrackerView) =>
    confirmDialog({
      title: 'Remove tracker',
      danger: true,
      message: `Disconnect ${t.label}?`,
      confirmLabel: 'Disconnect'
    }).then(async (ok) => {
      if (!ok) return
      setTrackers(await api().trackersRemove(t.id))
      if (active === t.id) {
        setActive(null)
        setItems([])
      }
    })

  const startBranch = async (it: TrackerItem) => {
    const name = branchFromItem(it.id, it.title)
    setBusy(true)
    try {
      await api().createBranch(cwd, name)
      toast('ok', `Created branch ${name}.`)
      onChanged()
      onClose()
    } catch (e: any) {
      toast('err', e?.message || String(e))
    } finally {
      setBusy(false)
    }
  }

  const canConnect =
    type === 'jira' ? site.trim() && email.trim() && token.trim() : key.trim() && token.trim()

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm" onClick={onClose}>
      <div className="card flex max-h-[88vh] w-[720px] flex-col overflow-hidden shadow-2xl" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between border-b border-ink-700/60 px-5 py-4">
          <div>
            <h2 className="text-base font-semibold text-white">Issue trackers</h2>
            <p className="text-xs text-slate-400">Connect Jira or Trello; start a branch from a task.</p>
          </div>
          <button className="btn-ghost px-2" onClick={onClose} title="Close">
            <IconClose className="w-4 h-4" />
          </button>
        </div>

        {/* connect */}
        <div className="border-b border-ink-800 bg-ink-900 px-5 py-3">
          <div className="mb-2 flex gap-1 rounded-lg bg-ink-950 p-0.5">
            {(['jira', 'trello'] as TrackerType[]).map((t) => (
              <button
                key={t}
                className={`flex-1 rounded-md py-1 text-xs font-medium ${
                  type === t ? 'bg-ink-750 text-white' : 'text-slate-400 hover:text-slate-200'
                }`}
                onClick={() => setType(t)}
              >
                {t === 'jira' ? 'Jira' : 'Trello'}
              </button>
            ))}
          </div>
          <div className="flex flex-wrap gap-2">
            <input
              value={label}
              onChange={(e) => setLabel(e.target.value)}
              placeholder="Label (optional)"
              className="w-36 rounded-md border border-ink-700 bg-ink-950 px-3 py-1.5 text-sm outline-none focus:border-accent select-text"
            />
            {type === 'jira' ? (
              <>
                <input
                  value={site}
                  onChange={(e) => setSite(e.target.value)}
                  placeholder="https://you.atlassian.net"
                  className="flex-1 rounded-md border border-ink-700 bg-ink-950 px-3 py-1.5 text-sm outline-none focus:border-accent select-text"
                />
                <input
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="account email"
                  className="w-48 rounded-md border border-ink-700 bg-ink-950 px-3 py-1.5 text-sm outline-none focus:border-accent select-text"
                />
                <input
                  type="password"
                  value={token}
                  onChange={(e) => setToken(e.target.value)}
                  placeholder="API token"
                  className="flex-1 rounded-md border border-ink-700 bg-ink-950 px-3 py-1.5 font-mono text-sm outline-none focus:border-accent select-text"
                />
              </>
            ) : (
              <>
                <input
                  value={key}
                  onChange={(e) => setKey(e.target.value)}
                  placeholder="API key"
                  className="flex-1 rounded-md border border-ink-700 bg-ink-950 px-3 py-1.5 font-mono text-sm outline-none focus:border-accent select-text"
                />
                <input
                  type="password"
                  value={token}
                  onChange={(e) => setToken(e.target.value)}
                  placeholder="token"
                  className="flex-1 rounded-md border border-ink-700 bg-ink-950 px-3 py-1.5 font-mono text-sm outline-none focus:border-accent select-text"
                />
                <input
                  value={boardUrl}
                  onChange={(e) => setBoardUrl(e.target.value)}
                  placeholder="Board URL (optional, for Kanban view)"
                  className="w-full rounded-md border border-ink-700 bg-ink-950 px-3 py-1.5 text-sm outline-none focus:border-accent select-text"
                />
              </>
            )}
            <button className="btn-accent text-sm" disabled={busy || !canConnect} onClick={connect}>
              Connect
            </button>
          </div>
        </div>

        <div className="overflow-auto px-5 py-3">
          {trackers.length === 0 && (
            <div className="rounded-lg border border-dashed border-ink-700 py-6 text-center text-sm text-slate-500">
              No trackers connected yet.
            </div>
          )}
          <div className="space-y-1">
            {trackers.map((t) => (
              <div key={t.id} className="flex items-center gap-2 rounded-lg border border-ink-800 bg-ink-900 px-3 py-2">
                <span className="chip bg-ink-750 text-slate-300">{t.type}</span>
                <div className="min-w-0 flex-1">
                  <div className="truncate text-sm text-slate-100">{t.label}</div>
                  {t.site && <div className="truncate text-[11px] text-slate-500">{t.site}</div>}
                </div>
                <button className="btn-ghost text-xs" disabled={busy} onClick={() => viewItems(t)}>
                  View tasks
                </button>
                <button className="btn-ghost text-xs text-bad" disabled={busy} onClick={() => remove(t)}>
                  Remove
                </button>
              </div>
            ))}
          </div>

          {active && (
            <div className="mt-4">
              <div className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-slate-500">
                Tasks
              </div>
              {loadingItems && <div className="text-sm text-slate-500">Loading...</div>}
              {!loadingItems && items.length === 0 && (
                <div className="rounded-lg border border-dashed border-ink-700 py-6 text-center text-sm text-slate-500">
                  No tasks (or none assigned to you).
                </div>
              )}
              <div className="space-y-1">
                {items.map((it) => (
                  <div key={it.id} className="flex items-center gap-3 rounded-lg border border-ink-800 bg-ink-900 px-3 py-2">
                    <span className="font-mono text-xs text-slate-500">{it.id}</span>
                    <div className="min-w-0 flex-1">
                      <div className="truncate text-sm text-slate-100">{it.title}</div>
                      {it.status && <div className="truncate text-[11px] text-slate-500">{it.status}</div>}
                    </div>
                    <button className="btn-soft text-xs" disabled={busy} onClick={() => startBranch(it)}>
                      Start branch
                    </button>
                    <button className="btn-ghost text-xs" onClick={() => api().openExternal(it.url)}>
                      Open
                    </button>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
