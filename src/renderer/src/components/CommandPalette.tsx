import React, { useEffect, useMemo, useRef, useState } from 'react'
import { api, Branch, GraphCommit } from '../api'

export interface PaletteAction {
  label: string
  hint?: string
  run: () => void
}

type Kind = 'action' | 'branch' | 'file' | 'commit'

interface Item {
  kind: Kind
  label: string
  hint?: string
  run: () => void
}

/** Subsequence match with bonuses for word starts and consecutive runs. */
function fuzzyScore(query: string, target: string): number {
  const q = query.toLowerCase()
  const t = target.toLowerCase()
  if (!q) return 0
  let score = 0
  let from = 0
  let last = -2
  for (const ch of q) {
    const idx = t.indexOf(ch, from)
    if (idx === -1) return -Infinity
    score += idx === last + 1 ? 3 : 1
    if (idx === 0 || '/\\-_. '.includes(t[idx - 1])) score += 2
    last = idx
    from = idx + 1
  }
  return score - t.length * 0.01
}

const KIND_STYLE: Record<Kind, { label: string; cls: string }> = {
  action: { label: 'action', cls: 'bg-accent/15 text-accent' },
  branch: { label: 'branch', cls: 'bg-good/15 text-good' },
  file: { label: 'file', cls: 'bg-info/15 text-info' },
  commit: { label: 'commit', cls: 'bg-warn/15 text-warn' }
}

export default function CommandPalette({
  cwd,
  branches,
  actions,
  onCheckout,
  onOpenFile,
  onOpenCommit,
  onClose
}: {
  cwd: string
  branches: Branch[]
  actions: PaletteAction[]
  onCheckout: (name: string) => void
  onOpenFile: (path: string) => void
  onOpenCommit: (hash: string) => void
  onClose: () => void
}) {
  const [q, setQ] = useState('')
  const [idx, setIdx] = useState(0)
  const [files, setFiles] = useState<string[]>([])
  const [commits, setCommits] = useState<GraphCommit[]>([])
  const listRef = useRef<HTMLDivElement>(null)

  const [remoteOnly, setRemoteOnly] = useState<string[]>([])

  useEffect(() => {
    api().tree(cwd).then(setFiles).catch(() => {})
    api().logGraph(cwd, { all: true, limit: 300 }).then(setCommits).catch(() => {})
    api()
      .branchesFull(cwd)
      .then((all) => {
        const locals = new Set(all.filter((b) => !b.remote).map((b) => b.name))
        setRemoteOnly(
          all
            .filter((b) => b.remote && !b.name.endsWith('/HEAD'))
            .filter((b) => !locals.has(b.name.split('/').slice(1).join('/')))
            .map((b) => b.name)
        )
      })
      .catch(() => {})
  }, [cwd])

  const results = useMemo(() => {
    const bias: Record<Kind, number> = { action: 4, branch: 3, file: 1, commit: 0 }
    const pool: Item[] = [
      ...actions.map((a) => ({ kind: 'action' as Kind, label: a.label, hint: a.hint, run: a.run })),
      ...branches.map((b) => ({
        kind: 'branch' as Kind,
        label: b.name,
        hint: b.current ? 'current branch' : 'checkout',
        run: () => onCheckout(b.name)
      })),
      ...remoteOnly.map((name) => ({
        kind: 'branch' as Kind,
        label: name,
        hint: 'checkout remote',
        run: () => onCheckout(name.split('/').slice(1).join('/'))
      })),
      // Files and commits only make sense once there is something to match.
      ...(q
        ? files.map((f) => ({ kind: 'file' as Kind, label: f, hint: 'open', run: () => onOpenFile(f) }))
        : []),
      ...(q
        ? commits.map((c) => ({
            kind: 'commit' as Kind,
            label: c.subject,
            hint: `${c.shortHash} - ${c.author}`,
            run: () => onOpenCommit(c.hash)
          }))
        : [])
    ]
    const scored = pool
      .map((item) => ({
        item,
        score: fuzzyScore(q, item.kind === 'commit' ? `${item.label} ${item.hint}` : item.label) + bias[item.kind]
      }))
      .filter((s) => s.score > -Infinity)
    scored.sort((a, b) => b.score - a.score)
    return scored.slice(0, 40).map((s) => s.item)
  }, [q, actions, branches, remoteOnly, files, commits, onCheckout, onOpenFile, onOpenCommit])

  useEffect(() => setIdx(0), [q])

  useEffect(() => {
    listRef.current
      ?.querySelector(`[data-idx="${idx}"]`)
      ?.scrollIntoView({ block: 'nearest' })
  }, [idx])

  const pick = (item: Item | undefined) => {
    if (!item) return
    onClose()
    item.run()
  }

  return (
    <div className="fixed inset-0 z-[80] bg-black/50 backdrop-blur-[2px]" onClick={onClose}>
      <div
        className="mx-auto mt-[12vh] flex w-[580px] flex-col overflow-hidden rounded-xl border border-ink-700 bg-ink-850 shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <input
          autoFocus
          value={q}
          onChange={(e) => setQ(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'ArrowDown') {
              e.preventDefault()
              setIdx((i) => Math.min(i + 1, results.length - 1))
            } else if (e.key === 'ArrowUp') {
              e.preventDefault()
              setIdx((i) => Math.max(i - 1, 0))
            } else if (e.key === 'Enter') {
              pick(results[idx])
            } else if (e.key === 'Escape') {
              onClose()
            }
          }}
          placeholder="Type a command, branch, file or commit message..."
          className="w-full border-b border-ink-800 bg-transparent px-4 py-3 text-sm outline-none select-text"
        />
        <div ref={listRef} className="max-h-[46vh] overflow-auto py-1">
          {results.map((r, i) => {
            const k = KIND_STYLE[r.kind]
            return (
              <button
                key={r.kind + r.label + i}
                data-idx={i}
                onMouseEnter={() => setIdx(i)}
                onClick={() => pick(r)}
                className={`flex w-full items-center gap-2.5 px-4 py-1.5 text-left text-sm ${
                  i === idx ? 'bg-ink-750 text-white' : 'text-slate-300'
                }`}
              >
                <span className={`w-14 shrink-0 rounded px-1.5 py-px text-center text-[10px] font-semibold ${k.cls}`}>
                  {k.label}
                </span>
                <span className="min-w-0 flex-1 truncate">{r.label}</span>
                {r.hint && <span className="shrink-0 text-[11px] text-slate-500">{r.hint}</span>}
              </button>
            )
          })}
          {results.length === 0 && (
            <div className="px-4 py-6 text-center text-sm text-slate-500">Nothing matches.</div>
          )}
        </div>
        <div className="flex items-center gap-3 border-t border-ink-800 px-4 py-1.5 text-[10px] text-ink-500">
          <span>Up/Down to move</span>
          <span>Enter to run</span>
          <span>Esc to close</span>
        </div>
      </div>
    </div>
  )
}
