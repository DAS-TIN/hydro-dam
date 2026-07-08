import React, { useState } from 'react'
import { api } from '../../api'
import { RtcState, RtcTask, TASK_STATUS_STYLE, taskProgress } from '../../rtc'
import { ActorChip, StatusChip, Section, EmptyNote, ProgressBar, inputCls } from './bits'

// Mirrors TRANSITIONS in src/main/rtc/tasks.mjs, minus 'claimed' because
// claiming has its own button (it needs an actor, not just a status flip).
const NEXT: Record<string, string[]> = {
  backlog: ['ready', 'abandoned'],
  ready: ['backlog', 'abandoned'],
  claimed: ['in_progress', 'ready', 'abandoned'],
  in_progress: ['blocked', 'needs_review', 'ready', 'abandoned'],
  blocked: ['in_progress', 'abandoned'],
  needs_review: ['checkpointed', 'in_progress', 'rejected'],
  checkpointed: ['merged', 'in_progress'],
  merged: [],
  rejected: ['in_progress', 'abandoned'],
  abandoned: ['backlog']
}

export default function RtcTasksScreen({
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
  const [title, setTitle] = useState('')
  const [type, setType] = useState('feature')
  const [desc, setDesc] = useState('')
  const [criteria, setCriteria] = useState('')
  const [open, setOpen] = useState<string | null>(null)

  const act = (fn: () => Promise<any>) => fn().then(refresh).catch((e) => toast('err', e.message))

  async function create() {
    if (!title.trim()) return
    await act(() =>
      api().rtcTaskCreate(cwd, {
        title: title.trim(),
        type,
        description: desc.trim(),
        acceptanceCriteria: criteria.split('\n').map((l) => l.trim()).filter(Boolean)
      })
    )
    setTitle('')
    setDesc('')
    setCriteria('')
  }

  function TaskCard({ t }: { t: RtcTask }) {
    const pct = taskProgress(t, state.patches)
    const expanded = open === t.id
    const deps = t.dependsOn.map((id) => state.tasks.find((x) => x.id === id)).filter(Boolean) as RtcTask[]
    const patches = state.patches.filter((p) => p.taskId === t.id)
    return (
      <li className="rounded-lg border border-ink-700/50 bg-ink-800">
        <button className="w-full px-3 py-2 text-left" onClick={() => setOpen(expanded ? null : t.id)}>
          <div className="flex items-center gap-2">
            <StatusChip status={t.status} styles={TASK_STATUS_STYLE} />
            <span className="min-w-0 flex-1 truncate text-sm font-medium text-slate-100">{t.title}</span>
            <span className="text-[10px] uppercase text-slate-500">{t.type}</span>
            {t.ownerActorId && <ActorChip actors={state.actors} actorId={t.ownerActorId} small />}
          </div>
          <div className="mt-1.5">
            <ProgressBar pct={pct} />
          </div>
        </button>
        {expanded && (
          <div className="space-y-3 border-t border-ink-700/50 px-3 py-3 text-xs">
            {t.description && <p className="text-slate-400">{t.description}</p>}
            {deps.length > 0 && (
              <div className="text-slate-500">
                Depends on:{' '}
                {deps.map((d) => (
                  <span key={d.id} className={`mr-2 ${d.status === 'merged' ? 'text-emerald-300' : 'text-amber-300'}`}>
                    {d.title} ({d.status})
                  </span>
                ))}
              </div>
            )}
            {t.acceptanceCriteria.length > 0 && (
              <div className="space-y-1">
                <div className="text-[10px] font-semibold uppercase text-slate-500">Acceptance criteria</div>
                {t.acceptanceCriteria.map((c, i) => (
                  <label key={i} className="flex items-center gap-2 text-slate-300">
                    <input
                      type="checkbox"
                      checked={c.done}
                      onChange={() => {
                        const next = t.acceptanceCriteria.map((x, j) => (j === i ? { ...x, done: !x.done } : x))
                        act(() => api().rtcTaskUpdate(cwd, t.id, { acceptanceCriteria: next }))
                      }}
                    />
                    <span className={c.done ? 'line-through text-slate-500' : ''}>{c.text}</span>
                  </label>
                ))}
              </div>
            )}
            {patches.length > 0 && (
              <div className="text-slate-500">
                {patches.length} patch{patches.length === 1 ? '' : 'es'}: {patches.map((p) => p.status).join(', ')}
              </div>
            )}
            <div className="flex flex-wrap gap-1.5">
              {['backlog', 'ready'].includes(t.status) && state.local.activeActorId && (
                <button
                  className="btn-accent text-xs"
                  onClick={() => act(() => api().rtcTaskClaim(cwd, t.id, state.local.activeActorId!))}
                >
                  Claim as {state.local.activeActorId}
                </button>
              )}
              {(NEXT[t.status] || []).map((to) => (
                <button key={to} className="btn-soft text-xs" onClick={() => act(() => api().rtcTaskTransition(cwd, t.id, to))}>
                  {to.replace(/_/g, ' ')}
                </button>
              ))}
              {t.ownerActorId && state.local.activeActorId === t.ownerActorId && (
                <button
                  className="btn-ghost text-xs"
                  onClick={() => act(() => api().rtcActorSetActive(cwd, state.local.activeActorId!, t.id))}
                >
                  Set as my active task
                </button>
              )}
            </div>
          </div>
        )}
      </li>
    )
  }

  const order = ['in_progress', 'blocked', 'needs_review', 'claimed', 'ready', 'checkpointed', 'backlog', 'rejected', 'merged', 'abandoned']
  const sorted = [...state.tasks].sort((a, b) => order.indexOf(a.status) - order.indexOf(b.status))

  return (
    <div className="mx-auto max-w-2xl">
      <Section title={`Tasks (${state.tasks.length})`}>
        {sorted.length === 0 && <EmptyNote>No tasks yet - create the first one below.</EmptyNote>}
        <ul className="space-y-1.5">
          {sorted.map((t) => (
            <TaskCard key={t.id} t={t} />
          ))}
        </ul>
      </Section>

      <Section title="New task">
        <div className="card space-y-2 p-4">
          <div className="flex gap-2">
            <input className={`flex-1 ${inputCls}`} placeholder="Title" value={title} onChange={(e) => setTitle(e.target.value)} />
            <select className={inputCls} value={type} onChange={(e) => setType(e.target.value)}>
              {['feature', 'bugfix', 'refactor', 'test', 'docs', 'investigation', 'chore'].map((t) => (
                <option key={t} value={t}>
                  {t}
                </option>
              ))}
            </select>
          </div>
          <textarea className={`w-full ${inputCls}`} rows={2} placeholder="Description (optional)" value={desc} onChange={(e) => setDesc(e.target.value)} />
          <textarea
            className={`w-full ${inputCls}`}
            rows={2}
            placeholder="Acceptance criteria, one per line (optional)"
            value={criteria}
            onChange={(e) => setCriteria(e.target.value)}
          />
          <button className="btn-accent" onClick={create}>
            Create task
          </button>
        </div>
      </Section>
    </div>
  )
}
