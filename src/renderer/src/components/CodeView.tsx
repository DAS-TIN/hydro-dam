import React, { useMemo, useState } from 'react'
import { highlight, extOf } from '../highlight'
import { LiveCursor, LiveLineMark, liveLabelClass, timeAgo } from '../rtc'
import Avatar from './Avatar'

/** Read-only code view: line-number gutter plus syntax highlighting.
 * padLines reserves that many blank rows at the bottom - the editor uses it so a
 * freshly typed/pasted line has height to land in before the view re-renders.
 * live (from a collaboration session) tints uncommitted lines in the colour of
 * whoever wrote them; clicking the label or avatar unfolds what the lines said
 * before. cursors renders each participant's blinking insertion caret. */
export default function CodeView({
  text,
  path,
  padLines = 0,
  live,
  cursors
}: {
  text: string
  path: string
  padLines?: number
  live?: Map<number, LiveLineMark>
  cursors?: LiveCursor[]
}) {
  const lines = useMemo(() => highlight(text, extOf(path)), [text, path])
  const raw = useMemo(() => text.split('\n'), [text])
  const gutterCh = Math.max(3, String(lines.length).length) + 2 + (live?.size ? 3 : 0)
  // which segment's history is unfolded, keyed by its first line
  const [openHist, setOpenHist] = useState<number | null>(null)

  const editLabel = (m: LiveLineMark) =>
    m.startLine === m.endLine
      ? `${m.name} last edited this line`
      : `${m.name} last edited lines ${m.startLine}-${m.endLine}`
  const labelClass = (m: LiveLineMark) => liveLabelClass(m.color.name)

  return (
    <div className="min-w-max py-2 font-mono text-[12.5px] leading-[1.55] select-text">
      {lines.map((toks, i) => {
        const mark = live?.get(i + 1)
        const here = cursors?.filter((c) => c.line === i + 1)
        const unfolded = mark?.first && openHist === mark.startLine
        return (
          <React.Fragment key={i}>
            <div
              title={mark && !mark.first ? `${editLabel(mark)} ${timeAgo(mark.at)}` : undefined}
              className={`flex hover:bg-ink-850/60 ${mark ? `live-tinted ${mark.recent ? mark.color.strong : mark.color.soft}` : ''}`}
            >
              <span
                className="sticky left-0 flex shrink-0 select-none items-center justify-end gap-1 border-r border-ink-800 bg-ink-900 pr-2.5 text-right text-slate-300"
                style={{ minWidth: `${gutterCh}ch` }}
              >
                {mark?.first && (
                  <button
                    title={`${editLabel(mark)} ${timeAgo(mark.at)} - click for line history`}
                    onClick={() => setOpenHist(unfolded ? null : mark.startLine)}
                  >
                    <Avatar name={mark.name} bg={mark.color.bg} size={13} />
                  </button>
                )}
                {i + 1}
              </span>
              <span className="relative whitespace-pre pl-3">
                {here?.map((c) => (
                  <span
                    key={c.name}
                    title={`${c.name} is here`}
                    className={`absolute top-0 h-[1.4em] w-[2px] animate-pulse ${c.bg}`}
                    style={{ left: `calc(0.75rem + ${c.col ?? 0}ch)` }}
                  />
                ))}
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
              <span className="flex-1" />
              {mark?.first ? (
                // IDE-style inline attribution: informational only, never part of a copy
                <span
                  className="cursor-pointer select-none self-center whitespace-nowrap pl-8 pr-4 text-[11px] italic"
                  title="Click for line history"
                  onClick={() => setOpenHist(unfolded ? null : mark.startLine)}
                >
                  <span className={labelClass(mark)}>{editLabel(mark)}</span>{' '}
                  <span className="live-when">{timeAgo(mark.at)}</span>
                </span>
              ) : (
                <span className="pr-6" />
              )}
            </div>
            {unfolded && (
              <div className="flex select-text">
                <span
                  className="sticky left-0 shrink-0 border-r border-ink-800 bg-ink-900"
                  style={{ minWidth: `${gutterCh}ch` }}
                />
                <div className={`my-1 ml-3 flex-1 rounded border-l-2 bg-ink-850/80 px-3 py-2 ${mark!.color.border}`}>
                  <div className="mb-1.5 flex items-center gap-1.5 text-[11px]">
                    <Avatar name={mark!.name} bg={mark!.color.bg} size={14} />
                    <span className={mark!.color.text}>{mark!.name}</span>
                    <span className="text-slate-500">now - {timeAgo(mark!.at)}</span>
                  </div>
                  <pre className="mb-2 whitespace-pre-wrap break-all text-[11px] text-slate-300">
                    {raw.slice(mark!.startLine - 1, mark!.endLine).join('\n') || ' '}
                  </pre>
                  {[...mark!.history].reverse().map((h, k) => (
                    <React.Fragment key={k}>
                      <div className="mb-1.5 flex items-center gap-1.5 border-t border-ink-800 pt-1.5 text-[11px]">
                        <Avatar name={h.name} bg={h.color.bg} size={14} />
                        <span className={h.color.text}>{h.name}</span>
                        <span className="text-slate-500">{timeAgo(h.at)} it said:</span>
                      </div>
                      <pre className="mb-2 whitespace-pre-wrap break-all text-[11px] text-slate-500">{h.text || ' '}</pre>
                    </React.Fragment>
                  ))}
                  {mark!.history.length === 0 && (
                    <div className="text-[11px] text-slate-600">No earlier versions - these lines were written once.</div>
                  )}
                </div>
              </div>
            )}
          </React.Fragment>
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
