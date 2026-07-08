import { app, BrowserWindow, ipcMain, dialog, Menu, shell, Notification, nativeImage } from 'electron'
import { join, extname, resolve, sep, dirname } from 'node:path'
import {
  readFileSync,
  writeFileSync,
  statSync,
  mkdirSync,
  copyFileSync,
  readdirSync,
  rmSync,
  existsSync
} from 'node:fs'
import { spawn } from 'node:child_process'
import { randomUUID, createHash } from 'node:crypto'
import Anthropic from '@anthropic-ai/sdk'
import * as G from './git'
import * as Store from './store'
import * as Mcp from './mcp'
import * as Templates from './templates'
import * as Remote from './remote'
import { registerRtcIpc } from './rtc/ipc'

// Shared AI call: one system prompt + one user message, text out. Model and
// extra instructions come from Settings; key required.
async function aiText(system: string, user: string, maxTokens = 4000): Promise<string> {
  const s = Store.getSettings()
  const key = s.anthropicApiKey?.trim()
  if (!key) throw new Error('No API key set. Add one in Settings > AI assist.')
  const client = new Anthropic({ apiKey: key })
  const model = s.aiModel?.trim() || 'claude-opus-4-8'
  const extra = s.aiInstructions?.trim()
  const fullSystem = extra ? `${system}\n\nAdditional instructions from the user:\n${extra}` : system
  const req: Anthropic.MessageCreateParamsNonStreaming = {
    model,
    max_tokens: maxTokens,
    system: fullSystem,
    messages: [{ role: 'user', content: user }]
  }
  // Haiku does not support adaptive thinking; the Opus/Sonnet options do.
  if (!model.includes('haiku')) req.thinking = { type: 'adaptive' }
  const res = await client.messages.create(req)
  return res.content
    .filter((b): b is Anthropic.TextBlock => b.type === 'text')
    .map((b) => b.text)
    .join('')
    .trim()
}

function stripFences(t: string): string {
  return t.replace(/^```[\w-]*\n?/, '').replace(/\n?```\s*$/, '')
}

//Cap big diffs so a single request can't blow the context window.
function clipDiff(s: string, maxChars = 120000): string {
  return s.length <= maxChars ? s : s.slice(0, maxChars) + '\n\n[diff truncated for length]'
}

const SYS = {
  resolve:
    'You resolve git merge conflicts. The user gives a file containing conflict markers ' +
    '(<<<<<<<, =======, >>>>>>>, and possibly ||||||| base). Produce the correct fully-merged ' +
    'file: keep the intended changes from BOTH sides where they are compatible, remove every ' +
    'conflict marker, and change nothing else. Output ONLY the resolved file contents - no ' +
    'explanations and no markdown code fences.',
  commit:
    'You write clear git commit messages. Output ONLY the message: a concise imperative subject ' +
    'line (<= 72 characters), then if useful a blank line and a short body with bullet points. ' +
    'No preamble, no code fences, no quotes.',
  pr:
    'You write pull/merge request descriptions. Output a single title line, then a blank line, ' +
    'then a Markdown description (summary of what changed and why, and any testing notes). ' +
    'No code fences around the whole thing.',
  stash:
    'You write a short single-line label (<= 60 characters) describing in-progress git changes. ' +
    'Output only the label, no quotes.',
  explain:
    'You explain git changes to a developer. Summarize what changed and, where it is evident, why. ' +
    'Be concise; use short paragraphs and bullets. No code fences.',
  changelog:
    'You write release notes from git commit history. Group entries under Markdown headings ' +
    '(Features, Fixes, Other). Be concise and user-facing. No preamble.',
  review:
    'You are a senior code reviewer. Review the diff for bugs, edge cases, and risky changes. ' +
    'List concrete findings with the file/area and a severity (high/medium/low). Only real issues; ' +
    'if there are none, say so briefly. No code fences.',
  compose:
    'You group a set of uncommitted file changes into a few logical, reviewable commits. ' +
    'Output ONLY JSON of the form {"commits":[{"message":"<commit message>","files":["path",...]}]}. ' +
    'Every file path must be exactly one of the provided paths and appear in at most one commit. ' +
    'Order the commits so that dependencies come first. Messages should be concise imperative ' +
    'subject lines. No prose, no markdown, no code fences - JSON only.'
}

// Pull the commits JSON out of the model reply, ignoring any code fences or stray prose.
function parseComposer(text: string): { commits: { message: string; files: string[] }[] } {
  let t = stripFences(text).trim()
  const s = t.indexOf('{')
  const e = t.lastIndexOf('}')
  if (s !== -1 && e !== -1) t = t.slice(s, e + 1)
  const obj = JSON.parse(t)
  const commits = Array.isArray(obj.commits) ? obj.commits : []
  return {
    commits: commits
      .map((c: any) => ({ message: String(c.message || '').trim(), files: Array.isArray(c.files) ? c.files.map(String) : [] }))
      .filter((c: any) => c.message && c.files.length)
  }
}

async function aiResolveConflict(cwd: string, path: string): Promise<string> {
  const file = G.rawFile(cwd, path)
  const out = await aiText(SYS.resolve, `Resolve the merge conflicts in "${path}". Output only the final file.\n\n${file}`, 16000)
  return stripFences(out)
}

//The repository the MCP server acts on (the last one focused in the UI).
let activeRepo: string | null = null

const IMAGE_EXT: Record<string, string> = {
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.bmp': 'image/bmp',
  '.ico': 'image/x-icon',
  '.svg': 'image/svg+xml'
}

interface FilePreview {
  path: string
  kind: 'text' | 'image' | 'binary' | 'too-large' | 'missing'
  text?: string
  dataUrl?: string
  size: number
  ext: string
}

const MAX_PREVIEW = 2 * 1024 * 1024 // 2MB

function readWorkingFile(cwd: string, rel: string): FilePreview {
  const abs = join(cwd, rel)
  const ext = extname(rel).toLowerCase()
  let size = 0
  try {
    size = statSync(abs).size
  } catch {
    return { path: rel, kind: 'missing', size: 0, ext }
  }
  if (ext in IMAGE_EXT && ext !== '.svg') {
    if (size > MAX_PREVIEW) return { path: rel, kind: 'too-large', size, ext }
    const b64 = readFileSync(abs).toString('base64')
    return { path: rel, kind: 'image', dataUrl: `data:${IMAGE_EXT[ext]};base64,${b64}`, size, ext }
  }
  if (size > MAX_PREVIEW) return { path: rel, kind: 'too-large', size, ext }
  const buf = readFileSync(abs)
  // Binary heuristic: a NUL byte in the first 8KB.
  const isBinary = buf.subarray(0, 8192).includes(0)
  if (isBinary) return { path: rel, kind: 'binary', size, ext }
  return { path: rel, kind: 'text', text: buf.toString('utf8'), size, ext }
}

