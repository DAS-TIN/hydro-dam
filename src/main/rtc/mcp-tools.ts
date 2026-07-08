// mcp-tools.ts - the collaboration tools a connected AI assistant sees on
// the app's MCP server: join the session as an identified actor, declare a
// plan (files to lock + endpoints), detect concurrent edits before writing,
// and hand finished work back as a checkpoint. rtc_guide is the contract;
// the same text ships as a skill file via context.mjs.

import { z } from 'zod'
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import * as Store from './store.mjs'
import * as Actors from './actors.mjs'
import * as Tasks from './tasks.mjs'
import * as Locks from './locks.mjs'
import * as Patches from './patches.mjs'
import * as Checkpoints from './checkpoints.mjs'
import * as Baselines from './baselines.mjs'
import { ASSISTANT_GUIDE } from './context.mjs'
import { newId, slug } from './util.mjs'
import { withState } from './state'

function text(s: string) {
  return { content: [{ type: 'text' as const, text: s }] }
}

function ago(ts: number): string {
  const m = Math.floor((Date.now() - ts) / 60000)
  if (m < 1) return 'just now'
  if (m < 60) return `${m}m ago`
  return `${Math.floor(m / 60)}h ago`
}

export function registerRtcMcpTools(server: McpServer, getRepo: () => string | null): void {
  const repoOrThrow = () => {
    const r = getRepo()
    if (!r) throw new Error('No repository is open in Hydrodam right now.')
    return r
  }
  const stateOrThrow = (cwd: string) => {
    const s = Store.loadState(cwd)
    if (!s) {
      throw new Error(
        'No live collaboration session in this repository. Ask your user to start one (Live collab in Hydrodam).'
      )
    }
    return s
  }
  const actorOrThrow = (state: any, actorId: string) => {
    const a = Actors.getActor(state.actors, actorId)
    if (!a) throw new Error(`Unknown actor id ${actorId}. Call rtc_join first.`)
    return a
  }

  server.registerTool(
    'rtc_guide',
    {
      title: 'Collaboration guide',
      description:
        'How to work in this live collaboration session. Read this before making any change in the repository.'
    },
    async () => text(ASSISTANT_GUIDE)
  )

  server.registerTool(
    'rtc_status',
    {
      title: 'Session status',
      description:
        'Who is connected and what they are doing: actors with presence, tasks, active locks, declared endpoints, unclaimed changes.'
    },
    async () => {
      const cwd = repoOrThrow()
      const s = stateOrThrow(cwd)
      const locks = Locks.activeLocks(s.locks)
      const lines: string[] = []
      lines.push(`Session ${s.session.id} on ${s.session.repoName} (base ${s.session.baseCommit.slice(0, 10)})`)
      lines.push('', 'Connected:')
      for (const a of s.actors) {
        if (a.type === 'system') continue
        const p = (s.presence as Record<string, any>)[a.id]
        const files = p?.activeFiles?.length ? p.activeFiles : a.activeFiles
        const bits = [
          a.type === 'agent' ? 'assistant' : a.type,
          `seen ${ago(a.lastSeenAt)}`,
          a.activeTaskId ? `on ${a.activeTaskId}` : null,
          files?.length ? `editing ${files.join(', ')}` : null,
          p?.cursor ? `at ${p.cursor.path}:${p.cursor.line}` : null
        ].filter(Boolean)
        lines.push(`  ${a.id} (${a.displayName}) - ${bits.join(', ')}`)
      }
      lines.push('', 'Tasks:')
      for (const t of s.tasks) lines.push(`  ${t.id} [${t.status}] ${t.title}${t.ownerActorId ? ` (${t.ownerActorId})` : ''}`)
      if (!s.tasks.length) lines.push('  (none)')
      lines.push('', 'Active locks:')
      for (const l of locks) lines.push(`  ${l.path} [${l.hardLock ? 'HARD' : 'soft'}] held by ${l.lockedByActorId}${l.reason ? `: ${l.reason}` : ''}`)
      if (!locks.length) lines.push('  (none)')
      lines.push('', 'Declared endpoints:')
      for (const c of s.contracts || []) lines.push(`  ${c.name}: ${c.signature}${c.file ? ` (${c.file})` : ''} - ${c.actorId}`)
      if (!(s.contracts || []).length) lines.push('  (none)')
      const unclaimed = s.changes.filter((c: any) => c.actorId === 'unknown')
      if (unclaimed.length) lines.push('', `Unclaimed changes: ${unclaimed.map((c: any) => c.path).join(', ')}`)
      return text(lines.join('\n'))
    }
  )

  server.registerTool(
    'rtc_join',
    {
      title: 'Join as an assistant',
      description:
        'Identify yourself in the session as an AI assistant owned by your user. Returns your actor id; pass it to every other rtc tool. Safe to call again - the same name reconnects the same actor.',
      inputSchema: {
        name: z.string().describe('Short assistant name, e.g. "claude"'),
        owner: z.string().optional().describe("Your user's name as it appears in the session")
      }
    },
    async ({ name, owner }) => {
      const cwd = repoOrThrow()
      return withState(cwd, (state) => {
        const humans = state.actors.filter((a: any) => a.type === 'human')
        const own =
          humans.find((h: any) => owner && (slug(h.displayName) === slug(owner) || h.id === owner)) ||
          humans.find((h: any) => h.id === state.session.hostActorId) ||
          humans[0]
        if (!own) throw new Error('No people in this session yet - your user must join first.')
        const display = name.toLowerCase().includes(slug(own.displayName)) ? name : `${slug(own.displayName)}-${name}`
        const existing = state.actors.find(
          (a: any) => a.type === 'agent' && a.id === `agent:${slug(display)}`
        )
        const actor =
          existing ||
          Actors.addActor(state.actors, { type: 'agent', displayName: display, humanOwnerActorId: own.id })
        Actors.touchActor(state.actors, actor.id, { status: 'online' })
        Store.savePresence(cwd, actor.id, { note: 'connected via MCP' })
        return text(
          [
            `You are ${actor.id}, owned by ${own.id}.`,
            'Pass this actor id to every rtc tool.',
            'Next: rtc_status to see the session, then rtc_plan BEFORE you edit anything.'
          ].join('\n')
        )
      })
    }
  )

  server.registerTool(
    'rtc_plan',
    {
      title: 'Declare a plan',
      description:
        'Declare what you are about to do BEFORE editing: creates (or claims) a task, soft-locks the files you name, records the endpoints/interfaces you intend to add or change, and snapshots baselines of those files for later conflict checks.',
      inputSchema: {
        actorId: z.string(),
        title: z.string().describe('What you are doing, as a task title'),
        description: z.string().optional(),
        taskId: z.string().optional().describe('Claim this existing task instead of creating one'),
        files: z.array(z.string()).describe('Files you want to lock while you work'),
        endpoints: z
          .array(z.object({ name: z.string(), signature: z.string(), file: z.string().optional() }))
          .optional()
          .describe('Interfaces you will add or change, so parallel work can build against them'),
        criteria: z.array(z.string()).optional().describe('Acceptance criteria')
      }
    },
    async ({ actorId, title, description, taskId, files, endpoints, criteria }) => {
      const cwd = repoOrThrow()
      return withState(cwd, (state) => {
        const actor = actorOrThrow(state, actorId)
        let task = taskId ? Tasks.getTask(state.tasks, taskId) : null
        if (taskId && !task) throw new Error(`Task not found: ${taskId}`)
        if (!task) {
          task = Tasks.createTask(state.tasks, { title, description, acceptanceCriteria: criteria || [] })
        }
        if (['backlog', 'ready'].includes(task.status)) {
          Tasks.claimTask(state.tasks, state.actors, task.id, actorId)
          Tasks.transitionTask(state.tasks, task.id, 'in_progress')
        }
        task.allowedFiles = [...new Set([...(task.allowedFiles || []), ...files])]

        const lockedNow: string[] = []
        const conflicts: string[] = []
        for (const f of files) {
          try {
            Locks.acquireLock(state.locks, state.actors, { path: f, actorId, taskId: task.id, reason: title })
            lockedNow.push(f)
          } catch (err: any) {
            conflicts.push(err.message)
          }
        }
        task.lockedFiles = [...new Set([...(task.lockedFiles || []), ...lockedNow])]

        for (const e of endpoints || []) {
          state.contracts.push({
            id: newId('contract'),
            taskId: task.id,
            actorId,
            name: e.name,
            signature: e.signature,
            file: e.file || null,
            createdAt: Date.now()
          })
        }

        Baselines.claimBaselines(cwd, actorId, files)
        Actors.touchActor(state.actors, actorId, { activeTaskId: task.id, activeFiles: files })

        const lines = [
          `Plan recorded on ${task.id} (${task.status}).`,
          lockedNow.length ? `Locked: ${lockedNow.join(', ')}` : 'Locked: nothing',
          (endpoints || []).length ? `Declared endpoints: ${(endpoints || []).map((e) => e.name).join(', ')}` : null,
          'Baselines snapshotted - call rtc_check_files before every write.'
        ].filter(Boolean) as string[]
        if (conflicts.length) {
          lines.push('', 'LOCK CONFLICTS - do not edit these until resolved:', ...conflicts.map((c) => `  ${c}`))
        }
        return text(lines.join('\n'))
      })
    }
  )

  server.registerTool(
    'rtc_check_files',
    {
      title: 'Check for concurrent edits',
      description:
        'Compare your claimed baselines to the files on disk. Call this before EVERY write: "changed" means someone (probably your user) edited the file since you claimed it - re-read it, merge their changes with yours, rtc_claim_files again, and only then write.',
      inputSchema: {
        actorId: z.string(),
        paths: z.array(z.string()).optional().describe('Defaults to everything you have claimed')
      }
    },
    async ({ actorId, paths }) => {
      const cwd = repoOrThrow()
      const state = stateOrThrow(cwd)
      const results = Baselines.checkBaselines(cwd, actorId, paths ?? null)
      if (!results.length) return text('You have no claimed baselines. Call rtc_plan or rtc_claim_files first.')
      const lines = results.map((r: any) => {
        if (r.status === 'clean') return `clean     ${r.path}`
        const who = state.changes.find((c: any) => c.path === r.path && c.actorId !== actorId)
        const by = who ? ` (last touched by ${who.actorId})` : ''
        if (r.status === 'changed') return `CHANGED   ${r.path}${by} - merge before writing`
        if (r.status === 'appeared') return `APPEARED  ${r.path}${by} - someone created it first, merge before writing`
        if (r.status === 'deleted') return `DELETED   ${r.path}${by} - confirm before recreating`
        return `unclaimed ${r.path} - claim it with rtc_claim_files`
      })
      const dirty = results.some((r: any) => r.status !== 'clean')
      if (dirty) {
        lines.push('', 'Treat every non-clean file as a merge conflict: re-read, merge, re-claim, then write.')
      }
      return text(lines.join('\n'))
    }
  )

  server.registerTool(
    'rtc_claim_files',
    {
      title: 'Claim or re-claim files',
      description:
        'Lock additional files and snapshot their baselines, or refresh baselines after you write (so your own edit becomes the new reference point).',
      inputSchema: {
        actorId: z.string(),
        paths: z.array(z.string()),
        reason: z.string().optional()
      }
    },
    async ({ actorId, paths, reason }) => {
      const cwd = repoOrThrow()
      return withState(cwd, (state) => {
        actorOrThrow(state, actorId)
        const conflicts: string[] = []
        for (const p of paths) {
          if (Locks.conflictingLock(state.locks, p, actorId)) {
            conflicts.push(p)
            continue
          }
          if (!Locks.locksOn(state.locks, p).some((l: any) => l.lockedByActorId === actorId)) {
            Locks.acquireLock(state.locks, state.actors, { path: p, actorId, reason: reason || 'claimed via MCP' })
          }
        }
        Baselines.claimBaselines(cwd, actorId, paths)
        const lines = [`Baselines refreshed for ${paths.length} file(s).`]
        if (conflicts.length) lines.push(`Locked by someone else (baseline taken, but coordinate before editing): ${conflicts.join(', ')}`)
        return text(lines.join('\n'))
      })
    }
  )

  server.registerTool(
    'rtc_presence',
    {
      title: 'Update presence',
      description: 'Tell the session where you are: current file and line, active files, a short note.',
      inputSchema: {
        actorId: z.string(),
        file: z.string().optional(),
        line: z.number().int().min(1).optional(),
        activeFiles: z.array(z.string()).optional(),
        note: z.string().optional()
      }
    },
    async ({ actorId, file, line, activeFiles, note }) => {
      const cwd = repoOrThrow()
      return withState(cwd, (state) => {
        const actor = actorOrThrow(state, actorId)
        const cursor = file ? { path: file, line: line || 1 } : undefined
        Actors.touchActor(state.actors, actorId, {
          ...(cursor ? { cursor } : {}),
          ...(activeFiles ? { activeFiles } : {})
        })
        Store.savePresence(cwd, actorId, {
          activeFiles: activeFiles || actor.activeFiles,
          ...(cursor ? { cursor } : {}),
          ...(note ? { note } : {})
        })
        return text('Presence updated.')
      })
    }
  )

  server.registerTool(
    'rtc_checkpoint',
    {
      title: 'Checkpoint your work',
      description:
        'Turn your changes into a reviewable patch plus checkpoint. A person reviews, applies and commits it in Hydrodam - this never commits anything itself.',
      inputSchema: {
        actorId: z.string(),
        summary: z.string().optional(),
        taskId: z.string().optional().describe('Defaults to your active task')
      }
    },
    async ({ actorId, summary, taskId }) => {
      const cwd = repoOrThrow()
      return withState(cwd, async (state) => {
        const actor = actorOrThrow(state, actorId)
        const task = taskId || actor.activeTaskId || null
        // The change log only fills while the app watches; fall back to the
        // files this actor claimed so MCP-only work still checkpoints.
        const claimed = Baselines.checkBaselines(cwd, actorId).map((r: any) => r.path)
        const fromLog = state.changes.filter((c: any) => c.actorId === actorId).map((c: any) => c.path)
        const paths = [...new Set([...fromLog, ...claimed])]
        if (!paths.length) throw new Error('Nothing to checkpoint - no changes or claimed files for you.')
        const patch = await Patches.createPatch(cwd, state, { actorId, taskId: task, paths, summary: summary || '' })
        const cp = Checkpoints.createCheckpoint(state, {
          taskId: task,
          patchIds: [patch.id],
          actorId,
          summary: summary || ''
        })
        return text(
          [
            `Created ${patch.id} (${patch.filesChanged.length} file(s), risk ${patch.riskLevel}) and ${cp.id}.`,
            `Recommendation: ${cp.recommendation}.`,
            'A person reviews and commits it in Hydrodam - do not commit yourself.'
          ].join('\n')
        )
      })
    }
  )

  server.registerTool(
    'rtc_release',
    {
      title: 'Release locks and baselines',
      description: 'Free everything you hold when you finish or step away.',
      inputSchema: { actorId: z.string() }
    },
    async ({ actorId }) => {
      const cwd = repoOrThrow()
      return withState(cwd, (state) => {
        actorOrThrow(state, actorId)
        let released = 0
        for (const l of Locks.activeLocks(state.locks)) {
          if (l.lockedByActorId === actorId) {
            Locks.releaseLock(state.locks, l.id)
            released++
          }
        }
        Baselines.releaseBaselines(cwd, actorId)
        Actors.touchActor(state.actors, actorId, { activeFiles: [], cursor: null, status: 'idle' })
        Store.savePresence(cwd, actorId, { note: 'released' })
        return text(`Released ${released} lock(s) and your baselines.`)
      })
    }
  )
}
