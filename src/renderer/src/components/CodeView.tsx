import React, { useMemo } from 'react'
import { highlight, extOf } from '../highlight'
import { LiveLineMark, timeAgo } from '../rtc'
import Avatar from './Avatar'

/** Read-only code view: line-number gutter plus syntax highlighting.
 * padLines reserves that many blank rows at the bottom - the editor uses it so a
 * freshly typed/pasted line has height to land in before the view re-renders.
 * live (from a collaboration session) tints uncommitted lines in the colour of
 * whoever wrote them, with their avatar on the first line of each edit. */
export default function CodeView({
  text,
  path,
  padLines = 0,
  live
}: {
  text: string
  path: string
  padLines?: number
  live?: Map<number, LiveLineMark>
}) {
  const lines = useMemo(() => highlight(text, extOf(path)), [text, path])
  const gutterCh = Math.max(3, String(lines.length).length) + 2 + (live?.size ? 3 : 0)

  return (
    <div className="min-w-max py-2 font-mono text-[12.5px] leading-[1.55] select-text">
      {lines.map((toks, i) => {
        const mark = live?.get(i + 1)
        return (
          <div
            key={i}
            title={mark ? `${mark.name} - edited ${timeAgo(mark.at)} - not committed yet` : undefined}
            className={`flex hover:bg-ink-850/60 ${mark ? (mark.recent ? mark.color.strong : mark.color.soft) : ''}`}
          >
            <span
              className="sticky left-0 flex shrink-0 select-none items-center justify-end gap-1 border-r border-ink-800 bg-ink-900 pr-2.5 text-right text-ink-600"
              style={{ minWidth: `${gutterCh}ch` }}
            >
              {mark?.first && <Avatar name={mark.name} bg={mark.color.bg} size={13} />}
              {i + 1}
            </span>
            <span className="whitespace-pre pl-3 pr-6">
              {toks.length === 0
                ? ' '
                : toks.map((t, j) =>
                    t.cls ? (
                      <span key={j} className={`tok-${t.cls}`}>
                        {t.text}
                      </span>
                    ) : (
                      <React.Fragment key={j}>{t.text}</React.Fragment>
                    )
                  )}
            </span>
          </div>
        )
      })}
      {Array.from({ length: padLines }).map((_, i) => (
        <div key={`pad-${i}`} className="flex" aria-hidden>
          <span
            className="sticky left-0 shrink-0 select-none border-r border-ink-800 bg-ink-900 pr-2.5"
            style={{ minWidth: `${gutterCh}ch` }}
          />
          <span className="whitespace-pre pl-3 pr-6"> </span>
        </div>
      ))}
    </div>
  )
}
