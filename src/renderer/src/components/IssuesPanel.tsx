import React, { useEffect, useMemo, useState } from 'react'
import { IconClose } from './Icons'
import { api, confirmDialog, Issue, Milestone, RemoteRepo, relTime } from '../api'

// A git-safe branch slug like "42-fix-the-thing".
function branchFromIssue(n: number, title: string): string {
  const slug = title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40)
  return slug ? `${n}-${slug}` : `issue-${n}`
}

function dueLabel(dueOn: string | null): { text: string; cls: string } {
  if (!dueOn) return { text: 'no due date', cls: 'text-slate-600' }
  const due = new Date(dueOn)
  const days = Math.ceil((due.getTime() - Date.now()) / 86400000)
  const date = due.toLocaleDateString()
  if (days < 0) return { text: `${date} - ${-days}d overdue`, cls: 'text-bad' }
  if (days <= 7) return { text: `${date} - ${days}d left`, cls: 'text-warn' }
  return { text: date, cls: 'text-slate-400' }
}

// Open: green outlined circle. Closed as completed: violet check (GitHub's cue).
function StateIcon({ state }: { state: string }) {
  if (state === 'closed') {
    return (
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#a78bfa" strokeWidth="2" className="shrink-0">
        <circle cx="12" cy="12" r="10" />
        <path d="M8 12.5l2.5 2.5L16 9.5" />
      </svg>
    )
  }
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#4ade80" strokeWidth="2" className="shrink-0">
      <circle cx="12" cy="12" r="10" />
      <circle cx="12" cy="12" r="3" fill="#4ade80" stroke="none" />
    </svg>
  )
}

function SubProgress({ it }: { it: Issue }) {
  if (!it.subTotal) return null
  const pct = Math.round(((it.subCompleted ?? 0) / it.subTotal) * 100)
  return (
    <span className="flex shrink-0 items-center gap-1.5" title={`${it.subCompleted}/${it.subTotal} sub-issues done`}>
      <span className="h-1.5 w-14 overflow-hidden rounded-full bg-ink-750">
        <span className="block h-full rounded-full bg-violet-400" style={{ width: `${pct}%` }} />
      </span>
      <span className="text-[10px] text-slate-500">
        {it.subCompleted}/{it.subTotal}
      </span>
    </span>
  )
}

type ViewId = 'all' | 'assigned' | 'created' | 'mentioned' | 'activity' | 'milestones' | 'board'
type SortId = 'newest' | 'oldest' | 'updated'

const VIEWS: { id: ViewId; label: string; needsMe?: boolean }[] = [
  { id: 'all', label: 'All issues' },
  { id: 'assigned', label: 'Assigned to me', needsMe: true },
  { id: 'created', label: 'Created by me', needsMe: true },
  { id: 'mentioned', label: 'Mentions me' },
  { id: 'activity', label: 'Recent activity' }
]

