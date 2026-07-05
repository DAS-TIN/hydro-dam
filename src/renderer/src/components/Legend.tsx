import React from 'react'
import { IconBlocked } from './Icons'

const ITEMS: { letter?: string; icon?: React.ReactNode; cls: string; label: string }[] = [
  { letter: 'A', cls: 'bg-good/20 text-good', label: 'Added' },
  { letter: 'M', cls: 'bg-warn/20 text-warn', label: 'Modified' },
  { letter: 'D', cls: 'bg-bad/20 text-bad', label: 'Deleted' },
  { letter: 'R', cls: 'bg-accent/20 text-accent', label: 'Renamed' },
  { letter: 'U', cls: 'bg-info/20 text-info', label: 'Untracked' },
  { letter: '!', cls: 'bg-bad/20 text-bad', label: 'Conflict' },
  { icon: <IconBlocked className="w-3 h-3" />, cls: 'bg-slate-600/30 text-slate-400', label: 'Hidden' },
  { letter: 'I', cls: 'bg-ink-700 text-slate-500', label: 'Ignored' }
]

export default function Legend({ onClose }: { onClose?: () => void }) {
  return (
    <div className="border-t border-ink-800 bg-ink-900/80 px-3 py-2">
      <div className="mb-1 flex items-center justify-between">
        <span className="text-[10px] font-semibold uppercase tracking-wide text-slate-500">Key</span>
        {onClose && (
          <button
            onClick={onClose}
            className="text-[10px] text-slate-600 hover:text-slate-300"
            title="Hide the key (re-enable in Settings)"
          >
            hide
          </button>
        )}
      </div>
      <div className="flex flex-wrap gap-x-3 gap-y-1.5">
        {ITEMS.map((it) => (
          <span key={it.label} className="flex items-center gap-1.5 text-[11px] text-slate-400">
            <span
              className={`flex h-4 w-4 items-center justify-center rounded text-[10px] font-bold ${it.cls}`}
            >
              {it.icon || it.letter}
            </span>
            {it.label}
          </span>
        ))}
      </div>
    </div>
  )
}