// Window icon for Windows/Linux (macOS uses the packaged .icns). Loads the
// bundled PNG straight off disk - no SVG rasterisation, no timing games.
function ensureWindowIcon(win: BrowserWindow): void {
  try {
    const icon = join(__dirname, '../../resources/icon.png')
    if (!existsSync(icon)) return
    const img = nativeImage.createFromPath(icon)
    if (!img.isEmpty()) win.setIcon(img)
  } catch {
    // The icon is cosmetic; never let it affect startup.
  }
}

function createWindow(): BrowserWindow {
  const iconPath = join(__dirname, '../../resources/icon.png')
  const win = new BrowserWindow({
    width: 1280,
    height: 820,
    minWidth: 940,
    minHeight: 600,
    show: false,
    icon: existsSync(iconPath) ? iconPath : undefined,
    backgroundColor: '#0b0d12',
    titleBarStyle: process.platform === 'darwin' ? 'hiddenInset' : 'default',
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      sandbox: false,
      contextIsolation: true
    }
  })

  win.on('ready-to-show', () => win.show())
  ensureWindowIcon(win)

  if (process.env['ELECTRON_RENDERER_URL']) {
    win.loadURL(process.env['ELECTRON_RENDERER_URL'])
  } else {
    win.loadFile(join(__dirname, '../renderer/index.html'))
  }
  return win
}

type MenuAction =
  | 'new-repo'
  | 'open-repo'
  | 'settings'
  | 'stash'
  | 'commit'
  | 'push'
  | 'pull'
  | 'fetch'

// Tell the focused renderer to run a menu-driven navigation action.
function sendMenu(action: MenuAction) {
  const target = BrowserWindow.getFocusedWindow() ?? BrowserWindow.getAllWindows()[0]
  target?.webContents.send('menu', action)
}

function buildMenu(): void {
  const isMac = process.platform === 'darwin'
  const template: Electron.MenuItemConstructorOptions[] = [
    ...(isMac ? [{ role: 'appMenu' as const }] : []),
    {
      label: 'File',
      submenu: [
        {
          label: 'New Window',
          accelerator: 'CmdOrCtrl+Shift+N',
          click: () => createWindow()
        },
        { type: 'separator' },
        {
          label: 'New Repository...',
          accelerator: 'CmdOrCtrl+N',
          click: () => sendMenu('new-repo')
        },
        {
          label: 'Open Repository...',
          accelerator: 'CmdOrCtrl+O',
          click: () => sendMenu('open-repo')
        },
        { type: 'separator' },
        isMac ? { role: 'close' } : { role: 'quit' }
      ]
    },
    { role: 'editMenu' },
    {
      label: 'Repository',
      submenu: [
        {
          label: 'Commit',
          accelerator: 'CmdOrCtrl+Enter',
          click: () => sendMenu('commit')
        },
        {
          label: 'Push',
          accelerator: 'CmdOrCtrl+P',
          click: () => sendMenu('push')
        },
        {
          label: 'Pull',
          accelerator: 'CmdOrCtrl+Shift+L',
          click: () => sendMenu('pull')
        },
        {
          label: 'Fetch',
          accelerator: 'CmdOrCtrl+F',
          click: () => sendMenu('fetch')
        },
        { type: 'separator' },
        {
          label: 'Stashes...',
          accelerator: 'CmdOrCtrl+Shift+S',
          click: () => sendMenu('stash')
        },
        {
          label: 'Settings...',
          accelerator: 'CmdOrCtrl+,',
          click: () => sendMenu('settings')
        }
      ]
    },
    {
      label: 'View',
      submenu: [
        { role: 'reload' },
        { role: 'toggleDevTools' },
        { type: 'separator' },
        { role: 'resetZoom' },
        { role: 'zoomIn' },
        { role: 'zoomOut' },
        { type: 'separator' },
        { role: 'togglefullscreen' }
      ]
    },
    {
      label: 'Window',
      submenu: [
        { role: 'minimize' },
        { role: 'zoom' },
        {
          label: 'New Window',
          accelerator: 'CmdOrCtrl+Shift+N',
          click: () => createWindow()
        },
        ...(isMac
          ? ([{ type: 'separator' }, { role: 'front' }] as Electron.MenuItemConstructorOptions[])
          : ([{ type: 'separator' }, { role: 'close' }] as Electron.MenuItemConstructorOptions[]))
      ]
    },
    {
      role: 'help',
      submenu: [
        {
          label: 'Settings...',
          accelerator: 'CmdOrCtrl+,',
          click: () => sendMenu('settings')
        },
        { type: 'separator' },
        {
          label: 'Hydrodam on GitHub',
          click: () => shell.openExternal('https://github.com')
        }
      ]
    }
  ]
  Menu.setApplicationMenu(Menu.buildFromTemplate(template))
}

