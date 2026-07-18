import { spawn, ChildProcessWithoutNullStreams } from 'node:child_process'
import { pathToFileURL } from 'node:url'
import { join } from 'node:path'
import { BrowserWindow } from 'electron'
import * as G from './git'

// One external language server we know how to launch. These are tools the user
// installs themselves (npm i -g typescript-language-server, etc.); we only speak
// to them, never bundle them.
interface ServerDef {
  languageId: string
  command: string
  args: string[]
}

function serverFor(ext: string): ServerDef | null {
  switch (ext) {
    case 'ts':
      return { languageId: 'typescript', command: 'typescript-language-server', args: ['--stdio'] }
    case 'tsx':
      return { languageId: 'typescriptreact', command: 'typescript-language-server', args: ['--stdio'] }
    case 'js':
    case 'mjs':
    case 'cjs':
      return { languageId: 'javascript', command: 'typescript-language-server', args: ['--stdio'] }
    case 'jsx':
      return { languageId: 'javascriptreact', command: 'typescript-language-server', args: ['--stdio'] }
    case 'py':
      return { languageId: 'python', command: 'pylsp', args: [] }
    case 'rs':
      return { languageId: 'rust', command: 'rust-analyzer', args: [] }
    case 'go':
      return { languageId: 'go', command: 'gopls', args: [] }
    default:
      return null
  }
}

type Status = 'starting' | 'running' | 'not-found' | 'error'

interface DiagPayload {
  cwd: string
  path: string
  diagnostics: unknown[]
}

function broadcast(channel: string, payload: unknown): void {
  for (const w of BrowserWindow.getAllWindows()) w.webContents.send(channel, payload)
}

// A single language-server process, framed as JSON-RPC over stdio.
class Server {
  private proc: ChildProcessWithoutNullStreams | null = null
  private buf = Buffer.alloc(0)
  private nextId = 1
  private pending = new Map<number, { resolve: (v: any) => void; reject: (e: any) => void }>()
  private docs = new Map<string, number>() // uri -> version
  ready: Promise<void>
  status: Status = 'starting'
  error?: string
  private resolveReady!: () => void
  private rejectReady!: (e: any) => void

  constructor(
    private rootUri: string,
    private rootPath: string,
    private cwd: string,
    private def: ServerDef
  ) {
    this.ready = new Promise((res, rej) => {
      this.resolveReady = res
      this.rejectReady = rej
    })
    this.start()
  }

  private start(): void {
    let proc: ChildProcessWithoutNullStreams
    try {
      proc = spawn(this.def.command, this.def.args, { cwd: this.rootPath, shell: process.platform === 'win32' })
    } catch (e: any) {
      this.fail(e?.code === 'ENOENT' ? 'not-found' : 'error', e?.message)
      return
    }
    this.proc = proc
    proc.on('error', (e: any) =>
      this.fail(e?.code === 'ENOENT' ? 'not-found' : 'error', `${this.def.command}: ${e?.message}`)
    )
    proc.on('exit', () => {
      if (this.status !== 'not-found') this.status = 'error'
    })
    proc.stdout.on('data', (d: Buffer) => this.onData(d))
    this.initialize().then(this.resolveReady).catch((e) => this.fail('error', String(e?.message || e)))
  }

  private fail(status: Status, error?: string): void {
    this.status = status
    this.error = error
    for (const p of this.pending.values()) p.reject(new Error(error || status))
    this.pending.clear()
    this.rejectReady(new Error(error || status))
  }

  private write(msg: unknown): void {
    if (!this.proc) return
    const body = Buffer.from(JSON.stringify(msg), 'utf8')
    this.proc.stdin.write(`Content-Length: ${body.length}\r\n\r\n`)
    this.proc.stdin.write(body)
  }

  private request(method: string, params: unknown): Promise<any> {
    const id = this.nextId++
    this.write({ jsonrpc: '2.0', id, method, params })
    return new Promise((resolve, reject) => this.pending.set(id, { resolve, reject }))
  }

  private notify(method: string, params: unknown): void {
    this.write({ jsonrpc: '2.0', method, params })
  }

  private onData(chunk: Buffer): void {
    this.buf = Buffer.concat([this.buf, chunk])
    // Pull out every complete Content-Length framed message the buffer holds.
    for (;;) {
      const headerEnd = this.buf.indexOf('\r\n\r\n')
      if (headerEnd === -1) break
      const header = this.buf.slice(0, headerEnd).toString('utf8')
      const m = /content-length:\s*(\d+)/i.exec(header)
      if (!m) {
        this.buf = this.buf.slice(headerEnd + 4)
        continue
      }
      const len = parseInt(m[1], 10)
      const start = headerEnd + 4
      if (this.buf.length < start + len) break
      const body = this.buf.slice(start, start + len).toString('utf8')
      this.buf = this.buf.slice(start + len)
      try {
        this.onMessage(JSON.parse(body))
      } catch {
        // ignore malformed frames
      }
    }
  }

