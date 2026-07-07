import React from 'react'
import { Region } from '../shortcuts'

// The views the dock offers, in Shift+Left/Right cycling order.
export const ULTRA_ORDER: Region[] = ['topbar', 'files', 'main', 'commit']

const ITEMS: { region: Region; label: string; icon: React.ReactNode }[] = [
  {
    region: 'topbar',
    label: 'Repo actions',
    icon: (
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
        <path d="M12 3l9 8h-3v9h-4v-6h-4v6H6v-9H3l9-8z" />
      </svg>
    )
  },
  {
    region: 'files',
    label: 'File list',
    icon: (
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
        <rect x="3" y="3" width="18" height="18" rx="2" />
        <path d="M7 12h10M7 8h7M7 16h5" />
      </svg>
    )
  },
  {
    region: 'main',
    label: 'Graph',
    icon: (
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
        <circle cx="12" cy="12" r="9.5" />
        <path d="M12 6.8V12l3.6 2.2" />
      </svg>
    )
  },
  {
    region: 'commit',
    label: 'Commit',
    icon: (
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
        <circle cx="12" cy="12" r="3.2" />
        <path d="M12 2.5v6.3M12 15.2v6.3" />
      </svg>
    )
  }
]

/**
 * The ultra-focus taskbar, pinned to the bottom of every ultra view with the
 * current one lit. Clicks switch views, Shift+Left/Right cycle them (handled
 * at the app level). Deliberately not tabbable and ignored by plain arrows.
 */
export default function UltraDock({
  current,
  onPick
}: {
  current: Region
  onPick: (r: Region) => void
}) {
  return (
    <div className="ultra-footer fixed bottom-0 left-0 right-0 z-[45] flex h-10 items-center justify-center gap-1.5 px-4">
      <span className="mr-2 text-[10px] font-bold uppercase tracking-[0.2em] text-white/90">
        Ultra
      </span>
      {ITEMS.map((it) => (
        <button
          key={it.region}
          tabIndex={-1}
          onClick={() => onPick(it.region)}
          className={`flex items-center gap-1.5 rounded-md px-2.5 py-1 text-[11px] font-medium transition-colors ${
            current === it.region
              ? 'bg-white/25 text-white shadow'
              : 'text-white/65 hover:bg-white/10 hover:text-white'
          }`}
        >
          {it.icon}
          {it.label}
        </button>
      ))}
      <span className="ml-3 text-[10px] text-white/60">Shift+Left/Right move, Esc leaves</span>
    </div>
  )
}
