import React, { useEffect, useState } from 'react'
import { IconClose } from './Icons'
import { api, confirmDialog, BranchFull, Remote } from '../api'
import { promptDialog } from './PromptModal'

export default function BranchesPanel({
  cwd,
  currentBranch,
  toast,
  onChanged,
  onClose
}: {
  cwd: string
  currentBranch: string
  toast: (kind: 'ok' | 'err' | 'info', text: string) => void
  onChanged: () => void
  onClose: () => void
}) {
  const [branches, setBranches] = useState<BranchFull[]>([])
  const [remotes, setRemotes] = useState<Remote[]>([])
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)
  const [newName, setNewName] = useState('')
  // After merging an issue branch (e.g. 42-fix-thing), offer to close #42.
  const [closePrompt, setClosePrompt] = useState<{ number: number; branch: string } | null>(null)
  const [closeMsg, setCloseMsg] = useState('')

  const load = () => {
    setLoading(true)
    Promise.all([api().branchesFull(cwd), api().remotesList(cwd)])
      .then(([b, r]) => {
        setBranches(b)
        setRemotes(r)
      })
      .catch((e) => toast('err', e?.message || String(e)))
      .finally(() => setLoading(false))
  }
  useEffect(load, [cwd])

  const act = async (fn: () => Promise<any>, okMsg: string) => {
    setBusy(true)
    try {
      await fn()
      toast('ok', okMsg)
      onChanged()
      load()
    } catch (e: any) {
      toast('err', e?.message || String(e))
    } finally {
      setBusy(false)
    }
  }

  const create = () => {
    const name = newName.trim()
    if (!name) return
    setNewName('')
    act(() => api().createBranch(cwd, name), `Created and switched to ${name}.`)
  }

  const checkoutLocal = (b: BranchFull) => act(() => api().checkout(cwd, b.name), `Switched to ${b.name}.`)

  const checkoutRemote = (b: BranchFull) => {
    const local = b.name.includes('/') ? b.name.slice(b.name.indexOf('/') + 1) : b.name
    act(() => api().checkout(cwd, local), `Checked out ${local} tracking ${b.name}.`)
  }

  const merge = (b: BranchFull) =>
    confirmDialog({
      title: 'Merge branch',
      message: `Merge ${b.name} into ${currentBranch}?`,
      confirmLabel: 'Merge'
    }).then((ok) => {
      if (ok) act(() => api().mergeBranch(cwd, b.name), `Merged ${b.name} into ${currentBranch}.`)
    })

  const rebase = (b: BranchFull) =>
    confirmDialog({
      title: 'Rebase branch',
      message: `Rebase ${currentBranch} onto ${b.name}?`,
      detail: 'Your commits are replayed on top of that branch. Conflicts can be resolved from the banner.',
      confirmLabel: 'Rebase'
    }).then((ok) => {
      if (ok) act(() => api().rebaseBranch(cwd, b.name), `Rebased ${currentBranch} onto ${b.name}.`)
    })

  // "Ship it": merge a finished branch into main/master in one step.
  const defaultBranch =
    branches.find((b) => !b.remote && b.name === 'main')?.name ??
    branches.find((b) => !b.remote && b.name === 'master')?.name ??
    null

  const shipToDefault = async (b: BranchFull) => {
    if (!defaultBranch) return
    const ok = await confirmDialog({
      title: `Merge into ${defaultBranch}`,
      message: `Merge ${b.name} into ${defaultBranch}?`,
      detail: `Switches to ${defaultBranch}, then merges ${b.name} into it. Conflicts can be resolved from the banner.`,
      confirmLabel: 'Merge'
    })
    if (!ok) return
    setBusy(true)
    try {
      await api().checkout(cwd, defaultBranch)
      await api().mergeBranch(cwd, b.name)
      toast('ok', `Merged ${b.name} into ${defaultBranch}.`)
      onChanged()
      load()
      const issue = b.name.match(/^(\d+)-/)
      if (issue) {
        setClosePrompt({ number: parseInt(issue[1], 10), branch: b.name })
        setCloseMsg(`Fixed by merging ${b.name} into ${defaultBranch}.`)
      }
    } catch (e: any) {
      toast('err', e?.message || String(e))
    } finally {
      setBusy(false)
    }
  }

  const closeMergedIssue = async () => {
    if (!closePrompt) return
    setBusy(true)
    try {
      await api().issueClose(cwd, closePrompt.number, closeMsg)
      toast('ok', `Closed #${closePrompt.number}.`)
      setClosePrompt(null)
    } catch (e: any) {
      toast('err', e?.message || String(e))
    } finally {
      setBusy(false)
    }
  }

  const rename = async (b: BranchFull) => {
    const next = await promptDialog({
      title: 'Rename branch',
      label: `New name for ${b.name}`,
      initial: b.name,
      confirmLabel: 'Rename'
    })
    if (next && next.trim() && next.trim() !== b.name)
      act(() => api().renameBranch(cwd, b.name, next.trim()), `Renamed to ${next.trim()}.`)
  }

  const remove = async (b: BranchFull) => {
    const ok = await confirmDialog({
      title: 'Delete branch',
      danger: true,
      message: `Delete local branch ${b.name}?`,
      detail: 'If it has unmerged commits you will be asked to force-delete.',
      confirmLabel: 'Delete'
    })
    if (!ok) return
    setBusy(true)
    try {
      await api().deleteBranch(cwd, b.name, false)
      toast('ok', `Deleted ${b.name}.`)
      onChanged()
      load()
    } catch {
      const force = await confirmDialog({
        title: 'Force delete',
        danger: true,
        message: `${b.name} has unmerged commits. Force-delete it?`,
        detail: 'Those commits may become unreachable.',
        confirmLabel: 'Force delete'
      })
      if (force) await act(() => api().deleteBranch(cwd, b.name, true), `Force-deleted ${b.name}.`)
    } finally {
      setBusy(false)
    }
  }

  const removeRemote = (b: BranchFull) => {
    const slash = b.name.indexOf('/')
    const remote = b.name.slice(0, slash)
    const branch = b.name.slice(slash + 1)
    confirmDialog({
      title: 'Delete remote branch',
      danger: true,
      message: `Delete ${branch} on ${remote}?`,
      detail: 'This pushes a deletion to the remote.',
      confirmLabel: 'Delete on remote'
    }).then((ok) => {
      if (ok) act(() => api().deleteRemoteBranch(cwd, remote, branch), `Deleted ${b.name} on remote.`)
    })
  }

  const setUpstream = async (b: BranchFull) => {
    const up = await promptDialog({
      title: 'Set upstream',
      label: `Upstream for ${b.name}`,
      initial: b.upstream || `origin/${b.name}`,
      placeholder: `origin/${b.name}`,
      confirmLabel: 'Set'
    })
    if (up && up.trim()) act(() => api().setUpstream(cwd, b.name, up.trim()), `Upstream set to ${up.trim()}.`)
  }

  const local = branches.filter((b) => !b.remote)
  const remote = branches.filter((b) => b.remote)

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm" onClick={onClose}>
      <div className="card flex max-h-[88vh] w-[720px] flex-col overflow-hidden shadow-2xl" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between border-b border-ink-700/60 px-5 py-4">
          <div>
            <h2 className="text-base font-semibold text-white">Branches</h2>
            <p className="text-xs text-slate-400">Switch, merge, rename, delete and track branches.</p>
          </div>
          <button className="btn-ghost px-2" onClick={onClose} title="Close">
            <IconClose className="w-4 h-4" />
          </button>
        </div>

        {/* create */}
        <div className="flex items-center gap-2 border-b border-ink-800 bg-ink-900 px-5 py-3">
          <input
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && create()}
            placeholder={`New branch from ${currentBranch || 'HEAD'}...`}
            className="flex-1 rounded-md border border-ink-700 bg-ink-950 px-3 py-1.5 text-sm outline-none focus:border-accent select-text"
          />
          <button className="btn-accent text-sm" disabled={busy || !newName.trim()} onClick={create}>
            Create
          </button>
        </div>

        <div className="overflow-auto">
          {loading && <div className="p-5 text-sm text-slate-500">Loading...</div>}

          {/* local */}
          {!loading && (
            <div className="px-5 py-3">
              <div className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-slate-500">
                Local ({local.length})
              </div>
              <div className="space-y-1">
                {local.map((b) => (
                  <div
                    key={b.name}
                    className={`flex items-center gap-2 rounded-lg border px-3 py-2 ${
                      b.current ? 'border-accent/40 bg-accent/5' : 'border-ink-800 bg-ink-900'
                    }`}
                  >
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2">
                        {b.current && <span className="text-accent">*</span>}
                        <span className="truncate text-sm font-medium text-slate-100">{b.name}</span>
                        {b.upstream && (
                          <span className="shrink-0 text-[11px] text-slate-500">
                            -&gt; {b.upstream}
                            {b.gone && <span className="text-bad"> (gone)</span>}
                          </span>
                        )}
                        {b.ahead > 0 && <span className="text-[11px] text-good">ahead {b.ahead}</span>}
                        {b.behind > 0 && <span className="text-[11px] text-warn">behind {b.behind}</span>}
                      </div>
                      <div className="mt-0.5 flex items-center gap-2 text-[11px] text-slate-500">
                        <span className="font-mono text-accent">{b.hash}</span>
                        <span className="min-w-0 truncate">{b.subject}</span>
                        <span className="shrink-0">- {b.relDate}</span>
                      </div>
                    </div>
                    <div className="flex shrink-0 items-center gap-1">
                      {defaultBranch && b.name !== defaultBranch && (
                        <button
                          className="inline-flex items-center gap-1 rounded px-2 py-1 text-xs font-semibold text-violet-300 hover:bg-violet-500/15"
                          disabled={busy}
                          onClick={() => shipToDefault(b)}
                          title={`Merge ${b.name} into ${defaultBranch} (switches to ${defaultBranch} first)`}
                        >
                          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2">
                            <circle cx="6" cy="5" r="2.4" />
                            <circle cx="6" cy="19" r="2.4" />
                            <circle cx="18" cy="12" r="2.4" />
                            <path d="M6 7.4v9.2M6 8c0 4.5 5 4 9.4 4" />
                          </svg>
                          {defaultBranch}
                        </button>
                      )}
                      {!b.current && (
                        <button className="btn-ghost text-xs" disabled={busy} onClick={() => checkoutLocal(b)}>
                          Checkout
                        </button>
                      )}
                      {!b.current && (
                        <button className="btn-ghost text-xs" disabled={busy} onClick={() => merge(b)}>
                          Merge
                        </button>
                      )}
                      {!b.current && (
                        <button className="btn-ghost text-xs" disabled={busy} onClick={() => rebase(b)}>
                          Rebase
                        </button>
                      )}
                      <button className="btn-ghost text-xs" disabled={busy} onClick={() => setUpstream(b)}>
                        Upstream
                      </button>
                      <button className="btn-ghost text-xs" disabled={busy} onClick={() => rename(b)}>
                        Rename
                      </button>
                      {!b.current && (
                        <button className="btn-ghost text-xs text-bad" disabled={busy} onClick={() => remove(b)}>
                          Delete
                        </button>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* remote */}
          {!loading && remote.length > 0 && (
            <div className="border-t border-ink-800 px-5 py-3">
              <div className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-slate-500">
                Remote ({remote.length})
              </div>
              <div className="space-y-1">
                {remote.map((b) => (
                  <div
                    key={b.name}
                    className="flex items-center gap-2 rounded-lg border border-ink-800 bg-ink-900 px-3 py-2"
                  >
                    <div className="min-w-0 flex-1">
                      <span className="truncate text-sm font-medium text-info">{b.name}</span>
                      <div className="mt-0.5 flex items-center gap-2 text-[11px] text-slate-500">
                        <span className="font-mono text-accent">{b.hash}</span>
                        <span className="min-w-0 truncate">{b.subject}</span>
                        <span className="shrink-0">- {b.relDate}</span>
                      </div>
                    </div>
                    <div className="flex shrink-0 items-center gap-1">
                      <button className="btn-ghost text-xs" disabled={busy} onClick={() => checkoutRemote(b)}>
                        Checkout
                      </button>
                      <button className="btn-ghost text-xs text-bad" disabled={busy} onClick={() => removeRemote(b)}>
                        Delete
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* remotes */}
          {!loading && remotes.length > 0 && (
            <div className="border-t border-ink-800 px-5 py-3">
              <div className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-slate-500">
                Remotes ({remotes.length})
              </div>
              <div className="space-y-1">
                {remotes.map((r) => (
                  <div key={r.name} className="flex items-center gap-2 text-xs">
                    <span className="w-16 shrink-0 font-medium text-slate-300">{r.name}</span>
                    <span className="min-w-0 truncate text-slate-500">{r.url}</span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      </div>

      {/* close the issue the merged branch belonged to */}
      {closePrompt && (
        <div
          className="fixed inset-0 z-[60] flex items-center justify-center bg-black/60 backdrop-blur-sm"
          onClick={(e) => {
            // Dismiss only the prompt, not the whole panel underneath.
            e.stopPropagation()
            setClosePrompt(null)
          }}
        >
          <div className="card w-[480px] overflow-hidden shadow-2xl" onClick={(e) => e.stopPropagation()}>
            <div className="border-b border-ink-700/60 px-5 py-3.5">
              <h2 className="text-sm font-semibold text-white">Close issue #{closePrompt.number}?</h2>
              <p className="mt-0.5 text-xs text-slate-400">
                {closePrompt.branch} looks like a branch for issue #{closePrompt.number}. The comment
                below is posted before closing - edit it or clear it.
              </p>
            </div>
            <div className="px-5 py-3">
              <textarea
                value={closeMsg}
                onChange={(e) => setCloseMsg(e.target.value)}
                rows={3}
                autoFocus
                className="w-full resize-none rounded-md border border-ink-700 bg-ink-950 px-3 py-2 text-sm outline-none focus:border-accent select-text"
              />
            </div>
            <div className="flex justify-end gap-2 border-t border-ink-700/60 px-5 py-3">
              <button className="btn-ghost text-sm" disabled={busy} onClick={() => setClosePrompt(null)}>
                Skip
              </button>
              <button className="btn-accent text-sm" disabled={busy} onClick={closeMergedIssue}>
                Close issue
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
