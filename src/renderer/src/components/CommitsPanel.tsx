import React, { useEffect, useMemo, useRef, useState } from 'react'
import { IconClose } from './Icons'
import { api, confirmDialog, GraphCommit, LogQuery, basename } from '../api'
import DiffView from './DiffView'
import { promptDialog } from './PromptModal'

const ROW_H = 50 // px; must match the row height below so the graph aligns
const COL_W = 14 // px per graph lane
const LANE_COLORS = [
  '#60a5fa',
  '#f472b6',
  '#34d399',
  '#fbbf24',
  '#a78bfa',
  '#fb7185',
  '#22d3ee',
  '#a3e635',
  '#f97316',
  '#e879f9'
]
const laneColor = (i: number) => LANE_COLORS[((i % LANE_COLORS.length) + LANE_COLORS.length) % LANE_COLORS.length]

/**
 * Work out which horizontal column each commit occupies in the graph. This is
 * the classic swimlane layout.
 *
 * Each lane holds the hash of the commit it is waiting for. Walking commits
 * newest-first (topo order): when a commit is reached, use the lane already
 * reserved for it (a child stored its hash there) or the first free lane. That
 * lane then waits on the commit's first parent; additional parents (merges)
 * reserve new lanes, and any other lanes still waiting on this commit are freed.
 *
 * Returns a hash-to-column map plus the widest column used (to size the SVG).
 */
function assignColumns(commits: GraphCommit[]): { colOf: Map<string, number>; maxCol: number } {
  const colOf = new Map<string, number>()
  const lanes: (string | null)[] = [] // hash each lane is waiting to draw next
  let maxCol = 0
  const firstFree = () => {
    const i = lanes.indexOf(null)
    return i === -1 ? lanes.length : i
  }
  for (const c of commits) {
    let col = lanes.indexOf(c.hash)
    if (col === -1) col = firstFree()
    if (col >= lanes.length) lanes.push(null)
    colOf.set(c.hash, col)
    maxCol = Math.max(maxCol, col)
    //This lane now continues to the commit's first parent.
    lanes[col] = c.parents[0] ?? null
    //Collapse any other lanes that were also waiting for this commit.
    for (let i = 0; i < lanes.length; i++) if (i !== col && lanes[i] === c.hash) lanes[i] = null
    //Reserve lanes for additional (merge) parents.
    for (let k = 1; k < c.parents.length; k++) {
      const p = c.parents[k]
      if (lanes.indexOf(p) === -1) {
        const slot = firstFree()
        if (slot >= lanes.length) lanes.push(null)
        lanes[slot] = p
        maxCol = Math.max(maxCol, slot)
      }
    }
  }
  return { colOf, maxCol }
}

//The local branch a decoration represents (draggable), or null for tags/remotes.
function branchOf(label: string): string | null {
  if (label.startsWith('HEAD ->')) return label.slice('HEAD ->'.length).trim()
  if (label.startsWith('tag:') || label === 'HEAD' || label.includes('/')) return null
  return label
}

const TagGlyph = () => (
  <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="shrink-0">
    <path d="M2.8 2.8h8.6l9.4 9.4a1.3 1.3 0 010 1.8l-6.8 6.8a1.3 1.3 0 01-1.8 0L2.8 11.4z"/>
    <path d="M7.4 7.4h.02" strokeLinecap="round" strokeWidth="2.6"/>
  </svg>
)

const BranchGlyph = () => (
  <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="shrink-0">
    <line x1="6.5" y1="3.5" x2="6.5" y2="14.6"/>
    <circle cx="17.5" cy="6.5" r="2.7"/>
    <circle cx="6.5" cy="17.6" r="2.7"/>
    <path d="M17.5 9.2c0 4.5-3.7 8.2-8.2 8.2"/>
  </svg>
)

