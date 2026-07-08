import React, { useEffect, useMemo, useRef, useState } from 'react'
import { FileEntry, NumstatEntry, RepoStatus, WorkingNumstat, basename, dirname } from '../api'
import { CollabMark } from '../rtc'
import { IconBlocked, IconCheck, IconChevronDown, IconChevronRight, IconArrowLeft } from './Icons'

interface Props {
  status: RepoStatus
  stats: WorkingNumstat | null
  hidden: string[]
  selected: string | null
  treeView: boolean
  showIgnored: boolean
  // per-file live-collab marks (who is on it, locks); absent outside a session
  collab?: Map<string, CollabMark>
  onSelect: (f: FileEntry, staged: boolean) => void
  onStage: (paths: string[]) => void
  onUnstage: (paths: string[]) => void
  onDiscard: (f: FileEntry) => void
  onUntrack: (path: string) => void
  onHide: (path: string, hidden: boolean) => void
  onHistory: (path: string) => void
}

/** Coloured presence dots + a lock glyph for one row of the changes list. */
function CollabBadges({ mark }: { mark?: CollabMark }) {
  if (!mark || (!mark.actors.length && !mark.lock)) return null
  const lockTitle = mark.lock
    ? `${mark.lock.hard ? 'Hard-locked' : 'Locked'} by ${mark.lock.byName}${mark.lock.reason ? `: ${mark.lock.reason}` : ''}${
        mark.lock.mine ? ' (you hold this lock)' : ' - treat as read-only'
      }`
    : ''
  return (
    <span className="flex shrink-0 items-center gap-1">
      {mark.actors.slice(0, 3).map((a) => (
        <span
          key={a.id}
          title={`${a.name} is on this file${a.line !== undefined ? ` (line ${a.line})` : ''}`}
          className={`h-2 w-2 rounded-full ${a.bg}`}
        />
      ))}
      {mark.actors.length > 3 && <span className="text-[10px] text-slate-500">+{mark.actors.length - 3}</span>}
      {mark.lock && (
        <svg
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth={mark.lock.hard ? 2.6 : 1.8}
          className={`h-3.5 w-3.5 ${mark.lock.mine ? 'text-amber-300' : 'text-bad'}`}
        >
          <title>{lockTitle}</title>
          <rect x="5" y="11" width="14" height="9" rx="2" />
          <path d="M8 11V7a4 4 0 0 1 8 0v4" />
        </svg>
      )}
    </span>
  )
}

function badge(f: FileEntry): { letter: string; cls: string; label: string } {
  if (f.conflicted) return { letter: '!', cls: 'bg-bad/20 text-bad', label: 'conflict' }
  if (f.untracked) return { letter: 'U', cls: 'bg-info/20 text-info', label: 'untracked' }
  if (f.deleted) return { letter: 'D', cls: 'bg-bad/20 text-bad', label: 'deleted' }
  if (f.renamed) return { letter: 'R', cls: 'bg-accent/20 text-accent', label: 'renamed' }
  const code = (f.staged ? f.index : f.work).trim()
  if (code === 'A') return { letter: 'A', cls: 'bg-good/20 text-good', label: 'added' }
  return { letter: 'M', cls: 'bg-warn/20 text-warn', label: 'modified' }
}

/** Right-aligned "+12 -3" line counts; swaps out for the hover actions. */
function LineStat({ stat }: { stat?: NumstatEntry }) {
  if (!stat || (stat.add === 0 && stat.del === 0)) return null
  return (
    <span className="shrink-0 font-mono text-[11px] group-hover:hidden">
      {stat.add < 0 ? (
        <span className="text-slate-500">bin</span>
      ) : (
        <>
          <span className="text-good">+{stat.add}</span>
          <span className="ml-1.5 text-bad">-{stat.del}</span>
        </>
      )}
    </span>
  )
}

