import React, { useMemo, useState } from 'react'
import { highlight, extOf } from '../highlight'
import { LiveCursor, LiveLineMark, liveLabelClass, timeAgo } from '../rtc'
import Avatar from './Avatar'

// One row's rendered height: text-[12.5px] leading-[1.55].
const ROW_PX = 12.5 * 1.55

/** A curly brace "}" for a live-edit segment: tips curl LEFT toward the code,
 * the point sticks out RIGHT toward the label. Drawn once for the whole segment
 * so the curls stay tight (fixed size) while the straight body stretches to any
 * height. Colour comes from currentColor. */
const BRACE_W = 18
function SegmentBrace({ heightPx }: { heightPx: number }) {
  const tipX = 2
  const bodyX = 9
  const pointX = 18
  const h = heightPx
  const mid = h / 2
  const curl = Math.min(13, h / 2 - 1)
  // cubic curls (deeper than quadratics) so the brace reads as clearly curly
  const d =
    `M ${tipX} 0 C ${bodyX} 0 ${bodyX} 0 ${bodyX} ${curl} L ${bodyX} ${mid - curl} ` +
    `C ${bodyX} ${mid} ${bodyX} ${mid} ${pointX} ${mid} ` +
    `C ${bodyX} ${mid} ${bodyX} ${mid} ${bodyX} ${mid + curl} ` +
    `L ${bodyX} ${h - curl} C ${bodyX} ${h} ${bodyX} ${h} ${tipX} ${h}`
  return (
    <svg
      width={BRACE_W}
      height={h}
      viewBox={`0 0 ${BRACE_W} ${h}`}
      fill="none"
      className="pointer-events-none"
      style={{ overflow: 'visible' }}
    >
      <path d={d} stroke="currentColor" strokeWidth={1.9} strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  )
}

/** Read-only code view: line-number gutter plus syntax highlighting.
 * padLines reserves that many blank rows at the bottom - the editor uses it so a
 * freshly typed/pasted line has height to land in before the view re-renders.
 * live (from a collaboration session) tints uncommitted lines in the colour of
 * whoever wrote them; clicking the label or avatar unfolds what the lines said
 * before. cursors renders each participant's blinking insertion caret.
 * brackets (default) draws multi-line segments as a brace down their right
 * side with the label at its middle; off puts the label on the first line. */
export default function CodeView({
  text,
  path,
  padLines = 0,
  live,
  cursors,
  brackets = true
}: {
  text: string
  path: string
  padLines?: number
  live?: Map<number, LiveLineMark>
  cursors?: LiveCursor[]
  brackets?: boolean
}) {
  const lines = useMemo(() => highlight(text, extOf(path)), [text, path])
  const raw = useMemo(() => text.split('\n'), [text])
  const gutterCh = Math.max(3, String(lines.length).length) + 2 + (live?.size ? 3 : 0)
  // which segment's history is unfolded, keyed by its first line
  const [openHist, setOpenHist] = useState<number | null>(null)

  // "You" for your own edits, otherwise the author's name - coloured either way
  const who = (m: LiveLineMark) => (m.mine ? 'You' : m.name)
  // "edited ..." without the name - the name gets its own colour
  const actionLabel = (m: LiveLineMark) =>
    m.startLine === m.endLine ? 'edited this line' : `edited lines ${m.startLine}-${m.endLine}`
  const hoverLabel = (m: LiveLineMark) => `${who(m)} ${actionLabel(m)} ${timeAgo(m.at)}`
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
              title={mark ? hoverLabel(mark) : undefined}
              className={`group relative flex ${
                mark
                  ? // keep the actor colour on hover, just lift it with a faint
                    // overlay (a filter here would disturb the sticky gutter)
                    `live-tinted hover:shadow-[inset_0_0_0_9999px_rgba(255,255,255,0.07)] ${
                      mark.recent ? mark.color.strong : mark.color.soft
                    }`
                  : 'hover:bg-ink-850/60'
              }`}
            >
              <span
                className="sticky left-0 flex shrink-0 select-none items-center justify-end gap-1 border-r border-ink-800 bg-ink-900 pr-2.5 text-right text-slate-500 group-hover:bg-ink-800 group-hover:font-semibold group-hover:text-white"
                style={{ minWidth: `${gutterCh}ch` }}
              >
                {mark?.first && (
                  <button
                    title={`${hoverLabel(mark)} - click for line history`}
                    onClick={() => setOpenHist(openHist === mark.startLine ? null : mark.startLine)}
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
              {(() => {
                if (!mark) return <span className="flex-1 pr-6" />
                // Clamp to what is actually rendered: while a peer types, the
                // segment metadata can briefly run ahead of the file re-read, so
                // an unclamped brace would overshoot into empty rows below.
                const endLine = Math.min(mark.endLine, lines.length)
                const span = endLine - mark.startLine + 1
                const rangeLabel =
                  span <= 1 ? 'edited this line' : `edited lines ${mark.startLine}-${endLine}`
                const labelText = (
                  <>
                    <span className={mark.color.text}>{who(mark)}</span>{' '}
                    <span className={labelClass(mark)}>{rangeLabel}</span>{' '}
                    <span className="live-when">{timeAgo(mark.at)}</span>
                  </>
                )
                if (!brackets || span <= 1) {
                  if (!mark.first) return <span className="flex-1 pr-6" />
                  // IDE-style inline attribution: informational only, never part of a copy
                  return (
                    <>
                      <span className="flex-1" />
                      <span
                        className="cursor-pointer select-none self-center whitespace-nowrap pl-8 pr-4 text-[11px] italic"
                        title="Click for line history"
                        onClick={() => setOpenHist(openHist === mark.startLine ? null : mark.startLine)}
                      >
                        {labelText}
                      </span>
                    </>
                  )
                }
                const mid = mark.startLine + Math.floor((span - 1) / 2)
                if (i + 1 !== mid) return <span className="flex-1 pr-6" />
                let maxLen = 0
                for (let ln = mark.startLine; ln <= endLine; ln++) {
                  maxLen = Math.max(maxLen, (raw[ln - 1] ?? '').length)
                }
                const pad = Math.max(1, maxLen - (raw[mid - 1] ?? '').length + 2)
                return (
                  <span
                    className={`flex shrink-0 items-center ${mark.color.text}`}
                    style={{ marginLeft: `${pad}ch` }}
                  >
                    <span className="relative self-stretch" style={{ width: BRACE_W }}>
                      <span
                        className="absolute left-0 -translate-y-1/2"
                        style={{ top: span % 2 === 0 ? '100%' : '50%' }}
                      >
                        <SegmentBrace heightPx={span * ROW_PX} />
                      </span>
                    </span>
                    {/* connector hyphen from the brace point out to the label */}
                    <span className={`h-0.5 w-6 ${mark.color.bg}`} />
                    <span
                      className="cursor-pointer select-none whitespace-nowrap pl-2 pr-6 text-[11px] italic"
                      title="Click for line history"
                      onClick={() => setOpenHist(openHist === mark.startLine ? null : mark.startLine)}
                    >
                      {labelText}
                    </span>
                  </span>
                )
              })()}
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
                    <span className={mark!.color.text}>{who(mark!)}</span>
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