// GitKraken-style ref labels: squared boxes with a branch/tag glyph.
function RefChip({
  label,
  onDragStart,
  onDropBranch
}: {
  label: string
  onDragStart?: (e: React.DragEvent) => void
  onDropBranch?: (e: React.DragEvent) => void
}) {
  let cls = 'border-accent/40 bg-accent/10 text-accent'
  let text = label
  let icon: React.ReactNode = <BranchGlyph />
  if (label.startsWith('tag:')) {
    cls = 'border-warn/40 bg-warn/10 text-warn'
    text = label.replace('tag:', '').trim()
    icon = <TagGlyph />
  } else if (label.startsWith('HEAD ->')) {
    cls = 'border-good/50 bg-good/10 text-good'
    text = label.replace('HEAD ->', '').trim()
  } else if (label === 'HEAD') {
    cls = 'border-good/50 bg-good/10 text-good'
  } else if (label.includes('/')) {
    cls = 'border-info/40 bg-info/10 text-info'
  }
  const drag = !!onDragStart
  return (
    <span
      draggable={drag}
      onDragStart={onDragStart}
      onDragOver={onDropBranch ? (e) => e.preventDefault() : undefined}
      onDrop={onDropBranch}
      title={drag ? `Drag ${text} onto a commit (move) or another branch (merge/rebase)` : text}
      className={`inline-flex max-w-[180px] shrink-0 items-center gap-1.5 rounded border px-2 py-0.5 text-[11px] font-semibold ${cls} ${
        drag ? 'cursor-grab' : ''
      } ${onDropBranch ? 'ring-1 ring-accent' : ''}`}
    >
      {icon}
      <span className="truncate">{text}</span>
    </span>
  )
}

type Menu = { commit: GraphCommit; x: number; y: number }
type MenuAction = { label: string; run: () => void; danger?: boolean }