function Row({
  f,
  selected,
  onSelect,
  primaryLabel,
  primaryTitle,
  onPrimary,
  indent = 0,
  hideDir = false,
  stat,
  mark,
  children
}: {
  f: FileEntry
  selected: boolean
  onSelect: () => void
  primaryLabel?: string
  primaryTitle?: string
  onPrimary?: () => void
  indent?: number
  hideDir?: boolean
  stat?: NumstatEntry
  mark?: CollabMark
  children?: React.ReactNode
}) {
  const b = badge(f)
  const dir = dirname(f.path)
  return (
    <div
      onClick={onSelect}
      data-selected={selected || undefined}
      style={{ paddingLeft: 12 + indent * 14 }}
      title={`${f.path} (${b.label})`}
      className={`group flex cursor-pointer items-center gap-2 py-1.5 pr-3 text-sm transition-colors ${
        selected ? 'bg-accent/15 ring-1 ring-inset ring-accent/40' : 'hover:bg-ink-800'
      }`}
    >
      <span
        className={`flex h-5 w-5 shrink-0 items-center justify-center rounded text-[11px] font-bold ${b.cls}`}
        title={b.label}
      >
        {b.letter}
      </span>
      <span className="min-w-0 flex-1 truncate">
        <span className="text-slate-100">{basename(f.path)}</span>
        {!hideDir && dir && <span className="ml-1.5 text-[11px] text-slate-500">{dir}</span>}
        {f.orig && <span className="ml-1.5 inline-flex items-center gap-0.5 text-[11px] text-slate-500"><IconArrowLeft className="w-2.5 h-2.5" />{f.orig}</span>}
      </span>
      <CollabBadges mark={mark} />
      <LineStat stat={stat} />
      <span className="hidden items-center gap-1 group-hover:flex">
        {children}
        {onPrimary && (
          <button
            onClick={(e) => {
              e.stopPropagation()
              onPrimary()
            }}
            className="rounded px-1.5 py-0.5 text-[11px] font-semibold text-accent hover:bg-accent/15"
            title={primaryTitle ?? primaryLabel}
          >
            {primaryLabel}
          </button>
        )}
      </span>
    </div>
  )
}

interface TNode {
  name: string
  path: string
  children: Map<string, TNode>
  file?: FileEntry
}

function buildTree(files: FileEntry[]): TNode {
  const root: TNode = { name: '', path: '', children: new Map() }
  for (const f of files) {
    const parts = f.path.split('/')
    let node = root
    for (let i = 0; i < parts.length; i++) {
      const isLeaf = i === parts.length - 1
      const seg = parts[i]
      const path = node.path ? `${node.path}/${seg}` : seg
      if (!node.children.has(seg)) node.children.set(seg, { name: seg, path, children: new Map() })
      node = node.children.get(seg)!
      if (isLeaf) node.file = f
    }
  }
  return root
}

function Tree({
  files,
  leaf
}: {
  files: FileEntry[]
  leaf: (f: FileEntry, depth: number) => React.ReactNode
}) {
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set())
  const root = buildTree(files)

  const render = (node: TNode, depth: number): React.ReactNode[] => {
    const kids = [...node.children.values()].sort((a, b) => {
      const af = a.file ? 1 : 0
      const bf = b.file ? 1 : 0
      if (af !== bf) return af - bf // folders first
      return a.name.localeCompare(b.name)
    })
    const out: React.ReactNode[] = []
    for (const k of kids) {
      if (k.file && k.children.size === 0) {
        out.push(<React.Fragment key={k.path}>{leaf(k.file, depth)}</React.Fragment>)
      } else {
        const isOpen = !collapsed.has(k.path)
        out.push(
          <div
            key={k.path}
            onClick={() =>
              setCollapsed((s) => {
                const n = new Set(s)
                n.has(k.path) ? n.delete(k.path) : n.add(k.path)
                return n
              })
            }
            style={{ paddingLeft: 12 + depth * 14 }}
            className="flex cursor-pointer items-center gap-1 py-1 pr-3 text-[13px] text-slate-400 hover:bg-ink-850"
          >
            <span className="w-3 text-slate-600">{isOpen ? <IconChevronDown className="w-3 h-3" /> : <IconChevronRight className="w-3 h-3" />}</span>
            <span className="text-slate-300">{k.name}</span>
          </div>
        )
        if (isOpen) out.push(...render(k, depth + 1))
      }
    }
    return out
  }

  return <>{render(root, 0)}</>
}

function Section({
  title,
  count,
  accent,
  stat,
  action,
  children
}: {
  title: string
  count: number
  accent?: string
  stat?: { add: number; del: number }
  action?: React.ReactNode
  children: React.ReactNode
}) {
  if (count === 0) return null
  return (
    <div className="mb-1">
      <div className="sticky top-0 z-10 flex items-center justify-between bg-ink-900/95 px-3 py-1.5 backdrop-blur">
        <span className="flex items-center gap-2 text-[11px] font-semibold uppercase tracking-wide text-slate-400">
          <span className={`h-1.5 w-1.5 rounded-full ${accent ?? 'bg-slate-500'}`} />
          {title}
          <span className="text-slate-600">{count}</span>
          {stat && (stat.add > 0 || stat.del > 0) && (
            <span className="font-mono text-[10px] normal-case tracking-normal">
              <span className="text-good/80">+{stat.add}</span>{' '}
              <span className="text-bad/80">-{stat.del}</span>
            </span>
          )}
        </span>
        {action}
      </div>
      {children}
    </div>
  )
}

