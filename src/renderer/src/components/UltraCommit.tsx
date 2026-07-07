import React, { useEffect, useRef, useState } from 'react'
import { api, Coauthor, GraphCommit, Identity, RepoStatus, basename } from '../api'
import { moveFocusWithin } from '../shortcuts'
import DiffView from './DiffView'
import { IconArrowDown, IconArrowUp } from './Icons'

type Zone = 'compose' | 'history' | 'details'

/**
 * Full-window commit center. Arrows pick one of the three zones (message,
 * history, details), Enter steps into it, Esc steps back out. Compose sits
 * on the left, history stacked over details on the right.
 */
export default function UltraCommit({
  cwd,
  status,
  identity,
  coauthors,
  message,
  setMessage,
  amend,
  setAmend,
  busy,
  stagedCount,
  stagedAdd,
  stagedDel,
  onCommit,
  onPreview,
  onFetch,
  onPull,
  onPush,
  onCoauthors,
  onIdentity
}: {
  cwd: string
  status: RepoStatus | null
  identity: Identity | null
  coauthors: Coauthor[]
  message: string
  setMessage: (v: string) => void
  amend: boolean
  setAmend: (v: boolean) => void
  busy: boolean
  stagedCount: number
  stagedAdd: number
  stagedDel: number
  onCommit: (push: boolean) => void
  onPreview: () => void
  onFetch: () => void
  onPull: () => void
  onPush: () => void
  onCoauthors: () => void
  onIdentity: () => void
}) {
  const [commits, setCommits] = useState<GraphCommit[]>([])
  const [selHash, setSelHash] = useState<string | null>(null)
  const [diff, setDiff] = useState('')
  // arrows pick a zone, Enter steps in, Esc steps back out
  const [zone, setZone] = useState<Zone>('compose')
  const [entered, setEntered] = useState(false)

  const rootRef = useRef<HTMLDivElement>(null)
  const composeRef = useRef<HTMLDivElement>(null)
  const historyRef = useRef<HTMLDivElement>(null)
  const detailsRef = useRef<HTMLDivElement>(null)
  const taRef = useRef<HTMLTextAreaElement>(null)

  useEffect(() => {
    rootRef.current?.focus()
  }, [])

  useEffect(() => {
    api()
      .logGraph(cwd, { limit: 25 })
      .then((c) => {
        setCommits(c)
        if (c[0]) setSelHash(c[0].hash)
      })
      .catch(() => setCommits([]))
  }, [cwd])

  useEffect(() => {
    if (!selHash) return
    setDiff('')
    api()
      .commitShow(cwd, selHash)
      .then(setDiff)
      .catch((e) => setDiff(e.message))
  }, [cwd, selHash])

  // scroll the selected row into view
  useEffect(() => {
    historyRef.current?.querySelector('[data-selected]')?.scrollIntoView({ block: 'nearest' })
  }, [selHash])

  const moveHistory = (dir: 1 | -1) => {
    if (commits.length === 0) return
    const at = commits.findIndex((c) => c.hash === selHash)
    const next = commits[Math.min(Math.max(at + dir, 0), commits.length - 1)]
    if (next) setSelHash(next.hash)
  }

  const stepOut = () => {
    setEntered(false)
    rootRef.current?.focus()
  }

  const enterZone = () => {
    setEntered(true)
    if (zone === 'compose') taRef.current?.focus()
  }

  const onKey = (e: React.KeyboardEvent) => {
    if (e.shiftKey) return // Shift+arrows switch ultra views at the app level
    const t = e.target as HTMLElement
    const typing = t.tagName === 'TEXTAREA'

    if (e.key === 'Escape') {
      // First Esc: out of the zone back to picking; only the next one, at
      // picking level, bubbles up and leaves ultra.
      if (typing || entered) {
        e.stopPropagation()
        if (typing) t.blur()
        stepOut()
      }
      return
    }

    if (typing) {
      // Inside the message, arrows at the text edges move on to the other
      // compose controls; everything else is normal typing.
      const ta = t as HTMLTextAreaElement
      const down = e.key === 'ArrowDown' && ta.selectionEnd === ta.value.length
      const up = e.key === 'ArrowUp' && ta.selectionStart === 0
      if (!down && !up) return
      e.preventDefault()
      e.stopPropagation()
      moveFocusWithin(composeRef.current, down ? 1 : -1, { wrap: true })
      return
    }

    if (e.key === 'Enter') {
      if (!entered) {
        e.preventDefault()
        e.stopPropagation()
        enterZone()
      }
      // entered: Enter presses the focused control natively
      return
    }

    if (!['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(e.key)) return
    e.preventDefault()
    e.stopPropagation()

    if (!entered) {
      // zone picking, laid out: compose | (history over details)
      if (zone === 'compose' && e.key === 'ArrowRight') setZone('history')
      else if (zone === 'history' && e.key === 'ArrowLeft') setZone('compose')
      else if (zone === 'history' && e.key === 'ArrowDown') setZone('details')
      else if (zone === 'details' && e.key === 'ArrowLeft') setZone('compose')
      else if (zone === 'details' && e.key === 'ArrowUp') setZone('history')
      return
    }

    const dir = e.key === 'ArrowDown' || e.key === 'ArrowRight' ? 1 : -1
    if (zone === 'compose') moveFocusWithin(composeRef.current, dir, { wrap: true })
    else if (zone === 'history') moveHistory(dir)
    else detailsRef.current?.querySelector('.overflow-auto')?.scrollBy({ top: dir * 60 })
  }

  // dim ring: zone picked; solid ring: zone entered and live
  const ring = (z: Zone) =>
    zone !== z ? '' : entered ? 'ring-2 ring-accent' : 'ring-2 ring-accent/50'

  return (
    <div
      data-ultra
      ref={rootRef}
      tabIndex={-1}
      className="fixed inset-0 z-40 flex gap-5 bg-gradient-to-br from-ink-950 via-ink-900 to-ink-850 px-6 pb-12 pt-6 outline-none"
      onKeyDown={onKey}
    >
      {/* compose zone: the commit itself plus the remote actions */}
      <div
        ref={composeRef}
        tabIndex={-1}
        onMouseDown={() => {
          setZone('compose')
          setEntered(true)
        }}
        className={`flex w-[380px] shrink-0 flex-col gap-3 overflow-y-auto rounded-xl outline-none ${ring('compose')}`}
      >
        <div className="card p-4">
          <div className="mb-3 flex items-center font-mono text-[11px]">
            <span className="text-accent">$</span>
            <span className="ml-1.5 text-ink-500">git commit</span>
            <span className="ml-auto text-[10px] text-ink-600">Ctrl+Enter</span>
          </div>
          <button
            onClick={onIdentity}
            className="mb-3 flex w-full items-center gap-1 font-mono text-[11px] text-slate-400 hover:text-slate-200"
          >
            <span className="text-accent">&gt;</span>
            <span className="font-medium text-slate-100">{identity?.name || '(no name)'}</span>
            <span className="text-ink-600">@</span>
            <span>{basename(cwd)}</span>
            <span className="ml-auto text-[10px] text-accent">Edit</span>
          </button>
          <button
            onClick={onCoauthors}
            className="mb-3 flex w-full flex-wrap items-center gap-1.5 rounded-md border border-ink-700/60 bg-ink-900 px-2.5 py-1.5 text-left text-[11px] text-slate-500 hover:border-accent/40"
          >
            <span className="font-medium">Co-authors</span>
            {coauthors.length === 0 ? (
              <span className="text-ink-500">none active</span>
            ) : (
              coauthors.map((c) => (
                <span key={c.id} className="chip bg-accent/15 text-accent">
                  {c.name}
                </span>
              ))
            )}
            <span className="ml-auto text-[10px] text-accent">Manage</span>
          </button>
          <textarea
            ref={taRef}
            value={message}
            onChange={(e) => setMessage(e.target.value)}
            placeholder={`Commit message${stagedCount ? ` (${stagedCount} staged)` : ''}...`}
            rows={5}
            className="mb-2 w-full resize-none rounded-lg border border-ink-700 bg-ink-950 px-3 py-2 text-sm leading-relaxed outline-none focus:border-accent select-text"
          />
          <div className="mb-3 flex items-center gap-3 text-[11px] text-slate-500">
            <span>
              <span className="font-semibold text-accent">{stagedCount}</span> staged
            </span>
            {(stagedAdd > 0 || stagedDel > 0) && (
              <span className="font-mono text-[10px]">
                <span className="text-good">+{stagedAdd}</span>{' '}
                <span className="text-bad">-{stagedDel}</span>
              </span>
            )}
            <label className="ml-auto flex cursor-pointer items-center gap-1.5">
              <input
                type="checkbox"
                checked={amend}
                onChange={(e) => setAmend(e.target.checked)}
                className="accent-accent"
              />
              Amend
            </label>
          </div>
          <div className="flex flex-col gap-2">
            <button
              className="w-full rounded-md border border-ink-700/60 py-1.5 text-[11px] text-slate-400 hover:bg-ink-750 hover:text-slate-200"
              disabled={busy || stagedCount === 0}
              onClick={onPreview}
            >
              Preview changes
            </button>
            <div className="flex gap-2">
              <button
                className="btn-accent flex-1 py-2 text-sm font-semibold"
                disabled={busy || (stagedCount === 0 && !amend)}
                onClick={() => onCommit(false)}
              >
                {amend ? 'Amend' : 'Commit'}
              </button>
              <button
                className="btn-soft px-3"
                disabled={busy || (stagedCount === 0 && !amend)}
                onClick={() => onCommit(true)}
                title="Commit and push"
              >
                <IconArrowUp className="h-3.5 w-3.5" />
              </button>
            </div>
          </div>
        </div>

        <div className="card flex items-center gap-2 p-3">
          <button className="btn-ghost text-xs" disabled={busy} onClick={onFetch}>
            Fetch
          </button>
          <button className="btn-ghost text-xs" disabled={busy} onClick={onPull}>
            Pull
            {status && status.behind > 0 && (
              <span className="ml-1 inline-flex items-center gap-0.5 text-warn">
                <IconArrowDown className="h-3 w-3" />
                {status.behind}
              </span>
            )}
          </button>
          <div className="flex-1" />
          <button className="btn-accent text-xs" disabled={busy} onClick={onPush}>
            Push
            {status && status.ahead > 0 && (
              <span className="ml-1 inline-flex items-center gap-0.5">
                <IconArrowUp className="h-3 w-3" />
                {status.ahead}
              </span>
            )}
          </button>
        </div>
      </div>

      {/* history and details zones */}
      <div className="flex min-w-0 flex-1 flex-col gap-3">
        <div
          ref={historyRef}
          tabIndex={-1}
          className={`card max-h-56 overflow-y-auto outline-none ${ring('history')}`}
          onMouseDown={() => {
            setZone('history')
            setEntered(true)
          }}
        >
          {commits.map((c) => (
            <button
              key={c.hash}
              data-selected={selHash === c.hash || undefined}
              onClick={() => setSelHash(c.hash)}
              className={`flex w-full items-baseline gap-2.5 border-b border-ink-850 px-3.5 py-2 text-left text-sm last:border-0 ${
                selHash === c.hash ? 'bg-accent/15' : 'hover:bg-ink-850'
              }`}
            >
              <span className="shrink-0 font-mono text-[11px] text-accent">{c.shortHash}</span>
              <span className="min-w-0 flex-1 truncate text-slate-200">{c.subject}</span>
              <span className="shrink-0 text-[11px] text-slate-500">{c.author}</span>
              <span className="shrink-0 text-[11px] text-slate-600">{c.relDate}</span>
            </button>
          ))}
          {commits.length === 0 && (
            <div className="px-4 py-6 text-sm text-slate-500">No commits yet.</div>
          )}
        </div>
        <div
          ref={detailsRef}
          tabIndex={-1}
          className={`card min-h-0 flex-1 overflow-hidden outline-none ${ring('details')}`}
          onMouseDown={() => {
            setZone('details')
            setEntered(true)
          }}
        >
          <DiffView text={diff} empty={selHash ? 'Loading commit...' : 'Select a commit above.'} />
        </div>
      </div>
    </div>
  )
}
