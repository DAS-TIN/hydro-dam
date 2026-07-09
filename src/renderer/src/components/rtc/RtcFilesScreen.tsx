import React, { useEffect, useMemo, useState } from 'react'
import { api, humanSize } from '../../api'
import { RtcState, actorColor } from '../../rtc'
import Avatar from '../Avatar'
import { ActorChip, EmptyNote, IconLock, IconCaret, inputCls } from './bits'

const MODE_STYLE: Record<string, string> = {
  live: 'bg-emerald-400/15 text-emerald-300',
  patch_only: 'bg-sky-400/15 text-sky-300',
  locked: 'bg-amber-400/15 text-amber-300',
  ignored: 'bg-ink-750 text-slate-500'
}

/**
 * File activity: what is in the session, who is touching it right now, and
 * an editor-style preview with a coloured caret where each actor's cursor is.
 */
export default function RtcFilesScreen({
  cwd,
  state,
  refresh,
  toast
}: {
  cwd: string
  state: RtcState
  refresh: () => void
  toast: (kind: 'ok' | 'err', text: string) => void
}) {
  const [filter, setFilter] = useState('')
  const [selected, setSelected] = useState<string | null>(null)
  const [preview, setPreview] = useState<any>(null)
  const [assignTo, setAssignTo] = useState('')

  const now = Date.now()
  const activeLocks = state.locks.filter((l) => !l.releasedAt && (!l.expiresAt || l.expiresAt > now))

  // path -> actors whose presence, active files or pending changes touch it
  const activity = useMemo(() => {
    const map = new Map<string, Set<string>>()
    const touch = (path: string, actorId: string) => {
      if (!map.has(path)) map.set(path, new Set())
      map.get(path)!.add(actorId)
    }
    for (const a of state.actors) for (const f of a.activeFiles || []) touch(f, a.id)
    for (const [actorId, p] of Object.entries(state.presence)) {
      for (const f of p.activeFiles || []) touch(f, actorId)
      if (p.cursor) touch(p.cursor.path, actorId)
    }
    for (const c of state.changes) if (c.actorId !== 'unknown') touch(c.path, c.actorId)
    return map
  }, [state])

  // actorId -> cursor, for carets in the preview
  const cursors = useMemo(() => {
    const out: { actorId: string; path: string; line: number }[] = []
    for (const a of state.actors) if (a.cursor) out.push({ actorId: a.id, ...a.cursor })
    for (const [actorId, p] of Object.entries(state.presence)) {
      if (p.cursor) out.push({ actorId, path: p.cursor.path, line: p.cursor.line })
    }
    return out
  }, [state])

  useEffect(() => {
    if (!selected) {
      setPreview(null)
      return
    }
    api().readFile(cwd, selected).then(setPreview).catch(() => setPreview(null))
  }, [cwd, selected])

  const entries = state.manifest.entries.filter((e) => !filter || e.path.toLowerCase().includes(filter.toLowerCase()))
  const unknownChanges = state.changes.filter((c) => c.actorId === 'unknown')

  const lockOn = (path: string) =>
    activeLocks.find((l) => (l.lockType === 'folder' ? path === l.path || path.startsWith(l.path + '/') : l.path === path))

  return (
    <div className="flex h-full min-h-0 gap-4">
      {/* left: manifest + pending changes */}
      <div className="flex w-[46%] min-w-0 flex-col">
        {unknownChanges.length > 0 && (
          <div className="mb-3 rounded-lg border border-amber-400/30 bg-amber-400/10 p-3">
            <div className="mb-1.5 text-xs font-semibold text-amber-300">
              {unknownChanges.length} external change{unknownChanges.length === 1 ? '' : 's'} with no owner
            </div>
            <div className="flex items-center gap-2">
              <select className={`flex-1 ${inputCls}`} value={assignTo} onChange={(e) => setAssignTo(e.target.value)}>
                <option value="">assign to...</option>
                {state.actors
                  .filter((a) => a.type !== 'system')
                  .map((a) => (
                    <option key={a.id} value={a.id}>
                      {a.displayName}
                    </option>
                  ))}
              </select>
              <button
                className="btn-soft text-xs"
                disabled={!assignTo}
                onClick={() =>
                  api()
                    .rtcChangesAssign(cwd, unknownChanges.map((c) => c.path), assignTo, state.local.activeTaskId)
                    .then(refresh)
                    .catch((e) => toast('err', e.message))
                }
              >
                Assign
              </button>
            </div>
          </div>
        )}

        <div className="mb-2 flex items-center gap-2">
          <input className={`flex-1 ${inputCls}`} placeholder="Filter files..." value={filter} onChange={(e) => setFilter(e.target.value)} />
          <button
            className="btn-ghost text-xs"
            onClick={() => api().rtcManifestRefresh(cwd).then(refresh).catch((e) => toast('err', e.message))}
          >
            rescan
          </button>
        </div>
        <div className="mb-1.5 text-[11px] text-slate-500">
          {state.manifest.entries.length} files in scope
          {state.manifest.skipped?.length ? ` - ${state.manifest.skipped.length} excluded (secrets, deps, binaries, symlinks)` : ''}
        </div>
        <div className="min-h-0 flex-1 overflow-auto rounded-lg border border-ink-700/50">
          {entries.length === 0 && <EmptyNote>No files match.</EmptyNote>}
          <ul>
            {entries.map((e) => {
              const who = [...(activity.get(e.path) || [])]
              const lock = lockOn(e.path)
              const change = state.changes.find((c) => c.path === e.path)
              return (
                <li key={e.path}>
                  <button
                    className={`flex w-full items-center gap-2 border-b border-ink-800 px-2.5 py-1.5 text-left hover:bg-ink-800 ${selected === e.path ? 'bg-ink-800' : ''}`}
                    onClick={() => setSelected(e.path)}
                  >
                    <span className="min-w-0 flex-1 truncate font-mono text-xs text-slate-300">{e.path}</span>
                    {change && (
                      <span className={`text-[9px] font-semibold uppercase ${change.kind === 'delete' ? 'text-bad' : 'text-amber-300'}`}>
                        {change.kind}
                      </span>
                    )}
                    {who.map((id) => {
                      const c = actorColor(state.actors, id)
                      const name = state.actors.find((a) => a.id === id)?.displayName || id
                      return <Avatar key={id} name={name} bg={c.bg} size={16} title={name} />
                    })}
                    {lock && (
                      <IconLock
                        className={`h-3.5 w-3.5 shrink-0 ${lock.hardLock ? 'text-bad' : 'text-amber-300'}`}
                        hard={lock.hardLock}
                      />
                    )}
                    <span className={`rounded px-1 py-0.5 text-[9px] uppercase ${MODE_STYLE[e.collaborativeMode]}`}>
                      {e.collaborativeMode === 'patch_only' ? 'patch' : e.collaborativeMode}
                    </span>
                    <span className="w-14 shrink-0 text-right text-[10px] tabular-nums text-slate-600">{humanSize(e.size)}</span>
                  </button>
                </li>
              )
            })}
          </ul>
        </div>
      </div>

      {/* right: editor-style preview with presence carets */}
      <div className="flex min-w-0 flex-1 flex-col">
        {!selected && (
          <EmptyNote>
            Select a file to preview it. Coloured carets show where each participant's cursor is,
            and clicking a line moves your own caret there for everyone else.
          </EmptyNote>
        )}
        {selected && (
          <>
            <div className="mb-2 flex items-center gap-2">
              <span className="min-w-0 flex-1 truncate font-mono text-xs text-slate-200">{selected}</span>
              {[...(activity.get(selected) || [])].map((id) => (
                <ActorChip key={id} actors={state.actors} actorId={id} small />
              ))}
            </div>
            <div className="min-h-0 flex-1 overflow-auto rounded-lg border border-ink-700/50 bg-ink-950 font-mono text-[11px] leading-5">
              {preview?.kind === 'text' &&
                preview.text.split('\n').map((line: string, i: number) => {
                  const here = cursors.filter((c) => c.path === selected && c.line === i + 1)
                  const c0 = here.length ? actorColor(state.actors, here[0].actorId) : null
                  return (
                    <div
                      key={i}
                      className={`flex cursor-pointer hover:bg-ink-800/60 ${c0 ? c0.soft : ''}`}
                      title="Click to show the others you are on this line"
                      onClick={() => {
                        const me = state.local.activeActorId
                        if (me && selected) {
                          api()
                            .rtcPresence(cwd, me, { cursor: { path: selected, line: i + 1 }, activeFiles: [selected] })
                            .catch((e) => toast('err', e.message))
                        }
                      }}
                    >
                      <span className="w-10 shrink-0 select-none pr-2 text-right text-slate-600">{i + 1}</span>
                      <span className="whitespace-pre-wrap break-all text-slate-300">
                        {here.map((h) => {
                          const c = actorColor(state.actors, h.actorId)
                          return (
                            <span key={h.actorId} title={h.actorId} className={`${c.text} -ml-0.5 animate-pulse font-bold`}>
                              <IconCaret className="inline h-3.5 w-3.5" />
                            </span>
                          )
                        })}
                        {line || ' '}
                      </span>
                    </div>
                  )
                })}
              {preview && preview.kind !== 'text' && (
                <div className="p-4 text-slate-500">
                  {preview.kind === 'binary' && 'Binary file - not previewable, collaboration is lock-based for this one.'}
                  {preview.kind === 'too-large' && 'File too large to preview.'}
                  {preview.kind === 'missing' && 'File is missing from the working copy.'}
                  {preview.kind === 'image' && <img src={preview.dataUrl} className="max-w-full" />}
                </div>
              )}
            </div>
            {cursors.filter((c) => c.path === selected).length > 0 && (
              <div className="mt-1.5 flex flex-wrap gap-3 text-[11px] text-slate-500">
                {cursors
                  .filter((c) => c.path === selected)
                  .map((c) => {
                    const col = actorColor(state.actors, c.actorId)
                    return (
                      <span key={c.actorId} className="flex items-center gap-1">
                        <IconCaret className={`h-3 w-3 ${col.text}`} />
                        <span className={col.text}>{c.actorId}</span> at line {c.line}
                      </span>
                    )
                  })}
              </div>
            )}
          </>
        )}
      </div>
    </div>
  )
}
