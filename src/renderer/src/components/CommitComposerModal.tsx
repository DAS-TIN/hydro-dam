import React, { useEffect, useState } from 'react'
import { IconClose } from './Icons'
import { api, Coauthor, ComposedCommit, basename } from '../api'

/**
 * AI Commit Composer: asks the AI to group the working changes into logical
 * commits, then lets you apply each one (stage exactly those files + commit).
 */
export default function CommitComposerModal({
  cwd,
  coauthors,
  toast,
  onApplied,
  onClose
}: {
  cwd: string
  coauthors: Coauthor[]
  toast: (kind: 'ok' | 'err' | 'info', text: string) => void
  onApplied: () => void
  onClose: () => void
}) {
  const [groups, setGroups] = useState<ComposedCommit[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    api()
      .aiComposeCommits(cwd)
      .then((r) => setGroups(r.commits))
      .catch((e) => setError(e?.message || String(e)))
      .finally(() => setLoading(false))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cwd])

  const setMessage = (i: number, message: string) =>
    setGroups((gs) => gs.map((g, k) => (k === i ? { ...g, message } : g)))

  const applyOne = async (g: ComposedCommit): Promise<void> => {
    await api().unstageAll(cwd)
    await api().stage(cwd, g.files)
    await api().commit(cwd, g.message, coauthors, false)
  }

  const apply = async (g: ComposedCommit) => {
    setBusy(true)
    try {
      await applyOne(g)
      toast('ok', `Committed: ${g.message.split('\n')[0]}`)
      setGroups((gs) => gs.filter((x) => x !== g))
      onApplied()
    } catch (e: any) {
      toast('err', e?.message || String(e))
    } finally {
      setBusy(false)
    }
  }

  const applyAll = async () => {
    setBusy(true)
    try {
      for (const g of [...groups]) await applyOne(g)
      toast('ok', `Created ${groups.length} commit(s).`)
      setGroups([])
      onApplied()
      onClose()
    } catch (e: any) {
      toast('err', e?.message || String(e))
      onApplied()
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/60 backdrop-blur-sm">
      <div className="card flex max-h-[88vh] w-[760px] flex-col overflow-hidden shadow-2xl">
        <div className="flex items-center justify-between border-b border-ink-700/60 px-5 py-4">
          <div>
            <h2 className="text-base font-semibold text-white">Commit composer</h2>
            <p className="text-xs text-slate-400">
              The AI grouped your changes into logical commits. Review, then apply.
            </p>
          </div>
          <div className="flex items-center gap-2">
            {groups.length > 1 && (
              <button className="btn-soft text-sm" disabled={busy} onClick={applyAll}>
                Commit all in order
              </button>
            )}
            <button className="btn-ghost px-2" onClick={onClose} title="Close">
              <IconClose className="w-4 h-4" />
            </button>
          </div>
        </div>

        <div className="overflow-auto px-5 py-4">
          {loading && (
            <div className="flex items-center gap-2 text-sm text-slate-400">
              <span className="h-2 w-2 animate-pulse rounded-full bg-accent" /> Grouping changes with AI...
            </div>
          )}
          {error && <div className="text-sm text-bad">{error}</div>}
          {!loading && !error && groups.length === 0 && (
            <div className="rounded-lg border border-dashed border-ink-700 py-8 text-center text-sm text-slate-500">
              Nothing left to commit.
            </div>
          )}

          <div className="space-y-3">
            {groups.map((g, i) => (
              <div key={i} className="rounded-lg border border-ink-800 bg-ink-900 p-3">
                <div className="mb-2 flex items-center gap-2">
                  <span className="shrink-0 text-[11px] font-semibold uppercase tracking-wide text-slate-500">
                    Commit {i + 1}
                  </span>
                  <span className="text-[11px] text-slate-500">{g.files.length} file(s)</span>
                  <div className="flex-1" />
                  <button className="btn-accent text-xs" disabled={busy} onClick={() => apply(g)}>
                    Stage &amp; commit
                  </button>
                </div>
                <textarea
                  value={g.message}
                  onChange={(e) => setMessage(i, e.target.value)}
                  rows={2}
                  className="mb-2 w-full resize-none rounded-md border border-ink-700 bg-ink-950 px-3 py-1.5 text-sm outline-none focus:border-accent select-text"
                />
                <div className="flex flex-wrap gap-1">
                  {g.files.map((f) => (
                    <span key={f} className="chip bg-ink-750 text-slate-300" title={f}>
                      {basename(f)}
                    </span>
                  ))}
                </div>
              </div>
            ))}
          </div>

          {!loading && !error && groups.length > 0 && (
            <div className="mt-3 text-[11px] text-slate-600">
              Applying a commit re-stages only its files (everything else is unstaged first), then commits with
              your active co-authors. AI-grouped - review before applying.
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
