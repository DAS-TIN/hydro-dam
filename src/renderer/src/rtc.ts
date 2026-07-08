// Types and small helpers for the RTC collaboration UI.

export interface RtcActor {
  id: string
  type: 'human' | 'agent' | 'manager' | 'system'
  displayName: string
  email: string | null
  humanOwnerActorId: string | null
  permissions: Record<string, boolean>
  joinedAt: number
  lastSeenAt: number
  activeTaskId: string | null
  activeFiles: string[]
  cursor: { path: string; line: number } | null
  status: string
}

export interface RtcManifestEntry {
  path: string
  size: number
  sha256: string
  gitTracked: boolean
  binary: boolean
  largeFile: boolean
  collaborativeMode: 'live' | 'patch_only' | 'locked' | 'ignored'
  lastKnownHash: string | null
}

export interface RtcSession {
  id: string
  repoName: string
  hostActorId: string
  joinMode: 'clone' | 'snapshot' | 'mixed'
  baseBranch: string
  baseCommit: string
  baseManifestHash: string
  createdAt: number
  participants: string[]
  allowedFileStrategy: string
  excludedPatterns: string[]
  remoteUrl: string | null
  dirtyAtStart: boolean
  status: 'active' | 'ended'
}

export interface RtcCriterion {
  text: string
  done: boolean
}

export interface RtcTask {
  id: string
  title: string
  description: string
  type: string
  status: string
  ownerActorId: string | null
  humanOwnerActorId: string | null
  priority: string
  dependsOn: string[]
  blocks: string[]
  acceptanceCriteria: RtcCriterion[]
  lockedFiles: string[]
  allowedFiles: string[]
  forbiddenFiles: string[]
  createdAt: number
  updatedAt: number
}

export interface RtcLock {
  id: string
  lockType: 'file' | 'folder' | 'task' | 'contract' | 'binary'
  path: string
  taskId: string | null
  lockedByActorId: string
  humanOwnerActorId: string | null
  reason: string
  hardLock: boolean
  createdAt: number
  expiresAt: number | null
  releasedAt: number | null
}

export interface RtcPatch {
  id: string
  taskId: string | null
  createdByActorId: string
  humanOwnerActorId: string | null
  baseCommit: string
  baseManifestHash: string
  summary: string
  filesChanged: string[]
  diff: string
  status: 'draft' | 'needs_review' | 'checkpointed' | 'accepted' | 'rejected' | 'applied' | 'conflicted'
  testStatus: string
  riskLevel: 'low' | 'medium' | 'high'
  lockWarnings: string[]
  createdAt: number
}

export interface RtcCheckpoint {
  id: string
  taskId: string | null
  patchIds: string[]
  createdByActorId: string
  humanOwnerActorId: string | null
  summary: string
  files: string[]
  risks: string[]
  recommendation: string
  createdAt: number
}

export interface RtcCoauthorPick {
  actorId: string
  name: string
  email: string
  selected: boolean
}

export interface RtcSuggestion {
  id: string
  checkpointId: string
  title: string
  body: string
  coAuthors: RtcCoauthorPick[]
  suggestedByActorId: string | null
  requiresHumanApproval: boolean
  status: 'pending' | 'committed'
  commitHash?: string
  createdAt: number
}

export interface RtcChange {
  path: string
  kind: 'create' | 'edit' | 'delete'
  actorId: string
  taskId: string | null
  at: number
}

export interface RtcViolation {
  id: string
  path: string
  actorId: string
  lockId: string
  lockedByActorId: string
  hardLock: boolean
  at: number
}

export interface RtcSettings {
  includeUntracked: boolean
  maxFileSize: number
  terminalAccess: boolean
  autoApplyRemote: boolean
  allowRunCommands: boolean
}

export interface RtcState {
  session: RtcSession
  actors: RtcActor[]
  tasks: RtcTask[]
  locks: RtcLock[]
  patches: RtcPatch[]
  checkpoints: RtcCheckpoint[]
  suggestions: RtcSuggestion[]
  changes: RtcChange[]
  violations: RtcViolation[]
  manifest: { entries: RtcManifestEntry[]; manifestHash: string; skipped?: { path: string; reason: string }[] }
  settings: RtcSettings
  local: { activeActorId: string | null; activeTaskId: string | null }
  presence: Record<string, { activeFiles?: string[]; cursor?: { path: string; line: number }; note?: string }>
}

export interface RtcTip {
  id: string
  kind: string
  severity: 'low' | 'medium' | 'high'
  message: string
  taskId?: string
  patchId?: string
  lockId?: string
  actorIds?: string[]
  file?: string
}

export interface ActorColor {
  name: string
  text: string
  bg: string
  soft: string
  border: string
}

// One stable colour per actor so "who did what" reads at a glance everywhere.
export const ACTOR_COLORS: ActorColor[] = [
  { name: 'emerald', text: 'text-emerald-400', bg: 'bg-emerald-400', soft: 'bg-emerald-400/15', border: 'border-emerald-400/40' },
  { name: 'sky', text: 'text-sky-400', bg: 'bg-sky-400', soft: 'bg-sky-400/15', border: 'border-sky-400/40' },
  { name: 'violet', text: 'text-violet-400', bg: 'bg-violet-400', soft: 'bg-violet-400/15', border: 'border-violet-400/40' },
  { name: 'amber', text: 'text-amber-400', bg: 'bg-amber-400', soft: 'bg-amber-400/15', border: 'border-amber-400/40' },
  { name: 'rose', text: 'text-rose-400', bg: 'bg-rose-400', soft: 'bg-rose-400/15', border: 'border-rose-400/40' },
  { name: 'cyan', text: 'text-cyan-400', bg: 'bg-cyan-400', soft: 'bg-cyan-400/15', border: 'border-cyan-400/40' },
  { name: 'lime', text: 'text-lime-400', bg: 'bg-lime-400', soft: 'bg-lime-400/15', border: 'border-lime-400/40' },
  { name: 'fuchsia', text: 'text-fuchsia-400', bg: 'bg-fuchsia-400', soft: 'bg-fuchsia-400/15', border: 'border-fuchsia-400/40' }
]

