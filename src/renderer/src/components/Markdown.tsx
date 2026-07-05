import React from 'react'
import { api } from '../api'
import { highlight } from '../highlight'

// Minimal markdown renderer: headings, lists, quotes, fenced code, tables,
// links, emphasis. Builds React nodes directly, so nothing is injected as HTML.

type Block =
  | { kind: 'heading'; level: number; text: string }
  | { kind: 'code'; lang: string; text: string }
  | { kind: 'quote'; lines: string[] }
  | { kind: 'list'; ordered: boolean; items: { depth: number; text: string }[] }
  | { kind: 'table'; header: string[]; rows: string[][] }
  | { kind: 'hr' }
  | { kind: 'p'; text: string }

const cells = (line: string) =>
  line
    .replace(/^\s*\|/, '')
    .replace(/\|\s*$/, '')
    .split('|')
    .map((c) => c.trim())

function parseBlocks(src: string): Block[] {
  const lines = src.replace(/\r\n/g, '\n').split('\n')
  const blocks: Block[] = []
  let i = 0

  while (i < lines.length) {
    const line = lines[i]

    if (!line.trim()) {
      i++
      continue
    }

    const fence = line.match(/^\s*```\s*(\S*)/)
    if (fence) {
      const body: string[] = []
      i++
      while (i < lines.length && !/^\s*```/.test(lines[i])) body.push(lines[i++])
      i++ // closing fence
      blocks.push({ kind: 'code', lang: fence[1], text: body.join('\n') })
      continue
    }

    const heading = line.match(/^(#{1,6})\s+(.*)/)
    if (heading) {
      blocks.push({ kind: 'heading', level: heading[1].length, text: heading[2] })
      i++
      continue
    }

    if (/^\s*([-*_])\s*(\1\s*){2,}$/.test(line)) {
      blocks.push({ kind: 'hr' })
      i++
      continue
    }

    if (/^\s*>/.test(line)) {
      const body: string[] = []
      while (i < lines.length && /^\s*>/.test(lines[i])) {
        body.push(lines[i].replace(/^\s*>\s?/, ''))
        i++
      }
      blocks.push({ kind: 'quote', lines: body })
      continue
    }

    const listItem = (l: string) => l.match(/^(\s*)([-*+]|\d+[.)])\s+(.*)/)
    const first = listItem(line)
    if (first) {
      const ordered = /\d/.test(first[2][0])
      const items: { depth: number; text: string }[] = []
      while (i < lines.length) {
        const m = listItem(lines[i])
        if (!m) break
        items.push({ depth: Math.min(3, Math.floor(m[1].length / 2)), text: m[3] })
        i++
      }
      blocks.push({ kind: 'list', ordered, items })
      continue
    }

    if (line.includes('|') && i + 1 < lines.length && /^\s*\|?[\s:|-]+\|[\s:|-]*$/.test(lines[i + 1])) {
      const header = cells(line)
      i += 2
      const rows: string[][] = []
      while (i < lines.length && lines[i].includes('|') && lines[i].trim()) {
        rows.push(cells(lines[i]))
        i++
      }
      blocks.push({ kind: 'table', header, rows })
      continue
    }

    const body: string[] = []
    while (i < lines.length && lines[i].trim() && !/^\s*(#{1,6}\s|```|>|([-*+]|\d+[.)])\s)/.test(lines[i])) {
      body.push(lines[i])
      i++
    }
    blocks.push({ kind: 'p', text: body.join(' ') })
  }

  return blocks
}

const INLINE =
  /(`[^`]+`)|(!\[[^\]]*\]\([^)]*\))|(\[[^\]]+\]\([^)]+\))|(\*\*[^*]+\*\*)|(__[^_]+__)|(~~[^~]+~~)|(\*[^*\s][^*]*\*)|(\bhttps?:\/\/[^\s<>()]+)/g

function openLink(url: string) {
  api().openExternal(url).catch(() => {})
}

function Link({ url, children }: { url: string; children: React.ReactNode }) {
  return (
    <a
      href={url}
      title={url}
      className="cursor-pointer text-accent hover:underline"
      onClick={(e) => {
        e.preventDefault()
        openLink(url)
      }}
    >
      {children}
    </a>
  )
}

function inline(text: string): React.ReactNode[] {
  const out: React.ReactNode[] = []
  let last = 0
  let key = 0
  for (const m of text.matchAll(INLINE)) {
    const idx = m.index ?? 0
    if (idx > last) out.push(text.slice(last, idx))
    const s = m[0]
    if (m[1]) {
      out.push(
        <code key={key++} className="rounded bg-ink-800 px-1 py-px font-mono text-[0.85em] text-slate-200">
          {s.slice(1, -1)}
        </code>
      )
    } else if (m[2]) {
      const alt = s.match(/^!\[([^\]]*)\]/)![1]
      out.push(<em key={key++} className="text-slate-500">[image: {alt || 'untitled'}]</em>)
    } else if (m[3]) {
      const [, label, url] = s.match(/^\[([^\]]+)\]\(([^)]+)\)$/)!
      out.push(
        <Link key={key++} url={url}>
          {inline(label)}
        </Link>
      )
    } else if (m[4] || m[5]) {
      out.push(<strong key={key++}>{inline(s.slice(2, -2))}</strong>)
    } else if (m[6]) {
      out.push(<del key={key++} className="text-slate-500">{inline(s.slice(2, -2))}</del>)
    } else if (m[7]) {
      out.push(<em key={key++}>{inline(s.slice(1, -1))}</em>)
    } else {
      out.push(
        <Link key={key++} url={s}>
          {s}
        </Link>
      )
    }
    last = idx + s.length
  }
  if (last < text.length) out.push(text.slice(last))
  return out
}

function CodeBlock({ lang, text }: { lang: string; text: string }) {
  const lines = highlight(text, lang)
  return (
    <pre className="my-3 overflow-x-auto rounded-lg border border-ink-800 bg-ink-950 p-3 font-mono text-[12.5px] leading-[1.55]">
      {lines.map((toks, i) => (
        <div key={i}>
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
        </div>
      ))}
    </pre>
  )
}

const HEADING_CLS = [
  'mt-6 mb-3 border-b border-ink-800 pb-2 text-2xl font-bold text-white',
  'mt-6 mb-2.5 text-xl font-semibold text-white',
  'mt-5 mb-2 text-lg font-semibold text-slate-100',
  'mt-4 mb-1.5 text-base font-semibold text-slate-100',
  'mt-4 mb-1.5 text-sm font-semibold text-slate-200',
  'mt-4 mb-1.5 text-sm font-semibold text-slate-400'
]

export default function Markdown({ text }: { text: string }) {
  const blocks = parseBlocks(text)
  return (
    <div className="w-full px-8 py-6 text-[14.5px] leading-relaxed text-slate-300 select-text">
      {blocks.map((b, i) => {
        switch (b.kind) {
          case 'heading': {
            const Tag = `h${b.level}` as 'h1' | 'h2' | 'h3' | 'h4' | 'h5' | 'h6'
            return (
              <Tag key={i} className={HEADING_CLS[b.level - 1]}>
                {inline(b.text)}
              </Tag>
            )
          }
          case 'code':
            return <CodeBlock key={i} lang={b.lang} text={b.text} />
          case 'quote':
            return (
              <blockquote key={i} className="my-3 border-l-2 border-accent/50 pl-4 text-slate-400">
                {b.lines.map((l, j) => (
                  <div key={j}>{l.trim() ? inline(l) : <br />}</div>
                ))}
              </blockquote>
            )
          case 'list':
            return (
              <ul key={i} className={`my-3 space-y-1 ${b.ordered ? 'list-decimal' : 'list-disc'} pl-6`}>
                {b.items.map((it, j) => (
                  <li key={j} style={{ marginLeft: it.depth * 20 }}>
                    {inline(it.text)}
                  </li>
                ))}
              </ul>
            )
          case 'table':
            return (
              <table key={i} className="my-3 border-collapse text-sm">
                <thead>
                  <tr>
                    {b.header.map((h, j) => (
                      <th key={j} className="border border-ink-700 bg-ink-850 px-3 py-1.5 text-left font-semibold text-slate-200">
                        {inline(h)}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {b.rows.map((r, j) => (
                    <tr key={j}>
                      {r.map((c, k) => (
                        <td key={k} className="border border-ink-800 px-3 py-1.5">
                          {inline(c)}
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            )
          case 'hr':
            return <hr key={i} className="my-5 border-ink-800" />
          case 'p':
            return (
              <p key={i} className="my-2.5">
                {inline(b.text)}
              </p>
            )
        }
      })}
    </div>
  )
}
