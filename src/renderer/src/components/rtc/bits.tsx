import React from 'react'
import { RtcActor, actorColor, actorShort } from '../../rtc'

/** Coloured dot + name for an actor, the building block of attribution. */
export function ActorChip({ actors, actorId, small }: { actors: RtcActor[]; actorId: string | null; small?: boolean }) {
  const c = actorColor(actors, actorId)
  const a = actors.find((x) => x.id === actorId)
  const label = a ? a.displayName : actorId === 'unknown' || !actorId ? 'unknown' : actorShort(actorId)
  return (
    <span className={`inline-flex items-center gap-1.5 ${small ? 'text-[11px]' : 'text-xs'}`}>
      <span className={`h-2 w-2 shrink-0 rounded-full ${c.bg}`} />
      <span className={c.text}>{label}</span>
      {a?.type === 'agent' && <span className="text-[10px] text-slate-500">agent</span>}
      {a?.type === 'manager' && <span className="text-[10px] text-slate-500">manager</span>}
    </span>
  )
}

export function StatusChip({ status, styles }: { status: string; styles: Record<string, string> }) {
  return (
    <span className={`rounded px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide ${styles[status] || 'bg-ink-750 text-slate-400'}`}>
      {status.replace(/_/g, ' ')}
    </span>
  )
}

export function Section({ title, children, right }: { title: string; children: React.ReactNode; right?: React.ReactNode }) {
  return (
    <div className="mb-4">
      <div className="mb-1.5 flex items-center justify-between">
        <div className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">{title}</div>
        {right}
      </div>
      {children}
    </div>
  )
}

export function EmptyNote({ children }: { children: React.ReactNode }) {
  return (
    <div className="rounded-lg border border-dashed border-ink-700 py-6 text-center text-sm text-slate-500">
      {children}
    </div>
  )
}

/** Progress toward a reviewed checkpoint, colour-shifting as it fills. */
export function ProgressBar({ pct }: { pct: number }) {
  const color = pct >= 85 ? 'bg-emerald-400' : pct >= 50 ? 'bg-amber-400' : 'bg-sky-400'
  return (
    <div className="flex items-center gap-2">
      <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-ink-750">
        <div className={`h-full rounded-full ${color}`} style={{ width: `${pct}%` }} />
      </div>
      <span className="w-8 text-right text-[10px] tabular-nums text-slate-400">{pct}%</span>
    </div>
  )
}

export function IconLock({ className, hard }: { className?: string; hard?: boolean }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={hard ? 2.5 : 1.8} className={className}>
      <rect x="5" y="11" width="14" height="9" rx="2" />
      <path d="M8 11V7a4 4 0 0 1 8 0v4" />
    </svg>
  )
}

export function IconCaret({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" className={className}>
      <rect x="11" y="3" width="2" height="18" rx="1" />
    </svg>
  )
}

export const inputCls =
  'rounded-md border border-ink-700 bg-ink-950 px-3 py-1.5 text-sm outline-none focus:border-accent'

export const RISK_STYLE: Record<string, string> = {
  low: 'bg-emerald-400/15 text-emerald-300',
  medium: 'bg-amber-400/15 text-amber-300',
  high: 'bg-bad/20 text-bad'
}
