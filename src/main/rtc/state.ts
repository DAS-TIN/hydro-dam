// state.ts - persistence helpers shared by the IPC layer and the MCP tools.
// Both mutate the same .rtc state, so the save-everything + rewrite-context +
// notify-the-UI dance lives here once.

import { BrowserWindow } from 'electron'
import * as Store from './store.mjs'
import * as Context from './context.mjs'

const COLLECTIONS = [
  'session', 'actors', 'tasks', 'locks', 'patches', 'checkpoints',
  'suggestions', 'changes', 'violations', 'contracts', 'manifest', 'settings', 'local'
] as const

export function broadcast(payload: any): void {
  for (const w of BrowserWindow.getAllWindows()) w.webContents.send('rtc:event', payload)
}

// Load state, let fn mutate it, persist everything, refresh agent context.
export async function withState<T>(cwd: string, fn: (state: any) => Promise<T> | T): Promise<T> {
  const state = Store.loadState(cwd)
  if (!state) throw new Error('No RTC session in this repository.')
  const result = await fn(state)
  for (const name of COLLECTIONS) Store.saveColl(cwd, name, state[name])
  Context.writeContext(cwd, state)
  broadcast({ kind: 'state', cwd })
  return result
}
