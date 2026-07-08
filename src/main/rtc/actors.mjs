// actors.mjs - the actor registry: humans, their agents, managers, system.
//
// Ids are stable and readable: "human:dastin", "agent:dastin-claude". Every
// agent must point at the person that owns it so any agent change is
// attributable to both.

import { slug } from './util.mjs'

export const ACTOR_TYPES = ['human', 'agent', 'manager', 'system']

const DEFAULT_PERMISSIONS = {
  human: { editFiles: true, applyPatches: true, commit: true, manageLocks: true, manageTasks: true, runCommands: false },
  agent: { editFiles: true, applyPatches: false, commit: false, manageLocks: false, manageTasks: false, runCommands: false },
  manager: { editFiles: false, applyPatches: false, commit: false, manageLocks: false, manageTasks: false, runCommands: false },
  system: { editFiles: false, applyPatches: false, commit: false, manageLocks: false, manageTasks: false, runCommands: false }
}

function uniqueId(actors, base) {
  if (!actors.some((a) => a.id === base)) return base
  let n = 2
  while (actors.some((a) => a.id === `${base}-${n}`)) n++
  return `${base}-${n}`
}

/**
 * Create an actor and append it to the list. Agents must name an owner who
 * is already in the session. Returns the new actor.
 */
export function addActor(actors, { type, displayName, humanOwnerActorId = null, email = null, permissions = null }, now = Date.now()) {
  if (!ACTOR_TYPES.includes(type)) throw new Error(`Unknown actor type: ${type}`)
  const name = String(displayName || '').trim()
  if (!name) throw new Error('Actor needs a display name.')
  if (type === 'agent') {
    const owner = actors.find((a) => a.id === humanOwnerActorId)
    if (!owner || owner.type !== 'human') throw new Error('An agent must belong to a person in the session.')
  }
  if (type === 'human' || type === 'system') humanOwnerActorId = null
  const id = uniqueId(actors, `${type}:${slug(name)}`)
  const actor = {
    id,
    type,
    displayName: name,
    email,
    humanOwnerActorId,
    permissions: permissions || { ...DEFAULT_PERMISSIONS[type] },
    joinedAt: now,
    lastSeenAt: now,
    activeTaskId: null,
    activeFiles: [],
    cursor: null,
    status: 'online'
  }
  actors.push(actor)
  return actor
}

export function getActor(actors, id) {
  return actors.find((a) => a.id === id) || null
}

/** The person ultimately responsible for this actor. */
export function humanOwnerOf(actors, actorId) {
  const a = getActor(actors, actorId)
  if (!a) return null
  if (a.type === 'human') return a
  return a.humanOwnerActorId ? getActor(actors, a.humanOwnerActorId) : null
}

export function touchActor(actors, actorId, patch = {}, now = Date.now()) {
  const a = getActor(actors, actorId)
  if (!a) return null
  a.lastSeenAt = now
  if (patch.activeFiles !== undefined) a.activeFiles = patch.activeFiles
  if (patch.cursor !== undefined) a.cursor = patch.cursor
  if (patch.activeTaskId !== undefined) a.activeTaskId = patch.activeTaskId
  if (patch.status !== undefined) a.status = patch.status
  return a
}

/** All agents owned by one person, for the "who owns which Claude" view. */
export function agentsOf(actors, humanId) {
  return actors.filter((a) => a.type === 'agent' && a.humanOwnerActorId === humanId)
}
