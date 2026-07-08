// advisor.mjs - the manager's rule-based brain. Version one never edits code:
// it looks at actors, tasks, locks, patches and checkpoints and produces
// suggestions the user can act on with one click.

import { staleBlocks, getTask } from './tasks.mjs'
import { taskProgress } from './checkpoints.mjs'
import { suggestHardLock } from './locks.mjs'

let seq = 0
function tip(kind, severity, message, extra = {}) {
  return { id: `tip-${++seq}`, kind, severity, message, ...extra }
}

/** Inspect the whole session state and return coordination suggestions. */
export function advise(state, now = Date.now()) {
  const tips = []
  const { actors, tasks, locks, patches, changes } = state

  // Two actors about to collide: same file in their active sets or pending changes.
  const touching = {}
  for (const a of actors) {
    for (const f of a.activeFiles || []) (touching[f] ||= new Set()).add(a.id)
  }
  for (const c of changes) (touching[c.path] ||= new Set()).add(c.actorId)
  for (const [file, who] of Object.entries(touching)) {
    const ids = [...who].filter((id) => id !== 'unknown')
    if (ids.length > 1) {
      tips.push(
        tip('collision', 'high', `${ids.join(' and ')} are both working on ${file}. Consider a lock or splitting the work.`, { file, actorIds: ids })
      )
    }
  }

  // Blocked/unblocked drift against dependencies.
  for (const s of staleBlocks(tasks)) {
    tips.push(
      s.shouldBe === 'blocked'
        ? tip('mark-blocked', 'medium', `"${s.task.title}" depends on unfinished work and should be marked blocked.`, { taskId: s.task.id })
        : tip('unblock', 'medium', `All dependencies of "${s.task.title}" are merged - it can be unblocked.`, { taskId: s.task.id })
    )
  }

  // Contract coupling: a task that depends on another while both name the same files.
  for (const t of tasks) {
    for (const depId of t.dependsOn || []) {
      const dep = getTask(tasks, depId)
      if (!dep) continue
      const overlap = (t.allowedFiles || []).filter((f) => (dep.allowedFiles || []).includes(f))
      if (overlap.length) {
        tips.push(
          tip('contract', 'medium', `"${t.title}" builds on the API of "${dep.title}" (${overlap.join(', ')}). Agree the contract before parallel work.`, { taskId: t.id, dependsOnTaskId: dep.id, files: overlap })
        )
      }
    }
  }

  // Uncaptured work piling up.
  const byActor = {}
  for (const c of changes) (byActor[c.actorId] ||= []).push(c)
  for (const [actorId, list] of Object.entries(byActor)) {
    if (actorId === 'unknown') {
      tips.push(tip('assign-changes', 'medium', `${list.length} changed file${list.length === 1 ? '' : 's'} have no owner yet - assign them to an actor.`, { files: list.map((c) => c.path) }))
    } else if (list.length >= 5) {
      tips.push(tip('create-patch', 'low', `${actorId} has ${list.length} uncaptured file changes - turn them into a patch before they grow.`, { actorId }))
    }
  }

  for (const p of patches) {
    if (p.status === 'conflicted') {
      tips.push(tip('resolve-conflict', 'high', `Patch ${p.id} does not apply cleanly - resolve the conflict first.`, { patchId: p.id }))
    }
    if (p.status === 'draft' && p.filesChanged.length > 15) {
      tips.push(tip('split-patch', 'medium', `Patch ${p.id} touches ${p.filesChanged.length} files - split it for reviewability.`, { patchId: p.id }))
    }
    if (['draft', 'needs_review'].includes(p.status) && p.filesChanged.some(suggestHardLock)) {
      tips.push(tip('risky', 'high', `Patch ${p.id} touches risky files (lockfile, binary or migration) - it needs sign-off before it lands.`, { patchId: p.id }))
    }
    if (p.status === 'accepted') {
      tips.push(tip('commit-patch', 'low', `Patch ${p.id} is accepted - stage and commit it via a checkpoint.`, { patchId: p.id }))
    }
  }

  // Tasks sitting in review with all patches accepted.
  for (const t of tasks) {
    if (t.status !== 'needs_review') continue
    const mine = patches.filter((p) => p.taskId === t.id)
    if (mine.length && mine.every((p) => ['accepted', 'applied'].includes(p.status))) {
      tips.push(tip('checkpoint', 'medium', `Every patch on "${t.title}" is accepted (${taskProgress(t, patches)}%) - create a checkpoint.`, { taskId: t.id }))
    }
  }

  // Expired locks still on the books.
  for (const l of locks) {
    if (!l.releasedAt && l.expiresAt && l.expiresAt < now) {
      tips.push(tip('stale-lock', 'low', `The lock on ${l.path} held by ${l.lockedByActorId} has expired - release it.`, { lockId: l.id }))
    }
  }

  return tips
}