export default function CommitsPanel({
  cwd,
  currentBranch,
  toast,
  onChanged,
  onInteractiveRebase,
  path,
  aiAvailable,
  onAi,
  onClose,
  embedded,
  focusHash
}: {
  cwd: string
  currentBranch: string
  toast: (kind: 'ok' | 'err' | 'info', text: string) => void
  onChanged: () => void
  onInteractiveRebase: (base: string) => void
  path?: string
  aiAvailable?: boolean
  onAi?: (title: string, run: () => Promise<string>) => void
  onClose?: () => void
  /** Render inline (main-pane tab) instead of as a modal overlay. */
  embedded?: boolean
  /** Select and scroll to this commit once loaded (command palette jump). */
  focusHash?: string
}) {
  const [commits, setCommits] = useState<GraphCommit[]>([])
  const [sel, setSel] = useState<GraphCommit | null>(null)
  const [show, setShow] = useState('')
  const [loadingList, setLoadingList] = useState(true)
  const [loadingShow, setLoadingShow] = useState(false)
  const [allBranches, setAllBranches] = useState(true)
  const [grep, setGrep] = useState('')
  const [author, setAuthor] = useState('')
  const [menu, setMenu] = useState<Menu | null>(null)
  const [busy, setBusy] = useState(false)
  const [copied, setCopied] = useState('')
  const [dragBranch, setDragBranch] = useState<{ name: string; current: boolean } | null>(null)
  const [dragCommit, setDragCommit] = useState<{ hash: string; shortHash: string } | null>(null)
  const [branchDrop, setBranchDrop] = useState<{ source: string; target: string; x: number; y: number } | null>(null)
  const [listW, setListW] = useState(560)

  const startSplit = (e: React.MouseEvent) => {
    e.preventDefault()
    const startX = e.clientX
    const startW = listW
    const move = (ev: MouseEvent) =>
      setListW(Math.min(Math.max(340, startW + ev.clientX - startX), 900))
    const up = () => {
      window.removeEventListener('mousemove', move)
      window.removeEventListener('mouseup', up)
    }
    window.addEventListener('mousemove', move)
    window.addEventListener('mouseup', up)
  }

  const load = (q: LogQuery) => {
    setLoadingList(true)
    api()
      .logGraph(cwd, q)
      .then((c) => {
        setCommits(c)
        setSel((prev) => c.find((x) => x.hash === prev?.hash) ?? c[0] ?? null)
      })
      .catch((e) => {
        setCommits([])
        toast('err', e?.message || String(e))
      })
      .finally(() => setLoadingList(false))
  }

  //Reload when the branch scope changes; search runs on submit.
  useEffect(() => {
    load({ all: allBranches, grep, author, path, limit: 400 })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cwd, allBranches])

  const listRef = useRef<HTMLDivElement>(null)

  // Jump to the commit the command palette asked for, once the list is in.
  useEffect(() => {
    if (!focusHash || loadingList) return
    const idx = commits.findIndex((c) => c.hash === focusHash)
    if (idx === -1) return
    setSel(commits[idx])
    listRef.current?.scrollTo({ top: Math.max(0, idx * ROW_H - 120) })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [focusHash, loadingList])

  useEffect(() => {
    if (!sel) {
      setShow('')
      return
    }
    setLoadingShow(true)
    api()
      .commitShow(cwd, sel.hash)
      .then(setShow)
      .catch((e) => setShow(e.message))
      .finally(() => setLoadingShow(false))
  }, [sel, cwd])

  const { colOf, maxCol } = useMemo(() => assignColumns(commits), [commits])
  const rowOf = useMemo(() => {
    const m = new Map<string, number>()
    commits.forEach((c, i) => m.set(c.hash, i))
    return m
  }, [commits])
  const graphW = (maxCol + 1) * COL_W + 10
  const xOf = (col: number) => col * COL_W + COL_W / 2 + 5
  const yOf = (row: number) => row * ROW_H + ROW_H / 2

  const submitSearch = () => load({ all: allBranches, grep, author, path, limit: 400 })

  const copyHash = (hash: string) => {
    navigator.clipboard.writeText(hash).then(() => {
      setCopied(hash)
      setTimeout(() => setCopied(''), 1400)
    })
  }

  //Run a commit action, then refresh both this panel and the main view.
  const act = async (fn: () => Promise<any>, okMsg: string, closeAfter = false) => {
    setBusy(true)
    setMenu(null)
    try {
      await fn()
      toast('ok', okMsg)
      onChanged()
      load({ all: allBranches, grep, author, path, limit: 400 })
      if (closeAfter) onClose?.()
    } catch (e: any) {
      toast('err', e?.message || String(e))
      onChanged()
    } finally {
      setBusy(false)
    }
  }

  //Drag a commit onto a branch chip to cherry-pick it onto that branch.
  const cherryPickOnto = (target: string, c: { hash: string; shortHash: string }) =>
    confirmDialog({
      title: 'Cherry-pick',
      message: `Cherry-pick ${c.shortHash} onto ${target}?`,
      detail: 'Checks out the branch and applies this commit on top.',
      confirmLabel: 'Cherry-pick'
    }).then((ok) => {
      if (ok)
        act(async () => {
          await api().checkout(cwd, target)
          await api().cherryPick(cwd, c.hash)
        }, `Cherry-picked ${c.shortHash} onto ${target}.`)
    })

  // Drag a branch chip onto a commit to move/reset it there (GitKraken-style).
  const onDropCommit = (c: GraphCommit) => {
    const b = dragBranch
    setDragBranch(null)
    if (!b) return
    // Dropping a branch on the commit it already points to is a no-op.
    if (c.refs.some((r) => branchOf(r) === b.name)) return
    confirmDialog({
      title: 'Move branch',
      message: `Move ${b.name} to ${c.shortHash}?`,
      detail: b.current
        ? 'This is the current branch: a mixed reset (keeps your working changes).'
        : 'Moves the branch ref (git branch -f).',
      confirmLabel: 'Move'
    }).then((ok) => {
      if (ok)
        act(
          () => (b.current ? api().resetTo(cwd, c.hash, 'mixed') : api().moveBranch(cwd, b.name, c.hash)),
          `Moved ${b.name} to ${c.shortHash}.`
        )
    })
  }

  const menuActions = (c: GraphCommit): MenuAction[] => [
    { label: copied === c.hash ? 'Copied hash!' : 'Copy full hash', run: () => copyHash(c.hash) },
    {
      label: 'Checkout this commit (detached)',
      run: () =>
        confirmDialog({
          title: 'Checkout commit',
          message: `Check out ${c.shortHash} in a detached HEAD?`,
          detail: 'You will not be on a branch. Create a branch here to keep work.',
          confirmLabel: 'Checkout'
        }).then((ok) => {
          if (ok) act(() => api().checkoutCommit(cwd, c.hash), `Checked out ${c.shortHash}.`, true)
        })
    },
    {
      label: 'New branch here...',
      run: async () => {
        const name = await promptDialog({
          title: 'New branch',
          label: `Branch name (starting at ${c.shortHash})`,
          placeholder: 'feature/my-change',
          confirmLabel: 'Create'
        })
        if (name) act(() => api().branchAt(cwd, name, c.hash), `Created branch ${name}.`, true)
      }
    },
    {
      label: 'New tag here...',
      run: async () => {
        const name = await promptDialog({
          title: 'New tag',
          label: `Tag name (at ${c.shortHash})`,
          placeholder: 'v1.0.0',
          confirmLabel: 'Create'
        })
        if (name) act(() => api().tagAt(cwd, name, c.hash), `Tagged ${name}.`)
      }
    },
    {
      label: 'Cherry-pick onto ' + (currentBranch || 'HEAD'),
      run: () => act(() => api().cherryPick(cwd, c.hash), `Cherry-picked ${c.shortHash}.`)
    },
    {
      label: 'Revert this commit',
      run: () => act(() => api().revertCommit(cwd, c.hash), `Reverted ${c.shortHash}.`)
    },
    {
      label: 'Rebase ' + (currentBranch || 'branch') + ' onto here',
      run: () =>
        confirmDialog({
          title: 'Rebase',
          message: `Rebase ${currentBranch || 'current branch'} onto ${c.shortHash}?`,
          detail: 'Commits are replayed on top of this one. Conflicts can be resolved from the banner.',
          confirmLabel: 'Rebase'
        }).then((ok) => {
          if (ok) act(() => api().rebaseBranch(cwd, c.hash), `Rebased onto ${c.shortHash}.`)
        })
    },
    {
      label: 'Interactive rebase from here (edit newer commits)',
      run: () => {
        setMenu(null)
        onInteractiveRebase(c.hash)
      }
    },
    {
      label: 'Reset ' + (currentBranch || 'branch') + ' to here (soft)',
      run: () => act(() => api().resetTo(cwd, c.hash, 'soft'), `Reset (soft) to ${c.shortHash}.`)
    },
    {
      label: 'Reset to here (mixed)',
      run: () => act(() => api().resetTo(cwd, c.hash, 'mixed'), `Reset (mixed) to ${c.shortHash}.`)
    },
    {
      label: 'Reset to here (hard) - discards changes',
      danger: true,
      run: () =>
        confirmDialog({
          title: 'Hard reset',
          danger: true,
          message: `Hard reset ${currentBranch || 'branch'} to ${c.shortHash}?`,
          detail: 'All uncommitted changes AND commits after this one are discarded. This cannot be undone.',
          confirmLabel: 'Hard reset'
        }).then((ok) => {
          if (ok) act(() => api().resetTo(cwd, c.hash, 'hard'), `Hard reset to ${c.shortHash}.`)
        })
    }
  ]

  return (
    <div
      className={
        embedded
          ? 'flex min-h-0 flex-1 flex-col'
          : 'fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm'
      }
      onClick={() => {
        // First click clears any open context menu; a bare backdrop click
        // closes the modal (never the embedded main-pane graph).
        if (menu || branchDrop) {
          setMenu(null)
          setBranchDrop(null)
        } else if (!embedded) {
          onClose?.()
        }
      }}
    >
      <div
        className={
          embedded
            ? 'flex min-h-0 flex-1 flex-col overflow-hidden'
            : 'card flex h-[88vh] w-[1180px] flex-col overflow-hidden shadow-2xl'
        }
        onClick={embedded ? undefined : (e) => e.stopPropagation()}
      >
        {/* header / search */}
        <div className="flex items-center gap-2 border-b border-ink-700/60 px-4 py-2.5">
          <div className="text-sm font-semibold text-white">History</div>
          {path && <span className="chip bg-ink-750 text-slate-300">file: {basename(path)}</span>}
          <span className="text-[11px] text-slate-500">{commits.length} commits</span>
          <div className="mx-1 h-5 w-px bg-ink-700" />
          <input
            value={grep}
            onChange={(e) => setGrep(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && submitSearch()}
            placeholder="Search messages..."
            className="w-52 rounded-md border border-ink-700 bg-ink-950 px-2.5 py-1 text-sm outline-none focus:border-accent select-text"
          />
          <input
            value={author}
            onChange={(e) => setAuthor(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && submitSearch()}
            placeholder="Author..."
            className="w-36 rounded-md border border-ink-700 bg-ink-950 px-2.5 py-1 text-sm outline-none focus:border-accent select-text"
          />
          <button className="btn-soft text-xs" onClick={submitSearch}>
            Search
          </button>
          <label className="flex items-center gap-1.5 text-xs text-slate-400">
            <input
              type="checkbox"
              checked={allBranches}
              onChange={(e) => setAllBranches(e.target.checked)}
              className="accent-accent"
            />
            All branches
          </label>
          <div className="flex-1" />
          {onClose && (
            <button className="btn-ghost px-2" onClick={onClose} title="Close">
              <IconClose className="w-4 h-4" />
            </button>
          )}
        </div>

        <div className="flex min-h-0 flex-1">
          {/* graph + list */}
          <div ref={listRef} className="relative shrink-0 overflow-auto" style={{ width: listW }}>
            {loadingList && <div className="p-4 text-sm text-slate-500">Loading...</div>}
            {!loadingList && commits.length === 0 && (
              <div className="p-4 text-sm text-slate-500">No commits match.</div>
            )}
            {!loadingList && commits.length > 0 && (
              <div className="relative" style={{ height: commits.length * ROW_H }}>
                {/* graph edges + nodes */}
                <svg
                  className="pointer-events-none absolute left-0 top-0"
                  width={graphW}
                  height={commits.length * ROW_H}
                >
                  {commits.map((c, i) => {
                    const cx = xOf(colOf.get(c.hash) ?? 0)
                    const cy = yOf(i)
                    return c.parents.map((p) => {
                      const pr = rowOf.get(p)
                      const color = laneColor(colOf.get(c.hash) ?? 0)
                      if (pr === undefined) {
                        //parent outside the window: short stub downward
                        return (
                          <path
                            key={c.hash + p}
                            d={`M ${cx} ${cy} L ${cx} ${cy + ROW_H * 0.6}`}
                            stroke={color}
                            strokeWidth={2}
                            fill="none"
                            opacity={0.5}
                          />
                        )
                      }
                      const px = xOf(colOf.get(p) ?? 0)
                      const py = yOf(pr)
                      const pcolor = laneColor(colOf.get(p) ?? 0)
                      const midY = (cy + py) / 2
                      const d =
                        cx === px
                          ? `M ${cx} ${cy} L ${px} ${py}`
                          : `M ${cx} ${cy} C ${cx} ${midY} ${px} ${midY} ${px} ${py}`
                      return <path key={c.hash + p} d={d} stroke={pcolor} strokeWidth={2} fill="none" />
                    })
                  })}
                  {commits.map((c, i) => {
                    const cx = xOf(colOf.get(c.hash) ?? 0)
                    const cy = yOf(i)
                    const color = laneColor(colOf.get(c.hash) ?? 0)
                    const isHead = c.refs.some((r) => r.startsWith('HEAD'))
                    return (
                      <circle
                        key={c.hash}
                        cx={cx}
                        cy={cy}
                        r={isHead ? 5.5 : 4}
                        fill={color}
                        stroke={isHead ? '#fff' : '#0b0d12'}
                        strokeWidth={isHead ? 1.5 : 1}
                      />
                    )
                  })}
                </svg>

                {/* rows */}
                {commits.map((c, i) => (
                  <button
                    key={c.hash}
                    draggable
                    onDragStart={() => setDragCommit({ hash: c.hash, shortHash: c.shortHash })}
                    onDragEnd={() => setDragCommit(null)}
                    onClick={() => setSel(c)}
                    onContextMenu={(e) => {
                      e.preventDefault()
                      setSel(c)
                      setMenu({ commit: c, x: e.clientX, y: e.clientY })
                    }}
                    onDragOver={(e) => {
                      if (dragBranch) e.preventDefault()
                    }}
                    onDrop={(e) => {
                      e.preventDefault()
                      onDropCommit(c)
                    }}
                    className={`absolute right-0 flex flex-col justify-center border-b border-ink-850 px-3 text-left transition-colors ${
                      sel?.hash === c.hash ? 'bg-ink-750' : 'hover:bg-ink-850'
                    } ${dragBranch ? 'hover:ring-1 hover:ring-inset hover:ring-accent' : ''}`}
                    style={{ top: i * ROW_H, height: ROW_H, left: graphW, width: `calc(100% - ${graphW}px)` }}
                  >
                    <div className="flex items-center gap-2">
                      {c.refs.map((r) => {
                        const br = branchOf(r)
                        const dropTarget = !!(br && ((dragBranch && br !== dragBranch.name) || dragCommit))
                        return (
                          <RefChip
                            key={r}
                            label={r}
                            onDragStart={
                              br
                                ? (e) => {
                                    e.stopPropagation()
                                    setDragBranch({ name: br, current: br === currentBranch })
                                  }
                                : undefined
                            }
                            onDropBranch={
                              dropTarget
                                ? (e) => {
                                    e.preventDefault()
                                    e.stopPropagation()
                                    if (dragCommit) {
                                      const c2 = dragCommit
                                      setDragCommit(null)
                                      cherryPickOnto(br!, c2)
                                    } else if (dragBranch) {
                                      setBranchDrop({ source: dragBranch.name, target: br!, x: e.clientX, y: e.clientY })
                                      setDragBranch(null)
                                    }
                                  }
                                : undefined
                            }
                          />
                        )
                      })}
                      <span className="min-w-0 truncate text-sm text-slate-100">{c.subject}</span>
                    </div>
                    <div className="mt-0.5 flex items-center gap-2 text-[11px] text-slate-500">
                      <span className="font-mono text-accent">{c.shortHash}</span>
                      <span className="min-w-0 truncate">{c.author}</span>
                      <span className="shrink-0">- {c.relDate}</span>
                    </div>
                  </button>
                ))}
              </div>
            )}
          </div>

          {/* splitter */}
          <div
            onMouseDown={startSplit}
            className="w-1 shrink-0 cursor-col-resize bg-ink-700/60 transition-colors hover:bg-accent/60"
            title="Drag to resize"
          />

          {/* preview */}
          <div className="flex min-w-0 flex-1 flex-col">
            <div className="flex items-start gap-3 border-b border-ink-700/60 px-4 py-2.5">
              <div className="min-w-0 flex-1">
                <div className="truncate text-sm font-medium text-slate-100">
                  {sel ? sel.subject : 'Select a commit'}
                </div>
                {sel && (
                  <div className="mt-0.5 flex flex-wrap items-center gap-x-3 gap-y-0.5 text-[11px] text-slate-500">
                    <button onClick={() => copyHash(sel.hash)} className="font-mono text-accent hover:underline">
                      {copied === sel.hash ? 'copied!' : sel.shortHash}
                    </button>
                    <span>
                      {sel.author} &lt;{sel.email}&gt;
                    </span>
                    <span>{sel.date}</span>
                    {sel.coauthors.map((c) => (
                      <span
                        key={c.email || c.name}
                        className="chip bg-ink-750 text-slate-300"
                        title={c.email ? `${c.name} <${c.email}>` : c.name}
                      >
                        + {c.name}
                      </span>
                    ))}
                  </div>
                )}
              </div>
              {sel && aiAvailable && onAi && (
                <>
                  <button
                    className="btn-ghost text-xs"
                    onClick={() => onAi(`Explain ${sel.shortHash}`, () => api().aiExplainCommit(cwd, sel.hash))}
                    title="Explain this commit with AI"
                  >
                    Explain
                  </button>
                  <button
                    className="btn-ghost text-xs"
                    onClick={() => onAi('Release notes since ' + sel.shortHash, () => api().aiChangelog(cwd, sel.hash))}
                    title="Generate release notes for commits after this one"
                  >
                    Changelog
                  </button>
                </>
              )}
              {sel && (
                <button
                  className="btn-ghost text-xs"
                  disabled={busy}
                  onClick={(e) => setMenu({ commit: sel, x: e.clientX, y: e.clientY })}
                  title="Commit actions"
                >
                  Actions
                </button>
              )}
            </div>
            <div className="min-h-0 flex-1">
              {loadingShow ? (
                <div className="flex h-full items-center justify-center text-sm text-slate-500">Loading...</div>
              ) : (
                <DiffView text={show} empty="Select a commit to preview what it changed." />
              )}
            </div>
          </div>
        </div>
      </div>

      {/* context menu */}
      {menu && (
        <div
          className="fixed z-[70] w-64 rounded-lg border border-ink-700 bg-ink-850 py-1 shadow-2xl"
          style={{ left: Math.min(menu.x, window.innerWidth - 270), top: Math.min(menu.y, window.innerHeight - 320) }}
          onClick={(e) => e.stopPropagation()}
        >
          <div className="border-b border-ink-800 px-3 py-1.5 text-[11px] text-slate-500">
            <span className="font-mono text-accent">{menu.commit.shortHash}</span> {menu.commit.subject}
          </div>
          {menuActions(menu.commit).map((a) => (
            <button
              key={a.label}
              disabled={busy}
              onClick={a.run}
              className={`block w-full px-3 py-1.5 text-left text-sm hover:bg-ink-800 disabled:opacity-50 ${
                a.danger ? 'text-bad' : 'text-slate-300'
              }`}
            >
              {a.label}
            </button>
          ))}
        </div>
      )}

      {/* branch-onto-branch drop menu */}
      {branchDrop && (
        <div
          className="fixed z-[70] w-72 rounded-lg border border-ink-700 bg-ink-850 py-1 shadow-2xl"
          style={{
            left: Math.min(branchDrop.x, window.innerWidth - 300),
            top: Math.min(branchDrop.y, window.innerHeight - 140)
          }}
          onClick={(e) => e.stopPropagation()}
        >
          <div className="border-b border-ink-800 px-3 py-1.5 text-[11px] text-slate-500">
            <span className="text-accent">{branchDrop.source}</span> onto{' '}
            <span className="text-accent">{branchDrop.target}</span>
          </div>
          <button
            className="block w-full px-3 py-1.5 text-left text-sm text-slate-300 hover:bg-ink-800 disabled:opacity-50"
            disabled={busy}
            onClick={() => {
              const { source, target } = branchDrop
              setBranchDrop(null)
              act(async () => {
                await api().checkout(cwd, target)
                await api().mergeBranch(cwd, source)
              }, `Merged ${source} into ${target}.`)
            }}
          >
            Merge {branchDrop.source} into {branchDrop.target}
          </button>
          <button
            className="block w-full px-3 py-1.5 text-left text-sm text-slate-300 hover:bg-ink-800 disabled:opacity-50"
            disabled={busy}
            onClick={() => {
              const { source, target } = branchDrop
              setBranchDrop(null)
              act(async () => {
                await api().checkout(cwd, target)
                await api().rebaseBranch(cwd, source)
              }, `Rebased ${target} onto ${source}.`)
            }}
          >
            Rebase {branchDrop.target} onto {branchDrop.source}
          </button>
        </div>
      )}
    </div>
  )
}
