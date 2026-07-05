import React, { useEffect, useState } from 'react'
import { IconClose } from './Icons'
import { api, PullRequest, RemoteInfo, WorkflowRun, relTime } from '../api'

// Traffic-light dot for a workflow run: green passed, red failed, amber running.
function runTone(r: WorkflowRun): string {
  if (r.status !== 'completed') return 'bg-warn'
  if (r.conclusion === 'success') return 'bg-good'
  if (r.conclusion === 'cancelled' || r.conclusion === 'skipped') return 'bg-ink-600'
  return 'bg-bad'
}

export default function RemotePanel({
  cwd,
  currentBranch,
  aiAvailable,
  toast,
  onManageAccounts,
  onClose
}: {
  cwd: string
  currentBranch: string
  aiAvailable: boolean
  toast: (kind: 'ok' | 'err' | 'info', text: string) => void
  onManageAccounts: () => void
  onClose: () => void
}) {
  const [info, setInfo] = useState<RemoteInfo | null>(null)
  const [pulls, setPulls] = useState<PullRequest[]>([])
  const [runs, setRuns] = useState<WorkflowRun[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)

  const [showForm, setShowForm] = useState(false)
  const [title, setTitle] = useState('')
  const [base, setBase] = useState('main')
  const [head, setHead] = useState(currentBranch)
  const [body, setBody] = useState('')

  const load = () => {
    setLoading(true)
    setError('')
    api()
      .remoteInfo(cwd)
      .then((ri) => {
        setInfo(ri)
        if (!ri.repo) {
          setLoading(false)
          return
        }
        api().remoteActions(cwd).then(setRuns).catch(() => setRuns([]))
        return api()
          .remotePulls(cwd)
          .then((r) => setPulls(r.pulls))
          .catch((e) => setError(e?.message || String(e)))
          .finally(() => setLoading(false))
      })
      .catch((e) => {
        setError(e?.message || String(e))
        setLoading(false)
      })
  }
  useEffect(load, [cwd])

  const provider = info?.repo?.provider
  const noun = provider === 'gitlab' ? 'merge request' : 'pull request'
  const Noun = provider === 'gitlab' ? 'Merge requests' : 'Pull requests'

  const open = (url: string) => api().openExternal(url).catch(() => {})

  const aiDraft = async () => {
    setBusy(true)
    try {
      const text = await api().aiPrDescribe(cwd, base.trim(), head.trim())
      const nl = text.indexOf('\n')
      if (nl === -1) setTitle(text.trim())
      else {
        setTitle(text.slice(0, nl).trim())
        setBody(text.slice(nl + 1).trim())
      }
      toast('ok', 'Drafted with AI.')
    } catch (e: any) {
      toast('err', e?.message || String(e))
    } finally {
      setBusy(false)
    }
  }

  const fork = async () => {
    setBusy(true)
    try {
      const url = await api().remoteFork(cwd)
      toast('ok', 'Fork created (or already existed) under your account.')
      if (url) open(url)
    } catch (e: any) {
      toast('err', e?.message || String(e))
    } finally {
      setBusy(false)
    }
  }

  const create = async () => {
    if (!title.trim() || !head.trim() || !base.trim()) return
    setBusy(true)
    try {
      const pr = await api().remoteCreatePull(cwd, { title: title.trim(), head: head.trim(), base: base.trim(), body })
      toast('ok', `Opened ${noun} #${pr.number}.`)
      setShowForm(false)
      setTitle('')
      setBody('')
      load()
      open(pr.url)
    } catch (e: any) {
      toast('err', e?.message || String(e))
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm" onClick={onClose}>
      <div className="card flex max-h-[88vh] w-[720px] flex-col overflow-hidden shadow-2xl" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between border-b border-ink-700/60 px-5 py-4">
          <div className="min-w-0">
            <h2 className="text-base font-semibold text-white">{provider ? Noun : 'Remote'}</h2>
            <p className="truncate text-xs text-slate-400">
              {info?.repo ? `${info.repo.provider} - ${info.repo.slug}` : 'GitHub / GitLab integration'}
              {info?.account && info.repo && (
                <>
                  {' - as '}
                  <button
                    className="text-good hover:underline"
                    onClick={() => open(`https://${info.repo!.host}/${info.account!.username}`)}
                    title="Open your profile in the browser"
                  >
                    {info.account.username}
                  </button>
                </>
              )}
            </p>
          </div>
          <div className="flex items-center gap-2">
            {info?.repo && (
              <button
                className="btn-ghost text-sm"
                onClick={() => open(info.repo!.webUrl)}
                title="Open this repository in the browser"
              >
                View on {provider === 'gitlab' ? 'GitLab' : 'GitHub'}
              </button>
            )}
            <button className="btn-ghost text-sm" onClick={onManageAccounts}>
              Accounts
            </button>
            {info?.repo && (provider === 'github' || provider === 'gitlab') && (
              <button
                className="btn-ghost text-sm"
                disabled={busy}
                onClick={fork}
                title="Create a fork of this repository under your account"
              >
                Fork
              </button>
            )}
            {info?.repo && (
              <button
                className="btn-accent text-sm"
                onClick={() => {
                  setHead(currentBranch)
                  setShowForm((v) => !v)
                }}
              >
                New {noun}
              </button>
            )}
            <button className="btn-ghost px-2" onClick={onClose} title="Close">
              <IconClose className="w-4 h-4" />
            </button>
          </div>
        </div>

        <div className="overflow-auto px-5 py-4">
          {/* not a supported remote */}
          {!loading && !info?.repo && (
            <div className="rounded-lg border border-dashed border-ink-700 px-4 py-8 text-center text-sm text-slate-500">
              <div>origin is not a GitHub or GitLab remote.</div>
              <div className="mt-1 text-xs text-slate-600">{info?.url || 'No origin remote configured.'}</div>
            </div>
          )}

          {/* connect hint */}
          {info?.repo && !info.hasToken && (
            <div className="mb-3 rounded-lg border border-warn/30 bg-warn/5 px-3 py-2 text-xs text-slate-300">
              No {provider} account connected. Public {Noun.toLowerCase()} may still list; creating one needs a
              connected account.{' '}
              <button className="text-accent hover:underline" onClick={onManageAccounts}>
                Connect an account
              </button>
              .
            </div>
          )}

          {/* create form */}
          {showForm && info?.repo && (
            <div className="mb-4 rounded-lg border border-ink-700 bg-ink-900 p-3">
              <div className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-500">New {noun}</div>
              <input
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                placeholder="Title"
                className="mb-2 w-full rounded-md border border-ink-700 bg-ink-950 px-3 py-1.5 text-sm outline-none focus:border-accent select-text"
              />
              <div className="mb-2 flex items-center gap-2 text-sm">
                <input
                  value={head}
                  onChange={(e) => setHead(e.target.value)}
                  placeholder="source branch"
                  className="flex-1 rounded-md border border-ink-700 bg-ink-950 px-3 py-1.5 outline-none focus:border-accent select-text"
                />
                <span className="text-slate-500">into</span>
                <input
                  value={base}
                  onChange={(e) => setBase(e.target.value)}
                  placeholder="target branch"
                  className="flex-1 rounded-md border border-ink-700 bg-ink-950 px-3 py-1.5 outline-none focus:border-accent select-text"
                />
              </div>
              <textarea
                value={body}
                onChange={(e) => setBody(e.target.value)}
                placeholder="Description (optional)"
                rows={3}
                className="mb-2 w-full resize-none rounded-md border border-ink-700 bg-ink-950 px-3 py-1.5 text-sm outline-none focus:border-accent select-text"
              />
              <div className="flex justify-end gap-2">
                {aiAvailable && (
                  <button className="btn-ghost text-sm" disabled={busy} onClick={aiDraft} title="Draft title and description with AI">
                    AI draft
                  </button>
                )}
                <button className="btn-ghost text-sm" onClick={() => setShowForm(false)}>
                  Cancel
                </button>
                <button
                  className="btn-accent text-sm"
                  disabled={busy || !title.trim() || !head.trim() || !base.trim()}
                  onClick={create}
                >
                  Create {noun}
                </button>
              </div>
            </div>
          )}

          {loading && <div className="text-sm text-slate-500">Loading...</div>}
          {error && <div className="mb-3 text-sm text-bad">{error}</div>}

          {/* list */}
          {!loading && info?.repo && pulls.length === 0 && !error && (
            <div className="rounded-lg border border-dashed border-ink-700 py-8 text-center text-sm text-slate-500">
              No open {Noun.toLowerCase()}.
            </div>
          )}
          <div className="space-y-1">
            {pulls.map((p) => (
              <button
                key={p.number}
                onClick={() => open(p.url)}
                className="flex w-full items-center gap-3 rounded-lg border border-ink-800 bg-ink-900 px-3 py-2 text-left hover:border-accent/50"
                title="Open in browser"
              >
                <span className="font-mono text-xs text-slate-500">#{p.number}</span>
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <span className="truncate text-sm text-slate-100">{p.title}</span>
                    {p.draft && <span className="chip bg-ink-750 text-slate-400">draft</span>}
                  </div>
                  <div className="mt-0.5 truncate text-[11px] text-slate-500">
                    {p.author} - {p.head} -&gt; {p.base}
                  </div>
                </div>
                <span className="shrink-0 text-xs text-accent">open</span>
              </button>
            ))}
          </div>

          {/* GitHub Actions: latest workflow runs */}
          {runs.length > 0 && (
            <div className="mt-5 border-t border-ink-800 pt-3">
              <div className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-slate-500">
                Actions - latest runs
              </div>
              <div className="space-y-1">
                {runs.map((r) => (
                  <button
                    key={r.id}
                    onClick={() => open(r.url)}
                    className="flex w-full items-center gap-2.5 rounded-lg border border-ink-800 bg-ink-900 px-3 py-1.5 text-left hover:border-accent/50"
                    title={`${r.status === 'completed' ? r.conclusion : r.status} - open on GitHub`}
                  >
                    <span className={`h-2 w-2 shrink-0 rounded-full ${runTone(r)}`} />
                    <span className="min-w-0 flex-1 truncate text-sm text-slate-200">{r.name}</span>
                    <span className="shrink-0 text-[11px] text-slate-500">{r.branch}</span>
                    <span className="shrink-0 text-[11px] text-slate-600">{relTime(Date.parse(r.updatedAt))}</span>
                  </button>
                ))}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
