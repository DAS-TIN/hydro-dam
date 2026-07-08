import React, { useState } from 'react'
import { api, relTime } from '../../api'
import { RtcState } from '../../rtc'
import { ActorChip, Section, EmptyNote, inputCls } from './bits'

export default function RtcCheckpointsScreen({
  cwd,
  state,
  refresh,
  toast,
  gotoCommits
}: {
  cwd: string
  state: RtcState
  refresh: () => void
  toast: (kind: 'ok' | 'err', text: string) => void
  gotoCommits: () => void
}) {
  const [taskId, setTaskId] = useState('')
  const [picked, setPicked] = useState<Set<string>>(new Set())
  const [summary, setSummary] = useState('')

  const eligible = state.patches.filter((p) => !['rejected'].includes(p.status) && (!taskId || p.taskId === taskId))

  async function create() {
    if (!picked.size) return
    try {
      await api().rtcCheckpointCreate(cwd, {
        taskId: taskId || null,
        patchIds: [...picked],
        actorId: state.local.activeActorId,
        summary: summary.trim()
      })
      setPicked(new Set())
      setSummary('')
      toast('ok', 'Checkpoint created.')
      refresh()
    } catch (e: any) {
      toast('err', e.message)
    }
  }

  return (
    <div className="mx-auto max-w-2xl">
      <Section title="Create a checkpoint">
        <div className="card space-y-2 p-4">
          <div className="flex gap-2">
            <select className={inputCls} value={taskId} onChange={(e) => { setTaskId(e.target.value); setPicked(new Set()) }}>
              <option value="">any task / no task</option>
              {state.tasks.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.title}
                </option>
              ))}
            </select>
            <input className={`flex-1 ${inputCls}`} placeholder="Summary (optional)" value={summary} onChange={(e) => setSummary(e.target.value)} />
          </div>
          {eligible.length === 0 && <EmptyNote>No patches to checkpoint yet.</EmptyNote>}
          {eligible.map((p) => (
            <label key={p.id} className="flex items-center gap-2 text-xs text-slate-300">
              <input
                type="checkbox"
                checked={picked.has(p.id)}
                onChange={(e) => {
                  const next = new Set(picked)
                  e.target.checked ? next.add(p.id) : next.delete(p.id)
                  setPicked(next)
                }}
              />
              <span className="font-mono text-slate-500">{p.id}</span>
              <span className="truncate">{p.summary}</span>
              <span className="text-slate-500">({p.status})</span>
            </label>
          ))}
          <button className="btn-accent" disabled={!picked.size} onClick={create}>
            Checkpoint {picked.size || ''} patch{picked.size === 1 ? '' : 'es'}
          </button>
        </div>
      </Section>

      <Section title={`Checkpoints (${state.checkpoints.length})`}>
        {state.checkpoints.length === 0 && <EmptyNote>No checkpoints yet.</EmptyNote>}
        <ul className="space-y-1.5">
          {[...state.checkpoints].reverse().map((cp) => {
            const task = cp.taskId ? state.tasks.find((t) => t.id === cp.taskId) : null
            const suggested = state.suggestions.some((s) => s.checkpointId === cp.id)
            return (
              <li key={cp.id} className="rounded-lg border border-ink-700/50 bg-ink-800 px-3 py-2.5">
                <div className="flex items-center gap-2">
                  <span className="min-w-0 flex-1 truncate text-sm text-slate-100">{cp.summary}</span>
                  <span className="rounded bg-accent/15 px-1.5 py-0.5 text-[10px] font-semibold text-accent">
                    next: {cp.recommendation}
                  </span>
                  <ActorChip actors={state.actors} actorId={cp.createdByActorId} small />
                </div>
                <div className="mt-1 flex items-center gap-3 text-[11px] text-slate-500">
                  <span className="font-mono">{cp.id}</span>
                  <span>{cp.files.length} file{cp.files.length === 1 ? '' : 's'}</span>
                  <span>{cp.patchIds.length} patch{cp.patchIds.length === 1 ? '' : 'es'}</span>
                  {task && <span>task: {task.title} ({task.status})</span>}
                  <span>{relTime(cp.createdAt)}</span>
                </div>
                {cp.risks.length > 0 && (
                  <ul className="mt-1.5 space-y-0.5 text-[11px] text-amber-300">
                    {cp.risks.map((r, i) => (
                      <li key={i}>! {r}</li>
                    ))}
                  </ul>
                )}
                <div className="mt-2">
                  <button
                    className="btn-soft text-xs"
                    disabled={suggested}
                    onClick={() =>
                      api()
                        .rtcCommitSuggest(cwd, cp.id)
                        .then(() => {
                          toast('ok', 'Commit suggestion drafted - review it in Commits.')
                          refresh()
                          gotoCommits()
                        })
                        .catch((e) => toast('err', e.message))
                    }
                  >
                    {suggested ? 'Commit already suggested' : 'Suggest a commit'}
                  </button>
                </div>
              </li>
            )
          })}
        </ul>
      </Section>
    </div>
  )
}
