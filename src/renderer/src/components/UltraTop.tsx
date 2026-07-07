import React, { useRef } from 'react'
import { RepoStatus, basename } from '../api'
import { focusables } from '../shortcuts'
import { IconArrowDown, IconArrowUp, IconHome, IconLogo, IconRefresh } from './Icons'

const COLS = 4

// No standout styling on any box: only real keyboard focus (or hover) lights
// one up, so nothing looks pre-selected when it is not.
function ActionBox({
  label,
  icon,
  count,
  disabled,
  autoFocus,
  onClick
}: {
  label: string
  icon: React.ReactNode
  count?: number
  disabled?: boolean
  autoFocus?: boolean
  onClick: () => void
}) {
  return (
    <button
      disabled={disabled}
      autoFocus={autoFocus}
      onClick={onClick}
      className="relative flex h-24 flex-col items-center justify-center gap-2 rounded-xl border border-ink-800 bg-ink-900/70 text-slate-200 outline-none transition-colors hover:border-accent/60 hover:bg-accent/15 focus:border-accent focus:bg-accent/25 focus:text-white disabled:pointer-events-none disabled:opacity-40"
    >
      <span className="text-accent [&_svg]:h-7 [&_svg]:w-7">{icon}</span>
      <span className="text-[13px] font-medium">{label}</span>
      {count !== undefined && count > 0 && (
        <span className="absolute right-2 top-2 rounded-full bg-accent px-2 py-0.5 text-xs font-bold text-white">
          {count}
        </span>
      )}
    </button>
  )
}

/** Ultra focus on the top bar: the repo's actions, side by side, full window. */
export default function UltraTop({
  cwd,
  status,
  busy,
  onHome,
  onMainView,
  onOpenFolder,
  onRefresh,
  onFetch,
  onPull,
  onReview,
  onPush
}: {
  cwd: string
  status: RepoStatus | null
  busy: boolean
  onHome: () => void
  onMainView: () => void
  onOpenFolder: () => void
  onRefresh: () => void
  onFetch: () => void
  onPull: () => void
  onReview: () => void
  onPush: () => void
}) {
  const ahead = status?.ahead ?? 0
  const behind = status?.behind ?? 0
  const boxRef = useRef<HTMLDivElement>(null)

  // left/right wrap through the boxes, up/down move one grid row
  const onKey = (e: React.KeyboardEvent) => {
    if (e.shiftKey) return // Shift+arrows switch ultra views at the app level
    if (!['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(e.key)) return
    e.preventDefault()
    e.stopPropagation()
    const els = focusables(boxRef.current)
    if (els.length === 0) return
    const at = els.indexOf(document.activeElement as HTMLElement)
    if (at === -1) {
      els[0].focus()
      return
    }
    let to = at
    if (e.key === 'ArrowLeft') to = (at - 1 + els.length) % els.length
    else if (e.key === 'ArrowRight') to = (at + 1) % els.length
    else if (e.key === 'ArrowDown') to = Math.min(at + COLS, els.length - 1)
    else if (e.key === 'ArrowUp') to = Math.max(at - COLS, 0)
    els[to]?.focus()
  }

  return (
    <div
      data-ultra
      ref={boxRef}
      className="fixed inset-0 z-40 flex items-center justify-center overflow-y-auto bg-gradient-to-br from-ink-950 via-ink-900 to-ink-850"
      onKeyDown={onKey}
    >
      <div className="w-[720px] px-6 pb-16 pt-8 text-center">
        <IconLogo className="mx-auto h-28 w-auto" />
        <h1 className="mt-4 text-2xl font-semibold text-white">Hydrodam</h1>
        <p className="mt-2 text-sm text-slate-400">
          Currently in <span className="font-medium text-slate-200">{basename(cwd)}</span> on the{' '}
          <span className="font-medium text-accent">{status?.branch ?? '...'}</span> branch
          {ahead > 0
            ? `, ${ahead} commit${ahead === 1 ? '' : 's'} ready to be pushed`
            : ', nothing waiting to push'}
          {behind > 0 && ` (${behind} behind the remote)`}.
        </p>

        <div className="mt-8 grid grid-cols-4 gap-4">
          <ActionBox label="Home" icon={<IconHome />} onClick={onHome} />
          <ActionBox
            label="Main view"
            autoFocus
            icon={
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
                <rect x="3" y="3" width="18" height="18" rx="2" />
                <path d="M3 9h18M9 9v12" />
              </svg>
            }
            onClick={onMainView}
          />
          <ActionBox
            label="Open folder"
            icon={
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
                <path d="M3 6.5A1.5 1.5 0 014.5 5h4l2 2.5h9A1.5 1.5 0 0121 9v9a1.5 1.5 0 01-1.5 1.5h-15A1.5 1.5 0 013 18V6.5z" />
              </svg>
            }
            onClick={onOpenFolder}
          />
          <ActionBox label="Fetch" icon={<IconRefresh />} disabled={busy} onClick={onFetch} />
          <ActionBox label="Pull" icon={<IconArrowDown />} count={behind} disabled={busy} onClick={onPull} />
          <ActionBox
            label="Review outgoing"
            icon={
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
                <path d="M2.5 12s3.5-6.5 9.5-6.5S21.5 12 21.5 12s-3.5 6.5-9.5 6.5S2.5 12 2.5 12z" />
                <circle cx="12" cy="12" r="2.8" />
              </svg>
            }
            disabled={busy || ahead === 0}
            onClick={onReview}
          />
          <ActionBox label="Push" icon={<IconArrowUp />} count={ahead} disabled={busy} onClick={onPush} />
          <ActionBox label="Refresh" icon={<IconRefresh />} disabled={busy} onClick={onRefresh} />
        </div>

        <div className="mt-6 text-[11px] text-slate-600">Arrows or Tab move, Enter runs</div>
      </div>
    </div>
  )
}
