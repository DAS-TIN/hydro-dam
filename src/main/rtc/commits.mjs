// commits.mjs - staging and commit recommendations. Suggestions are only
// ever suggestions: nothing is staged, committed or co-authored until
// someone presses Approve in the UI.

import { git, newId } from './util.mjs'
import { humanOwnerOf } from './actors.mjs'

/**
 * Build a commit suggestion from a checkpoint: title from the task, body
 * from the summary and files, co-author candidates from every actor whose
 * patches are in the checkpoint (plus the agents' owners).
 */
export function suggestCommit(state, checkpointId, now = Date.now()) {
  const cp = state.checkpoints.find((c) => c.id === checkpointId)
  if (!cp) throw new Error('Checkpoint not found.')
  const task = cp.taskId ? state.tasks.find((t) => t.id === cp.taskId) : null
  const patches = cp.patchIds.map((id) => state.patches.find((p) => p.id === id)).filter(Boolean)

  const involved = new Map()
  for (const p of patches) {
    for (const id of [p.createdByActorId, p.humanOwnerActorId]) {
      const a = state.actors.find((x) => x.id === id)
      if (a && a.type !== 'system') involved.set(a.id, a)
    }
    const owner = humanOwnerOf(state.actors, p.createdByActorId)
    if (owner) involved.set(owner.id, owner)
  }

  const title = (task ? task.title : cp.summary).slice(0, 72)
  const bodyLines = []
  if (cp.summary && cp.summary !== title) bodyLines.push(cp.summary)
  if (task?.description) bodyLines.push(task.description)
  bodyLines.push('', 'Files:', ...cp.files.map((f) => `- ${f}`))
  if (cp.risks.length) bodyLines.push('', 'Risks noted at checkpoint:', ...cp.risks.map((r) => `- ${r}`))

  const suggestion = {
    id: newId('commit'),
    checkpointId,
    title,
    body: bodyLines.join('\n').trim(),
    coAuthors: [...involved.values()].map((a) => ({
      actorId: a.id,
      name: a.displayName,
      email: a.email || `${a.id.replace(':', '.')}@rtc.invalid`,
      selected: false
    })),
    suggestedByActorId: state.local?.activeActorId || null,
    requiresHumanApproval: true,
    status: 'pending',
    createdAt: now
  }
  state.suggestions.push(suggestion)
  return suggestion
}

/**
 * Runs when the user presses Approve: stage exactly the checkpoint's files
 * and commit with the message and co-authors they chose. Never called
 * automatically.
 */
export async function approveCommit(cwd, state, suggestionId, { title, body, coAuthors } = {}) {
  const s = state.suggestions.find((x) => x.id === suggestionId)
  if (!s) throw new Error('Suggestion not found.')
  const cp = state.checkpoints.find((c) => c.id === s.checkpointId)
  if (!cp) throw new Error('Checkpoint not found.')

  const finalTitle = (title ?? s.title).trim()
  if (!finalTitle) throw new Error('The commit needs a title.')
  const chosen = coAuthors ?? s.coAuthors.filter((c) => c.selected)

  await git(cwd, ['add', '--', ...cp.files])
  let message = finalTitle
  const finalBody = (body ?? s.body).trim()
  if (finalBody) message += `\n\n${finalBody}`
  if (chosen.length) {
    message += '\n\n' + chosen.map((c) => `Co-Authored-By: ${c.name} <${c.email}>`).join('\n')
  }
  await git(cwd, ['commit', '-F', '-'], { input: message })
  const hash = (await git(cwd, ['rev-parse', 'HEAD'])).trim()

  s.status = 'committed'
  s.commitHash = hash
  const task = cp.taskId ? state.tasks.find((t) => t.id === cp.taskId) : null
  if (task && task.status === 'checkpointed') task.status = 'merged'
  return { hash, message }
}
