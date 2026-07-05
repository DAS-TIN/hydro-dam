import React, { useEffect, useState } from 'react'
import { api, TrelloList, TrackerItem, TrackerView } from '../api'

const LABEL_COLORS: Record<string, string> = {
  red: 'bg-red-900/40 text-red-300',
  orange: 'bg-orange-900/40 text-orange-300',
  yellow: 'bg-yellow-900/40 text-yellow-300',
  green: 'bg-green-900/40 text-green-300',
  blue: 'bg-blue-900/40 text-blue-300',
  purple: 'bg-purple-900/40 text-purple-300',
  pink: 'bg-pink-900/40 text-pink-300',
  sky: 'bg-sky-900/40 text-sky-300',
  lime: 'bg-lime-900/40 text-lime-300',
  black: 'bg-ink-700 text-slate-300'
}

function labelClass(name: string): string {
  for (const key of Object.keys(LABEL_COLORS)) {
    if (name.toLowerCase().includes(key)) return LABEL_COLORS[key]
  }
  return 'bg-ink-700 text-slate-300'
}

export default function TrelloBoardView({
  tracker,
  cwd,
  toast,
  onBranchCreated
}: {
  tracker: TrackerView
  cwd: string
  toast: (kind: 'ok' | 'err' | 'info', text: string) => void
  onBranchCreated: () => void
}) {
  const [lists, setLists] = useState<TrelloList[]>([])
  const [loading, setLoading] = useState(true)
  const [err, setErr] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    setLoading(true)
    setErr(null)
    api().trackersBoard(tracker.id)
      .then(setLists)
      .catch((e: any) => setErr(e?.message || String(e)))
      .finally(() => setLoading(false))
  }, [tracker.id])

  const startBranch = async (card: TrackerItem) => {
    const slug = (card.id + '-' + card.title)
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 48)
    setBusy(true)
    try {
      await api().createBranch(cwd, slug)
      toast('ok', 'Branch created: ' + slug)
      onBranchCreated()
    } catch (e: any) {
      toast('err', e?.message || String(e))
    } finally {
      setBusy(false)
    }
  }

  if (loading) {
    return (
      <div className="flex h-full items-center justify-center text-sm text-slate-500">
        Loading board...
      </div>
    )
  }

  if (err) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-2 text-sm text-slate-500">
        <span className="text-bad">{err}</span>
        <button
          className="btn-ghost text-xs"
          onClick={() => {
            setLoading(true)
            setErr(null)
            api().trackersBoard(tracker.id)
              .then(setLists)
              .catch((e: any) => setErr(e?.message || String(e)))
              .finally(() => setLoading(false))
          }}
        >
          Retry
        </button>
      </div>
    )
  }

  return (
    <div className="flex h-full flex-col overflow-hidden">
      <div className="flex items-center gap-3 border-b border-ink-800 px-4 py-2 flex-shrink-0">
        <span className="text-sm font-medium text-slate-100">{tracker.label}</span>
        <span className="text-[11px] text-slate-500">Trello board</span>
        <div className="flex-1" />
        <button
          className="btn-ghost text-xs"
          onClick={() => {
            setLoading(true)
            api().trackersBoard(tracker.id)
              .then(setLists)
              .catch((e: any) => setErr(e?.message || String(e)))
              .finally(() => setLoading(false))
          }}
        >
          Refresh
        </button>
        <button
          className="btn-ghost text-xs"
          onClick={() => api().openExternal('https://trello.com')}
        >
          Open Trello
        </button>
      </div>

      <div className="flex flex-1 gap-3 overflow-x-auto overflow-y-hidden p-4">
        {lists.map((list) => (
          <div
            key={list.id}
            className="flex w-56 flex-shrink-0 flex-col rounded-xl border border-ink-700/60 bg-ink-850"
          >
            <div className="flex items-center gap-2 border-b border-ink-800 px-3 py-2">
              <span className="flex-1 text-xs font-semibold text-slate-200">{list.name}</span>
              <span className="rounded-full bg-ink-750 px-2 py-0.5 text-[10px] text-slate-400">
                {list.cards.length}
              </span>
            </div>

            <div className="flex flex-1 flex-col gap-2 overflow-y-auto p-2">
              {list.cards.length === 0 && (
                <div className="py-4 text-center text-[11px] text-slate-600">No cards</div>
              )}
              {list.cards.map((card) => (
                <div
                  key={card.id}
                  className="group rounded-lg border border-ink-700 bg-ink-900 p-2.5 hover:border-ink-600 cursor-default"
                >
                  <div className="mb-1.5 text-[12px] leading-snug text-slate-100">{card.title}</div>
                  {card.status && card.status !== list.name && (
                    <div className="mb-1.5 text-[10px] text-slate-500">{card.status}</div>
                  )}
                  <div className="flex items-center gap-1.5 flex-wrap">
                    <button
                      className="rounded bg-ink-750 px-1.5 py-0.5 text-[10px] text-slate-400 hover:bg-ink-700 hover:text-slate-200 disabled:opacity-40"
                      disabled={busy}
                      onClick={() => startBranch(card)}
                      title="Create a git branch for this card"
                    >
                      Branch
                    </button>
                    <button
                      className="rounded bg-ink-750 px-1.5 py-0.5 text-[10px] text-slate-400 hover:bg-ink-700 hover:text-slate-200"
                      onClick={() => api().openExternal(card.url)}
                    >
                      Open
                    </button>
                  </div>
                </div>
              ))}
            </div>
          </div>
        ))}

        {lists.length === 0 && (
          <div className="flex flex-1 items-center justify-center text-sm text-slate-600">
            No lists found on this board.
          </div>
        )}
      </div>
    </div>
  )
}
