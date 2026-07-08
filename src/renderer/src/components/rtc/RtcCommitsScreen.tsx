import React, { useState } from 'react'
import { api, confirmDialog, relTime } from '../../api'
import { RtcState, RtcSuggestion } from '../../rtc'
import { Section, EmptyNote, inputCls } from './bits'

/** Nothing here stages or commits until you press the button. */
export default function RtcCommitsScreen({
  cwd,
  state,
  refresh,
  toast
}: {
  cwd: string
  state: RtcState
  refresh: () => void
  toast: (kind: 'ok' | 'err', text: string) => void
}) {
  const [drafts, setDrafts] = useState<Record<string, { title: string; body: string; picks: Record<string, boolean> }>>({})

  const draftFor = (s: RtcSuggestion) =>
    drafts[s.id] ?? {
      title: s.title,
      body: s.body,
      picks: Object.fromEntries(s.coAuthors.map((c) => [c.actorId, c.selected]))
    }

  async function approve(s: RtcSuggestion) {
    const d = draftFor(s)
    const chosen = s.coAuthors.filter((c) => d.picks[c.actorId])
    const go = await confirmDialog({
      title: 'Stage and commit',
      message: 'Stage the checkpoint files and commit?',
      detail: `${d.title}\n\nCo-authors: ${chosen.map((c) => c.name).join(', ') || 'none'}`,
      confirmLabel: 'Commit'
    })
    if (!go) return
    try {
      const out = await api().rtcCommitApprove(cwd, s.id, {
        title: d.title,
        body: d.body,
        coAuthors: chosen
      })
      toast('ok', `Committed ${out.hash.slice(0, 10)}.`)
      refresh()
    } catch (e: any) {
      toast('err', e.message)
    }
  }

  const pending = state.suggestions.filter((s) => s.status === 'pending')
  const done = state.suggestions.filter((s) => s.status === 'committed')

  return (
    <div className="mx-auto max-w-2xl">
      <Section title={`Awaiting your approval (${pending.length})`}>
        {pending.length === 0 && <EmptyNote>No commit suggestions. Create one from a checkpoint.</EmptyNote>}
        <ul className="space-y-2">
          {pending.map((s) => {
            const d = draftFor(s)
            const set = (patch: Partial<typeof d>) => setDrafts({ ...drafts, [s.id]: { ...d, ...patch } })
            return (
              <li key={s.id} className="card space-y-2 p-4">
                <input className={`w-full ${inputCls}`} value={d.title} onChange={(e) => set({ title: e.target.value })} />
                <textarea className={`w-full ${inputCls}`} rows={5} value={d.body} onChange={(e) => set({ body: e.target.value })} />
                <div>
                  <div className="mb-1 text-[11px] font-semibold uppercase tracking-wide text-slate-500">
                    Credit these actors as co-authors
                  </div>
                  {s.coAuthors.length === 0 && <div className="text-xs text-slate-500">No other actors were involved.</div>}
                  {s.coAuthors.map((c) => (
                    <label key={c.actorId} className="flex items-center gap-2 text-xs text-slate-300">
                      <input
                        type="checkbox"
                        checked={!!d.picks[c.actorId]}
                        onChange={(e) => set({ picks: { ...d.picks, [c.actorId]: e.target.checked } })}
                      />
                      {c.name} <span className="text-slate-500">&lt;{c.email}&gt;</span>
                    </label>
                  ))}
                </div>
                <div className="flex items-center gap-2">
                  <button className="btn-accent" onClick={() => approve(s)}>
                    Stage + commit
                  </button>
                  <span className="text-[11px] text-slate-500">
                    from {s.checkpointId} - nothing is staged until you press this
                  </span>
                </div>
              </li>
            )
          })}
        </ul>
      </Section>

      {done.length > 0 && (
        <Section title="Committed">
          <ul className="space-y-1">
            {done.map((s) => (
              <li key={s.id} className="flex items-center gap-2 rounded-md border border-ink-700/50 bg-ink-800 px-3 py-1.5 text-xs">
                <span className="font-mono text-emerald-300">{s.commitHash?.slice(0, 10)}</span>
                <span className="min-w-0 flex-1 truncate text-slate-300">{s.title}</span>
                <span className="text-slate-500">{relTime(s.createdAt)}</span>
              </li>
            ))}
          </ul>
        </Section>
      )}
    </div>
  )
}
