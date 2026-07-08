// ipc.ts - wires the RTC collaboration modules to the renderer. All state
// mutation runs here in the main process; the renderer only ever sees the
// resulting state bundle plus change events.

import { ipcMain, BrowserWindow, dialog } from 'electron'
import * as Session from './session.mjs'
import * as Join from './join.mjs'
import * as Store from './store.mjs'
import * as Actors from './actors.mjs'
import * as Tasks from './tasks.mjs'
import * as Locks from './locks.mjs'
import * as Patches from './patches.mjs'
import * as Checkpoints from './checkpoints.mjs'
import * as Advisor from './advisor.mjs'
import * as Commits from './commits.mjs'
import * as Context from './context.mjs'
import * as Watcher from './watcher.mjs'
import * as FileSelect from './fileselect.mjs'

function handle<T>(channel: string, fn: (...args: any[]) => Promise<T> | T) {
  ipcMain.handle(channel, async (_e, ...args) => {
    try {
      return { ok: true, data: await fn(...args) }
    } catch (err: any) {
      return { ok: false, error: err?.message || String(err) }
    }
  })
}

function broadcast(payload: any) {
  for (const w of BrowserWindow.getAllWindows()) w.webContents.send('rtc:event', payload)
}

const COLLECTIONS = [
  'session', 'actors', 'tasks', 'locks', 'patches',
  'checkpoints', 'suggestions', 'changes', 'violations', 'manifest', 'settings', 'local'
] as const

// Load state, let fn mutate it, persist everything, refresh agent context.
async function withState<T>(cwd: string, fn: (state: any) => Promise<T> | T): Promise<T> {
  const state = Store.loadState(cwd)
  if (!state) throw new Error('No RTC session in this repository.')
  const result = await fn(state)
  for (const name of COLLECTIONS) Store.saveColl(cwd, name, state[name])
  Context.writeContext(cwd, state)
  broadcast({ kind: 'state', cwd })
  return result
}

// One live watcher at a time (the focused repo).
let active: { cwd: string; watcher: { close(): void; markKnown(p: string): void } } | null = null

function stopWatching() {
  active?.watcher.close()
  active = null
}

function startWatching(cwd: string) {
  stopWatching()
  const state = Store.loadState(cwd)
  if (!state) throw new Error('No RTC session in this repository.')
  const paths = state.manifest.entries.map((e: any) => e.path)
  const watcher = Watcher.startWatcher(
    cwd,
    paths,
    (batch: { path: string; kind: string }[]) => {
      const s = Store.loadState(cwd)
      if (!s) return
      const actorId = s.local.activeActorId || 'unknown'
      const taskId = s.local.activeTaskId || null
      Patches.recordChanges(s.changes, batch, actorId, taskId)
      const violations = Locks.checkViolations(
        s.locks,
        s.violations,
        batch.map((b) => b.path),
        actorId
      )
      for (const b of batch) if (b.kind === 'create') active?.watcher.markKnown(b.path)
      Store.saveColl(cwd, 'changes', s.changes)
      Store.saveColl(cwd, 'violations', s.violations)
      broadcast({ kind: 'changes', cwd, files: batch.map((b) => b.path) })
      if (violations.length) broadcast({ kind: 'violation', cwd, violations })
    },
    () => broadcast({ kind: 'presence', cwd })
  )
  active = { cwd, watcher }
}

function dialogParent(): BrowserWindow {
  return BrowserWindow.getFocusedWindow() ?? BrowserWindow.getAllWindows()[0]
}

