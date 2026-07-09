import React, { useEffect, useMemo, useState } from 'react'
import { api, BlameLine } from '../api'
import { ACTOR_COLORS, ActorColor, LiveLineMark, timeAgo } from '../rtc'
import Avatar from './Avatar'

interface Hunk {
  header: string
  // body lines paired with their selectable index (-1 for context/meta) and
  // their line numbers: newNo in the new file (context/added), oldNo in the
  // old file (context/removed)
  lines: { text: string; tag: ' ' | '+' | '-' | '\\'; selIdx: number; newNo?: number; oldNo?: number }[]
}

// selIdx must match how the backend counts body lines when it rebuilds the patch
// (stageLines in git.ts): every space/plus/minus line gets an index; no-newline
// markers do not. a mismatch makes line-staging apply to the wrong line.
function parse(text: string): { fileHeader: string[]; hunks: Hunk[] } {
  const all = text.replace(/\n$/, '').split('\n')
  const first = all.findIndex((l) => l.startsWith('@@'))
  if (first === -1) return { fileHeader: all, hunks: [] }
  const fileHeader = all.slice(0, first)
  const hunks: Hunk[] = []
  let cur: Hunk | null = null
  let selIdx = -1
  let newNo = 0
  let oldNo = 0
  for (let i = first; i < all.length; i++) {
    const l = all[i]
    if (l.startsWith('@@')) {
      if (cur) hunks.push(cur)
      cur = { header: l, lines: [] }
      selIdx = -1
      newNo = parseInt(l.match(/\+(\d+)/)?.[1] ?? '0', 10)
      oldNo = parseInt(l.match(/^@@ -(\d+)/)?.[1] ?? '0', 10)
      continue
    }
    if (!cur) continue
    const c = l[0]
    if (c === '+' || c === '-' || c === ' ') {
      selIdx++
      const line: Hunk['lines'][number] = { text: l, tag: c as ' ' | '+' | '-', selIdx }
      if (c !== '-') line.newNo = newNo++
      if (c !== '+') line.oldNo = oldNo++
      cur.lines.push(line)
    } else if (c === '\\') {
      cur.lines.push({ text: l, tag: '\\', selIdx: -1 })
    }
  }
  if (cur) hunks.push(cur)
  return { fileHeader, hunks }
}

// Everyone whose live edits appear in this hunk, latest edit first.
function contributors(hunk: Hunk, live?: Map<number, LiveLineMark>): LiveLineMark[] {
  if (!live?.size) return []
  const byName = new Map<string, LiveLineMark>()
  for (const ln of hunk.lines) {
    if (ln.tag !== '+' || ln.newNo === undefined) continue
    const m = live.get(ln.newNo)
    if (m && (!byName.has(m.name) || byName.get(m.name)!.at < m.at)) byName.set(m.name, m)
  }
  return [...byName.values()].sort((a, b) => b.at - a.at)
}

