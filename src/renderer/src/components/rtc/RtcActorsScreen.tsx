import React, { useState } from 'react'
import { api, relTime } from '../../api'
import { RtcState, actorColor } from '../../rtc'
import { Section, EmptyNote, inputCls, IconCaret } from './bits'

/** People with their agents nested under them, live presence included. */
export default function RtcActorsScreen({
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
  const [name, setName] = useState('')
  const [type, setType] = useState<'human' | 'agent' | 'manager'>('human')
  const [owner, setOwner] = useState('')

  const humans = state.actors.filter((a) => a.type === 'human')
  const managers = state.actors.filter((a) => a.type === 'manager')
  const system = state.actors.filter((a) => a.type === 'system')
  const orphanAgents = state.actors.filter((a) => a.type === 'agent' && !humans.some((h) => h.id === a.humanOwnerActorId))

  async function add() {
    try {
      await api().rtcActorAdd(cwd, {
        type,
        displayName: name.trim(),
        humanOwnerActorId: type === 'agent' ? owner || humans[0]?.id : null
      })
      setName('')
      refresh()
    } catch (e: any) {
      toast('err', e.message)
    }
  }

  function ActorRow({ actorId, indent }: { actorId: string; indent?: boolean }) {
    const a = state.actors.find((x) => x.id === actorId)!
    const c = actorColor(state.actors, a.id)
    const p = state.presence[a.id]
    const files = p?.activeFiles?.length ? p.activeFiles : a.activeFiles
    const cursor = p?.cursor || a.cursor
    const isMe = state.local.activeActorId === a.id
    const task = a.activeTaskId ? state.tasks.find((t) => t.id === a.activeTaskId) : null
    return (
      <li className={`flex items-start gap-3 rounded-lg border px-3 py-2 ${isMe ? `${c.border} ${c.soft}` : 'border-ink-700/50 bg-ink-800'} ${indent ? 'ml-7' : ''}`}>
        <span className={`mt-1 h-2.5 w-2.5 shrink-0 rounded-full ${c.bg}`} />
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <span className="truncate text-sm font-medium text-slate-100">{a.displayName}</span>
            <span className="font-mono text-[10px] text-slate-500">{a.id}</span>
            {isMe && <span className={`text-[10px] font-semibold ${c.text}`}>ACTING AS</span>}
          </div>
          <div className="mt-0.5 flex flex-wrap items-center gap-x-3 gap-y-0.5 text-[11px] text-slate-500">
            <span>seen {relTime(a.lastSeenAt)}</span>
            {task && <span>on <span className="text-slate-300">{task.title}</span></span>}
            {files?.length ? (
              <span>
                editing{' '}
                {files.slice(0, 3).map((f) => (
                  <span key={f} className={`mr-1 font-mono ${c.text}`}>{f.split('/').pop()}</span>
                ))}
                {files.length > 3 && `+${files.length - 3}`}
              </span>
            ) : null}
            {cursor && (
              <span className="flex items-center gap-0.5">
                <IconCaret className={`h-3 w-3 ${c.text}`} />
                <span className="font-mono">{cursor.path.split('/').pop()}:{cursor.line}</span>
              </span>
            )}
            {p?.note && <span className="italic">{p.note}</span>}
          </div>
        </div>
        {!isMe && a.type !== 'system' && (
          <button
            className="btn-ghost text-[11px]"
            onClick={() => api().rtcActorSetActive(cwd, a.id).then(refresh).catch((e) => toast('err', e.message))}
          >
            act as
          </button>
        )}
      </li>
    )
  }

  return (
    <div className="mx-auto max-w-2xl">
      <Section title={`Participants (${state.actors.length})`}>
        {state.actors.length === 0 && <EmptyNote>Nobody here yet.</EmptyNote>}
        <ul className="space-y-1.5">
          {humans.map((h) => (
            <React.Fragment key={h.id}>
              <ActorRow actorId={h.id} />
              {state.actors
                .filter((a) => a.type === 'agent' && a.humanOwnerActorId === h.id)
                .map((a) => (
                  <ActorRow key={a.id} actorId={a.id} indent />
                ))}
            </React.Fragment>
          ))}
          {orphanAgents.map((a) => (
            <ActorRow key={a.id} actorId={a.id} />
          ))}
          {managers.map((a) => (
            <ActorRow key={a.id} actorId={a.id} />
          ))}
          {system.map((a) => (
            <ActorRow key={a.id} actorId={a.id} />
          ))}
        </ul>
      </Section>

      <Section title="Add a participant">
        <div className="card space-y-2 p-4">
          <div className="flex gap-2">
            <select className={inputCls} value={type} onChange={(e) => setType(e.target.value as any)}>
              <option value="human">Human</option>
              <option value="agent">AI assistant</option>
              <option value="manager">Manager assistant</option>
            </select>
            <input
              className={`flex-1 ${inputCls}`}
              placeholder={type === 'agent' ? 'e.g. dastin-claude' : 'Display name'}
              value={name}
              onChange={(e) => setName(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && add()}
            />
            {type === 'agent' && (
              <select className={inputCls} value={owner || humans[0]?.id || ''} onChange={(e) => setOwner(e.target.value)}>
                {humans.map((h) => (
                  <option key={h.id} value={h.id}>
                    owned by {h.displayName}
                  </option>
                ))}
              </select>
            )}
            <button className="btn-accent" onClick={add}>
              Add
            </button>
          </div>
          <p className="text-[11px] text-slate-500">
            Every assistant has an owner. An assistant connected through the Hydrodam MCP server
            (Claude Code, for example) joins this list by itself when it calls rtc_join; you only
            add one by hand if it cannot reach MCP. Assistants read .rtc/agents/&lt;id&gt;.md for who
            they are and the rules, and report position via .rtc/presence/&lt;id&gt;.json.
          </p>
        </div>
      </Section>
    </div>
  )
}
