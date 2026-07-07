import React from 'react'

/**
 * The mode strip every ultra-focus view wears: a thin flowing-gradient footer
 * pinned to the bottom of the window, out of the content's way.
 */
export default function UltraBanner({ label, hint }: { label: string; hint?: string }) {
  return (
    <div className="ultra-footer pointer-events-none fixed bottom-0 left-0 right-0 z-[45] flex h-8 items-center justify-center gap-3 px-4 text-[11px]">
      <span className="whitespace-nowrap font-bold uppercase tracking-[0.2em] text-white">
        Ultra focus - {label}
      </span>
      {hint && <span className="truncate text-white/75">{hint}</span>}
    </div>
  )
}
