import { createServer, Server as HttpServer, IncomingMessage, ServerResponse } from 'node:http'
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js'
import { z } from 'zod'
import * as G from './git'

export interface McpDeps {
  getRepo: () => string | null
  getDangerous: () => boolean
  getActiveCoauthors: () => { name: string; email: string }[]
}

let deps: McpDeps | null = null
let http: HttpServer | null = null
let currentPort = 0
let lastError: string | null = null

export function configureMcp(d: McpDeps): void {
  deps = d
}

export function mcpInfo() {
  return {
    running: !!http,
    port: currentPort,
    url: http ? `http://127.0.0.1:${currentPort}/mcp` : null,
    dangerous: deps?.getDangerous() ?? false,
    error: lastError
  }
}

function repoOrThrow(): string {
  const r = deps?.getRepo()
  if (!r) throw new Error('No repository is open in Hydrodam right now.')
  return r
}

function text(s: string) {
  return { content: [{ type: 'text' as const, text: s }] }
}

/** Build a fresh server instance (stateless: one per request). */
function buildServer(): McpServer {
  const server = new McpServer({ name: 'hydrodam', version: '0.1.0' })

  server.registerTool(
    'preview_commit',
    {
      title: 'Preview commit',
      description:
        'Show exactly what the next commit would contain: staged files with +/- line counts, the author, and the active co-authors (or "none"). Optionally include the message that would be used.',
      inputSchema: { message: z.string().optional().describe('Draft commit message to preview with trailers') }
    },
    async ({ message }) => {
      const cwd = repoOrThrow()
      const [files, who] = await Promise.all([G.stagedFiles(cwd), G.author(cwd)])
      const co = deps!.getActiveCoauthors()
      const totalAdd = files.reduce((n, f) => n + Math.max(0, f.add), 0)
      const totalDel = files.reduce((n, f) => n + Math.max(0, f.del), 0)
      const lines: string[] = []
      lines.push(`Staged files: ${files.length}  (+${totalAdd} / -${totalDel})`)
      for (const f of files) {
        const counts = f.add < 0 ? 'binary' : `+${f.add} -${f.del}`
        lines.push(`  ${f.status}  ${f.path}  (${counts})`)
      }
      lines.push('')
      lines.push(`Author: ${who.name || '(unset)'} <${who.email || '(unset)'}>`)
      lines.push(`Co-authors: ${co.length ? '' : 'none'}`)
      for (const c of co) lines.push(`  Co-Authored-By: ${c.name} <${c.email}>`)
      if (message) {
        lines.push('')
        lines.push('Message preview:')
        let full = message.trimEnd()
        if (co.length) full += '\n\n' + co.map((c) => `Co-Authored-By: ${c.name} <${c.email}>`).join('\n')
        lines.push(full.split('\n').map((l) => '  ' + l).join('\n'))
      }
      if (files.length === 0) lines.push('\n(Nothing staged - `git add` files first.)')
      return text(lines.join('\n'))
    }
  )

  server.registerTool(
    'status',
    { title: 'Repo status', description: 'Working-tree status: staged, changed, untracked, conflicts.' },
    async () => {
      const cwd = repoOrThrow()
      const s = await G.status(cwd)
      const byBucket = (pred: (f: G.FileEntry) => boolean) =>
        s.files.filter((f) => !f.ignored && pred(f)).map((f) => `  ${f.index}${f.work} ${f.path}`)
      const out = [
        `Branch: ${s.branch}${s.upstream ? ` -> ${s.upstream}` : ''}  (ahead ${s.ahead}, behind ${s.behind})`,
        'Staged:',
        ...byBucket((f) => f.staged && !f.conflicted),
        'Changed:',
        ...byBucket((f) => f.unstaged && !f.conflicted && !f.untracked),
        'Untracked:',
        ...byBucket((f) => f.untracked)
      ]
      return text(out.join('\n'))
    }
  )

  server.registerTool(
    'diff',
    {
      title: 'Diff',
      description: 'Unified diff. Set staged=true for the staged (cached) diff; optionally limit to one path.',
      inputSchema: { staged: z.boolean().optional(), path: z.string().optional() }
    },
    async ({ staged, path }) => {
      const cwd = repoOrThrow()
      const args = ['diff', '--no-color']
      if (staged) args.push('--cached')
      if (path) args.push('--', path)
      const out = await G.git(cwd, args)
      return text(out || '(no diff)')
    }
  )

  server.registerTool(
    'log_stat',
    {
      title: 'Recent commits (stat)',
      description: 'git log -n COUNT --stat for the most recent commit(s).',
      inputSchema: { count: z.number().int().min(1).max(20).optional() }
    },
    async ({ count }) => {
      const cwd = repoOrThrow()
      return text(await G.logStat(cwd, count ?? 1))
    }
  )

  server.registerTool(
    'show_commit',
    {
      title: 'Show a commit',
      description:
        'Full readable view of one commit: its message, the diffstat, and the complete patch ' +
        '(git show --stat -p). Pass a commit hash, or omit to show HEAD.',
      inputSchema: { hash: z.string().optional().describe('Commit hash (defaults to HEAD)') }
    },
    async ({ hash }) => {
      const cwd = repoOrThrow()
      return text(await G.commitShow(cwd, hash || 'HEAD'))
    }
  )

  server.registerTool(
    'coauthors',
    { title: 'Active co-authors', description: 'List the co-authors that will co-sign the next commit (or "none").' },
    async () => {
      const co = deps!.getActiveCoauthors()
      if (!co.length) return text('none')
      return text(co.map((c) => `Co-Authored-By: ${c.name} <${c.email}>`).join('\n'))
    }
  )

  server.registerTool(
    'branches',
    { title: 'Branches', description: 'All local and remote branches with upstream, ahead/behind, and last commit.' },
    async () => {
      const bs = await G.branchesFull(repoOrThrow())
      const lines = bs.map((b) => {
        const marks = [
          b.current ? '*' : ' ',
          b.remote ? 'remote' : 'local',
          b.upstream ? `-> ${b.upstream}` : '',
          b.ahead ? `ahead ${b.ahead}` : '',
          b.behind ? `behind ${b.behind}` : '',
          b.gone ? 'upstream gone' : ''
        ]
          .filter(Boolean)
          .join('  ')
        return `${marks}  ${b.name}  (${b.hash} ${b.subject}, ${b.relDate})`
      })
      return text(lines.join('\n') || '(no branches)')
    }
  )

  server.registerTool(
    'log_search',
    {
      title: 'Search history',
      description: 'Search commits by message text, author, or path. Returns hash, subject, author, date.',
      inputSchema: {
        grep: z.string().optional().describe('Text to find in commit messages'),
        author: z.string().optional(),
        path: z.string().optional().describe('Limit to commits touching this path'),
        limit: z.number().int().min(1).max(200).optional()
      }
    },
    async ({ grep, author, path, limit }) => {
      const commits = await G.logGraph(repoOrThrow(), { all: true, grep, author, path, limit: limit ?? 50 })
      const lines = commits.map((c) => `${c.shortHash}  ${c.subject}  (${c.author}, ${c.relDate})`)
      return text(lines.join('\n') || '(no matches)')
    }
  )

  server.registerTool(
    'file_at',
    {
      title: 'File at revision',
      description: 'Contents of a file at a given commit or ref (defaults to HEAD).',
      inputSchema: { path: z.string(), ref: z.string().optional() }
    },
    async ({ path, ref }) => text(await G.fileAtCommit(repoOrThrow(), ref || 'HEAD', path))
  )

  server.registerTool(
    'blame',
    {
      title: 'Blame',
      description: 'Per-line authorship for a file: commit, author, date, content.',
      inputSchema: { path: z.string() }
    },
    async ({ path }) => {
      const lines = await G.blame(repoOrThrow(), path)
      return text(
        lines.map((l) => `${l.shortHash} ${l.author.padEnd(18)} ${l.date} ${String(l.lineNo).padStart(5)}| ${l.content}`).join('\n')
      )
    }
  )

  server.registerTool(
    'numstat',
    { title: 'Working-tree line counts', description: 'Per-file +/- line counts, split into staged and unstaged.' },
    async () => {
      const ns = await G.workingNumstat(repoOrThrow())
      const fmt = (e: { path: string; add: number; del: number }) =>
        `  ${e.add < 0 ? 'binary' : `+${e.add} -${e.del}`}  ${e.path}`
      return text(
        ['Staged:', ...ns.staged.map(fmt), 'Unstaged:', ...ns.unstaged.map(fmt)].join('\n')
      )
    }
  )

  server.registerTool(
    'stash_list',
    { title: 'Stashes', description: 'List stash entries with branch and age.' },
    async () => {
      const st = await G.stashList(repoOrThrow())
      return text(st.map((s) => `${s.ref}  [${s.branch}]  ${s.subject}  (${s.relDate})`).join('\n') || '(no stashes)')
    }
  )

  server.registerTool(
    'reflog',
    {
      title: 'Reflog',
      description: 'Recent HEAD movements (checkouts, resets, commits) for recovering lost work.',
      inputSchema: { count: z.number().int().min(1).max(100).optional() }
    },
    async ({ count }) => {
      const entries = await G.reflog(repoOrThrow(), count ?? 30)
      return text(entries.map((e) => `${e.selector}  ${e.shortHash}  ${e.action}: ${e.subject}  (${e.relDate})`).join('\n'))
    }
  )

  server.registerTool(
    'conflicts',
    {
      title: 'Merge conflicts',
      description:
        'List every merge-conflicted file as JSON, each with its conflict regions parsed into ' +
        'ordered ours/base/theirs segments. Empty array means no conflicts.'
    },
    async () => {
      const cwd = repoOrThrow()
      const data = await G.conflictsJson(cwd)
      return text(JSON.stringify(data, null, 2))
    }
  )

  if (deps!.getDangerous()) {
    server.registerTool(
      'stage',
      {
        title: 'Stage paths',
        description: 'Stage files for commit. Pass paths, or omit to stage everything.',
        inputSchema: { paths: z.array(z.string()).optional() }
      },
      async ({ paths }) => {
        const cwd = repoOrThrow()
        if (paths && paths.length) await G.stage(cwd, paths)
        else await G.stageAll(cwd)
        return text('Staged.')
      }
    )

    server.registerTool(
      'commit',
      {
        title: 'Commit',
        description: 'Create a commit from staged changes, appending the active co-author trailers.',
        inputSchema: { message: z.string().describe('Commit message') }
      },
      async ({ message }) => {
        const cwd = repoOrThrow()
        const co = deps!.getActiveCoauthors()
        const out = await G.commit(cwd, message, co, false)
        return text(out || 'Committed.')
      }
    )

    server.registerTool(
      'stash',
      {
        title: 'Stash',
        description: 'Stash working changes (including untracked).',
        inputSchema: { message: z.string().optional() }
      },
      async ({ message }) => text(await G.stash(repoOrThrow(), message))
    )

    server.registerTool(
      'push',
      { title: 'Push', description: 'Push the current branch to its remote.' },
      async () => text(await G.push(repoOrThrow()))
    )

    server.registerTool(
      'uncommit',
      { title: 'Undo last commit', description: 'Soft-reset HEAD~1: undo the last commit but keep its changes staged.' },
      async () => {
        await G.undoCommit(repoOrThrow())
        return text('Last commit undone (changes kept staged).')
      }
    )

    server.registerTool(
      'resolve_conflict',
      {
        title: 'Resolve a conflict',
        description:
          'Write the fully-resolved contents for a conflicted file (all conflict markers removed) and stage it.',
        inputSchema: { path: z.string(), content: z.string() }
      },
      async ({ path, content }) => {
        await G.resolveWith(repoOrThrow(), path, content)
        return text(`Resolved and staged ${path}.`)
      }
    )

    server.registerTool(
      'unstage',
      {
        title: 'Unstage paths',
        description: 'Remove files from the next commit but keep the changes. Omit paths to unstage everything.',
        inputSchema: { paths: z.array(z.string()).optional() }
      },
      async ({ paths }) => {
        const cwd = repoOrThrow()
        if (paths && paths.length) await G.unstage(cwd, paths)
        else await G.unstageAll(cwd)
        return text('Unstaged.')
      }
    )

    server.registerTool(
      'checkout',
      {
        title: 'Checkout branch',
        description: 'Switch to an existing branch.',
        inputSchema: { branch: z.string() }
      },
      async ({ branch }) => {
        await G.checkout(repoOrThrow(), branch)
        return text(`Switched to ${branch}.`)
      }
    )

    server.registerTool(
      'create_branch',
      {
        title: 'Create branch',
        description: 'Create and switch to a new branch at HEAD.',
        inputSchema: { name: z.string() }
      },
      async ({ name }) => {
        await G.createBranch(repoOrThrow(), name)
        return text(`Created and switched to ${name}.`)
      }
    )

    server.registerTool(
      'fetch',
      { title: 'Fetch', description: 'Fetch from all remotes (no working-tree changes).' },
      async () => text((await G.fetch(repoOrThrow())) || 'Fetched.')
    )

    server.registerTool(
      'pull',
      { title: 'Pull', description: 'Pull the current branch from its upstream.' },
      async () => text((await G.pull(repoOrThrow())) || 'Pulled.')
    )
  }

  return server
}

