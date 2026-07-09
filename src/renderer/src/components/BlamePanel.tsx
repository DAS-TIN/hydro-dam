import React, { useEffect, useMemo, useState } from 'react'
import { IconClose } from './Icons'
import { api, BlameLine, basename } from '../api'
import { ACTOR_COLORS, ActorColor, RtcActor, RtcChange, RtcLiveBlameSeg, actorColor, actorShort, timeAgo } from '../rtc'
import Avatar from './Avatar'

// git marks uncommitted working-tree lines with an all-zero hash
const isUncommitted = (hash: string) => /^0+$/.test(hash)

// How each blame line should be presented: who, in what colour, since when.
interface Attribution {
  name: string
  color: ActorColor
  live: boolean
  at?: number
  hash?: string
  shortHash?: string
  date?: string
}

export default function BlamePanel({
  cwd,
  path,
  live,
  toast,
  onClose
}: {
  cwd: string
  path: string
  // present while a collaboration session is active: lets uncommitted lines
  // be attributed to whoever actually typed them
  live?: { actors: RtcActor[]; segments: RtcLiveBlameSeg[]; changes: RtcChange[] }
  toast: (kind: 'ok' | 'err' | 'info', text: string) => void
  onClose: () => void
}) {
  const [lines, setLines] = useState<BlameLine[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    setLoading(true)
    api()
      .blame(cwd, path)
      .then(setLines)
      .catch((e) => {
        setLines([])
        toast('err', e?.message || String(e))
      })
      .finally(() => setLoading(false))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cwd, path])

  // Commit authors get a stable colour each, same palette as session actors.
  const authorColors = useMemo(() => {
    const m = new Map<string, ActorColor>()
    for (const l of lines) {
      if (!isUncommitted(l.hash) && !m.has(l.author)) m.set(l.author, ACTOR_COLORS[m.size % ACTOR_COLORS.length])
    }
    return m
  }, [lines])

  const segments = useMemo(() => (live?.segments ?? []).filter((s) => s.path === path), [live, path])
  const newestAt = useMemo(() => Math.max(0, ...segments.map((s) => s.at)), [segments])
  const fileChange = live?.changes.find((c) => c.path === path)

  const attribution = (l: BlameLine): Attribution => {
    if (live && isUncommitted(l.hash)) {
      const seg = segments.find((s) => l.lineNo >= s.startLine && l.lineNo <= s.endLine)
      const actorId = seg?.actorId ?? fileChange?.actorId ?? null
      const actor = live.actors.find((a) => a.id === actorId)
      return {
        name: actor?.displayName || (actorId ? actorShort(actorId) : 'uncommitted'),
        color: actorColor(live.actors, actorId),
        live: true,
        at: seg?.at ?? fileChange?.at
      }
    }
    return {
      name: l.author,
      color: authorColors.get(l.author) ?? ACTOR_COLORS[0],
      live: false,
      hash: l.hash,
      shortHash: l.shortHash,
      date: l.date
    }
  }

  const hasLive = live && lines.some((l) => isUncommitted(l.hash))

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm" onClick={onClose}>
      <div className="card flex h-[84vh] w-[1040px] flex-col overflow-hidden shadow-2xl" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between border-b border-ink-700/60 px-4 py-2.5">
          <div className="min-w-0">
            <div className="text-xs uppercase tracking-wide text-slate-500">Blame</div>
            <div className="truncate text-sm font-medium text-white">{basename(path)}</div>
          </div>
          {hasLive && (
            <div className="mx-4 min-w-0 flex-1 truncate text-right text-[11px] text-slate-500">
              Highlighted lines are live edits, not committed yet - one colour per participant, brighter means the
              last few minutes.
            </div>
          )}
          <button className="btn-ghost px-2" onClick={onClose} title="Close">
            <IconClose className="w-4 h-4" />
          </button>
        </div>
        <div className="min-h-0 flex-1 overflow-auto bg-ink-900 font-mono text-[12.5px] leading-[1.6] select-text">
          {loading && <div className="p-4 text-sm text-slate-500">Loading...</div>}
          {!loading && lines.length === 0 && (
            <div className="p-4 text-sm text-slate-500">No blame (file may be binary or untracked).</div>
          )}
          {!loading &&
            lines.map((l, i) => {
              const a = attribution(l)
              const prev = i > 0 ? attribution(lines[i - 1]) : null
              const sameAsPrev =
                !!prev && prev.live === a.live && (a.live ? prev.name === a.name && prev.at === a.at : prev.hash === a.hash)
              // Two shades per person: recent edits pop, older ones stay quiet.
              const rowShade = a.live ? (a.at && newestAt - a.at < 5 * 60_000 ? a.color.strong : a.color.soft) : ''
              const title = a.live
                ? `Live edit by ${a.name}${a.at ? ` - ${timeAgo(a.at)}` : ''} - not committed yet`
                : `${a.hash} ${a.name} ${a.date}`
              return (
                <div key={i} className={`flex items-start hover:bg-ink-850 ${rowShade}`}>
                  <span
                    className="flex w-[230px] shrink-0 select-none items-center gap-1.5 truncate border-r border-ink-800 px-2 text-[11px] text-slate-500"
                    title={title}
                  >
                    {sameAsPrev ? (
                      <span className="pl-6 opacity-25">{a.live ? '~' : a.shortHash}</span>
                    ) : a.live ? (
                      <>
                        <Avatar name={a.name} bg={a.color.bg} size={15} title={title} />
                        <span className={`truncate ${a.color.text}`}>{a.name}</span>
                        {a.at !== undefined && <span className="live-when shrink-0">{timeAgo(a.at)}</span>}
                      </>
                    ) : (
                      <>
                        <Avatar name={a.name} bg={a.color.bg} size={15} title={title} />
                        <span className="text-accent">{a.shortHash}</span> {a.date}{' '}
                        <span className="truncate text-slate-400">{a.name}</span>
                      </>
                    )}
                  </span>
                  <span className="w-12 shrink-0 select-none px-2 text-right text-slate-300">{l.lineNo}</span>
                  <span className={`whitespace-pre px-2 ${a.live ? 'text-slate-100' : 'text-slate-200'}`}>
                    {l.content === '' ? ' ' : l.content}
                  </span>
                </div>
              )
            })}
        </div>
      </div>
    </div>
  )
}
