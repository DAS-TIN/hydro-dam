import React, { useState } from 'react'
import { api, relTime } from '../../api'
import { RtcState } from '../../rtc'
import { ActorChip, Section, EmptyNote, IconLock, inputCls } from './bits'

export default function RtcLocksScreen({
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
  const [path, setPath] = useState('')
  const [lockType, setLockType] = useState('file')
  const [reason, setReason] = useState('')
  const [hard, setHard] = useState(false)
  const [ttl, setTtl] = useState('')

  const now = Date.now()
  const active = state.locks.filter((l) => !l.releasedAt && (!l.expiresAt || l.expiresAt > now))
  const me = state.local.activeActorId
  const canUnlock = (lockedBy: string) => {
    const a = state.actors.find((x) => x.id === me)
    return me === lockedBy || (a?.type === 'human' && a.permissions?.manageLocks)
  }

  async function acquire() {
    if (!path.trim() || !me) return
    try {
      await api().rtcLockAcquire(cwd, {
        lockType,
        path: path.trim(),
        actorId: me,
        reason: reason.trim(),
        hardLock: hard,
        ttlMinutes: ttl ? Number(ttl) : null,
        taskId: state.local.activeTaskId
      })
      setPath('')
      setReason('')
      refresh()
    } catch (e: any) {
      toast('err', e.message)
    }
  }

  return (
    <div className="mx-auto max-w-2xl">
      <Section title={`Active locks (${active.length})`}>
        {active.length === 0 && <EmptyNote>Nothing is locked.</EmptyNote>}
        <ul className="space-y-1.5">
          {active.map((l) => (
            <li key={l.id} className="flex items-center gap-3 rounded-lg border border-ink-700/50 bg-ink-800 px-3 py-2">
              <IconLock className={`h-4 w-4 shrink-0 ${l.hardLock ? 'text-bad' : 'text-amber-300'}`} hard={l.hardLock} />
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                  <span className="truncate font-mono text-xs text-slate-200">{l.path}</span>
                  <span className={`rounded px-1 py-0.5 text-[9px] font-semibold uppercase ${l.hardLock ? 'bg-bad/20 text-bad' : 'bg-amber-400/15 text-amber-300'}`}>
                    {l.hardLock ? 'hard' : 'soft'} {l.lockType}
                  </span>
                </div>
                <div className="mt-0.5 flex items-center gap-2 text-[11px] text-slate-500">
                  <ActorChip actors={state.actors} actorId={l.lockedByActorId} small />
                  {l.reason && <span>- {l.reason}</span>}
                  {l.expiresAt && <span>expires {relTime(l.expiresAt)}</span>}
                </div>
              </div>
              {canUnlock(l.lockedByActorId) && (
                <button className="btn-ghost text-xs" onClick={() => api().rtcLockRelease(cwd, l.id).then(refresh).catch((e) => toast('err', e.message))}>
                  release
                </button>
              )}
            </li>
          ))}
        </ul>
      </Section>

      <Section title="Take a lock">
        <div className="card space-y-2 p-4">
          <div className="flex gap-2">
            <input className={`flex-1 ${inputCls}`} placeholder="path/to/file or folder" value={path} onChange={(e) => setPath(e.target.value)} />
            <select className={inputCls} value={lockType} onChange={(e) => setLockType(e.target.value)}>
              {['file', 'folder', 'task', 'contract', 'binary'].map((t) => (
                <option key={t} value={t}>
                  {t}
                </option>
              ))}
            </select>
          </div>
          <div className="flex gap-2">
            <input className={`flex-1 ${inputCls}`} placeholder="Reason (shown to others)" value={reason} onChange={(e) => setReason(e.target.value)} />
            <input className={`w-28 ${inputCls}`} placeholder="TTL min" value={ttl} onChange={(e) => setTtl(e.target.value.replace(/\D/g, ''))} />
          </div>
          <label className="flex items-center gap-2 text-xs text-slate-400">
            <input type="checkbox" checked={hard} onChange={(e) => setHard(e.target.checked)} />
            Hard lock (for lockfiles, binaries, migrations - risky files pick this automatically)
          </label>
          <button className="btn-accent" onClick={acquire} disabled={!me}>
            Lock it
          </button>
        </div>
      </Section>

      {state.violations.length > 0 && (
        <Section title={`Lock violations (${state.violations.length})`}>
          <ul className="space-y-1">
            {state.violations.slice(-15).reverse().map((v) => (
              <li key={v.id} className="flex items-center gap-2 rounded-md border border-bad/30 bg-bad/10 px-3 py-1.5 text-[11px]">
                <ActorChip actors={state.actors} actorId={v.actorId} small />
                <span className="text-slate-300">
                  edited <span className="font-mono">{v.path}</span> while locked by
                </span>
                <ActorChip actors={state.actors} actorId={v.lockedByActorId} small />
                <span className="ml-auto text-slate-500">{relTime(v.at)}</span>
              </li>
            ))}
          </ul>
        </Section>
      )}
    </div>
  )
}
