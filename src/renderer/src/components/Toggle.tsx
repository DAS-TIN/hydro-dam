import React from 'react'

/**
 * A pill toggle whose knob sits with an even 2px gap on both ends.
 * Track 36x20, knob 16x16 -> off at left:2px, on at left:18px (36-16-2).
 */
export default function Toggle({
  on,
  onClick,
  title
}: {
  on: boolean
  onClick: (e: React.MouseEvent) => void
  title?: string
}) {
  return (
    <button
      role="switch"
      aria-checked={on}
      onClick={onClick}
      title={title}
      className={`relative h-5 w-9 shrink-0 rounded-full transition-colors ${
        on ? 'bg-accent' : 'bg-ink-700'
      }`}
    >
      <span
        className={`absolute top-1/2 h-4 w-4 -translate-y-1/2 rounded-full bg-white shadow-sm transition-all ${
          on ? 'left-[18px]' : 'left-[2px]'
        }`}
      />
    </button>
  )
}
