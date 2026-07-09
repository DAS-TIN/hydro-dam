import React from 'react'
import { initials } from '../rtc'

/**
 * Circular initials badge - the profile-style "who" mark used in the changes
 * list, the diff header and the blame gutter. bg is a Tailwind class like
 * bg-emerald-400 so the colour matches the rest of that person's marks.
 */
export default function Avatar({
  name,
  bg,
  title,
  size = 18,
  className = ''
}: {
  name: string
  bg: string
  title?: string
  size?: number
  className?: string
}) {
  return (
    <span
      title={title ?? name}
      style={{ width: size, height: size, fontSize: Math.round(size * 0.42) }}
      className={`flex shrink-0 select-none items-center justify-center rounded-full font-bold text-ink-950 ring-1 ring-ink-950/70 ${bg} ${className}`}
    >
      {initials(name)}
    </span>
  )
}
