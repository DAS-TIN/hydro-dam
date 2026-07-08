// sync.mjs - the network sync boundary. Deliberately an interface with a
// local no-op transport for now: sessions are fully usable on one machine,
// and a WebSocket/WebRTC transport can slot in later without touching the
// rest of the system. Only metadata and patches ever travel - never raw
// file writes, and in clone mode never file contents at all.

/**
 * @typedef {Object} SyncTransport
 * @property {(actors: any[]) => void} sendActors
 * @property {(tasks: any[]) => void} sendTasks
 * @property {(locks: any[]) => void} sendLocks
 * @property {(patchMeta: any) => void} sendPatch        patch metadata + diff
 * @property {(checkpointMeta: any) => void} sendCheckpoint
 * @property {(presence: any) => void} sendPresence
 * @property {(comment: any) => void} sendComment
 * @property {(handler: (msg: any) => void) => void} onMessage
 * @property {() => void} close
 */

/**
 * Local transport: queues outbound messages so the UI can show what WOULD
 * sync, and never delivers anything. Guests on the same machine work off
 * the shared .rtc folder instead.
 * @returns {SyncTransport & { outbox: any[] }}
 */
export function createLocalTransport() {
  const outbox = []
  const push = (type) => (payload) => {
    outbox.push({ type, payload, at: Date.now() })
    if (outbox.length > 200) outbox.shift()
  }
  return {
    outbox,
    sendActors: push('actors'),
    sendTasks: push('tasks'),
    sendLocks: push('locks'),
    sendPatch: push('patch'),
    sendCheckpoint: push('checkpoint'),
    sendPresence: push('presence'),
    sendComment: push('comment'),
    onMessage() {},
    close() {}
  }
}
