import React, { useState } from 'react'
import { api, confirmDialog, relTime } from '../../api'
import { RtcState, RtcPatch, PATCH_STATUS_STYLE, actorColor } from '../../rtc'
import { ActorChip, StatusChip, Section, EmptyNote, RISK_STYLE, inputCls } from './bits'

/** Unified diff coloured line by line, with the owning actor's accent stripe. */
function DiffPreview({ diff, accent }: { diff: string; accent: string }) {
  return (
    <pre className={`max-h-72 overflow-auto rounded-md border-l-2 ${accent} bg-ink-950 p-2 font-mono text-[11px] leading-4`}>
      {diff.split('\n').map((line, i) => {
        let cls = 'text-slate-400'
        if (line.startsWith('+') && !line.startsWith('+++')) cls = 'bg-emerald-400/10 text-emerald-300'
        else if (line.startsWith('-') && !line.startsWith('---')) cls = 'bg-bad/10 text-bad'
        else if (line.startsWith('@@')) cls = 'text-sky-300'
        else if (line.startsWith('diff ') || line.startsWith('index ') || line.startsWith('+++') || line.startsWith('---'))
          cls = 'text-slate-500'
        return (
          <div key={i} className={cls}>
            {line || ' '}
          </div>
        )
      })}
    </pre>
  )
}

export default function RtcPatchesScreen({
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
  const [open, setOpen] = useState<string | null>(null)
  const [summary, setSummary] = useState('')
  const act = (fn: () => Promise<any>, ok?: string) =>
    fn()
      .then(() => {
        if (ok) toast('ok', ok)
        refresh()
      })
      .catch((e) => toast('err', e.message))

  const me = state.local.activeActorId
  const myChanges = state.changes.filter((c) => c.actorId === me)

  async function apply(p: RtcPatch) {
    const check = await api().rtcPatchApply(cwd, p.id, true).catch((e: any) => ({ ok: false, error: e.message }))
    if (!check.ok) {
      toast('err', check.conflicted ? 'This patch conflicts with your working tree.' : check.error)
      refresh()
      return
    }
    const go = await confirmDialog({
      title: 'Apply patch',
      message: `Apply ${p.id} to your working copy?`,
      detail: `${p.filesChanged.length} file(s) will be modified via 3-way merge:\n${p.filesChanged.join('\n')}`,
      confirmLabel: 'Apply'
    })
    if (go) await act(() => api().rtcPatchApply(cwd, p.id, false), 'Patch applied.')
  }

  return (
    <div className="mx-auto max-w-3xl">
      {me && (
        <Section title="Capture my pending changes">
          <div className="card flex items-center gap-2 p-3">
            <span className="text-xs text-slate-400">
              {myChanges.length} file{myChanges.length === 1 ? '' : 's'} attributed to {me}
              {state.local.activeTaskId ? ` on ${state.local.activeTaskId}` : ''}
            </span>
            <input
              className={`flex-1 ${inputCls}`}
              placeholder="Patch summary (optional)"
              value={summary}
              onChange={(e) => setSummary(e.target.value)}
            />
            <button
              className="btn-accent text-xs"
              disabled={!myChanges.length}
              onClick={() => {
                act(
                  () =>
                    api().rtcPatchCreate(cwd, {
                      actorId: me,
                      taskId: state.local.activeTaskId,
                      summary: summary.trim()
                    }),
                  'Patch created.'
                )
                setSummary('')
              }}
            >
              Create patch
            </button>
          </div>
        </Section>
      )}

      <Section title={`Patches (${state.patches.length})`}>
        {state.patches.length === 0 && <EmptyNote>No patches yet. Edit files, then capture them here.</EmptyNote>}
        <ul className="space-y-1.5">
          {[...state.patches].reverse().map((p) => {
            const c = actorColor(state.actors, p.createdByActorId)
            const expanded = open === p.id
            const task = p.taskId ? state.tasks.find((t) => t.id === p.taskId) : null
            return (
              <li key={p.id} className={`rounded-lg border ${expanded ? c.border : 'border-ink-700/50'} bg-ink-800`}>
                <button className="w-full px-3 py-2 text-left" onClick={() => setOpen(expanded ? null : p.id)}>
                  <div className="flex items-center gap-2">
                    <StatusChip status={p.status} styles={PATCH_STATUS_STYLE} />
                    <span className="min-w-0 flex-1 truncate text-sm text-slate-100">{p.summary}</span>
                    <span className={`rounded px-1.5 py-0.5 text-[9px] font-semibold uppercase ${RISK_STYLE[p.riskLevel]}`}>
                      {p.riskLevel} risk
                    </span>
                    <ActorChip actors={state.actors} actorId={p.createdByActorId} small />
                  </div>
                  <div className="mt-0.5 flex items-center gap-3 text-[11px] text-slate-500">
                    <span className="font-mono">{p.id}</span>
                    <span>{p.filesChanged.length} file{p.filesChanged.length === 1 ? '' : 's'}</span>
                    {task && <span>task: {task.title}</span>}
                    <span>base {p.baseCommit.slice(0, 8)}</span>
                    <span>{relTime(p.createdAt)}</span>
                  </div>
                </button>
                {expanded && (
                  <div className="space-y-2 border-t border-ink-700/50 px-3 py-3">
                    {p.lockWarnings?.length > 0 && (
                      <div className="rounded-md border border-bad/30 bg-bad/10 px-2 py-1.5 text-[11px] text-bad">
                        {p.lockWarnings.map((w, i) => (
                          <div key={i}>{w}</div>
                        ))}
                      </div>
                    )}
                    <DiffPreview diff={p.diff} accent={c.border} />
                    <div className="flex flex-wrap gap-1.5">
                      {p.status === 'draft' && (
                        <button className="btn-soft text-xs" onClick={() => act(() => api().rtcPatchStatus(cwd, p.id, 'needs_review'))}>
                          Request review
                        </button>
                      )}
                      {['draft', 'needs_review', 'checkpointed'].includes(p.status) && (
                        <>
                          <button className="btn-soft text-xs" onClick={() => act(() => api().rtcPatchStatus(cwd, p.id, 'accepted'), 'Accepted.')}>
                            Accept
                          </button>
                          <button className="btn-ghost text-xs text-bad" onClick={() => act(() => api().rtcPatchStatus(cwd, p.id, 'rejected'))}>
                            Reject
                          </button>
                        </>
                      )}
                      {['accepted', 'needs_review', 'checkpointed', 'conflicted'].includes(p.status) && (
                        <button className="btn-accent text-xs" onClick={() => apply(p)}>
                          Apply to my copy (3-way)
                        </button>
                      )}
                      <button
                        className="btn-ghost text-xs"
                        onClick={() => act(() => api().rtcPatchApply(cwd, p.id, true), 'Patch applies cleanly.')}
                      >
                        Dry-run check
                      </button>
                    </div>
                  </div>
                )}
              </li>
            )
          })}
        </ul>
      </Section>
    </div>
  )
}