export function registerRtcIpc(): void {
  handle('rtc:probe', (cwd: string) => Session.probe(cwd))
  handle('rtc:state', (cwd: string) => Store.loadState(cwd))
  handle('rtc:create', async (cwd: string, opts: any) => {
    const state = await Session.createSession(cwd, opts)
    Context.writeContext(cwd, state)
    startWatching(cwd)
    return state
  })
  handle('rtc:end', (cwd: string) => {
    stopWatching()
    return Session.endSession(cwd)
  })

  handle('rtc:inviteExport', async (cwd: string) => {
    const res = await dialog.showSaveDialog(dialogParent(), {
      title: 'Save session invite',
      defaultPath: 'rtc-invite.json',
      filters: [{ name: 'JSON', extensions: ['json'] }]
    })
    if (res.canceled || !res.filePath) return null
    return Session.inviteExport(cwd, res.filePath)
  })
  handle('rtc:snapshotExport', async (cwd: string) => {
    const res = await dialog.showOpenDialog(dialogParent(), {
      title: 'Choose an empty folder for the snapshot',
      properties: ['openDirectory', 'createDirectory']
    })
    if (res.canceled || !res.filePaths[0]) return null
    return Session.snapshotExport(cwd, res.filePaths[0])
  })
  handle('rtc:snapshotVerify', (srcDir: string) => Join.snapshotVerify(srcDir))
  handle('rtc:snapshotImport', async (srcDir: string, destDir: string, guestName: string) => {
    const out = await Join.snapshotImport(srcDir, destDir, guestName)
    Context.writeContext(out.root, out.state)
    return out
  })
  handle('rtc:cloneJoin', async (cwd: string, inviteFile: string, guestName: string) => {
    const out = await Join.cloneJoin(cwd, inviteFile, guestName)
    Context.writeContext(cwd, out.state)
    return out
  })
  handle('rtc:pickFile', async (title: string) => {
    const res = await dialog.showOpenDialog(dialogParent(), {
      title,
      properties: ['openFile'],
      filters: [{ name: 'JSON', extensions: ['json'] }]
    })
    return res.canceled ? null : res.filePaths[0] ?? null
  })

  handle('rtc:manifestRefresh', (cwd: string) =>
    withState(cwd, async (state) => {
      state.manifest = await FileSelect.buildManifest(cwd, {
        includeUntracked: state.settings.includeUntracked,
        maxFileSize: state.settings.maxFileSize
      })
      return state.manifest
    })
  )

  handle('rtc:actorAdd', (cwd: string, opts: any) =>
    withState(cwd, (state) => {
      const actor = Actors.addActor(state.actors, opts)
      state.session.participants = [...new Set([...state.session.participants, actor.id])]
      return actor
    })
  )
  handle('rtc:actorSetActive', (cwd: string, actorId: string, taskId?: string | null) =>
    withState(cwd, (state) => {
      state.local.activeActorId = actorId
      if (taskId !== undefined) state.local.activeTaskId = taskId
      Actors.touchActor(state.actors, actorId, taskId !== undefined ? { activeTaskId: taskId } : {})
      return state.local
    })
  )
  handle('rtc:presence', (cwd: string, actorId: string, patch: any) =>
    withState(cwd, (state) => Actors.touchActor(state.actors, actorId, patch))
  )

  handle('rtc:taskCreate', (cwd: string, opts: any) =>
    withState(cwd, (state) => Tasks.createTask(state.tasks, opts))
  )
  handle('rtc:taskClaim', (cwd: string, taskId: string, actorId: string) =>
    withState(cwd, (state) => Tasks.claimTask(state.tasks, state.actors, taskId, actorId))
  )
  handle('rtc:taskTransition', (cwd: string, taskId: string, to: string) =>
    withState(cwd, (state) => Tasks.transitionTask(state.tasks, taskId, to))
  )
  handle('rtc:taskUpdate', (cwd: string, taskId: string, patch: any) =>
    withState(cwd, (state) => {
      const t = Tasks.getTask(state.tasks, taskId)
      if (!t) throw new Error('Task not found.')
      const allowed = [
        'title', 'description', 'type', 'priority', 'dependsOn', 'blocks',
        'acceptanceCriteria', 'lockedFiles', 'allowedFiles', 'forbiddenFiles'
      ]
      for (const k of allowed) if (k in patch) (t as any)[k] = patch[k]
      t.updatedAt = Date.now()
      return t
    })
  )

  handle('rtc:lockAcquire', (cwd: string, opts: any) =>
    withState(cwd, (state) => Locks.acquireLock(state.locks, state.actors, opts))
  )
  handle('rtc:lockRelease', (cwd: string, lockId: string) =>
    withState(cwd, (state) => Locks.releaseLock(state.locks, lockId))
  )

  handle('rtc:changesAssign', (cwd: string, paths: string[], actorId: string, taskId?: string | null) =>
    withState(cwd, (state) => Patches.assignChanges(state.changes, paths, actorId, taskId ?? null))
  )
  handle('rtc:patchCreate', (cwd: string, opts: any) =>
    withState(cwd, (state) => Patches.createPatch(cwd, state, opts))
  )
  handle('rtc:patchStatus', (cwd: string, patchId: string, status: string) =>
    withState(cwd, (state) => Patches.setPatchStatus(state.patches, patchId, status))
  )
  handle('rtc:patchApply', (cwd: string, patchId: string, checkOnly: boolean) =>
    withState(cwd, (state) => Patches.applyPatch(cwd, state.patches, patchId, { checkOnly }))
  )

  handle('rtc:checkpointCreate', (cwd: string, opts: any) =>
    withState(cwd, (state) => Checkpoints.createCheckpoint(state, opts))
  )
  handle('rtc:advise', (cwd: string) => {
    const state = Store.loadState(cwd)
    if (!state) throw new Error('No RTC session in this repository.')
    return Advisor.advise(state)
  })

  handle('rtc:commitSuggest', (cwd: string, checkpointId: string) =>
    withState(cwd, (state) => Commits.suggestCommit(state, checkpointId))
  )
  handle('rtc:commitApprove', (cwd: string, suggestionId: string, edits: any) =>
    withState(cwd, (state) => Commits.approveCommit(cwd, state, suggestionId, edits || {}))
  )

  handle('rtc:settingsSet', (cwd: string, patch: any) =>
    withState(cwd, (state) => {
      Object.assign(state.settings, patch)
      return state.settings
    })
  )

  handle('rtc:watchStart', (cwd: string) => {
    startWatching(cwd)
    return true
  })
  handle('rtc:watchStop', () => {
    stopWatching()
    return true
  })
}
