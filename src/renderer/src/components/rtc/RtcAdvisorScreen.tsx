import React, { useEffect, useState } from 'react'
import { api } from '../../api'
import { RtcState, RtcTip } from '../../rtc'
import { Section, EmptyNote } from './bits'

const SEV_STYLE: Record<string, string> = {
  high: 'border-bad/40 bg-bad/10',
  medium: 'border-amber-400/40 bg-amber-400/10',
  low: 'border-ink-700/50 bg-ink-800'
}

/** Manager Claude's read on the session: suggestions only, never edits. */
export default function RtcAdvisorScreen({
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
  const [tips, setTips] = useState<RtcTip[]>([])
  const [loading, setLoading] = useState(false)

  const load = () => {
    setLoading(true)
    api()
      .rtcAdvise(cwd)
      .then(setTips)
      .catch((e) => toast('err', e.message))
      .finally(() => setLoading(false))
  }
  useEffect(load, [cwd, state])

  async function actOn(tip: RtcTip) {
    try {
      if (tip.kind === 'unblock' && tip.taskId) await api().rtcTaskTransition(cwd, tip.taskId, 'in_progress')
      else if (tip.kind === 'mark-blocked' && tip.taskId) await api().rtcTaskTransition(cwd, tip.taskId, 'blocked')
      else if (tip.kind === 'stale-lock' && tip.lockId) await api().rtcLockRelease(cwd, tip.lockId)
      else return
      refresh()
    } catch (e: any) {
      toast('err', e.message)
    }
  }

  const actionable = new Set(['unblock', 'mark-blocked', 'stale-lock'])

  return (
    <div className="mx-auto max-w-2xl">
      <Section
        title={`Coordination suggestions (${tips.length})`}
        right={
          <button className="btn-ghost text-xs" onClick={load} disabled={loading}>
            {loading ? 'thinking...' : 'refresh'}
          </button>
        }
      >
        {tips.length === 0 && <EmptyNote>Nothing to flag - the session looks coordinated.</EmptyNote>}
        <ul className="space-y-1.5">
          {tips.map((t) => (
            <li key={t.id} className={`flex items-center gap-3 rounded-lg border px-3 py-2 ${SEV_STYLE[t.severity]}`}>
              <span
                className={`rounded px-1.5 py-0.5 text-[9px] font-semibold uppercase ${
                  t.severity === 'high' ? 'bg-bad/20 text-bad' : t.severity === 'medium' ? 'bg-amber-400/15 text-amber-300' : 'bg-ink-750 text-slate-400'
                }`}
              >
                {t.kind}
              </span>
              <span className="min-w-0 flex-1 text-xs text-slate-200">{t.message}</span>
              {actionable.has(t.kind) && (
                <button className="btn-soft text-xs" onClick={() => actOn(t)}>
                  do it
                </button>
              )}
            </li>
          ))}
        </ul>
        <p className="mt-3 text-[11px] text-slate-500">
          The manager never edits code or applies anything itself. Acting on a suggestion is up to you.
        </p>
      </Section>
    </div>
  )
}