export default function IssuesPanel({
  cwd,
  toast,
  onManageAccounts,
  onChanged,
  onClose
}: {
  cwd: string
  toast: (kind: 'ok' | 'err' | 'info', text: string) => void
  onManageAccounts: () => void
  onChanged: () => void
  onClose: () => void
}) {
  const [repo, setRepo] = useState<RemoteRepo | null>(null)
  const [issues, setIssues] = useState<Issue[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const [me, setMe] = useState('')
  const [view, setView] = useState<ViewId>('all')
  const [stateTab, setStateTab] = useState<'open' | 'closed'>('open')
  const [sort, setSort] = useState<SortId>('newest')
  const [labelFilter, setLabelFilter] = useState<Set<string>>(new Set())
  const [milestone, setMilestone] = useState('')
  const [commentFor, setCommentFor] = useState<number | null>(null)
  const [commentText, setCommentText] = useState('')
  const [timeline, setTimeline] = useState<Milestone[] | null>(null)

  // "Mentions me" is a server-side query (GitHub); the other views filter locally.
  const mentioned = view === 'mentioned'

  const load = () => {
    setLoading(true)
    setError('')
    api()
      .remoteIssues(cwd, mentioned)
      .then((r) => {
        setRepo(r.repo)
        setIssues(r.issues)
      })
      .catch((e) => setError(e?.message || String(e)))
      .finally(() => setLoading(false))
  }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(load, [cwd, mentioned])

  useEffect(() => {
    api()
      .remoteInfo(cwd)
      .then((ri) => setMe(ri.account?.username || ''))
      .catch(() => {})
  }, [cwd])

  useEffect(() => {
    if (view !== 'milestones' || timeline !== null) return
    api()
      .remoteMilestones(cwd)
      .then((ms) => {
        // Due-dated first, soonest first; undated at the end.
        ms.sort((a, b) => (a.dueOn ? Date.parse(a.dueOn) : Infinity) - (b.dueOn ? Date.parse(b.dueOn) : Infinity))
        setTimeline(ms)
      })
      .catch((e) => toast('err', e?.message || String(e)))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [view, cwd])

  // Planning surfaces that only exist on the host's website (Projects v2 has
  // no REST API) - offer one-click jumps instead.
  const webLinks = useMemo((): [string, string][] => {
    if (!repo) return []
    const base = repo.webUrl
    if (repo.provider === 'gitlab') {
      return [
        ['Issues', `${base}/-/issues`],
        ['Boards', `${base}/-/boards`],
        ['Milestones', `${base}/-/milestones`],
        ['Labels', `${base}/-/labels`]
      ]
    }
    return [
      ['Issue views', `${base}/issues/views`],
      ['Projects', `${base}/projects`],
      ['Milestones', `${base}/milestones`],
      ['Labels', `${base}/labels`]
    ]
  }, [repo])

  const allLabels = useMemo(() => [...new Set(issues.flatMap((it) => it.labels))].sort(), [issues])
  const milestones = useMemo(
    () => [...new Set(issues.map((it) => it.milestone).filter(Boolean) as string[])].sort(),
    [issues]
  )

  // View scope -> shared filters -> state split -> sort.
  const scoped = issues.filter((it) => {
    if (view === 'assigned' && !(me && it.assignees?.includes(me))) return false
    if (view === 'created' && it.author !== me) return false
    return true
  })
  const filtered = scoped.filter((it) => {
    if (milestone && it.milestone !== milestone) return false
    for (const l of labelFilter) if (!it.labels.includes(l)) return false
    return true
  })
  const openCount = filtered.filter((it) => it.state === 'open').length
  const closedCount = filtered.length - openCount
  const effectiveSort: SortId = view === 'activity' ? 'updated' : sort
  const listed = filtered
    .filter((it) => it.state === stateTab)
    .sort((a, b) => {
      if (effectiveSort === 'newest') return b.number - a.number
      if (effectiveSort === 'oldest') return a.number - b.number
      return Date.parse(b.updatedAt) - Date.parse(a.updatedAt)
    })

  // Board: milestone groups with completion, closed and open together.
  const groups = useMemo(() => {
    const byMs = new Map<string, Issue[]>()
    for (const it of filtered) {
      const key = it.milestone || 'No milestone'
      if (!byMs.has(key)) byMs.set(key, [])
      byMs.get(key)!.push(it)
    }
    return [...byMs.entries()].sort((a, b) =>
      a[0] === 'No milestone' ? 1 : b[0] === 'No milestone' ? -1 : a[0].localeCompare(b[0])
    )
  }, [filtered])

  const toggleLabel = (l: string) =>
    setLabelFilter((s) => {
      const n = new Set(s)
      n.has(l) ? n.delete(l) : n.add(l)
      return n
    })

  const act = async (fn: () => Promise<any>, okMsg: string, reload = true) => {
    setBusy(true)
    try {
      await fn()
      toast('ok', okMsg)
      if (reload) load()
    } catch (e: any) {
      toast('err', e?.message || String(e))
    } finally {
      setBusy(false)
    }
  }

  const startBranch = async (it: Issue) => {
    const name = branchFromIssue(it.number, it.title)
    await act(() => api().createBranch(cwd, name), `Created branch ${name}.`, false)
    onChanged()
    onClose()
  }

  const postComment = (it: Issue) => {
    const body = commentText.trim()
    if (!body) return
    act(() => api().issueComment(cwd, it.number, body), `Commented on #${it.number}.`, false).then(() => {
      setCommentFor(null)
      setCommentText('')
    })
  }

  const closeIssue = async (it: Issue) => {
    const ok = await confirmDialog({
      title: 'Close issue',
      message: `Close #${it.number} "${it.title}"?`,
      detail: 'Add a comment first if you want to say why.',
      confirmLabel: 'Close issue'
    })
    if (ok) act(() => api().issueClose(cwd, it.number), `Closed #${it.number}.`)
  }

  const reopenIssue = (it: Issue) =>
    act(() => api().issueReopen(cwd, it.number), `Reopened #${it.number}.`)

  const rowActions = (it: Issue) => (
    <span className="flex shrink-0 items-center gap-1">
      <button className="btn-soft text-xs" disabled={busy} onClick={() => startBranch(it)} title="Create a branch for this issue">
        Start branch
      </button>
      <button
        className="btn-ghost text-xs"
        disabled={busy}
        onClick={() => {
          setCommentFor(commentFor === it.number ? null : it.number)
          setCommentText('')
        }}
        title="Reply on the issue without leaving the app"
      >
        Comment
      </button>
      {it.state === 'open' ? (
        <button className="btn-ghost text-xs" disabled={busy} onClick={() => closeIssue(it)} title="Close this issue on the remote">
          Close
        </button>
      ) : (
        <button className="btn-ghost text-xs text-violet-300" disabled={busy} onClick={() => reopenIssue(it)} title="Reopen this issue">
          Reopen
        </button>
      )}
      <button className="btn-ghost text-xs" onClick={() => api().openExternal(it.url)}>
        Open
      </button>
    </span>
  )

  const composer = (it: Issue) =>
    commentFor === it.number && (
      <div className="border-t border-ink-800 px-3 py-2">
        <textarea
          value={commentText}
          onChange={(e) => setCommentText(e.target.value)}
          onKeyDown={(e) => (e.ctrlKey || e.metaKey) && e.key === 'Enter' && postComment(it)}
          rows={3}
          autoFocus
          placeholder={`Comment on #${it.number}... (Ctrl+Enter to post)`}
          className="w-full resize-none rounded-md border border-ink-700 bg-ink-950 px-3 py-2 text-sm outline-none focus:border-accent select-text"
        />
        <div className="mt-1.5 flex justify-end gap-2">
          <button className="btn-ghost text-xs" onClick={() => setCommentFor(null)}>
            Cancel
          </button>
          <button className="btn-accent text-xs" disabled={busy || !commentText.trim()} onClick={() => postComment(it)}>
            Post comment
          </button>
        </div>
      </div>
    )

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm" onClick={onClose}>
      <div className="card flex h-[82vh] w-[900px] overflow-hidden shadow-2xl" onClick={(e) => e.stopPropagation()}>
        {/* left rail: views, planning, labels */}
        <div className="flex w-44 shrink-0 flex-col border-r border-ink-700/60 bg-ink-900">
          <div className="px-4 pb-1 pt-3 text-sm font-semibold text-white">Issues</div>
          {VIEWS.map((v) => (
            <button
              key={v.id}
              onClick={() => setView(v.id)}
              disabled={!!v.needsMe && !me}
              title={v.needsMe && !me ? 'Connect an account to filter by yourself' : undefined}
              className={`mx-1.5 rounded-md px-2.5 py-1.5 text-left text-[13px] disabled:opacity-40 ${
                view === v.id ? 'bg-accent/10 text-accent' : 'text-slate-400 hover:bg-ink-850 hover:text-slate-200'
              }`}
            >
              {v.label}
            </button>
          ))}
          <div className="mx-3 my-2 h-px bg-ink-800" />
          {(
            [
              ['milestones', 'Milestones'],
              ['board', 'Board']
            ] as const
          ).map(([id, label]) => (
            <button
              key={id}
              onClick={() => setView(id)}
              className={`mx-1.5 rounded-md px-2.5 py-1.5 text-left text-[13px] ${
                view === id ? 'bg-accent/10 text-accent' : 'text-slate-400 hover:bg-ink-850 hover:text-slate-200'
              }`}
            >
              {label}
            </button>
          ))}
          {webLinks.length > 0 && (
            <>
              <div className="mx-3 my-2 h-px bg-ink-800" />
              <div className="px-4 pb-1 text-[10px] font-semibold uppercase tracking-wide text-slate-600">
                On {repo?.provider === 'gitlab' ? 'GitLab' : 'GitHub'}
              </div>
              {webLinks.map(([label, url]) => (
                <button
                  key={label}
                  onClick={() => api().openExternal(url)}
                  title={url}
                  className="mx-1.5 flex items-center justify-between rounded-md px-2.5 py-1 text-left text-[13px] text-slate-400 hover:bg-ink-850 hover:text-slate-200"
                >
                  {label}
                  <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="shrink-0 opacity-60">
                    <path d="M17.5 13.5V19a1.5 1.5 0 01-1.5 1.5H5A1.5 1.5 0 013.5 19V8A1.5 1.5 0 015 6.5h5.5" />
                    <path d="M14 3.5h6.5V10" />
                    <path d="M11 13.5l9.5-10" />
                  </svg>
                </button>
              ))}
            </>
          )}
          {allLabels.length > 0 && (
            <>
              <div className="mx-3 my-2 h-px bg-ink-800" />
              <div className="px-4 pb-1 text-[10px] font-semibold uppercase tracking-wide text-slate-600">Labels</div>
              <div className="min-h-0 flex-1 overflow-y-auto px-3 pb-2">
                {allLabels.map((l) => (
                  <button
                    key={l}
                    onClick={() => toggleLabel(l)}
                    className={`mb-1 mr-1 chip ${
                      labelFilter.has(l)
                        ? 'bg-accent/20 text-accent ring-1 ring-accent/50'
                        : 'bg-ink-750 text-slate-400 hover:text-slate-200'
                    }`}
                  >
                    {l}
                  </button>
                ))}
              </div>
            </>
          )}
        </div>

        {/* right pane */}
        <div className="flex min-w-0 flex-1 flex-col">
          <div className="flex items-center justify-between border-b border-ink-700/60 px-5 py-3">
            <div className="min-w-0">
              <h2 className="text-sm font-semibold text-white">
                {view === 'milestones' ? 'Milestones' : view === 'board' ? 'Board' : VIEWS.find((v) => v.id === view)?.label}
              </h2>
              <p className="truncate text-xs text-slate-400">
                {repo ? `${repo.provider} - ${repo.slug}` : 'GitHub / GitLab issues'}
                {me && <span className="text-good"> - as {me}</span>}
              </p>
            </div>
            <div className="flex items-center gap-2">
              <button className="btn-ghost text-sm" onClick={onManageAccounts}>
                Accounts
              </button>
              <button className="btn-ghost px-2" onClick={onClose} title="Close">
                <IconClose className="w-4 h-4" />
              </button>
            </div>
          </div>

          {/* list toolbar */}
          {view !== 'milestones' && view !== 'board' && (
            <div className="flex flex-wrap items-center gap-2 border-b border-ink-800 bg-ink-900/60 px-5 py-2">
              <div className="flex gap-0.5 rounded-md bg-ink-950 p-0.5">
                {(
                  [
                    ['open', `Open ${openCount}`],
                    ['closed', `Closed ${closedCount}`]
                  ] as const
                ).map(([id, label]) => (
                  <button
                    key={id}
                    onClick={() => setStateTab(id)}
                    className={`rounded px-2.5 py-0.5 text-[11px] font-medium ${
                      stateTab === id ? 'bg-ink-750 text-white' : 'text-slate-400 hover:text-slate-200'
                    }`}
                  >
                    {label}
                  </button>
                ))}
              </div>
              {view !== 'activity' && (
                <select
                  value={sort}
                  onChange={(e) => setSort(e.target.value as SortId)}
                  className="rounded-md border border-ink-700 bg-ink-950 px-2 py-1 text-xs outline-none focus:border-accent"
                >
                  <option value="newest">Newest</option>
                  <option value="oldest">Oldest</option>
                  <option value="updated">Recently updated</option>
                </select>
              )}
              {milestones.length > 0 && (
                <select
                  value={milestone}
                  onChange={(e) => setMilestone(e.target.value)}
                  className="rounded-md border border-ink-700 bg-ink-950 px-2 py-1 text-xs outline-none focus:border-accent"
                >
                  <option value="">All milestones</option>
                  {milestones.map((m) => (
                    <option key={m} value={m}>
                      {m}
                    </option>
                  ))}
                </select>
              )}
              {(labelFilter.size > 0 || milestone) && (
                <button
                  className="text-[11px] text-slate-500 hover:text-slate-300"
                  onClick={() => {
                    setLabelFilter(new Set())
                    setMilestone('')
                  }}
                >
                  clear filters
                </button>
              )}
            </div>
          )}

          <div className="min-h-0 flex-1 overflow-auto px-5 py-3">
            {loading && <div className="text-sm text-slate-500">Loading...</div>}
            {!loading && !repo && (
              <div className="rounded-lg border border-dashed border-ink-700 px-4 py-8 text-center text-sm text-slate-500">
                origin is not a GitHub or GitLab remote.
              </div>
            )}
            {error && (
              <div className="mb-3 text-sm text-bad">
                {error} -{' '}
                <button className="text-accent hover:underline" onClick={onManageAccounts}>
                  connect an account
                </button>
              </div>
            )}

            {/* milestone timeline */}
            {view === 'milestones' && !loading && (
              <>
                {timeline === null && <div className="text-sm text-slate-500">Loading milestones...</div>}
                {timeline !== null && timeline.length === 0 && (
                  <div className="rounded-lg border border-dashed border-ink-700 py-8 text-center text-sm text-slate-500">
                    No open milestones.
                  </div>
                )}
                <div className="space-y-2">
                  {(timeline ?? []).map((m) => {
                    const total = m.openIssues + m.closedIssues
                    const pct = total ? Math.round((m.closedIssues / total) * 100) : 0
                    const due = dueLabel(m.dueOn)
                    return (
                      <button
                        key={m.title}
                        onClick={() => {
                          setMilestone(m.title)
                          setView('all')
                        }}
                        title="Show this milestone's issues"
                        className="block w-full rounded-lg border border-ink-800 bg-ink-900 px-4 py-3 text-left hover:border-accent/50"
                      >
                        <div className="flex items-center gap-3">
                          <span className="min-w-0 flex-1 truncate text-sm font-medium text-slate-100">{m.title}</span>
                          <span className={`shrink-0 text-[11px] ${due.cls}`}>{due.text}</span>
                        </div>
                        <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-ink-750">
                          <div className="h-full rounded-full bg-accent" style={{ width: `${pct}%` }} />
                        </div>
                        <div className="mt-1 flex items-center gap-3 text-[11px] text-slate-500">
                          <span>{total ? `${pct}% done` : 'no issues tracked'}</span>
                          {total > 0 && (
                            <span>
                              {m.closedIssues} closed / {m.openIssues} open
                            </span>
                          )}
                          {m.description && <span className="min-w-0 truncate">{m.description}</span>}
                        </div>
                      </button>
                    )
                  })}
                </div>
              </>
            )}

            {/* board: milestone groups with completion */}
            {view === 'board' && !loading && repo && (
              <div className="space-y-4">
                {groups.map(([name, items]) => {
                  const closed = items.filter((i) => i.state === 'closed').length
                  const pct = items.length ? Math.round((closed / items.length) * 100) : 0
                  return (
                    <div key={name}>
                      <div className="mb-1.5 flex items-center gap-3">
                        <span className="text-sm font-semibold text-slate-100">{name}</span>
                        <span className="h-1.5 w-32 overflow-hidden rounded-full bg-ink-750">
                          <span className="block h-full rounded-full bg-violet-400" style={{ width: `${pct}%` }} />
                        </span>
                        <span className="text-[11px] text-slate-500">
                          {pct}% - {closed}/{items.length} done
                        </span>
                      </div>
                      <div className="space-y-1">
                        {items.map((it) => (
                          <div key={it.number} className="group flex items-center gap-2.5 rounded-lg border border-ink-800 bg-ink-900 px-3 py-1.5">
                            <StateIcon state={it.state} />
                            <span className="font-mono text-[11px] text-slate-600">#{it.number}</span>
                            <span className={`min-w-0 flex-1 truncate text-sm ${it.state === 'closed' ? 'text-slate-500 line-through' : 'text-slate-100'}`}>
                              {it.title}
                            </span>
                            {it.labels.slice(0, 2).map((l) => (
                              <span key={l} className="chip bg-ink-750 text-slate-400">
                                {l}
                              </span>
                            ))}
                            <SubProgress it={it} />
                            {it.assignees && it.assignees.length > 0 && (
                              <span className="shrink-0 text-[11px] text-slate-500">{it.assignees[0]}</span>
                            )}
                            <span className="hidden shrink-0 group-hover:flex">{rowActions(it)}</span>
                          </div>
                        ))}
                      </div>
                    </div>
                  )
                })}
                {groups.length === 0 && (
                  <div className="rounded-lg border border-dashed border-ink-700 py-8 text-center text-sm text-slate-500">
                    Nothing to plan - no issues match the filters.
                  </div>
                )}
              </div>
            )}

            {/* issue list */}
            {view !== 'milestones' && view !== 'board' && !loading && repo && (
              <>
                {listed.length === 0 && !error && (
                  <div className="rounded-lg border border-dashed border-ink-700 py-8 text-center text-sm text-slate-500">
                    {filtered.length === 0 ? `No ${stateTab} issues match.` : `No ${stateTab} issues in this view.`}
                  </div>
                )}
                <div className="space-y-1">
                  {listed.map((it) => (
                    <div key={it.number} className="rounded-lg border border-ink-800 bg-ink-900">
                      <div className="flex items-center gap-2.5 px-3 py-2">
                        <StateIcon state={it.state} />
                        <div className="min-w-0 flex-1">
                          <div className="flex flex-wrap items-center gap-1.5">
                            <span className="truncate text-sm text-slate-100">{it.title}</span>
                            {it.milestone && (
                              <span className="chip bg-violet-500/15 text-violet-300" title="Milestone">
                                {it.milestone}
                              </span>
                            )}
                            {it.labels.slice(0, 3).map((l) => (
                              <span key={l} className="chip bg-ink-750 text-slate-400">
                                {l}
                              </span>
                            ))}
                          </div>
                          <div className="truncate text-[11px] text-slate-500">
                            #{it.number} - {it.author} - updated {relTime(Date.parse(it.updatedAt))}
                            {it.assignees && it.assignees.length > 0 && ` - assigned: ${it.assignees.join(', ')}`}
                          </div>
                        </div>
                        <SubProgress it={it} />
                        {rowActions(it)}
                      </div>
                      {composer(it)}
                    </div>
                  ))}
                </div>
              </>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}
