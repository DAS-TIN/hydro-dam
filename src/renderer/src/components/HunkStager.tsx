import React, { useEffect, useMemo, useState } from 'react'
import { api } from '../api'

interface Hunk {
  header: string
  // body lines paired with their selectable index (-1 for context/meta)
  lines: { text: string; tag: ' ' | '+' | '-' | '\\'; selIdx: number }[]
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
  for (let i = first; i < all.length; i++) {
    const l = all[i]
    if (l.startsWith('@@')) {
      if (cur) hunks.push(cur)
      cur = { header: l, lines: [] }
      selIdx = -1
      continue
    }
    if (!cur) continue
    const c = l[0]
    if (c === '+' || c === '-' || c === ' ') {
      selIdx++
      cur.lines.push({ text: l, tag: c as ' ' | '+' | '-', selIdx })
    } else if (c === '\\') {
      cur.lines.push({ text: l, tag: '\\', selIdx: -1 })
    }
  }
  if (cur) hunks.push(cur)
  return { fileHeader, hunks }
}

export default function HunkStager({
  cwd,
  path,
  staged,
  text,
  toast,
  onChanged
}: {
  cwd: string
  path: string
  staged: boolean
  text: string
  toast: (kind: 'ok' | 'err' | 'info', text: string) => void
  onChanged: () => void
}) {
  const { hunks } = useMemo(() => parse(text), [text])
  // selected changed-line indices, per hunk
  const [sel, setSel] = useState<Record<number, Set<number>>>({})
  const [busy, setBusy] = useState(false)

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
        return (
          <div key={h} className="border-b border-ink-800">
            <div className="sticky top-0 z-10 flex items-center gap-2 bg-ink-850 px-3 py-1">
              <span className="flex-1 truncate text-[11px] text-accent">{hunk.header}</span>
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
                ln.tag === '+' ? 'diff-add' : ln.tag === '-' ? 'diff-del' : ln.tag === '\\' ? 'diff-meta' : 'text-slate-300'
              return (
                <div
                  key={i}
                  onClick={() => changed && toggle(h, ln.selIdx)}
                  className={`diff-line flex ${bg} ${changed ? 'cursor-pointer' : ''} ${
                    selected ? 'ring-1 ring-inset ring-accent/70' : ''
                  }`}
                >
                  <span className="mr-2 inline-block w-3 shrink-0 select-none text-center text-[10px] text-slate-500">
                    {changed ? (selected ? 'x' : '+') : ''}
                  </span>
                  <span className="whitespace-pre">{ln.text === '' ? ' ' : ln.text}</span>
                </div>
              )
            })}
          </div>
        )
      })}
    </div>
  )
}
