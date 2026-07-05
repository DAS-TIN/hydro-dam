import React, { useMemo, useState } from 'react'
import { FileEntry, basename } from '../api'
import { IconChevronDown, IconChevronRight, IconFolder, IconFolderOpen } from './Icons'

interface TNode {
  name: string
  path: string
  children: Map<string, TNode>
  isFile: boolean
}

function build(paths: string[]): TNode {
  const root: TNode = { name: '', path: '', children: new Map(), isFile: false }
  for (const p of paths) {
    const parts = p.split('/')
    let node = root
    for (let i = 0; i < parts.length; i++) {
      const seg = parts[i]
      const isLeaf = i === parts.length - 1
      const path = node.path ? `${node.path}/${seg}` : seg
      if (!node.children.has(seg))
        node.children.set(seg, { name: seg, path, children: new Map(), isFile: isLeaf })
      node = node.children.get(seg)!
    }
  }
  return root
}

// name: the file name takes the status colour too, so a modified file reads
// yellow in the tree at a glance, not just its badge.
function fileBadge(f?: FileEntry): { letter: string; cls: string; title: string; name: string } {
  if (!f) return { letter: 'C', cls: 'bg-ink-750 text-slate-600', title: 'committed', name: 'text-slate-300' }
  if (f.conflicted) return { letter: '!', cls: 'bg-bad/20 text-bad', title: 'conflict', name: 'text-bad' }
  if (f.untracked) return { letter: 'U', cls: 'bg-info/20 text-info', title: 'untracked', name: 'text-info' }
  if (f.deleted) return { letter: 'D', cls: 'bg-bad/20 text-bad', title: 'deleted', name: 'text-bad' }
  if (f.renamed) return { letter: 'R', cls: 'bg-accent/20 text-accent', title: 'renamed', name: 'text-accent' }
  const code = (f.staged ? f.index : f.work).trim()
  if (code === 'A') return { letter: 'A', cls: 'bg-good/20 text-good', title: 'added', name: 'text-good' }
  return { letter: 'M', cls: 'bg-warn/20 text-warn', title: 'modified', name: 'text-warn' }
}

export default function RepoTree({
  paths,
  statusMap,
  selected,
  onSelect
}: {
  paths: string[]
  statusMap: Map<string, FileEntry>
  selected: string | null
  onSelect: (path: string) => void
}) {
  const root = useMemo(() => build(paths), [paths])
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set())

  const toggle = (path: string) =>
    setCollapsed((s) => {
      const n = new Set(s)
      n.has(path) ? n.delete(path) : n.add(path)
      return n
    })

  const render = (node: TNode, depth: number): React.ReactNode[] => {
    const kids = [...node.children.values()].sort((a, b) => {
      if (a.isFile !== b.isFile) return a.isFile ? 1 : -1 // folders first
      return a.name.localeCompare(b.name)
    })
    const out: React.ReactNode[] = []
    for (const k of kids) {
      const pad = 8 + depth * 14
      if (!k.isFile) {
        const open = !collapsed.has(k.path)
        out.push(
          <div
            key={k.path}
            onClick={() => toggle(k.path)}
            style={{ paddingLeft: pad }}
            className="flex cursor-pointer items-center gap-1 py-1 pr-2 text-[13px] text-slate-300 hover:bg-ink-850"
          >
            <span className="w-3 text-slate-600">{open ? <IconChevronDown className="w-3 h-3" /> : <IconChevronRight className="w-3 h-3" />}</span>
            <span className="text-slate-500">{open ? <IconFolderOpen className="w-3.5 h-3.5" /> : <IconFolder className="w-3.5 h-3.5" />}</span>
            <span className="truncate">{k.name}</span>
          </div>
        )
        if (open) out.push(...render(k, depth + 1))
      } else {
        const f = statusMap.get(k.path)
        const b = fileBadge(f)
        const isSel = selected === k.path
        out.push(
          <div
            key={k.path}
            onClick={() => onSelect(k.path)}
            style={{ paddingLeft: pad }}
            title={`${k.path}${f ? ` (${b.title})` : ''}`}
            className={`group flex cursor-pointer items-center gap-2 py-1 pr-2 text-[13px] transition-colors ${
              isSel ? 'bg-accent/15 ring-1 ring-inset ring-accent/40' : 'hover:bg-ink-800'
            }`}
          >
            <span className="w-3" />
            <span
              className={`flex h-4 w-4 shrink-0 items-center justify-center rounded text-[10px] font-bold ${b.cls}`}
              title={b.title}
            >
              {b.letter}
            </span>
            <span className={`truncate ${b.name}`}>{k.name}</span>
          </div>
        )
      }
    }
    return out
  }

  if (paths.length === 0) {
    return (
      <div className="flex h-full items-center justify-center text-sm text-slate-500">
        No files tracked yet.
      </div>
    )
  }

  return <div className="flex-1 overflow-auto py-1">{render(root, 0)}</div>
}
