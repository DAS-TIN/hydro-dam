import React, { useMemo } from 'react'
import { highlight, extOf } from '../highlight'

/** Read-only code view: line-number gutter plus syntax highlighting.
 * padLines reserves that many blank rows at the bottom - the editor uses it so a
 * freshly typed/pasted line has height to land in before the view re-renders. */
export default function CodeView({
  text,
  path,
  padLines = 0
}: {
  text: string
  path: string
  padLines?: number
}) {
  const lines = useMemo(() => highlight(text, extOf(path)), [text, path])
  const gutterCh = Math.max(3, String(lines.length).length) + 2

  return (
    <div className="min-w-max py-2 font-mono text-[12.5px] leading-[1.55] select-text">
      {lines.map((toks, i) => (
        <div key={i} className="flex hover:bg-ink-850/60">
          <span
            className="sticky left-0 shrink-0 select-none border-r border-ink-800 bg-ink-900 pr-2.5 text-right text-ink-600"
            style={{ minWidth: `${gutterCh}ch` }}
          >
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
      ))}
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
