import React, { useEffect, useRef } from 'react'
import { focusables } from '../shortcuts'
import UltraBanner from './UltraBanner'

export interface PickerItem {
  key: string
  label: string
  icon: React.ReactNode
  run: () => void
  badge?: number
}

const COLS = 4

function Box({ item }: { item: PickerItem }) {
  return (
    <button
      onClick={item.run}
      className="relative flex h-28 flex-col items-center justify-center gap-2.5 rounded-xl border border-ink-800 bg-ink-900/70 text-slate-300 outline-none transition-colors hover:border-accent/70 hover:bg-accent/20 hover:text-white focus:border-accent focus:bg-accent/25 focus:text-white"
    >
      <span className="text-accent [&_svg]:h-8 [&_svg]:w-8">{item.icon}</span>
      <span className="px-2 text-center text-[12px] font-medium leading-tight">{item.label}</span>
      {item.badge !== undefined && item.badge > 0 && (
        <span className="absolute right-2 top-2 rounded-full bg-accent px-1.5 text-[10px] font-bold text-white">
          {item.badge}
        </span>
      )}
    </button>
  )
}

/**
 * Ultra focus on the sidebar: a full-window app picker. Arrows move through
 * the grid (left/right wrap within their section, up/down cross sections);
 * Tab is left alone so the app-level handler can cycle the ultra views.
 */
export default function UltraPicker({
  items,
  more,
  onClose
}: {
  items: PickerItem[]
  more: PickerItem[]
  onClose: () => void
}) {
  const boxRef = useRef<HTMLDivElement>(null)

  // focus Changes on open
  useEffect(() => {
    focusables(boxRef.current)[0]?.focus()
  }, [])

  const onKey = (e: React.KeyboardEvent) => {
    if (!['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(e.key)) return
    if (e.shiftKey) return // Shift+arrows switch ultra views at the app level
    e.preventDefault()
    e.stopPropagation()
    const els = focusables(boxRef.current)
    if (els.length === 0) return
    const at = els.indexOf(document.activeElement as HTMLElement)
    if (at === -1) {
      els[0].focus()
      return
    }
    // section boundaries: the "Go to" grid, then the "More" grid
    const start = at < items.length ? 0 : items.length
    const end = at < items.length ? items.length : els.length
    let to = at
    if (e.key === 'ArrowLeft') to = at - 1 < start ? end - 1 : at - 1
    else if (e.key === 'ArrowRight') to = at + 1 >= end ? start : at + 1
    else if (e.key === 'ArrowDown') to = Math.min(at + COLS, els.length - 1)
    else if (e.key === 'ArrowUp') to = Math.max(at - COLS, 0)
    els[to]?.focus()
  }

  return (
    <div
      data-ultra
      ref={boxRef}
      className="fixed inset-0 z-40 flex items-center justify-center overflow-y-auto bg-gradient-to-br from-ink-950 via-ink-900 to-ink-850"
      onClick={onClose}
      onKeyDown={onKey}
    >
      <UltraBanner label="Sidebar" hint="Shift+Left/Right switch view, Esc leaves" />
      <div className="w-full max-w-3xl px-8 py-12" onClick={(e) => e.stopPropagation()}>
        <div className="mb-8 text-center">
          <h1 className="text-xl font-semibold text-white">Go to</h1>
          <div className="mt-1 text-[11px] text-slate-500">Arrows or Tab move, Enter opens</div>
        </div>
        <div className="grid grid-cols-4 gap-4">
          {items.map((it) => (
            <Box key={it.key} item={it} />
          ))}
        </div>
        <div className="mb-4 mt-10 flex items-center gap-3 text-[11px] font-semibold uppercase tracking-wide text-slate-500">
          More
          <div className="h-px flex-1 bg-ink-800" />
        </div>
        <div className="grid grid-cols-4 gap-4">
          {more.map((it) => (
            <Box key={it.key} item={it} />
          ))}
        </div>
      </div>
    </div>
  )
}