function readBody(req: IncomingMessage): Promise<unknown> {
  return new Promise((resolve) => {
    const chunks: Buffer[] = []
    req.on('data', (c) => chunks.push(c))
    req.on('end', () => {
      const raw = Buffer.concat(chunks).toString('utf8')
      try {
        resolve(raw ? JSON.parse(raw) : undefined)
      } catch {
        resolve(undefined)
      }
    })
    req.on('error', () => resolve(undefined))
  })
}

async function handle(req: IncomingMessage, res: ServerResponse): Promise<void> {
  const url = (req.url || '/').split('?')[0]

  // Loopback-only: refuse non-local connections.
  const ra = req.socket.remoteAddress || ''
  if (!(ra === '127.0.0.1' || ra === '::1' || ra === '::ffff:127.0.0.1')) {
    res.writeHead(403).end('Hydrodam MCP is loopback-only.')
    return
  }

  if (req.method === 'GET' && url !== '/mcp') {
    res.writeHead(200, { 'content-type': 'text/plain' })
    res.end(
      `Hydrodam MCP server is running.\nConnect an MCP client to: http://127.0.0.1:${currentPort}/mcp\nDangerous mode: ${deps?.getDangerous() ? 'ON (write tools enabled)' : 'off (read-only)'}`
    )
    return
  }

  if (req.method !== 'POST') {
    res.writeHead(405).end('Method Not Allowed')
    return
  }

  // Stateless: one server + transport per request.
  const body = await readBody(req)
  const server = buildServer()
  const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined })
  res.on('close', () => {
    transport.close()
    server.close()
  })
  try {
    await server.connect(transport)
    await transport.handleRequest(req, res, body)
  } catch (err: any) {
    if (!res.headersSent) res.writeHead(500).end(String(err?.message || err))
  }
}

/** Start the server on port. Resolves once listening (or rejects on error). */
function start(port: number): Promise<void> {
  return new Promise((resolve, reject) => {
    const srv = createServer((req, res) => {
      handle(req, res).catch((e) => {
        if (!res.headersSent) res.writeHead(500).end(String(e))
      })
    })
    srv.once('error', (e) => {
      lastError = (e as Error).message
      reject(e)
    })
    srv.listen(port, '127.0.0.1', () => {
      http = srv
      currentPort = port
      lastError = null
      resolve()
    })
  })
}

export function stopMcp(): Promise<void> {
  return new Promise((resolve) => {
    if (!http) return resolve()
    http.close(() => {
      http = null
      currentPort = 0
      resolve()
    })
  })
}

/** Start or stop the server so it matches the current settings. */
export async function applyMcp(enabled: boolean, port: number): Promise<void> {
  if (!enabled) {
    await stopMcp()
    return
  }
  if (http && currentPort === port) return // already running on the right port
  await stopMcp()
  try {
    await start(port)
  } catch (e: any) {
    lastError = e?.message || String(e)
  }
}