// unknown/system actors and anything not in the roster
const GRAY: ActorColor = {
  name: 'gray',
  text: 'text-slate-400',
  bg: 'bg-slate-400',
  soft: 'bg-slate-400/15',
  border: 'border-slate-400/40'
}

export function actorColor(actors: RtcActor[], actorId: string | null | undefined): ActorColor {
  if (!actorId || actorId === 'unknown') return GRAY
  const i = actors.findIndex((a) => a.id === actorId)
  if (i < 0) return GRAY
  return ACTOR_COLORS[i % ACTOR_COLORS.length]
}

export const TASK_STATUS_STYLE: Record<string, string> = {
  backlog: 'bg-ink-750 text-slate-400',
  ready: 'bg-sky-400/15 text-sky-300',
  claimed: 'bg-violet-400/15 text-violet-300',
  in_progress: 'bg-amber-400/15 text-amber-300',
  blocked: 'bg-bad/15 text-bad',
  needs_review: 'bg-fuchsia-400/15 text-fuchsia-300',
  checkpointed: 'bg-emerald-400/15 text-emerald-300',
  merged: 'bg-emerald-400/25 text-emerald-200',
  rejected: 'bg-bad/15 text-bad',
  abandoned: 'bg-ink-750 text-slate-500'
}

export const PATCH_STATUS_STYLE: Record<string, string> = {
  draft: 'bg-ink-750 text-slate-400',
  needs_review: 'bg-fuchsia-400/15 text-fuchsia-300',
  checkpointed: 'bg-sky-400/15 text-sky-300',
  accepted: 'bg-emerald-400/15 text-emerald-300',
  rejected: 'bg-bad/15 text-bad',
  applied: 'bg-emerald-400/25 text-emerald-200',
  conflicted: 'bg-bad/25 text-bad'
}

// Mirrors taskProgress in src/main/rtc/checkpoints.mjs so cards can render
// the percentage without a round trip.
const STATUS_WEIGHT: Record<string, number> = {
  backlog: 0, ready: 5, claimed: 15, in_progress: 35, blocked: 35,
  needs_review: 70, checkpointed: 85, merged: 100, rejected: 0, abandoned: 0
}

export function taskProgress(task: RtcTask, patches: RtcPatch[]): number {
  let pct = STATUS_WEIGHT[task.status] ?? 0
  if (task.status === 'merged') return 100
  const crits = task.acceptanceCriteria || []
  if (crits.length) {
    const done = crits.filter((c) => c.done).length / crits.length
    pct = Math.round(pct * 0.6 + done * 100 * 0.4)
  }
  if (task.status === 'in_progress') {
    const mine = patches.filter((p) => p.taskId === task.id)
    pct += Math.min(mine.length, 3) * 5
  }
  return Math.max(0, Math.min(99, pct))
}

export function actorShort(id: string): string {
  return id.includes(':') ? id.split(':')[1] : id
}

// Per-file collaboration marks for the MAIN changes list: who is on a file
// (dot colour, cursor line when known) and whether it is locked.
export interface CollabMark {
  actors: { id: string; name: string; bg: string; line?: number }[]
  lock?: { by: string; byName: string; reason: string; hard: boolean; mine: boolean }
}

export function buildCollabMarks(state: RtcState): Map<string, CollabMark> {
  const marks = new Map<string, CollabMark>()
  const mark = (p: string) => {
    let m = marks.get(p)
    if (!m) {
      m = { actors: [] }
      marks.set(p, m)
    }
    return m
  }
  const nameOf = (id: string) => state.actors.find((a) => a.id === id)?.displayName || actorShort(id)
  const touch = (path: string, id: string, line?: number) => {
    if (!id || id === 'unknown') return
    const m = mark(path.replace(/\\/g, '/'))
    const existing = m.actors.find((a) => a.id === id)
    if (existing) {
      if (line !== undefined) existing.line = line
      return
    }
    m.actors.push({ id, name: nameOf(id), bg: actorColor(state.actors, id).bg, ...(line !== undefined ? { line } : {}) })
  }

  for (const c of state.changes) touch(c.path, c.actorId)
  for (const a of state.actors) {
    for (const f of a.activeFiles || []) touch(f, a.id)
    if (a.cursor) touch(a.cursor.path, a.id, a.cursor.line)
  }
  for (const [id, p] of Object.entries(state.presence)) {
    for (const f of p.activeFiles || []) touch(f, id)
    if (p.cursor) touch(p.cursor.path, id, p.cursor.line)
  }

  const now = Date.now()
  for (const l of state.locks) {
    if (l.releasedAt || (l.expiresAt && l.expiresAt <= now)) continue
    const m = mark(l.path)
    // a hard lock wins over a soft one on the same path
    if (m.lock && m.lock.hard && !l.hardLock) continue
    m.lock = {
      by: l.lockedByActorId,
      byName: nameOf(l.lockedByActorId),
      reason: l.reason || '',
      hard: l.hardLock,
      mine: l.lockedByActorId === state.local.activeActorId
    }
  }
  return marks
}
