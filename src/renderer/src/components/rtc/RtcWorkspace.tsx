import React, { useCallback, useEffect, useRef, useState } from 'react'
import { api } from '../../api'
import { RtcState, actorColor } from '../../rtc'
import { IconClose } from '../Icons'
import RtcSessionScreen from './RtcSessionScreen'
import RtcActorsScreen from './RtcActorsScreen'
import RtcTasksScreen from './RtcTasksScreen'
import RtcLocksScreen from './RtcLocksScreen'
import RtcFilesScreen from './RtcFilesScreen'
import RtcPatchesScreen from './RtcPatchesScreen'
import RtcCheckpointsScreen from './RtcCheckpointsScreen'
import RtcCommitsScreen from './RtcCommitsScreen'
import RtcAdvisorScreen from './RtcAdvisorScreen'
import RtcSecurityScreen from './RtcSecurityScreen'

type Tab =
  | 'session'
  | 'actors'
  | 'tasks'
  | 'locks'
  | 'files'
  | 'patches'
  | 'checkpoints'
  | 'commits'
  | 'advisor'
  | 'security'

/** The collaboration workspace: one overlay, ten screens, live updates. */
export default function RtcWorkspace({ cwd, onClose }: { cwd: string; onClose: () => void }) {
  const [state, setState] = useState<RtcState | null>(null)
  const [tab, setTab] = useState<Tab>('session')
  const [msg, setMsg] = useState<{ kind: 'ok' | 'err'; text: string } | null>(null)
  const msgTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  const toast = useCallback((kind: 'ok' | 'err', text: string) => {
    setMsg({ kind, text })
    if (msgTimer.current) clearTimeout(msgTimer.current)
    msgTimer.current = setTimeout(() => setMsg(null), 4000)
  }, [])

  const refresh = useCallback(() => {
    api()
      .rtcState(cwd)
      .then(setState)
      .catch(() => setState(null))
  }, [cwd])

  useEffect(() => {
    refresh()
    const off = api().onRtcEvent((ev) => {
      if (ev.cwd !== cwd) return
      if (ev.kind === 'violation') toast('err', 'Lock violation: a locked file was just edited.')
      refresh()
    })
    return off
  }, [cwd, refresh, toast])

  // Keep the change watcher running while the workspace is open on a session.
  useEffect(() => {
    if (state?.session?.status === 'active') {
      api().rtcWatchStart(cwd).catch(() => {})
    }
  }, [cwd, state?.session?.status])

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation()
        onClose()
      }
    }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  }, [onClose])

  const hasSession = !!state
  const pendingReview = state?.patches.filter((p) => p.status === 'needs_review').length || 0
  const pendingCommits = state?.suggestions.filter((s) => s.status === 'pending').length || 0
  const violations = state?.violations.length || 0
  const me = state?.local.activeActorId
  const meActor = state?.actors.find((a) => a.id === me)
  const meColor = state ? actorColor(state.actors, me) : null

  const tabs: { key: Tab; label: string; badge?: number; needsSession?: boolean }[] = [
    { key: 'session', label: 'Session' },
    { key: 'actors', label: 'Actors', needsSession: true },
    { key: 'tasks', label: 'Tasks', needsSession: true },
    { key: 'locks', label: 'Locks', badge: violations, needsSession: true },
    { key: 'files', label: 'Files', needsSession: true },
    { key: 'patches', label: 'Patches', badge: pendingReview, needsSession: true },
    { key: 'checkpoints', label: 'Checkpoints', needsSession: true },
    { key: 'commits', label: 'Commits', badge: pendingCommits, needsSession: true },
    { key: 'advisor', label: 'Advisor', needsSession: true },
    { key: 'security', label: 'Security', needsSession: true }
  ]

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm">
      <div className="card flex h-[92vh] w-[94vw] max-w-[1400px] flex-col overflow-hidden shadow-2xl">
        {/* header */}
        <div className="flex items-center gap-4 border-b border-ink-700/60 px-5 py-3">
          <div>
            <h2 className="text-base font-semibold text-white">Live collaboration</h2>
            <p className="text-[11px] text-slate-400">
              {hasSession
                ? `${state!.session.repoName} - ${state!.actors.length} actors, base ${state!.session.baseCommit.slice(0, 8)}`
                : 'No session yet - start or join one'}
            </p>
          </div>
          <div className="flex-1" />
          {hasSession && (
            <label className="flex items-center gap-2 text-xs text-slate-400">
              <span className={`h-2.5 w-2.5 rounded-full ${meColor?.bg || 'bg-slate-500'}`} />
              acting as
              <select
                className="rounded-md border border-ink-700 bg-ink-900 px-2 py-1 text-xs outline-none focus:border-accent"
                value={me || ''}
                onChange={(e) => api().rtcActorSetActive(cwd, e.target.value).then(refresh).catch((err) => toast('err', err.message))}
              >
                {state!.actors
                  .filter((a) => a.type !== 'system')
                  .map((a) => (
                    <option key={a.id} value={a.id}>
                      {a.displayName} ({a.type === 'agent' ? 'assistant' : a.type})
                    </option>
                  ))}
              </select>
            </label>
          )}
          <button className="btn-ghost px-2" onClick={onClose} title="Close (Esc)">
            <IconClose className="h-4 w-4" />
          </button>
        </div>

        {/* tabs */}
        <div className="flex gap-1 border-b border-ink-700/60 px-4 py-1.5">
          {tabs.map((t) => {
            const disabled = t.needsSession && !hasSession
            return (
              <button
                key={t.key}
                disabled={disabled}
                className={`relative rounded-md px-2.5 py-1 text-xs font-medium ${
                  tab === t.key ? 'bg-ink-750 text-white' : disabled ? 'text-ink-600' : 'text-slate-400 hover:text-slate-200'
                }`}
                onClick={() => setTab(t.key)}
              >
                {t.label}
                {!!t.badge && (
                  <span className="ml-1 rounded-full bg-accent/20 px-1.5 text-[9px] font-semibold text-accent">{t.badge}</span>
                )}
              </button>
            )
          })}
          {meActor && (
            <span className="ml-auto self-center text-[10px] text-slate-500">
              changes you make are attributed to <span className={meColor?.text}>{meActor.displayName}</span>
            </span>
          )}
        </div>

        {/* toast */}
        {msg && (
          <div className={`px-5 py-1.5 text-xs ${msg.kind === 'ok' ? 'bg-emerald-400/10 text-emerald-300' : 'bg-bad/10 text-bad'}`}>
            {msg.text}
          </div>
        )}

        {/* body */}
        <div className="min-h-0 flex-1 overflow-auto p-5">
          {tab === 'session' && <RtcSessionScreen cwd={cwd} state={state} refresh={refresh} toast={toast} />}
          {hasSession && tab === 'actors' && <RtcActorsScreen cwd={cwd} state={state!} refresh={refresh} toast={toast} />}
          {hasSession && tab === 'tasks' && <RtcTasksScreen cwd={cwd} state={state!} refresh={refresh} toast={toast} />}
          {hasSession && tab === 'locks' && <RtcLocksScreen cwd={cwd} state={state!} refresh={refresh} toast={toast} />}
          {hasSession && tab === 'files' && <RtcFilesScreen cwd={cwd} state={state!} refresh={refresh} toast={toast} />}
          {hasSession && tab === 'patches' && <RtcPatchesScreen cwd={cwd} state={state!} refresh={refresh} toast={toast} />}
          {hasSession && tab === 'checkpoints' && (
            <RtcCheckpointsScreen cwd={cwd} state={state!} refresh={refresh} toast={toast} gotoCommits={() => setTab('commits')} />
          )}
          {hasSession && tab === 'commits' && <RtcCommitsScreen cwd={cwd} state={state!} refresh={refresh} toast={toast} />}
          {hasSession && tab === 'advisor' && <RtcAdvisorScreen cwd={cwd} state={state!} refresh={refresh} toast={toast} />}
          {hasSession && tab === 'security' && <RtcSecurityScreen cwd={cwd} state={state!} refresh={refresh} toast={toast} />}
        </div>
      </div>
    </div>
  )
}
