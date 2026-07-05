import React, { useMemo, useState } from 'react'

type Kind = 'meta' | 'hunk' | 'context' | 'del' | 'add'

interface Line {
  kind: Kind
  text: string
  // Per-token highlight flags for intra-line (word-level) changes, when paired.
  tokens?: string[]
  changed?: boolean[]
}

function kindOf(line: string): Kind {
  if (line.startsWith('@@')) return 'hunk'
  if (line.startsWith('+++') || line.startsWith('---')) return 'meta'
  if (
    line.startsWith('diff ') ||
    line.startsWith('index ') ||
    line.startsWith('new file') ||
    line.startsWith('deleted file') ||
    line.startsWith('rename ') ||
    line.startsWith('similarity') ||
    line.startsWith('old mode') ||
    line.startsWith('new mode')
  )
    return 'meta'
  if (line.startsWith('+')) return 'add'
  if (line.startsWith('-')) return 'del'
  return 'context'
}

function tokenize(s: string): string[] {
  return s.match(/\s+|[A-Za-z0-9_]+|[^\sA-Za-z0-9_]/g) ?? []
}

// LCS over word tokens; returns which tokens are "changed" on each side.
function wordDiff(a: string[], b: string[]): { a: boolean[]; b: boolean[] } {
  const n = a.length
  const m = b.length
  const aChanged = new Array(n).fill(true)
  const bChanged = new Array(m).fill(true)
  if (n * m > 6000 || n === 0 || m === 0) return { a: aChanged, b: bChanged } // too big: line-level only
  const dp: number[][] = Array.from({ length: n + 1 }, () => new Array(m + 1).fill(0))
  for (let i = n - 1; i >= 0; i--)
    for (let j = m - 1; j >= 0; j--)
      dp[i][j] = a[i] === b[j] ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1])
  let i = 0
  let j = 0
  while (i < n && j < m) {
    if (a[i] === b[j]) {
      aChanged[i] = false
      bChanged[j] = false
      i++
      j++
    } else if (dp[i + 1][j] >= dp[i][j + 1]) i++
    else j++
  }
  return { a: aChanged, b: bChanged }
}

// Parse a unified-diff (or git show) blob into lines, pairing del/add runs for
// word-level highlighting.
function parse(text: string): Line[] {
  const raw = text.split('\n')
  const lines: Line[] = raw.map((t) => ({ kind: kindOf(t), text: t }))
  // Pair consecutive del-run with the following add-run for intra-line diffs.
  let i = 0
  while (i < lines.length) {
    if (lines[i].kind === 'del') {
      let d = i
      while (d < lines.length && lines[d].kind === 'del') d++
      let a = d
      while (a < lines.length && lines[a].kind === 'add') a++
      const dels = lines.slice(i, d)
      const adds = lines.slice(d, a)
      const pairs = Math.min(dels.length, adds.length)
      for (let k = 0; k < pairs; k++) {
        const dl = dels[k]
        const al = adds[k]
        const dt = tokenize(dl.text.slice(1))
        const at = tokenize(al.text.slice(1))
        const { a: dc, b: ac } = wordDiff(dt, at)
        dl.tokens = dt
        dl.changed = dc
        al.tokens = at
        al.changed = ac
      }
      i = a
    } else i++
  }
  return lines
}

const lineClass: Record<Kind, string> = {
  meta: 'diff-line diff-meta',
  hunk: 'diff-line diff-hunk',
  context: 'diff-line text-slate-300',
  del: 'diff-line diff-del',
  add: 'diff-line diff-add'
}

// Render a line's text with the leading +/- sign and word-level highlights.
function highlighted(line: Line, side: 'del' | 'add'): React.ReactNode {
  if (!line.tokens || !line.changed) return line.text === '' ? ' ' : line.text
  const sign = line.text[0]
  const hi = side === 'del' ? 'bg-bad/40 text-red-100 rounded-[2px]' : 'bg-good/40 text-green-100 rounded-[2px]'
  return (
    <>
      {sign}
      {line.tokens.map((t, i) => (line.changed![i] ? <span key={i} className={hi}>{t}</span> : <span key={i}>{t}</span>))}
    </>
  )
}

function Unified({ lines }: { lines: Line[] }) {
  return (
    <>
      {lines.map((l, i) => (
        <div key={i} className={lineClass[l.kind]}>
          {l.kind === 'del' || l.kind === 'add' ? highlighted(l, l.kind) : l.text === '' ? ' ' : l.text}
        </div>
      ))}
    </>
  )
}

//Side-by-side rows. Context/meta/hunk span both columns; del/add runs pair up.
// Cells wrap long lines (instead of the pre default) so one column can never
// paint over the other.
function Split({ lines }: { lines: Line[] }) {
  const rows: React.ReactNode[] = []
  let i = 0
  const cell = (l: Line | null, side: 'del' | 'add') => {
    if (!l) return <div className="diff-line min-h-[1.55em] bg-ink-900/40" />
    return (
      <div className={`${lineClass[l.kind]} min-w-0 !whitespace-pre-wrap break-words`}>
        {highlighted(l, side)}
      </div>
    )
  }
  while (i < lines.length) {
    const l = lines[i]
    if (l.kind === 'del') {
      let d = i
      while (d < lines.length && lines[d].kind === 'del') d++
      let a = d
      while (a < lines.length && lines[a].kind === 'add') a++
      const dels = lines.slice(i, d)
      const adds = lines.slice(d, a)
      const rowsN = Math.max(dels.length, adds.length)
      for (let k = 0; k < rowsN; k++) {
        rows.push(
          <div key={`${i}-${k}`} className="grid grid-cols-2">
            {cell(dels[k] ?? null, 'del')}
            {cell(adds[k] ?? null, 'add')}
          </div>
        )
      }
      i = a
    } else {
      //Context / meta / hunk: full width across both columns
      rows.push(
        <div key={i} className="grid grid-cols-2">
          <div className={`${lineClass[l.kind]} col-span-2 min-w-0 !whitespace-pre-wrap break-words`}>
            {l.text === '' ? ' ' : l.text}
          </div>
        </div>
      )
      i++
    }
  }
  return <>{rows}</>
}

export default function DiffView({ text, empty }: { text: string; empty?: string }) {
  const [mode, setMode] = useState<'unified' | 'split'>('unified')
  const lines = useMemo(() => (text ? parse(text) : []), [text])

  if (!text || !text.trim()) {
    return (
      <div className="flex h-full items-center justify-center text-sm text-slate-500">
        {empty ?? 'No changes to display.'}
      </div>
    )
  }

  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center justify-end gap-1 border-b border-ink-800 bg-ink-900 px-2 py-1">
        <div className="flex gap-0.5 rounded-md bg-ink-950 p-0.5">
          {(['unified', 'split'] as const).map((m) => (
            <button
              key={m}
              onClick={() => setMode(m)}
              className={`rounded px-2 py-0.5 text-[11px] font-medium ${
                mode === m ? 'bg-ink-750 text-white' : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              {m === 'unified' ? 'Unified' : 'Split'}
            </button>
          ))}
        </div>
      </div>
      <div className="min-h-0 flex-1 overflow-auto bg-ink-900 py-2 font-mono text-[12.5px] leading-[1.55] select-text">
        {mode === 'unified' ? <Unified lines={lines} /> : <Split lines={lines} />}
      </div>
    </div>
  )
}
