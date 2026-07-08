import React, { useEffect, useState } from 'react'
import { api, confirmDialog } from '../../api'
import { RtcState } from '../../rtc'
import { Section, EmptyNote, inputCls } from './bits'

/** Start a session, join one (clone or snapshot), or inspect the current one. */
export default function RtcSessionScreen({
  cwd,
  state,
  refresh,
  toast
}: {
  cwd: string
  state: RtcState | null
  refresh: () => void
  toast: (kind: 'ok' | 'err', text: string) => void
}) {
  const [probe, setProbe] = useState<any>(null)
  const [hostName, setHostName] = useState('')
  const [includeUntracked, setIncludeUntracked] = useState(false)
  const [joinMode, setJoinMode] = useState<'clone' | 'snapshot'>('clone')
  const [guestName, setGuestName] = useState('')
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    api().rtcProbe(cwd).then(setProbe).catch(() => setProbe(null))
    api()
      .globalIdentity()
      .then((id) => setHostName((v) => v || id.name || ''))
      .catch(() => {})
  }, [cwd])

  async function run(label: string, fn: () => Promise<any>) {
    setBusy(true)
    try {
      await fn()
      toast('ok', label)
      refresh()
    } catch (e: any) {
      toast('err', e.message)
    } finally {
      setBusy(false)
    }
  }

  async function create() {
    if (probe?.dirty) {
      const go = await confirmDialog({
        title: 'Uncommitted changes',
        message: 'This repository has uncommitted changes.',
        detail:
          'The session base is the last commit, so uncommitted work will show up as pending changes attributed to you. Start anyway?',
        confirmLabel: 'Start session'
      })
      if (!go) return
    }
    await run('Session started.', () =>
      api().rtcCreate(cwd, { hostName: hostName.trim() || 'Host', joinMode, includeUntracked })
    )
  }

  async function joinClone() {
    const invite = await api().rtcPickFile('Choose the rtc-invite.json you received')
    if (!invite) return
    await run('Joined the session.', () => api().rtcCloneJoin(cwd, invite, guestName.trim() || 'Guest'))
  }

  async function joinSnapshot() {
    const src = await api().browseDir('Folder containing the downloaded snapshot')
    if (!src) return
    const check = await api().rtcSnapshotVerify(src)
    if (!check.ok) {
      toast('err', `Snapshot failed verification: ${check.problems[0]}`)
      return
    }
    const go = await confirmDialog({
      title: 'Security warning',
      message: 'You are about to import code from another machine.',
      detail:
        'The files were verified against the snapshot manifest, but treat them as untrusted: Hydrodam will never run install scripts, build steps or any project command from this code without you starting it yourself. Continue?',
      confirmLabel: 'I understand, import',
      danger: true
    })
    if (!go) return
    const dest = await api().browseDir('Choose an EMPTY folder for your working copy')
    if (!dest) return
    await run('Snapshot imported - a fresh repo with an "RTC session base" commit was created.', () =>
      api().rtcSnapshotImport(src, dest, guestName.trim() || 'Guest')
    )
  }

  if (!state) {
    return (
      <div className="mx-auto max-w-2xl">
        <Section title="Start a session from this repo">
          <div className="card space-y-3 p-4">
            {probe && !probe.isRepo && <EmptyNote>This folder is not a git repository.</EmptyNote>}
            {probe?.isRepo && (
              <>
                <div className="text-xs text-slate-400">
                  Base: <span className="font-mono text-slate-300">{probe.branch}</span> @{' '}
                  <span className="font-mono text-slate-300">{probe.baseCommit?.slice(0, 10)}</span>
                  {probe.dirty && <span className="ml-2 text-amber-300">uncommitted changes present</span>}
                </div>
                <input className={`w-full ${inputCls}`} placeholder="Your name (host)" value={hostName} onChange={(e) => setHostName(e.target.value)} />
                <div className="flex items-center gap-4 text-xs text-slate-400">
                  <label className="flex items-center gap-2">
                    <input type="radio" checked={joinMode === 'clone'} onChange={() => setJoinMode('clone')} />
                    Clone-based (guests clone the repo - best for large projects)
                  </label>
                  <label className="flex items-center gap-2">
                    <input type="radio" checked={joinMode === 'snapshot'} onChange={() => setJoinMode('snapshot')} />
                    Snapshot-based (share sanitized files)
                  </label>
                </div>
                <label className="flex items-center gap-2 text-xs text-slate-400">
                  <input type="checkbox" checked={includeUntracked} onChange={(e) => setIncludeUntracked(e.target.checked)} />
                  Also include untracked files (ignored files and secrets stay excluded)
                </label>
                <button className="btn-accent" disabled={busy} onClick={create}>
                  Start session
                </button>
              </>
            )}
          </div>
        </Section>

        <Section title="Join someone else's session">
          <div className="card space-y-3 p-4">
            <input className={`w-full ${inputCls}`} placeholder="Your name (guest)" value={guestName} onChange={(e) => setGuestName(e.target.value)} />
            <div className="flex gap-2">
              <button className="btn-soft flex-1" disabled={busy} onClick={joinClone}>
                Join with my clone + invite file
              </button>
              <button className="btn-soft flex-1" disabled={busy} onClick={joinSnapshot}>
                Import a snapshot
              </button>
            </div>
            <p className="text-[11px] text-slate-500">
              Clone join verifies your HEAD matches the session base. Snapshot import verifies every file hash,
              then creates a fresh local repo with an initial commit named "RTC session base".
            </p>
          </div>
        </Section>
      </div>
    )
  }

  const s = state.session
  return (
    <div className="mx-auto max-w-2xl">
      <Section title="Current session">
        <div className="card space-y-2 p-4 text-sm">
          <div className="flex items-center justify-between">
            <div className="text-base font-semibold text-white">{s.repoName}</div>
            <span className={`rounded px-2 py-0.5 text-[10px] font-semibold uppercase ${s.status === 'active' ? 'bg-emerald-400/15 text-emerald-300' : 'bg-ink-750 text-slate-500'}`}>
              {s.status}
            </span>
          </div>
          <div className="grid grid-cols-2 gap-x-4 gap-y-1 text-xs text-slate-400">
            <div>Join mode: <span className="text-slate-200">{s.joinMode}</span></div>
            <div>Participants: <span className="text-slate-200">{s.participants.length}</span></div>
            <div>Base: <span className="font-mono text-slate-200">{s.baseCommit.slice(0, 10)}</span> on <span className="text-slate-200">{s.baseBranch}</span></div>
            <div>Files in scope: <span className="text-slate-200">{state.manifest.entries.length}</span></div>
            <div>Strategy: <span className="text-slate-200">{s.allowedFileStrategy}</span></div>
            <div>Manifest: <span className="font-mono text-slate-200">{s.baseManifestHash.slice(0, 10)}</span></div>
          </div>
        </div>
      </Section>

      <Section title="Invite others">
        <div className="card space-y-2 p-4">
          <div className="flex gap-2">
            <button
              className="btn-soft flex-1"
              onClick={() =>
                api().rtcInviteExport(cwd).then((p) => p && toast('ok', `Invite saved to ${p}`)).catch((e) => toast('err', e.message))
              }
            >
              Export invite file (clone join)
            </button>
            <button
              className="btn-soft flex-1"
              onClick={() =>
                api()
                  .rtcSnapshotExport(cwd)
                  .then((r) => r && toast('ok', `Snapshot with ${r.copied} files written to ${r.dest}`))
                  .catch((e) => toast('err', e.message))
              }
            >
              Export sanitized snapshot
            </button>
          </div>
          <p className="text-[11px] text-slate-500">
            Snapshots contain only the files in the session manifest - never .git, ignored files or excluded secrets.
          </p>
        </div>
      </Section>

      <Section title="Danger zone">
        <div className="card flex items-center justify-between p-4">
          <span className="text-xs text-slate-400">Ending a session keeps the .rtc records but stops tracking.</span>
          <button
            className="btn-ghost text-bad"
            onClick={async () => {
              if (await confirmDialog({ message: 'End this session?', confirmLabel: 'End session', danger: true })) {
                api().rtcEnd(cwd).then(refresh).catch((e) => toast('err', e.message))
              }
            }}
          >
            End session
          </button>
        </div>
      </Section>
    </div>
  )
}