export default function HunkStager({
  cwd,
  path,
  staged,
  text,
  live,
  headBlame,
  toast,
  onChanged
}: {
  cwd: string
  path: string
  staged: boolean
  text: string
  // per-line live-collab attribution: colours added lines by who wrote them
  live?: Map<number, LiveLineMark>
  // blame of HEAD keyed by old line number: who wrote what a removed line replaces
  headBlame?: Map<number, BlameLine>
  toast: (kind: 'ok' | 'err' | 'info', text: string) => void
  onChanged: () => void
}) {
  const { hunks } = useMemo(() => parse(text), [text])
  // selected changed-line indices, per hunk
  const [sel, setSel] = useState<Record<number, Set<number>>>({})
  const [busy, setBusy] = useState(false)

  // Stable colour per commit author for the "was ..." labels, same idea as
  // the blame panel's palette.
  const authorColors = useMemo(() => {
    const m = new Map<string, ActorColor>()
    for (const b of headBlame?.values() ?? []) {
      if (!m.has(b.author)) m.set(b.author, ACTOR_COLORS[m.size % ACTOR_COLORS.length])
    }
    return m
  }, [headBlame])

  useEffect(() => setSel({}), [text])

  const toggle = (h: number, i: number) =>
    setSel((prev) => {
      const next = { ...prev }
      const s = new Set(next[h] ?? [])
      if (s.has(i)) s.delete(i)
      else s.add(i)
      next[h] = s
      return next
    })

  const run = async (fn: () => Promise<void>, msg: string) => {
    setBusy(true)
    try {
      await fn()
      toast('ok', msg)
      onChanged()
    } catch (e: any) {
      toast('err', e?.message || String(e))
    } finally {
      setBusy(false)
    }
  }

  const verb = staged ? 'Unstage' : 'Stage'
  const wholeHunk = (h: number) =>
    staged
      ? run(() => api().unstageHunk(cwd, path, h), 'Hunk unstaged.')
      : run(() => api().stageHunk(cwd, path, h), 'Hunk staged.')
  const selLines = (h: number) => {
    const arr = [...(sel[h] ?? [])]
    if (!arr.length) return
    return staged
      ? run(() => api().unstageLines(cwd, path, h, arr), `${arr.length} line(s) unstaged.`)
      : run(() => api().stageLines(cwd, path, h, arr), `${arr.length} line(s) staged.`)
  }

  return (
    <div className="h-full overflow-auto bg-ink-900 font-mono text-[12.5px] leading-[1.55] select-text">
      {hunks.map((hunk, h) => {
        const count = (sel[h] ?? new Set()).size
        const who = contributors(hunk, live)
        return (
          <div key={h} className="border-b border-ink-800">
            <div className="sticky top-0 z-10 flex items-center gap-2 bg-ink-850 px-3 py-1">
              <span className="truncate text-[11px] text-accent">{hunk.header}</span>
              {who.map((m) => (
                <span key={m.name} className="flex shrink-0 items-center gap-1 text-[10px] text-slate-400">
                  <Avatar name={m.name} bg={m.color.bg} size={14} />
                  <span className={m.color.text}>{m.name}</span> <span className="live-when">{timeAgo(m.at)}</span>
                </span>
              ))}
              <span className="flex-1" />
              {count > 0 && (
                <button
                  className="btn-soft px-2 py-0.5 text-[11px]"
                  disabled={busy}
                  onClick={() => selLines(h)}
                >
                  {verb} {count} line{count === 1 ? '' : 's'}
                </button>
              )}
              <button className="btn-ghost px-2 py-0.5 text-[11px]" disabled={busy} onClick={() => wholeHunk(h)}>
                {verb} hunk
              </button>
            </div>
            {hunk.lines.map((ln, i) => {
              const changed = ln.tag === '+' || ln.tag === '-'
              const selected = changed && (sel[h]?.has(ln.selIdx) ?? false)
              const bg =
                ln.tag === '+' ? 'diff-add' : ln.tag === '-' ? 'diff-del' : ln.tag === '\\' ? 'diff-meta' : 'text-slate-200'
              const mark = ln.tag === '+' && ln.newNo !== undefined ? live?.get(ln.newNo) : undefined
              const was = ln.tag === '-' && ln.oldNo !== undefined ? headBlame?.get(ln.oldNo) : undefined
              return (
                <div
                  key={i}
                  onClick={() => changed && toggle(h, ln.selIdx)}
                  title={mark ? `${mark.name} - edited ${timeAgo(mark.at)} - not committed yet` : undefined}
                  className={`diff-line flex ${bg} ${changed ? 'cursor-pointer' : ''} ${
                    selected ? 'ring-1 ring-inset ring-accent/70' : ''
                  }`}
                >
                  {!!live?.size && (
                    <span className={`w-[3px] shrink-0 self-stretch ${mark ? mark.color.bg : ''}`} />
                  )}
                  {/* real file line numbers: old on the left, new on the right */}
                  <span className="w-9 shrink-0 select-none pr-1 text-right text-slate-500">{ln.oldNo ?? ''}</span>
                  <span className="w-9 shrink-0 select-none pr-2 text-right text-slate-200">{ln.newNo ?? ''}</span>
                  <span className="mr-2 inline-block w-3 shrink-0 select-none text-center text-[10px] text-slate-500">
                    {changed ? (selected ? 'x' : '+') : ''}
                  </span>
                  <span className="whitespace-pre">{ln.text === '' ? ' ' : ln.text}</span>
                  <span className="flex-1" />
                  {mark && (
                    <span className="flex shrink-0 select-none items-center gap-1.5 self-center pl-6 pr-3 text-[11px] italic">
                      <Avatar name={mark.name} bg={mark.color.bg} size={12} />
                      <span className={mark.color.text}>{mark.name}</span>
                      <span className="live-when">{timeAgo(mark.at)}</span>
                    </span>
                  )}
                  {was && (
                    <span
                      className="flex shrink-0 select-none items-center gap-1.5 self-center pl-6 pr-3 text-[11px] italic"
                      title={`${was.shortHash} - what this line said before this change`}
                    >
                      <Avatar name={was.author} bg={(authorColors.get(was.author) ?? ACTOR_COLORS[0]).bg} size={12} />
                      <span className="live-label">was</span>
                      <span className={(authorColors.get(was.author) ?? ACTOR_COLORS[0]).text}>{was.author}</span>
                      <span className="live-when">{was.date}</span>
                    </span>
                  )}
                </div>
              )
            })}
          </div>
        )
      })}
    </div>
  )
}