  private onMessage(msg: any): void {
    // Response to one of our requests.
    if (msg.id !== undefined && (msg.result !== undefined || msg.error !== undefined)) {
      const p = this.pending.get(msg.id)
      if (p) {
        this.pending.delete(msg.id)
        msg.error ? p.reject(new Error(msg.error.message)) : p.resolve(msg.result)
      }
      return
    }
    // Server->client request: answer it so the server doesn't stall.
    if (msg.id !== undefined && msg.method) {
      const result = msg.method === 'workspace/configuration' ? (msg.params?.items ?? []).map(() => ({})) : null
      this.write({ jsonrpc: '2.0', id: msg.id, result })
      return
    }
    // Notifications we care about.
    if (msg.method === 'textDocument/publishDiagnostics') {
      broadcast('lsp:diagnostics', {
        cwd: this.cwd,
        path: this.relOf(msg.params.uri),
        diagnostics: msg.params.diagnostics
      } satisfies DiagPayload)
    }
  }

  private relOf(uri: string): string {
    const p = decodeURIComponent(new URL(uri).pathname).replace(/^\/([A-Za-z]:)/, '$1')
    const root = this.rootPath.replace(/\\/g, '/')
    return p.startsWith(root) ? p.slice(root.length).replace(/^[\\/]/, '') : p
  }

  private async initialize(): Promise<void> {
    await this.request('initialize', {
      processId: process.pid,
      rootUri: this.rootUri,
      workspaceFolders: [{ uri: this.rootUri, name: 'root' }],
      capabilities: {
        textDocument: {
          synchronization: { dynamicRegistration: false, didSave: false },
          publishDiagnostics: { relatedInformation: true }
        }
      }
    })
    this.notify('initialized', {})
    this.status = 'running'
  }

  didOpen(uri: string, text: string): void {
    this.docs.set(uri, 1)
    this.notify('textDocument/didOpen', {
      textDocument: { uri, languageId: this.def.languageId, version: 1, text }
    })
  }

  didChange(uri: string, text: string): void {
    const v = (this.docs.get(uri) ?? 1) + 1
    this.docs.set(uri, v)
    this.notify('textDocument/didChange', {
      textDocument: { uri, version: v },
      contentChanges: [{ text }]
    })
  }

  didClose(uri: string): void {
    if (!this.docs.has(uri)) return
    this.docs.delete(uri)
    this.notify('textDocument/didClose', { textDocument: { uri } })
  }

  dispose(): void {
    try {
      this.proc?.kill()
    } catch {
      // already gone
    }
  }
}

const servers = new Map<string, Server>() // key: command + '::' + rootUri

function extOf(path: string): string {
  return path.split('.').pop()?.toLowerCase() || ''
}

async function resolve(
  cwd: string,
  path: string
): Promise<{ server: Server; uri: string; def: ServerDef } | { server: null; def: ServerDef | null }> {
  const def = serverFor(extOf(path))
  if (!def) return { server: null, def: null }
  const root = (await G.repoRoot(cwd).catch(() => null)) || cwd
  const rootUri = pathToFileURL(root).href
  const key = `${def.command}::${rootUri}`
  let server = servers.get(key)
  if (!server) {
    server = new Server(rootUri, root, cwd, def)
    servers.set(key, server)
  }
  const uri = pathToFileURL(join(cwd, path)).href
  try {
    await server.ready
  } catch {
    return { server: null, def }
  }
  return { server, uri, def }
}

export async function openDoc(cwd: string, path: string, text: string): Promise<{ status: Status; error?: string }> {
  const r = await resolve(cwd, path)
  if (!r.server) return statusFrom(r.def, cwd, path)
  r.server.didOpen(r.uri, text)
  return { status: r.server.status, error: r.server.error }
}

export async function changeDoc(cwd: string, path: string, text: string): Promise<void> {
  const r = await resolve(cwd, path)
  if (r.server) r.server.didChange(r.uri, text)
}

export async function closeDoc(cwd: string, path: string): Promise<void> {
  const r = await resolve(cwd, path)
  if (r.server) r.server.didClose(r.uri)
}

export async function statusFor(cwd: string, path: string): Promise<{ status: Status | 'unsupported'; command?: string; error?: string }> {
  const def = serverFor(extOf(path))
  if (!def) return { status: 'unsupported' }
  const root = (await G.repoRoot(cwd).catch(() => null)) || cwd
  const key = `${def.command}::${pathToFileURL(root).href}`
  const server = servers.get(key)
  return { status: server?.status ?? 'starting', command: def.command, error: server?.error }
}

function statusFrom(def: ServerDef | null, cwd: string, _path: string): { status: Status; error?: string } {
  if (!def) return { status: 'error', error: 'unsupported' }
  const root = cwd
  const key = `${def.command}::${pathToFileURL(root).href}`
  const server = servers.get(key)
  return { status: server?.status ?? 'error', error: server?.error }
}

export function disposeAll(): void {
  for (const s of servers.values()) s.dispose()
  servers.clear()
}