export default function FileList(props: Props) {
  const { status, stats, hidden, selected, treeView, showIgnored } = props
  const tracked = status.files.filter((f) => !f.ignored)

  // Keep the row visible when selection moves by keyboard.
  const boxRef = useRef<HTMLDivElement>(null)
  useEffect(() => {
    boxRef.current?.querySelector('[data-selected]')?.scrollIntoView({ block: 'nearest' })
  }, [selected])

  const stagedStats = useMemo(
    () => new Map((stats?.staged ?? []).map((e) => [e.path, e])),
    [stats]
  )
  const unstagedStats = useMemo(
    () => new Map((stats?.unstaged ?? []).map((e) => [e.path, e])),
    [stats]
  )

  const totals = (files: FileEntry[], m: Map<string, NumstatEntry>) => {
    let add = 0
    let del = 0
    for (const f of files) {
      const s = m.get(f.path)
      if (!s) continue
      if (s.add > 0) add += s.add
      if (s.del > 0) del += s.del
    }
    return { add, del }
  }

  const staged = tracked.filter((f) => f.staged && !f.conflicted)
  const conflicts = tracked.filter((f) => f.conflicted)
  const changed = tracked.filter((f) => f.unstaged && !f.conflicted)
  const untracked = tracked.filter((f) => f.untracked)
  const ignored = status.files.filter((f) => f.ignored)

  const SmallBtn = (p: { label: string; onClick: () => void; danger?: boolean; title?: string }) => (
    <button
      title={p.title}
      onClick={(e) => {
        e.stopPropagation()
        p.onClick()
      }}
      className={`rounded px-1.5 py-0.5 text-[11px] font-semibold ${
        p.danger ? 'text-bad hover:bg-bad/15' : 'text-slate-400 hover:bg-ink-700 hover:text-white'
      }`}
    >
      {p.label}
    </button>
  )

  const body = (files: FileEntry[], leaf: (f: FileEntry, depth: number) => React.ReactNode) =>
    treeView ? <Tree files={files} leaf={leaf} /> : <>{files.map((f) => leaf(f, 0))}</>

  const conflictLeaf = (f: FileEntry, depth: number) => (
    <Row
      key={'c' + f.path}
      f={f}
      mark={props.collab?.get(f.path)}
      selected={selected === f.path}
      indent={depth}
      hideDir={treeView}
      onSelect={() => props.onSelect(f, false)}
      primaryLabel="resolve"
      primaryTitle={`Mark "${basename(f.path)}" resolved and stage it (git add)`}
      onPrimary={() => props.onStage([f.path])}
    />
  )

  const stagedLeaf = (f: FileEntry, depth: number) => (
    <Row
      key={'s' + f.path}
      f={f}
      mark={props.collab?.get(f.path)}
      selected={selected === f.path + ':staged'}
      indent={depth}
      hideDir={treeView}
      stat={stagedStats.get(f.path)}
      onSelect={() => props.onSelect(f, true)}
      primaryLabel="unstage"
      primaryTitle={`Unstage "${basename(f.path)}" - remove it from the next commit but keep your changes (git restore --staged)`}
      onPrimary={() => props.onUnstage([f.path])}
    >
      <SmallBtn
        label="history"
        title={`Browse past versions of "${basename(f.path)}"`}
        onClick={() => props.onHistory(f.path)}
      />
    </Row>
  )

  const changedLeaf = (f: FileEntry, depth: number) => (
    <Row
      key={'u' + f.path}
      f={f}
      mark={props.collab?.get(f.path)}
      selected={selected === f.path}
      indent={depth}
      hideDir={treeView}
      stat={unstagedStats.get(f.path)}
      onSelect={() => props.onSelect(f, false)}
      primaryLabel="stage"
      primaryTitle={`Stage "${basename(f.path)}" - include its changes in the next commit (git add)`}
      onPrimary={() => props.onStage([f.path])}
    >
      <SmallBtn
        label="history"
        title={`Browse past versions of "${basename(f.path)}"`}
        onClick={() => props.onHistory(f.path)}
      />
      <SmallBtn
        label="hide"
        title={`Hide "${basename(f.path)}" from commits - git stops noticing local edits (assume-unchanged). Reversible.`}
        onClick={() => props.onHide(f.path, true)}
      />
      <SmallBtn
        label="untrack"
        title={`Stop tracking "${basename(f.path)}" but keep the file on disk (git rm --cached). It becomes untracked.`}
        onClick={() => props.onUntrack(f.path)}
      />
      <SmallBtn
        label="discard"
        danger
        title={`Discard changes - revert "${basename(f.path)}" to the last commit. This cannot be undone (git restore).`}
        onClick={() => props.onDiscard(f)}
      />
    </Row>
  )

  const untrackedLeaf = (f: FileEntry, depth: number) => (
    <Row
      key={'n' + f.path}
      f={f}
      mark={props.collab?.get(f.path)}
      selected={selected === f.path}
      indent={depth}
      hideDir={treeView}
      onSelect={() => props.onSelect(f, false)}
      primaryLabel="stage"
      primaryTitle={`Start tracking & stage "${basename(f.path)}" for the next commit (git add)`}
      onPrimary={() => props.onStage([f.path])}
    >
      <SmallBtn
        label="delete"
        danger
        title={`Delete "${basename(f.path)}" from disk. It's untracked, so this is permanent (git clean).`}
        onClick={() => props.onDiscard(f)}
      />
    </Row>
  )

  return (
    <div ref={boxRef} className="flex-1 overflow-auto">
      <Section title="Conflicts" count={conflicts.length} accent="bg-bad">
        {body(conflicts, conflictLeaf)}
      </Section>

      <Section
        title="Staged"
        count={staged.length}
        accent="bg-good"
        stat={totals(staged, stagedStats)}
        action={
          staged.length > 0 ? (
            <SmallBtn
              label="Unstage all"
              title="Remove every file from the next commit (keeps your changes)"
              onClick={() => props.onUnstage(staged.map((f) => f.path))}
            />
          ) : null
        }
      >
        {body(staged, stagedLeaf)}
      </Section>

      <Section
        title="Changes"
        count={changed.length}
        accent="bg-warn"
        stat={totals(changed, unstagedStats)}
        action={
          changed.length > 0 ? (
            <SmallBtn
              label="Stage all"
              title="Stage every changed file for the next commit (git add)"
              onClick={() => props.onStage(changed.map((f) => f.path))}
            />
          ) : null
        }
      >
        {body(changed, changedLeaf)}
      </Section>

      <Section
        title="Untracked"
        count={untracked.length}
        accent="bg-info"
        action={
          untracked.length > 0 ? (
            <SmallBtn
              label="Stage all"
              title="Start tracking & stage all new files for the next commit (git add)"
              onClick={() => props.onStage(untracked.map((f) => f.path))}
            />
          ) : null
        }
      >
        {body(untracked, untrackedLeaf)}
      </Section>

      <Section title="Hidden from commits" count={hidden.length} accent="bg-slate-500">
        {hidden.map((p) => (
          <div
            key={'h' + p}
            className="group flex items-center gap-2 px-3 py-1.5 text-sm hover:bg-ink-800"
          >
            <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded bg-slate-600/30 text-slate-400">
              <IconBlocked className="w-3 h-3" />
            </span>
            <span className="min-w-0 flex-1 truncate text-slate-400">
              {basename(p)}
              <span className="ml-1.5 text-[11px] text-slate-600">{dirname(p)}</span>
            </span>
            <button
              onClick={() => props.onHide(p, false)}
              className="rounded px-1.5 py-0.5 text-[11px] font-semibold text-accent opacity-0 hover:bg-accent/15 group-hover:opacity-100"
            >
              unhide
            </button>
          </div>
        ))}
      </Section>

      {showIgnored && (
        <Section title="Ignored" count={ignored.length} accent="bg-ink-600">
          {ignored.map((f) => (
            <div
              key={'i' + f.path}
              className="flex items-center gap-2 px-3 py-1.5 text-sm text-slate-600"
            >
              <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded bg-ink-700 text-[11px]">
                I
              </span>
              <span className="min-w-0 flex-1 truncate">
                {basename(f.path)}
                <span className="ml-1.5 text-[11px] text-slate-700">{dirname(f.path)}</span>
              </span>
            </div>
          ))}
        </Section>
      )}

      {status.clean && (
        <div className="flex flex-col items-center justify-center gap-1 py-16 text-center">
          <IconCheck className="w-8 h-8 text-good" />
          <div className="text-sm text-slate-400">Working tree clean</div>
          <div className="text-xs text-slate-600">Nothing to commit.</div>
        </div>
      )}
    </div>
  )
}