app.whenReady().then(() => {
  Mcp.configureMcp({
    getRepo: () => activeRepo,
    getDangerous: () => Store.getSettings().mcpDangerous,
    getActiveCoauthors: () =>
      Store.load().coauthors.filter((c) => c.enabled).map((c) => ({ name: c.name, email: c.email }))
  })
  const s = Store.getSettings()
  Mcp.applyMcp(s.mcpEnabled, s.mcpPort)

  // Register the hydrodam:// deep-link scheme (e.g. hydrodam://open?path=...).
  try {
    app.setAsDefaultProtocolClient('hydrodam')
  } catch {
    // Ignore (unsupported in some dev setups)
  }

  buildMenu()
  createWindow()
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

// macOS delivers deep links here; make sure a window is open to receive focus.
app.on('open-url', (e) => {
  e.preventDefault()
  if (BrowserWindow.getAllWindows().length === 0) createWindow()
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})

app.on('before-quit', () => {
  Mcp.stopMcp()
})

// Wrap a handler so renderer always gets { ok, data } | { ok:false, error }
function handle<T>(channel: string, fn: (...args: any[]) => Promise<T> | T) {
  ipcMain.handle(channel, async (_e, ...args) => {
    try {
      return { ok: true, data: await fn(...args) }
    } catch (err: any) {
      return { ok: false, error: err?.message || String(err) }
    }
  })
}

function dialogParent(): BrowserWindow {
  return BrowserWindow.getFocusedWindow() ?? BrowserWindow.getAllWindows()[0]
}

// Returns a structured probe so the renderer can offer to initialise a folder
// that isn't a repo (or one nested inside another repo) instead of erroring.
handle('repo:open', async () => {
  const res = await dialog.showOpenDialog(dialogParent(), {
    title: 'Open a Git repository',
    properties: ['openDirectory']
  })
  if (res.canceled || !res.filePaths[0]) return null
  const probe = await G.probeOpen(res.filePaths[0])
  if (probe.root && !probe.nested) Store.rememberRepo(probe.root)
  return probe
})

// Pick a folder (e.g. the parent directory for a new or cloned repo).
handle('repo:browseDir', async (title?: string) => {
  const res = await dialog.showOpenDialog(dialogParent(), {
    title: title || 'Choose a folder',
    buttonLabel: 'Select folder',
    properties: ['openDirectory', 'createDirectory']
  })
  if (res.canceled || !res.filePaths[0]) return null
  return res.filePaths[0]
})

// Native OS message box, so the renderer can prompt with proper dialogs
// instead of the browser's built-in confirm()/alert(). Returns the index of
// the button the user clicked.
handle('dialog:message', async (opts: Electron.MessageBoxOptions) => {
  const res = await dialog.showMessageBox(dialogParent(), { noLink: true, ...opts })
  return res.response
})

//Template/preset lists for the New Repository dialog's dropdowns.
handle('repo:templates', () => Templates.catalog())

// Apply the user's default ignore profile to a freshly bootstrapped repo. Best
// effort: never let a seeding hiccup fail the create/clone itself.
async function seedDefaultExcludes(root: string): Promise<void> {
  if (!Store.getSettings().autoSeedExcludes) return
  try {
    await G.seedExcludes(root, Store.getDefaultExcludes())
  } catch {
    //Ignore: the repo is already created; excludes can be added later
  }
}

handle('repo:create', async (opts: G.NewRepoOptions) => {
  const root = await G.createRepo(opts)
  await seedDefaultExcludes(root)
  Store.rememberRepo(root)
  return root
})

// Create a repo from a saved setup. Identity profile and active co-authors are
// resolved here (in the main process) so the renderer only passes location + name.
handle('repo:createFromSetup', async (setupId: string, parentDir: string, name: string) => {
  const setup = Store.listSetups().find((s) => s.id === setupId)
  if (!setup) throw new Error('Setup not found.')

  let author: { name: string; email: string } | undefined
  let setLocalIdentity = false
  if (setup.identityProfileId) {
    const p = Store.listProfiles().profiles.find((x) => x.id === setup.identityProfileId)
    if (p) {
      author = { name: p.name, email: p.email }
      setLocalIdentity = true
    }
  }
  if (!author) author = await G.globalIdentity()

  const coauthors = setup.coauthors
    ? Store.load().coauthors.filter((c) => c.enabled).map((c) => ({ name: c.name, email: c.email }))
    : []

  const root = await G.createRepo({
    parentDir,
    name,
    branch: setup.branch,
    readme: setup.readme,
    gitignore: setup.gitignore,
    license: setup.license,
    initialCommit: setup.initialCommit,
    author,
    setLocalIdentity,
    files: setup.files,
    extraGitignore: setup.extraGitignore,
    localExclude: setup.localExclude,
    globalExclude: setup.globalExclude,
    coauthors
  })
  await seedDefaultExcludes(root)
  Store.rememberRepo(root)
  return root
})

handle('repo:clone', async (url: string, parentDir: string, name?: string, accountId?: string) => {
  const acc = accountId ? Store.getAccount(accountId) : null
  const auth = acc ? { provider: acc.provider, token: acc.token } : undefined
  const root = await G.cloneRepo(url, parentDir, name, auth)
  await seedDefaultExcludes(root)
  Store.rememberRepo(root)
  return root
})

handle('accounts:repos', async (accountId: string) => {
  const acc = Store.getAccount(accountId)
  if (!acc) throw new Error('Account not found. Reconnect it in Settings.')
  return Remote.listOwnedRepos(acc.provider, acc.host, acc.token)
})

handle('identity:global', () => G.globalIdentity())

handle('repo:validate', async (path: string) => {
  const root = await G.repoRoot(path)
  if (root) Store.rememberRepo(root)
  return root
})

handle('repo:recent', () => {
  const s = Store.load()
  return { recent: s.recentRepos, last: s.lastRepo }
})
handle('repo:forgetRecent', (root: string) => Store.forgetRepo(root))

handle('repo:status', (cwd: string) => G.status(cwd))
handle('repo:hidden', (cwd: string) => G.hiddenFiles(cwd))
handle('repo:branches', (cwd: string) => G.branches(cwd))
handle('repo:tree', (cwd: string) => G.listTree(cwd))
handle('repo:numstat', (cwd: string) => G.workingNumstat(cwd))
handle('identity:get', (cwd: string) => G.identity(cwd))
handle('identity:set', (cwd: string, name: string, email: string, scope: 'local' | 'global') =>
  G.setIdentity(cwd, name, email, scope)
)

handle('profiles:list', () => Store.listProfiles())
handle('profiles:add', (label: string, name: string, email: string) =>
  Store.addProfile(label, name, email)
)
handle('profiles:update', (id: string, label: string, name: string, email: string) =>
  Store.updateProfile(id, label, name, email)
)
handle('profiles:remove', (id: string) => Store.removeProfile(id))
//Select a profile AND apply it to the given repo's git identity.
handle('profiles:use', async (cwd: string, id: string, scope: 'local' | 'global') => {
  const p = Store.setActiveProfile(id)
  if (!p) throw new Error('Profile not found.')
  await G.setIdentity(cwd, p.name, p.email, scope)
  return Store.listProfiles()
})

handle('file:read', (cwd: string, path: string) => readWorkingFile(cwd, path))
handle('file:write', (cwd: string, path: string, content: string) => {
  // Refuse writes that escape the repository (e.g. "../" tricks).
  const abs = resolve(cwd, path)
  const root = resolve(cwd)
  if (abs !== root && !abs.startsWith(root + sep)) throw new Error('Path is outside the repository.')
  writeFileSync(abs, content, 'utf8')
  return true
})
handle('file:open', async (cwd: string, path: string) => {
  const err = await shell.openPath(join(cwd, path))
  if (err) throw new Error(err)
  return true
})
handle('file:reveal', (cwd: string, path: string) => {
  shell.showItemInFolder(join(cwd, path))
  return true
})

handle('file:diff', (cwd: string, path: string, staged: boolean, untracked: boolean) =>
  G.fileDiff(cwd, path, staged, untracked)
)
handle('file:meta', (cwd: string, path: string) => G.fileMeta(cwd, path))
handle('file:log', (cwd: string, path: string) => G.log(cwd, path, 60))
handle('file:atCommit', (cwd: string, hash: string, path: string) => G.fileAtCommit(cwd, hash, path))
handle('file:commitDiff', (cwd: string, hash: string, path: string) =>
  G.commitFileDiff(cwd, hash, path)
)
handle('commit:show', (cwd: string, hash: string) => G.commitShow(cwd, hash))
handle('commit:meta', (cwd: string, hash: string) => G.commitMeta(cwd, hash))
handle('reflog', (cwd: string) => G.reflog(cwd, 150))
handle('image:at', async (cwd: string, ref: string, path: string) => {
  const ext = extname(path).toLowerCase()
  const mime = IMAGE_EXT[ext]
  if (!mime) return null
  try {
    const buf = await G.blobAt(cwd, ref, path)
    return `data:${mime};base64,${buf.toString('base64')}`
  } catch {
    return null
  }
})
handle('lfs:info', (cwd: string) => G.lfsInfo(cwd))
handle('lfs:track', (cwd: string, pattern: string) => G.lfsTrack(cwd, pattern))
handle('lfs:pull', (cwd: string) => G.lfsPull(cwd))
handle('log:graph', (cwd: string, q: G.LogQuery) => G.logGraph(cwd, q ?? {}))
handle('blame', (cwd: string, path: string) => G.blame(cwd, path))

handle('commit:cherryPick', (cwd: string, hash: string) => G.cherryPick(cwd, hash))
handle('commit:revert', (cwd: string, hash: string) => G.revertCommit(cwd, hash))
handle('commit:reset', (cwd: string, hash: string, mode: 'soft' | 'mixed' | 'hard') =>
  G.resetTo(cwd, hash, mode)
)
handle('commit:checkout', (cwd: string, hash: string) => G.checkoutDetached(cwd, hash))
handle('commit:branchAt', (cwd: string, name: string, ref: string) => G.createBranchAt(cwd, name, ref))
handle('commit:tagAt', (cwd: string, name: string, ref: string) => G.tagAt(cwd, name, ref))

handle('branches:full', (cwd: string) => G.branchesFull(cwd))
handle('branch:delete', (cwd: string, name: string, force: boolean) => G.deleteBranch(cwd, name, force))
handle('branch:rename', (cwd: string, oldName: string, newName: string) =>
  G.renameBranch(cwd, oldName, newName)
)
handle('branch:move', (cwd: string, name: string, target: string) => G.moveBranch(cwd, name, target))
handle('branch:merge', (cwd: string, name: string) => G.mergeBranch(cwd, name))
handle('branch:setUpstream', (cwd: string, branch: string, upstream: string) =>
  G.setUpstream(cwd, branch, upstream)
)
handle('branch:deleteRemote', (cwd: string, remote: string, branch: string) =>
  G.deleteRemoteBranch(cwd, remote, branch)
)
handle('remotes:list', (cwd: string) => G.remotes(cwd))

const defaultHost = (p: Store.Provider) =>
  p === 'github' ? 'github.com' : p === 'gitlab' ? 'gitlab.com' : p === 'bitbucket' ? 'bitbucket.org' : 'dev.azure.com'

// Azure's "host" field is the org; we validate against it but store dev.azure.com
// so repo lookups (which see host=dev.azure.com) match the account.
const azureOrg = (input: string) =>
  input.replace(/^https?:\/\//, '').replace(/^dev\.azure\.com\//, '').replace(/\/+$/, '')

handle('accounts:list', () => Store.accountsView())
handle('accounts:add', async (provider: Store.Provider, host: string, label: string, token: string) => {
  const input = (host || '').trim()
  if (provider === 'azure') {
    const org = azureOrg(input)
    if (!org) throw new Error('Enter your Azure DevOps organization.')
    const { username } = await Remote.validateToken('azure', org, token)
    return Store.addAccount({ provider, host: 'dev.azure.com', label: (label || '').trim() || username, username, token })
  }
  const h = input || defaultHost(provider)
  const { username } = await Remote.validateToken(provider, h, token)
  return Store.addAccount({ provider, host: h, label: (label || '').trim() || username, username, token })
})
handle('accounts:remove', (id: string) => Store.removeAccount(id))
handle('accounts:setActive', (provider: Store.Provider, id: string) => Store.setActiveAccount(provider, id))
handle('accounts:validate', (provider: Store.Provider, host: string, token: string) => {
  const input = (host || '').trim()
  if (provider === 'azure') return Remote.validateToken('azure', azureOrg(input), token)
  return Remote.validateToken(provider, input || defaultHost(provider), token)
})

function repoToken(repo: Remote.RemoteRepo | null): string | undefined {
  if (!repo) return undefined
  return Store.activeToken(repo.provider, repo.host) || undefined
}

handle('remote:pulls', async (cwd: string) => {
  const url = await G.originUrl(cwd)
  const hosts = Store.hostProviders()
  const repo = Remote.parseRemote(url, hosts)
  return Remote.listPulls(url, hosts, repoToken(repo))
})
handle('remote:createPull', async (cwd: string, pull: Remote.NewPull) => {
  const url = await G.originUrl(cwd)
  const hosts = Store.hostProviders()
  const repo = Remote.parseRemote(url, hosts)
  return Remote.createPull(url, hosts, repoToken(repo), pull)
})
handle('remote:info', async (cwd: string) => {
  const url = await G.originUrl(cwd)
  const repo = Remote.parseRemote(url, Store.hostProviders())
  const account = repo
    ? Store.accountsView().find((a) => a.provider === repo.provider && a.active) ?? null
    : null
  return { url, repo, hasToken: !!repoToken(repo), account }
})
handle('shell:openExternal', async (url: string) => {
  await shell.openExternal(url)
  return true
})

handle('oauth:deviceStart', (clientId: string) => Remote.deviceStart(clientId))
handle('oauth:devicePoll', (clientId: string, deviceCode: string) => Remote.devicePoll(clientId, deviceCode))

handle('trackers:list', () => Store.trackersView())
handle('trackers:add', (t: Omit<Store.Tracker, 'id'>) => Store.addTracker(t))
handle('trackers:remove', (id: string) => Store.removeTracker(id))
handle('trackers:items', async (id: string) => {
  const t = Store.getTracker(id)
  if (!t) throw new Error('Tracker not found.')
  if (t.type === 'jira') return Remote.listJira(t.site || '', t.email || '', t.token || '')
  return Remote.listTrello(t.key || '', t.token || '')
})

handle('trackers:board', async (id: string) => {
  const t = Store.getTracker(id)
  if (!t) throw new Error('Tracker not found.')
  if (t.type !== 'trello' || !t.boardId) throw new Error('No board configured for this tracker.')
  return Remote.listTrelloBoard(t.key || '', t.token || '', t.boardId)
})

handle('signing:get', (cwd: string) => G.signingConfig(cwd))
handle('signing:set', (cwd: string, cfg: G.SigningConfig, scope: 'local' | 'global') =>
  G.setSigning(cwd, cfg, scope)
)
handle('signing:status', (cwd: string, hash: string) => G.commitSignature(cwd, hash))
handle('ssh:keys', () => G.sshKeys())
handle('ssh:generate', (name: string, comment: string) => G.generateSshKey(name, comment))

handle('submodule:add', (cwd: string, url: string, path: string) => G.addSubmodule(cwd, url, path))
handle('sparse:state', (cwd: string) => G.sparseState(cwd))
handle('sparse:set', (cwd: string, patterns: string[]) => G.sparseSet(cwd, patterns))
handle('sparse:disable', (cwd: string) => G.sparseDisable(cwd))

handle('insights', (cwd: string) => G.insights(cwd))

function launchTool(cwd: string, args: string[]): boolean {
  const c = spawn('git', args, { cwd, detached: true, stdio: 'ignore' })
  c.unref()
  return true
}
handle('tool:difftool', (cwd: string, path: string) =>
  launchTool(cwd, path ? ['difftool', '--no-prompt', '--', path] : ['difftool', '--no-prompt'])
)
handle('tool:mergetool', (cwd: string) => launchTool(cwd, ['mergetool']))
handle('tool:terminal', (cwd: string) => {
  if (process.platform === 'win32') spawn('cmd.exe', ['/c', 'start', 'cmd.exe'], { cwd, detached: true }).unref()
  else if (process.platform === 'darwin') spawn('open', ['-a', 'Terminal', cwd], { detached: true }).unref()
  else spawn('x-terminal-emulator', [], { cwd, detached: true }).unref()
  return true
})

handle('workspaces:list', () => Store.listWorkspaces())
handle('workspaces:save', (name: string, repos: string[]) => Store.saveWorkspace(name, repos))
handle('workspaces:remove', (id: string) => Store.removeWorkspace(id))

handle('setups:list', () => Store.listSetups())
handle('setups:save', (setup: Store.RepoSetup) => Store.saveSetup(setup))
handle('setups:remove', (id: string) => Store.removeSetup(id))

handle('settings:export', async () => {
  const res = await dialog.showSaveDialog(dialogParent(), {
    defaultPath: 'hydrodam-settings.json',
    filters: [{ name: 'JSON', extensions: ['json'] }]
  })
  if (res.canceled || !res.filePath) return false
  writeFileSync(res.filePath, JSON.stringify(Store.exportableSettings(), null, 2), 'utf8')
  return true
})
handle('settings:import', async () => {
  const res = await dialog.showOpenDialog(dialogParent(), {
    properties: ['openFile'],
    filters: [{ name: 'JSON', extensions: ['json'] }]
  })
  if (res.canceled || !res.filePaths[0]) return false
  Store.importSettings(JSON.parse(readFileSync(res.filePaths[0], 'utf8')))
  const s = Store.getSettings()
  await Mcp.applyMcp(s.mcpEnabled, s.mcpPort)
  return true
})

handle('notify', (title: string, body: string) => {
  if (Notification.isSupported()) new Notification({ title, body }).show()
  return true
})

handle('op:state', (cwd: string) => G.opState(cwd))
handle('op:continue', (cwd: string, kind: Exclude<G.OpKind, null>) => G.opContinue(cwd, kind))
handle('op:abort', (cwd: string, kind: Exclude<G.OpKind, null>) => G.opAbort(cwd, kind))
handle('op:skip', (cwd: string, kind: Exclude<G.OpKind, null>) => G.opSkip(cwd, kind))
handle('branch:rebase', (cwd: string, upstream: string) => G.rebaseOnto(cwd, upstream))
handle('rebase:list', (cwd: string, base: string) => G.commitsSince(cwd, base))
handle('rebase:interactive', (cwd: string, base: string, items: G.RebaseItem[]) =>
  G.interactiveRebase(cwd, base, items)
)

handle('worktrees:list', (cwd: string) => G.worktrees(cwd))
handle('worktrees:add', (cwd: string, path: string, branch: string) => G.addWorktree(cwd, path, branch))
handle('worktrees:remove', (cwd: string, path: string, force: boolean) =>
  G.removeWorktree(cwd, path, force)
)
handle('submodules:list', (cwd: string) => G.submodules(cwd))
handle('submodules:update', (cwd: string) => G.updateSubmodules(cwd))
handle('submodules:updateOne', (cwd: string, path: string) => G.updateSubmodule(cwd, path))
handle('submodules:sync', (cwd: string, path: string) => G.syncSubmodule(cwd, path))
handle('submodules:deinit', (cwd: string, path: string, force: boolean) =>
  G.deinitSubmodule(cwd, path, force)
)

handle('remote:issues', async (cwd: string, mentioned?: boolean) => {
  const url = await G.originUrl(cwd)
  const hosts = Store.hostProviders()
  const repo = Remote.parseRemote(url, hosts)
  return Remote.listIssues(url, hosts, repoToken(repo), !!mentioned)
})
handle('remote:reopenIssue', async (cwd: string, issueNumber: number) => {
  const url = await G.originUrl(cwd)
  const hosts = Store.hostProviders()
  const repo = Remote.parseRemote(url, hosts)
  return Remote.reopenIssue(url, hosts, repoToken(repo), issueNumber)
})
handle('remote:closeIssue', async (cwd: string, issueNumber: number, comment?: string) => {
  const url = await G.originUrl(cwd)
  const hosts = Store.hostProviders()
  const repo = Remote.parseRemote(url, hosts)
  return Remote.closeIssue(url, hosts, repoToken(repo), issueNumber, comment)
})
handle('remote:actions', async (cwd: string) => {
  const url = await G.originUrl(cwd)
  const hosts = Store.hostProviders()
  const repo = Remote.parseRemote(url, hosts)
  return Remote.listWorkflowRuns(url, hosts, repoToken(repo))
})
handle('remote:milestones', async (cwd: string) => {
  const url = await G.originUrl(cwd)
  const hosts = Store.hostProviders()
  const repo = Remote.parseRemote(url, hosts)
  return Remote.listMilestones(url, hosts, repoToken(repo))
})
handle('remote:languages', async (cwd: string) => {
  const url = await G.originUrl(cwd)
  const hosts = Store.hostProviders()
  const repo = Remote.parseRemote(url, hosts)
  return Remote.repoLanguages(url, hosts, repoToken(repo))
})
handle('remote:security', async (cwd: string) => {
  const url = await G.originUrl(cwd)
  const hosts = Store.hostProviders()
  const repo = Remote.parseRemote(url, hosts)
  return Remote.securityOverview(url, hosts, repoToken(repo))
})
handle('push:scanSecrets', (cwd: string) => G.scanOutgoingSecrets(cwd))
handle('remote:commentIssue', async (cwd: string, issueNumber: number, body: string) => {
  const url = await G.originUrl(cwd)
  const hosts = Store.hostProviders()
  const repo = Remote.parseRemote(url, hosts)
  return Remote.commentOnIssue(url, hosts, repoToken(repo), issueNumber, body)
})
handle('remote:fork', async (cwd: string) => {
  const url = await G.originUrl(cwd)
  const hosts = Store.hostProviders()
  const repo = Remote.parseRemote(url, hosts)
  return Remote.forkRepo(url, hosts, repoToken(repo))
})

handle('stage', (cwd: string, paths: string[]) => G.stage(cwd, paths))
handle('stage:all', (cwd: string) => G.stageAll(cwd))
handle('unstage', (cwd: string, paths: string[]) => G.unstage(cwd, paths))
handle('unstage:all', (cwd: string) => G.unstageAll(cwd))
// Discards are destructive, so the file's last contents are copied into
// userData (outside the repo) first and can be restored from the app.
const DISCARD_KEEP = 50
const DISCARD_MAX_BYTES = 5 * 1024 * 1024

function discardDir(cwd: string): string {
  const id = createHash('sha1').update(cwd).digest('hex').slice(0, 12)
  return join(app.getPath('userData'), 'discarded', id)
}

function cacheDiscard(cwd: string, rel: string): void {
  try {
    const abs = join(cwd, rel)
    const st = statSync(abs)
    if (!st.isFile() || st.size > DISCARD_MAX_BYTES) return
    const dir = discardDir(cwd)
    mkdirSync(dir, { recursive: true })
    const id = `${Date.now()}_${randomUUID().slice(0, 8)}`
    copyFileSync(abs, join(dir, id))
    writeFileSync(join(dir, `${id}.json`), JSON.stringify({ path: rel, when: Date.now(), size: st.size }))
    const metas = readdirSync(dir).filter((f) => f.endsWith('.json')).sort()
    for (const m of metas.slice(0, Math.max(0, metas.length - DISCARD_KEEP))) {
      rmSync(join(dir, m), { force: true })
      rmSync(join(dir, m.replace(/\.json$/, '')), { force: true })
    }
  } catch {
    // Best effort; a failed backup never blocks the discard itself.
  }
}

handle('discard', (cwd: string, path: string, untracked: boolean) => {
  cacheDiscard(cwd, path)
  return G.discard(cwd, path, untracked)
})
handle('discards:list', (cwd: string) => {
  const dir = discardDir(cwd)
  if (!existsSync(dir)) return []
  const out: { id: string; path: string; when: number; size: number }[] = []
  for (const f of readdirSync(dir).filter((x) => x.endsWith('.json'))) {
    try {
      out.push({ id: f.replace(/\.json$/, ''), ...JSON.parse(readFileSync(join(dir, f), 'utf8')) })
    } catch {
      // skip corrupt metadata
    }
  }
  out.sort((a, b) => b.when - a.when)
  return out
})
handle('discards:restore', (cwd: string, id: string) => {
  const dir = discardDir(cwd)
  const meta = JSON.parse(readFileSync(join(dir, `${id}.json`), 'utf8'))
  const dest = join(cwd, meta.path)
  mkdirSync(dirname(dest), { recursive: true })
  copyFileSync(join(dir, id), dest)
  return meta.path as string
})
handle('untrack', (cwd: string, path: string) => G.untrack(cwd, path))
handle('stage:hunk', (cwd: string, path: string, hunk: number) => G.stageHunk(cwd, path, hunk))
handle('unstage:hunk', (cwd: string, path: string, hunk: number) => G.unstageHunk(cwd, path, hunk))
handle('stage:lines', (cwd: string, path: string, hunk: number, lines: number[]) =>
  G.stageLines(cwd, path, hunk, lines)
)
handle('unstage:lines', (cwd: string, path: string, hunk: number, lines: number[]) =>
  G.unstageLines(cwd, path, hunk, lines)
)

handle('conflicts:list', (cwd: string) => G.conflictsJson(cwd))
handle('conflicts:stages', (cwd: string, path: string) => G.conflictStages(cwd, path))
handle('conflicts:ours', (cwd: string, path: string) => G.resolveOurs(cwd, path))
handle('conflicts:theirs', (cwd: string, path: string) => G.resolveTheirs(cwd, path))
handle('conflicts:keepFile', (cwd: string, path: string) => G.stage(cwd, [path]))
handle('conflicts:deleteFile', (cwd: string, path: string) => G.conflictDeleteFile(cwd, path))
handle('conflicts:resolve', (cwd: string, path: string, content: string) =>
  G.resolveWith(cwd, path, content)
)
handle('ai:available', () => !!Store.getSettings().anthropicApiKey?.trim())
handle('ai:resolveConflict', (cwd: string, path: string) => aiResolveConflict(cwd, path))

handle('ai:commitMessage', async (cwd: string) => {
  let diff = await G.git(cwd, ['diff', '--cached', '--no-color']).catch(() => '')
  if (!diff.trim()) diff = await G.git(cwd, ['diff', '--no-color']).catch(() => '')
  if (!diff.trim()) throw new Error('No changes to summarize - stage or edit some files first.')
  return aiText(SYS.commit, `Write a commit message for this diff:\n\n${clipDiff(diff)}`, 1024)
})

handle('ai:prDescribe', async (cwd: string, base: string, head: string) => {
  const b = (base || '').trim() || 'main'
  const h = (head || '').trim() || 'HEAD'
  const diff = await G.git(cwd, ['diff', '--no-color', `${b}...${h}`]).catch(() => '')
  const commits = await G.git(cwd, ['log', '--pretty=format:- %s', `${b}..${h}`]).catch(() => '')
  if (!diff.trim() && !commits.trim()) throw new Error(`No changes between ${b} and ${h}.`)
  return aiText(SYS.pr, `Source ${h} into ${b}.\n\nCommits:\n${commits}\n\nDiff:\n${clipDiff(diff)}`, 2000)
})

handle('ai:stashMessage', async (cwd: string) => {
  const diff = await G.git(cwd, ['diff', 'HEAD', '--no-color']).catch(() => '')
  if (!diff.trim()) throw new Error('No working changes to describe.')
  return aiText(SYS.stash, `Describe these in-progress changes:\n\n${clipDiff(diff)}`, 256)
})

handle('ai:explainCommit', async (cwd: string, hash: string) => {
  const show = await G.commitShow(cwd, hash)
  return aiText(SYS.explain, `Explain this commit:\n\n${clipDiff(show)}`, 2000)
})

handle('ai:explainWorking', async (cwd: string, path: string) => {
  const diff = path
    ? await G.fileDiff(cwd, path, false, false).catch(() => '')
    : await G.git(cwd, ['diff', 'HEAD', '--no-color']).catch(() => '')
  if (!diff.trim()) throw new Error('No changes to explain.')
  return aiText(SYS.explain, `Explain these working changes${path ? ` to ${path}` : ''}:\n\n${clipDiff(diff)}`, 2000)
})

handle('ai:changelog', async (cwd: string, base: string) => {
  const b = (base || '').trim()
  const args = ['log', '--pretty=format:%h %s']
  if (b) args.push(`${b}..HEAD`)
  else args.push('-n50')
  const log = await G.git(cwd, args).catch(() => '')
  if (!log.trim()) throw new Error('No commits in range.')
  return aiText(SYS.changelog, `Generate release notes from these commits:\n\n${log}`, 3000)
})

handle('ai:review', async (cwd: string) => {
  let diff = await G.git(cwd, ['diff', '--cached', '--no-color']).catch(() => '')
  if (!diff.trim()) diff = await G.git(cwd, ['diff', '--no-color']).catch(() => '')
  if (!diff.trim()) throw new Error('No changes to review - stage or edit some files first.')
  return aiText(SYS.review, `Review this diff:\n\n${clipDiff(diff)}`, 4000)
})

handle('ai:explainConflict', async (cwd: string, path: string) => {
  const file = G.rawFile(cwd, path)
  return aiText(SYS.explain, `Explain this merge conflict (ours/theirs) and suggest how to resolve it:\n\n${file}`, 2000)
})

handle('ai:composeCommits', async (cwd: string) => {
  const status = await G.status(cwd)
  const files = status.files.filter((f) => !f.ignored).map((f) => f.path)
  if (!files.length) throw new Error('No changes to compose into commits.')
  const untracked = status.files.filter((f) => f.untracked).map((f) => f.path)
  const diff = await G.git(cwd, ['diff', 'HEAD', '--no-color']).catch(() => '')
  const ctx =
    `Changed files:\n${files.map((f) => '- ' + f).join('\n')}\n\n` +
    `Untracked (new) files:\n${untracked.map((f) => '- ' + f).join('\n') || '(none)'}\n\n` +
    `Diff of tracked changes:\n${clipDiff(diff)}`
  const text = await aiText(SYS.compose, ctx, 3000)
  const parsed = parseComposer(text)
  const set = new Set(files)
  //keep only files that actually exist in the change set
  parsed.commits = parsed.commits
    .map((c) => ({ message: c.message, files: c.files.filter((f) => set.has(f)) }))
    .filter((c) => c.files.length)
  if (!parsed.commits.length) throw new Error('Could not group the changes - try committing manually.')
  return parsed
})
handle('hide', (cwd: string, path: string, hidden: boolean) => G.setHidden(cwd, path, hidden))
handle('repo:integrity', (cwd: string) => G.integrity(cwd))

handle('excludes:list', (cwd: string) => G.listExcludes(cwd))
handle('excludes:add', (cwd: string, scope: G.ExcludeScope, pattern: string) =>
  G.addExclude(cwd, scope, pattern)
)
handle('excludes:remove', (cwd: string, scope: G.ExcludeScope, pattern: string) =>
  G.removeExclude(cwd, scope, pattern)
)
handle('excludes:listIgnored', (cwd: string) => G.listIgnoredFiles(cwd))
handle('excludes:check', (cwd: string, path: string) => G.checkIgnore(cwd, path))
handle('excludes:getDefaults', () => Store.getDefaultExcludes())
handle('excludes:setDefaults', (profile: Store.ExcludeProfile) => Store.setDefaultExcludes(profile))
handle('excludes:applyDefaults', (cwd: string) => G.seedExcludes(cwd, Store.getDefaultExcludes()))

handle('commit', async (cwd: string, message: string, coauthors: any[], amend: boolean) => {
  const out = await G.commit(cwd, message, coauthors, amend)
  // Record the tip we just wrote so its co-authors count as added-through-Hydrodam.
  const root = await G.repoRoot(cwd).catch(() => null)
  const head = (await G.git(cwd, ['rev-parse', 'HEAD']).catch(() => '')).trim()
  if (root && head) {
    Store.recordVerifiedCommit(
      root,
      head,
      (coauthors || []).map((c: any) => ({ name: c.name, email: c.email }))
    )
  }
  return out
})
handle('log', (cwd: string) => G.log(cwd, undefined, 60))
handle('repo:unpushed', (cwd: string) => G.unpushedCommits(cwd))

const coKey = (c: { name: string; email: string }) => (c.email || c.name).toLowerCase()
const coDiff = (
  actual: { name: string; email: string }[],
  trusted: { name: string; email: string }[]
) => {
  const ta = new Set(trusted.map(coKey))
  const aa = new Set(actual.map(coKey))
  return {
    injected: actual.filter((c) => !ta.has(coKey(c))), // added outside Hydrodam
    dropped: trusted.filter((c) => !aa.has(coKey(c))) // an authored co-author was stripped
  }
}

// Flag unpushed commits whose co-authors don't match what Hydrodam recorded - a
// trailer injected or stripped out-of-band (git CLI, another tool, a hook). Only
// looks at commits you authored, so merged-in work from others isn't false-flagged.
handle('push:coauthorGuard', async (cwd: string) => {
  const root = await G.repoRoot(cwd).catch(() => null)
  const me = (await G.git(cwd, ['config', 'user.email']).catch(() => '')).trim().toLowerCase()
  const commits = await G.unpushedCommits(cwd).catch(() => [])
  const out: any[] = []
  for (const c of commits) {
    if (me && c.email.toLowerCase() !== me) continue
    const rec = root ? Store.verifiedCommit(root, c.hash) : null
    // Unverified commit (never made through Hydrodam): any co-author is untrusted.
    // Verified commit: compare against exactly what we recorded.
    const { injected, dropped } = coDiff(c.coauthors, rec?.coauthors ?? [])
    if (!injected.length && !dropped.length) continue
    const committedAt = (await G.git(cwd, ['show', '-s', '--format=%cI', c.hash]).catch(() => '')).trim()
    out.push({
      hash: c.hash,
      shortHash: c.shortHash,
      subject: c.subject,
      authoredAt: c.date,
      committedAt,
      coauthors: injected,
      dropped
    })
  }
  return out
})

// Right after a commit/amend: does HEAD's attribution match what we just asked
// for? Catches a commit-msg/pre-commit hook that rewrote trailers under us.
handle('commit:tamperCheck', async (cwd: string) => {
  const root = await G.repoRoot(cwd).catch(() => null)
  const head = (await G.git(cwd, ['rev-parse', 'HEAD']).catch(() => '')).trim()
  const rec = root && head ? Store.verifiedCommit(root, head) : null
  if (!rec) return { injected: [], dropped: [] }
  const actual = await G.commitCoauthors(cwd, head)
  return coDiff(actual, rec.coauthors)
})

// Escape hatch: accept a commit's current co-authors as legitimate (e.g. a real
// CLI rebase you did on purpose), so the guard stops flagging it.
handle('commit:trust', async (cwd: string, hash: string) => {
  const root = await G.repoRoot(cwd).catch(() => null)
  if (!root) return
  const actual = await G.commitCoauthors(cwd, hash)
  Store.recordVerifiedCommit(root, hash, actual)
})
handle('push', async (cwd: string, setUpstream: boolean, branch: string) => {
  const out = await G.push(cwd, setUpstream, branch)
  Store.recordOp(cwd, 'lastPush')
  return out
})
handle('pull', async (cwd: string) => {
  const out = await G.pull(cwd)
  Store.recordOp(cwd, 'lastPull')
  return out
})
handle('fetch', async (cwd: string) => {
  const out = await G.fetch(cwd)
  Store.recordOp(cwd, 'lastFetch')
  return out
})
handle('repo:meta', (cwd: string) => Store.getRepoMeta(cwd))
handle('stash', (cwd: string, message: string) => G.stash(cwd, message))
handle('stash:pop', (cwd: string) => G.stashPop(cwd))
handle('stash:list', (cwd: string) => G.stashList(cwd))
handle('stash:apply', (cwd: string, ref: string) => G.stashApply(cwd, ref))
handle('stash:popRef', (cwd: string, ref: string) => G.stashPopRef(cwd, ref))
handle('stash:drop', (cwd: string, ref: string) => G.stashDrop(cwd, ref))
handle('checkout', (cwd: string, branch: string) => G.checkout(cwd, branch))
handle('branch:create', (cwd: string, name: string) => G.createBranch(cwd, name))

handle('settings:get', () => Store.getSettings())
handle('settings:set', async (patch: any) => {
  const next = Store.setSettings(patch)
  if ('mcpEnabled' in patch || 'mcpPort' in patch) {
    await Mcp.applyMcp(next.mcpEnabled, next.mcpPort)
  }
  return next
})

handle('commit:preview', async (cwd: string) => {
  const [files, who] = await Promise.all([G.stagedFiles(cwd), G.author(cwd)])
  const coauthors = Store.load()
    .coauthors.filter((c) => c.enabled)
    .map((c) => ({ name: c.name, email: c.email }))
  return { files, author: who, coauthors }
})
handle('commit:undo', (cwd: string) => G.undoCommit(cwd))
handle('log:stat', (cwd: string, count: number) => G.logStat(cwd, count ?? 1))

handle('mcp:status', () => Mcp.mcpInfo())
handle('mcp:setRepo', (cwd: string | null) => {
  activeRepo = cwd
  return true
})

handle('coauthors:list', () => Store.load().coauthors)

handle('coauthors:add', (name: string, email: string) => {
  const s = Store.load()
  const exists = s.coauthors.find((c) => c.email.toLowerCase() === email.toLowerCase())
  if (exists) {
    exists.name = name
  } else {
    s.coauthors.push({ id: randomUUID(), name, email, enabled: true })
  }
  Store.save(s)
  return s.coauthors
})

handle('coauthors:toggle', (id: string, enabled: boolean) => {
  const s = Store.load()
  const c = s.coauthors.find((c) => c.id === id)
  if (c) c.enabled = enabled
  Store.save(s)
  return s.coauthors
})

handle('coauthors:remove', (id: string) => {
  const s = Store.load()
  s.coauthors = s.coauthors.filter((c) => c.id !== id)
  Store.save(s)
  return s.coauthors
})

handle('coauthors:known', (cwd: string) => G.knownCoauthors(cwd))

registerRtcIpc()
