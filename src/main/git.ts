// git.ts - thin wrappers over the git CLI.
//
// Everything shells out to the real git binary rather than a JS git library, so
// behaviour matches the command line exactly and the dependency list stays
// short. Most functions map to one or two commands; anything with real logic
// belongs in the main process instead.

import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { createHash } from 'node:crypto'
import { readFileSync, writeFileSync, mkdirSync, mkdtempSync, rmSync, existsSync, readdirSync, realpathSync } from 'node:fs'
import { join, resolve, dirname } from 'node:path'
import { homedir, tmpdir } from 'node:os'
import * as Templates from './templates'

const pExecFile = promisify(execFile)

const MAX_BUFFER = 1024 * 1024 * 64 // 64MB - big monorepo diffs blow past the default 1MB

// Every git invocation is recorded here so the UI can show exactly what the app
// ran - Hydrodam shells out to real git, and this makes that honest and visible.
export interface GitLogEntry {
  id: number
  args: string[]
  ms: number
  ok: boolean
  error?: string // first line of stderr when it failed
  at: number
}
const LOG_CAP = 300
const commandLog: GitLogEntry[] = []
let logSeq = 0
const logListeners = new Set<(e: GitLogEntry) => void>()

export function getCommandLog(): GitLogEntry[] {
  return commandLog.slice()
}
export function onGitCommand(fn: (e: GitLogEntry) => void): () => void {
  logListeners.add(fn)
  return () => logListeners.delete(fn)
}
function recordCommand(args: string[], ms: number, ok: boolean, error?: string): void {
  const e: GitLogEntry = { id: ++logSeq, args, ms: Math.round(ms), ok, error, at: Date.now() }
  commandLog.push(e)
  if (commandLog.length > LOG_CAP) commandLog.shift()
  for (const fn of logListeners) fn(e)
}

/**
 * The function every other call goes through. Runs git <args> in cwd and
 * resolves with stdout. A non-zero exit throws an Error carrying git's stderr
 * (trimmed), so callers can surface err.message directly.
 *
 * opts.input is piped to stdin, used by commit -F - so commit messages
 * never need shell-escaping. windowsHide keeps a console window from flashing
 * up on Windows.
 */
export async function git(cwd: string, args: string[], opts: { input?: string } = {}): Promise<string> {
  const started = performance.now()
  try {
    const child = pExecFile('git', args, {
      cwd,
      maxBuffer: MAX_BUFFER,
      windowsHide: true,
      encoding: 'utf8'
    })
    if (opts.input !== undefined && child.child.stdin) {
      child.child.stdin.write(opts.input)
      child.child.stdin.end()
    }
    const { stdout } = await child
    recordCommand(args, performance.now() - started, true)
    return stdout
  } catch (err: any) {
    const msg = (err?.stderr || err?.message || String(err)).trim()
    recordCommand(args, performance.now() - started, false, msg.split('\n')[0])
    throw new Error(msg)
  }
}

export interface FileEntry {
  path: string
  //XY status codes from git status --porcelain=v1 -z
  index: string // staged status (X)
  work: string // worktree status (Y)
  orig?: string // original path for renames
  staged: boolean
  unstaged: boolean
  untracked: boolean
  ignored: boolean
  deleted: boolean
  renamed: boolean
  conflicted: boolean
}

export interface RepoStatus {
  branch: string
  upstream: string | null
  ahead: number
  behind: number
  detached: boolean
  files: FileEntry[]
  clean: boolean
}

function decodeXY(x: string, y: string) {
  const conflicted =
    x === 'U' || y === 'U' || (x === 'A' && y === 'A') || (x === 'D' && y === 'D')
  return {
    staged: x !== ' ' && x !== '?' && x !== '!' && !conflicted,
    unstaged: y !== ' ' && y !== '?' && y !== '!',
    untracked: x === '?' && y === '?',
    ignored: x === '!' && y === '!',
    deleted: x === 'D' || y === 'D',
    renamed: x === 'R' || x === 'C',
    conflicted
  }
}

/** Full working-tree status, including untracked and ignored files. */
export async function status(cwd: string): Promise<RepoStatus> {
  const raw = await git(cwd, [
    'status',
    '--porcelain=v1',
    '-z',
    '--branch',
    '--untracked-files=all',
    '--ignored=matching'
  ])

  const parts = raw.split('\0')
  const files: FileEntry[] = []
  let branch = '(unknown)'
  let upstream: string | null = null
  let ahead = 0
  let behind = 0
  let detached = false

  for (let i = 0; i < parts.length; i++) {
    const line = parts[i]
    if (!line) continue
    if (line.startsWith('## ')) {
      const info = line.slice(3)
      // A freshly-initialised repo (no commits yet) reports the unborn branch as
      // "No commits yet on <branch>" - without this, the naive parse below grabs
      // "No" as the branch name.
      const unborn = info.match(/^(?:No commits yet|Initial commit) on (.+)$/)
      if (info.startsWith('HEAD (no branch)')) {
        detached = true
        branch = 'HEAD (detached)'
      } else if (unborn) {
        branch = unborn[1].trim()
      } else {
        const m = info.match(/^([^.\s]+)(?:\.\.\.(\S+))?(?:\s\[(.+)\])?/)
        if (m) {
          branch = m[1]
          upstream = m[2] ?? null
          if (m[3]) {
            const a = m[3].match(/ahead (\d+)/)
            const b = m[3].match(/behind (\d+)/)
            if (a) ahead = parseInt(a[1], 10)
            if (b) behind = parseInt(b[1], 10)
          }
        }
      }
      continue
    }

    const x = line[0]
    const y = line[1]
    let path = line.slice(3)
    let orig: string | undefined
    //Renames/copies consume an extra NUL-delimited field (the original path)
    if (x === 'R' || x === 'C') {
      orig = parts[++i]
    }
    const flags = decodeXY(x, y)
    files.push({ path, index: x, work: y, orig, ...flags })
  }

  return {
    branch,
    upstream,
    ahead,
    behind,
    detached,
    files,
    clean: files.filter((f) => !f.ignored).length === 0
  }
}

/** Like git(), but returns stdout even when git exits non-zero (e.g. diff --no-index). */
function gitCapture(cwd: string, args: string[]): Promise<string> {
  return new Promise((resolve, reject) => {
    execFile(
      'git',
      args,
      { cwd, maxBuffer: MAX_BUFFER, windowsHide: true, encoding: 'utf8' },
      (err, stdout, stderr) => {
        if (stdout) return resolve(stdout)
        if (err && !stdout) return reject(new Error((stderr || err.message).trim()))
        resolve(stdout || '')
      }
    )
  })
}

/** Diff for a single file. staged toggles --cached. Untracked files show full content. */
export async function fileDiff(
  cwd: string,
  path: string,
  staged: boolean,
  untracked: boolean
): Promise<string> {
  if (untracked) {
    // git recognises the literal "/dev/null" on all platforms (incl. Git for Windows);
    // --no-index exits 1 when content differs, so we capture stdout regardless.
    return gitCapture(cwd, ['diff', '--no-color', '--no-index', '--', '/dev/null', path])
  }
  const args = ['diff', '--no-color']
  if (staged) args.push('--cached')
  args.push('--', path)
  return git(cwd, args)
}

export interface NumstatEntry {
  path: string
  add: number // -1 for binary
  del: number
}

export interface WorkingNumstat {
  staged: NumstatEntry[]
  unstaged: NumstatEntry[]
}

function parseNumstat(out: string): NumstatEntry[] {
  const entries: NumstatEntry[] = []
  for (const line of out.split('\n').filter(Boolean)) {
    const parts = line.split('\t')
    if (parts.length < 3) continue
    let path = parts.slice(2).join('\t')
    // Renames print as "dir/{old => new}/file" or "old => new"; keep the new path.
    if (path.includes(' => ')) {
      path = path.includes('{')
        ? path.replace(/\{([^{}]*) => ([^{}]*)\}/g, '$2').replace(/\/{2,}/g, '/')
        : path.split(' => ')[1]
    }
    entries.push({
      path,
      add: parts[0] === '-' ? -1 : parseInt(parts[0], 10) || 0,
      del: parts[1] === '-' ? -1 : parseInt(parts[1], 10) || 0
    })
  }
  return entries
}

/** Per-file added/deleted line counts for staged and unstaged changes. */
export async function workingNumstat(cwd: string): Promise<WorkingNumstat> {
  const [stagedOut, unstagedOut] = await Promise.all([
    git(cwd, ['diff', '--cached', '--numstat', '-M']).catch(() => ''),
    git(cwd, ['diff', '--numstat', '-M']).catch(() => '')
  ])
  return { staged: parseNumstat(stagedOut), unstaged: parseNumstat(unstagedOut) }
}

// The -- matters: it stops a path that begins with a dash being read as a flag
export async function stage(cwd: string, paths: string[]): Promise<void> {
  if (!paths.length) return
  await git(cwd, ['add', '--', ...paths])
}

export async function stageAll(cwd: string): Promise<void> {
  await git(cwd, ['add', '-A'])
}

// inverse of stage()
export async function unstage(cwd: string, paths: string[]): Promise<void> {
  if (!paths.length) return
  await git(cwd, ['restore', '--staged', '--', ...paths])
}

export async function unstageAll(cwd: string): Promise<void> {
  await git(cwd, ['reset', '-q', 'HEAD', '--'])
}

/** Discard working-tree changes for tracked files; delete untracked. */
export async function discard(cwd: string, path: string, untracked: boolean): Promise<void> {
  if (untracked) {
    await git(cwd, ['clean', '-fd', '--', path])
  } else {
    await git(cwd, ['restore', '--', path])
  }
}

export interface ConflictSegment {
  type: 'text' | 'conflict'
  lines?: string[] // for text segments
  ours?: string[]
  base?: string[]
  theirs?: string[]
  hasBase?: boolean
  oursLabel?: string
  theirsLabel?: string
}

export interface ConflictFile {
  path: string
  segments: ConflictSegment[]
  conflictCount: number
  binary?: boolean
  unreadable?: boolean
  // Two-letter porcelain code (UU, DU, UD, AA, AU, UA, DD) and what it means
  // for the resolver UI.
  xy?: string
  kind?: 'content' | 'delete' | 'both-deleted'
}

// Paths git reports as unmerged (UU, AA, DD, etc.).
export async function conflictedPaths(cwd: string): Promise<string[]> {
  const raw = await git(cwd, ['diff', '--name-only', '--diff-filter=U', '-z'])
  return raw.split('\0').filter(Boolean)
}

/** Parse a conflicted file's markers into ordered ours/base/theirs segments. */
export function parseConflict(cwd: string, path: string): ConflictFile {
  let content: string
  try {
    content = readFileSync(join(cwd, path), 'utf8')
  } catch {
    return { path, segments: [], conflictCount: 0, unreadable: true }
  }
  if (content.indexOf(String.fromCharCode(0)) !== -1) return { path, segments: [], conflictCount: 0, binary: true }

  const lines = content.split('\n')
  const segments: ConflictSegment[] = []
  let text: string[] = []
  let conflictCount = 0
  const flush = () => {
    if (text.length) {
      segments.push({ type: 'text', lines: text })
      text = []
    }
  }

  for (let i = 0; i < lines.length; ) {
    const line = lines[i]
    if (line.startsWith('<<<<<<<')) {
      flush()
      const oursLabel = line.slice(7).trim()
      const ours: string[] = []
      const base: string[] = []
      const theirs: string[] = []
      let mode: 'ours' | 'base' | 'theirs' = 'ours'
      let hasBase = false
      i++
      for (; i < lines.length && !lines[i].startsWith('>>>>>>>'); i++) {
        const l = lines[i]
        if (l.startsWith('|||||||')) {
          mode = 'base'
          hasBase = true
        } else if (l.startsWith('=======')) {
          mode = 'theirs'
        } else if (mode === 'ours') ours.push(l)
        else if (mode === 'base') base.push(l)
        else theirs.push(l)
      }
      const theirsLabel = i < lines.length ? lines[i].slice(7).trim() : ''
      i++ // consume the >>>>>>> line
      conflictCount++
      segments.push({ type: 'conflict', ours, base, theirs, hasBase, oursLabel, theirsLabel })
    } else {
      text.push(line)
      i++
    }
  }
  flush()
  return { path, segments, conflictCount }
}

/** All conflicted files, parsed - the JSON structure used by the UI and the MCP tool. */
export async function conflictsJson(cwd: string): Promise<ConflictFile[]> {
  // Status (not diff --diff-filter=U) so delete/modify and both-deleted
  // conflicts are classified instead of showing up as unreadable content.
  const st = await status(cwd)
  const out: ConflictFile[] = []
  for (const f of st.files.filter((x) => x.conflicted)) {
    const xy = f.index + f.work
    if (xy === 'DD') {
      out.push({ path: f.path, segments: [], conflictCount: 0, xy, kind: 'both-deleted' })
    } else if (xy === 'DU' || xy === 'UD' || xy === 'AU' || xy === 'UA') {
      out.push({ path: f.path, segments: [], conflictCount: 0, xy, kind: 'delete' })
    } else {
      out.push({ ...parseConflict(cwd, f.path), xy, kind: 'content' })
    }
  }
  return out
}

/** Resolve a delete/modify conflict by removing the file (stages the deletion). */
export async function conflictDeleteFile(cwd: string, path: string): Promise<void> {
  await git(cwd, ['rm', '-f', '--', path])
}

export interface SecretFinding {
  kind: string
  file: string
  snippet: string
}

// Shapes of well-known credentials. Only clearly key-like strings; a generic
// entropy check would drown the warning in false positives.
const SECRET_PATTERNS: { kind: string; re: RegExp }[] = [
  { kind: 'GitHub token', re: /\b(?:ghp|gho|ghu|ghs|ghr)_[A-Za-z0-9]{30,}\b/ },
  { kind: 'GitHub fine-grained token', re: /\bgithub_pat_[A-Za-z0-9_]{30,}\b/ },
  { kind: 'AWS access key id', re: /\bAKIA[0-9A-Z]{16}\b/ },
  { kind: 'Anthropic API key', re: /\bsk-ant-[A-Za-z0-9_-]{20,}\b/ },
  { kind: 'OpenAI API key', re: /\bsk-[A-Za-z0-9]{40,}\b/ },
  { kind: 'Slack token', re: /\bxox[baprs]-[A-Za-z0-9-]{10,}\b/ },
  { kind: 'Stripe key', re: /\b[sr]k_(?:live|test)_[A-Za-z0-9]{16,}\b/ },
  { kind: 'Google API key', re: /\bAIza[0-9A-Za-z_-]{35}\b/ },
  { kind: 'Private key block', re: /-----BEGIN (?:RSA |EC |OPENSSH |DSA |PGP )?PRIVATE KEY/ },
  {
    kind: 'Hardcoded credential',
    re: /(?:api[_-]?key|secret|token|password)\s*[:=]\s*['"][A-Za-z0-9_\-/+=]{16,}['"]/i
  }
]

/**
 * Scan the commits about to be pushed for secret-shaped strings, like GitHub's
 * push protection but local and free. Only added lines are checked; with no
 * upstream (first push) it falls back to the HEAD commit.
 */
export async function scanOutgoingSecrets(cwd: string): Promise<SecretFinding[]> {
  let patch: string
  try {
    patch = await git(cwd, ['diff', '--no-color', '@{upstream}..HEAD'])
  } catch {
    patch = await git(cwd, ['show', '--no-color', 'HEAD']).catch(() => '')
  }
  const findings: SecretFinding[] = []
  let file = ''
  for (const line of patch.split('\n')) {
    if (line.startsWith('+++ b/')) {
      file = line.slice(6)
      continue
    }
    if (!line.startsWith('+') || line.startsWith('+++')) continue
    for (const p of SECRET_PATTERNS) {
      const m = line.match(p.re)
      if (!m) continue
      const raw = m[0]
      // Never echo the whole secret back at the user.
      const snippet = raw.length > 12 ? `${raw.slice(0, 6)}...${raw.slice(-4)}` : raw
      findings.push({ kind: p.kind, file, snippet })
      break
    }
    if (findings.length >= 20) break
  }
  return findings
}

export interface IgnoreCheck {
  ignored: boolean
  source?: string
  line?: string
  pattern?: string
}

/** Whether (and why) git ignores a path: git check-ignore -v. Exit 1 = not ignored. */
export async function checkIgnore(cwd: string, path: string): Promise<IgnoreCheck> {
  try {
    const out = (await git(cwd, ['check-ignore', '-v', '--', path])).trim()
    if (!out) return { ignored: false }
    const m = out.split('\n')[0].match(/^(.*):(\d+):(.*)\t/)
    if (!m) return { ignored: true }
    return { ignored: true, source: m[1], line: m[2], pattern: m[3] }
  } catch {
    return { ignored: false }
  }
}

/** The three full stage versions of a conflicted file: base (:1), ours (:2), theirs (:3). */
export async function conflictStages(
  cwd: string,
  path: string
): Promise<{ base: string; ours: string; theirs: string }> {
  const read = (n: number) => git(cwd, ['show', `:${n}:${path}`]).catch(() => '')
  const [base, ours, theirs] = await Promise.all([read(1), read(2), read(3)])
  return { base, ours, theirs }
}

export async function resolveOurs(cwd: string, path: string): Promise<void> {
  await git(cwd, ['checkout', '--ours', '--', path])
  await git(cwd, ['add', '--', path])
}

export async function resolveTheirs(cwd: string, path: string): Promise<void> {
  await git(cwd, ['checkout', '--theirs', '--', path])
  await git(cwd, ['add', '--', path])
}

/** Write fully-resolved contents for a file and stage it as resolved. */
export async function resolveWith(cwd: string, path: string, content: string): Promise<void> {
  writeFileSync(join(cwd, path), content, 'utf8')
  await git(cwd, ['add', '--', path])
}

/** Raw working-tree contents of a file (with conflict markers), for the AI assist. */
export function rawFile(cwd: string, path: string): string {
  return readFileSync(join(cwd, path), 'utf8')
}

/** Stop tracking a file (git rm --cached) while keeping it on disk. */
export async function untrack(cwd: string, path: string): Promise<void> {
  await git(cwd, ['rm', '--cached', '-r', '--', path])
}

/**
 * A content-sensitive fingerprint of the working tree + index.
 * Hashes porcelain status + the working diff + the staged diff, so ANY change
 * (new file, edit, re-stage, or a same-status content change) flips the value.
 * Used to detect changes that appeared between reviewing and committing.
 */
export async function integrity(cwd: string): Promise<string> {
  const [porcelain, work, cached] = await Promise.all([
    git(cwd, ['status', '--porcelain=v1', '-z', '--untracked-files=all']),
    git(cwd, ['diff', '--no-color']),
    git(cwd, ['diff', '--cached', '--no-color'])
  ])
  return createHash('sha1')
    .update(porcelain)
    .update('\0')
    .update(work)
    .update('\0')
    .update(cached)
    .digest('hex')
}

/** Toggle "assume-unchanged" - hides a tracked file from showing as changed/committing. */
export async function setHidden(cwd: string, path: string, hidden: boolean): Promise<void> {
  await git(cwd, ['update-index', hidden ? '--assume-unchanged' : '--no-assume-unchanged', '--', path])
}

/** List paths currently flagged assume-unchanged or skip-worktree. */
export async function hiddenFiles(cwd: string): Promise<string[]> {
  const raw = await git(cwd, ['ls-files', '-v'])
  return raw
    .split('\n')
    .filter((l) => /^[a-z]/.test(l)) // lowercase tag = assume-unchanged / skip-worktree
    .map((l) => l.slice(2))
}

//
// Three places git reads ignore patterns from, with different visibility:
//   shared  -> <repo>/.gitignore          committed, everyone who clones sees it
//   private -> <repo>/.git/info/exclude   this clone only, never committed/pushed
//   global  -> core.excludesFile          your machine only, applies to every repo
//
// "private" and "global" ignore files without touching a committed .gitignore,
// which suits local-only clutter like editor and tool config folders.

export type ExcludeScope = 'shared' | 'private' | 'global'

export interface ExcludeSets {
  shared: string[]
  private: string[]
  global: string[]
  globalPath: string
}

function expandHome(p: string): string {
  if (p === '~') return homedir()
  if (p.startsWith('~/') || p.startsWith('~\\')) return join(homedir(), p.slice(2))
  return p
}

//Read a file into lines, returning [] if it does not exist.
function readLines(path: string): string[] {
  try {
    return readFileSync(path, 'utf8').split(/\r?\n/)
  } catch {
    return []
  }
}

// The actual ignore patterns: trimmed, non-blank, non-comment lines.
function patternsOf(lines: string[]): string[] {
  return lines.map((l) => l.trim()).filter((l) => l.length > 0 && !l.startsWith('#'))
}

function ensureFile(path: string): void {
  mkdirSync(dirname(path), { recursive: true })
  if (!existsSync(path)) writeFileSync(path, '')
}

// Append a pattern if absent, preserving any comments/blank lines already there.
function appendPattern(path: string, pattern: string): void {
  ensureFile(path)
  const text = readFileSync(path, 'utf8')
  if (patternsOf(text.split(/\r?\n/)).includes(pattern)) return
  const sep = text.length === 0 || text.endsWith('\n') ? '' : '\n'
  writeFileSync(path, text + sep + pattern + '\n')
}

//Drop every line that is exactly this pattern; leave the rest of the file intact.
function removePattern(path: string, pattern: string): void {
  if (!existsSync(path)) return
  const kept = readFileSync(path, 'utf8')
    .split(/\r?\n/)
    .filter((l) => l.trim() !== pattern)
  writeFileSync(path, kept.join('\n'))
}

// Absolute path to this clone's private exclude file (handles worktrees).
async function privateExcludePath(cwd: string): Promise<string> {
  const rel = (await git(cwd, ['rev-parse', '--git-path', 'info/exclude'])).trim()
  return resolve(cwd, rel)
}

// Where global ignore patterns live. Uses core.excludesFile if set, otherwise the
// path git reads by default (XDG), reporting whether it was explicitly configured.
async function globalExcludeInfo(cwd: string): Promise<{ path: string; configured: boolean }> {
  let configured = ''
  try {
    configured = (await git(cwd, ['config', '--global', '--get', 'core.excludesFile'])).trim()
  } catch {
    //Key not set -> git exits non-zero; treat as unconfigured
  }
  if (configured) return { path: resolve(expandHome(configured)), configured: true }
  const xdg = process.env.XDG_CONFIG_HOME
  const def = xdg ? join(xdg, 'git', 'ignore') : join(homedir(), '.config', 'git', 'ignore')
  return { path: def, configured: false }
}

// Resolve a writable global exclude file, wiring up core.excludesFile the first
// time so git actually honours what we write regardless of platform defaults.
async function ensureGlobalExclude(cwd: string): Promise<string> {
  const info = await globalExcludeInfo(cwd)
  if (info.configured) {
    ensureFile(info.path)
    return info.path
  }
  // Not configured: keep using the default file if it already exists, else create
  // a conventional one and point git at it.
  if (existsSync(info.path)) return info.path
  const path = join(homedir(), '.gitignore_global')
  ensureFile(path)
  await git(cwd, ['config', '--global', 'core.excludesFile', path])
  return path
}

async function scopePath(cwd: string, scope: ExcludeScope): Promise<string> {
  if (scope === 'shared') return join(cwd, '.gitignore')
  if (scope === 'private') return privateExcludePath(cwd)
  return (await globalExcludeInfo(cwd)).path
}

// Read all three ignore sources for the repo at cwd.
export async function listExcludes(cwd: string): Promise<ExcludeSets> {
  const [sharedPath, privatePath, gInfo] = await Promise.all([
    Promise.resolve(join(cwd, '.gitignore')),
    privateExcludePath(cwd),
    globalExcludeInfo(cwd)
  ])
  return {
    shared: patternsOf(readLines(sharedPath)),
    private: patternsOf(readLines(privatePath)),
    global: patternsOf(readLines(gInfo.path)),
    globalPath: gInfo.path
  }
}

export interface IgnoredFileSets {
  gitignore: string[]
  local: string[]
  global: string[]
}

// Returns the actual files each ignore source is currently hiding, by running
// git ls-files --ignored with one exclude-from at a time. Untracked only; already
// committed files are never listed even if they match a pattern.
export async function listIgnoredFiles(cwd: string): Promise<IgnoredFileSets> {
  const [sharedPath, privatePath, gInfo] = await Promise.all([
    Promise.resolve(join(cwd, '.gitignore')),
    privateExcludePath(cwd),
    globalExcludeInfo(cwd)
  ])

  async function filesFor(excludeFile: string): Promise<string[]> {
    if (!existsSync(excludeFile)) return []
    try {
      const out = await git(cwd, [
        'ls-files', '--others', '--ignored', '--directory',
        '--no-empty-directory', '-z',
        `--exclude-from=${excludeFile}`
      ])
      return out.split('\0').map(s => s.trim()).filter(Boolean)
    } catch {
      return []
    }
  }

  const [gitignore, local, global] = await Promise.all([
    filesFor(sharedPath),
    filesFor(privatePath),
    filesFor(gInfo.path)
  ])
  return { gitignore, local, global }
}

/** Add a pattern to one of the ignore sources, then return the updated sets. */
export async function addExclude(cwd: string, scope: ExcludeScope, pattern: string): Promise<ExcludeSets> {
  const pat = pattern.trim()
  if (!pat) throw new Error('Enter a pattern to ignore.')
  const path = scope === 'global' ? await ensureGlobalExclude(cwd) : await scopePath(cwd, scope)
  appendPattern(path, pat)
  return listExcludes(cwd)
}

/** Remove a pattern from one of the ignore sources, then return the updated sets. */
export async function removeExclude(
  cwd: string,
  scope: ExcludeScope,
  pattern: string
): Promise<ExcludeSets> {
  removePattern(await scopePath(cwd, scope), pattern)
  return listExcludes(cwd)
}

/**
 * Make sure a profile of default patterns is present in this repo. private goes
 * into .git/info/exclude (per-clone, never committed) and global into the
 * global excludesFile. Runs safely more than once: existing patterns are left alone.
 */
export async function seedExcludes(
  cwd: string,
  profile: { private?: string[]; global?: string[] }
): Promise<ExcludeSets> {
  const clean = (xs?: string[]) => (xs ?? []).map((x) => x.trim()).filter(Boolean)
  const priv = clean(profile.private)
  const glob = clean(profile.global)
  if (priv.length > 0) {
    const path = await privateExcludePath(cwd)
    for (const pat of priv) appendPattern(path, pat)
  }
  if (glob.length > 0) {
    const path = await ensureGlobalExclude(cwd)
    for (const pat of glob) appendPattern(path, pat)
  }
  return listExcludes(cwd)
}

export interface CommitInfo {
  hash: string
  shortHash: string
  subject: string
  author: string
  email: string
  date: string
  relDate: string
}

//Recent commit log, optionally limited to one file.
export async function log(cwd: string, file?: string, limit = 50): Promise<CommitInfo[]> {
  const sep = '\x1f'
  const recSep = '\x1e'
  const fmt = ['%H', '%h', '%s', '%an', '%ae', '%ad', '%ar'].join(sep)
  const args = ['log', `--pretty=format:${fmt}${recSep}`, '--date=iso', `-n${limit}`]
  if (file) args.push('--follow', '--', file)
  const raw = await git(cwd, args)
  return raw
    .split(recSep)
    .map((r) => r.trim())
    .filter(Boolean)
    .map((r) => {
      const [hash, shortHash, subject, author, email, date, relDate] = r.split(sep)
      return { hash, shortHash, subject, author, email, date, relDate }
    })
}

/** Contents of a file at a specific commit (for "view previous version"). */
export async function fileAtCommit(cwd: string, hash: string, path: string): Promise<string> {
  return git(cwd, ['show', `${hash}:${path}`])
}

/** Diff of a single commit for a file (what changed in that revision). */
export async function commitFileDiff(cwd: string, hash: string, path: string): Promise<string> {
  return git(cwd, ['show', '--no-color', hash, '--', path])
}

/**
 * One commit, fully readable in a single view: the log header + message, then
 * the diffstat, then the full patch -- i.e. "git log -1 --stat" and "git diff"
 * combined for the chosen revision. Used by the commit preview.
 */
export async function commitShow(cwd: string, hash: string): Promise<string> {
  return git(cwd, ['show', '--no-color', '--stat', '-p', '--date=iso', hash])
}

export interface CommitMeta {
  message: string // full commit message (%B), trailing blank lines trimmed
  files: { path: string; add: number; del: number }[] // numstat; -1 add/del means binary
  isHead: boolean // amend is only offered for the tip commit
}

/** Message, per-file line counts, and whether this is HEAD - enough to drive an amend form. */
export async function commitMeta(cwd: string, hash: string): Promise<CommitMeta> {
  const message = await git(cwd, ['log', '-1', '--format=%B', hash])
  const head = (await git(cwd, ['rev-parse', 'HEAD']).catch(() => '')).trim()
  const full = (await git(cwd, ['rev-parse', hash]).catch(() => '')).trim()
  const numstat = await git(cwd, ['show', '--numstat', '--format=', '--no-color', hash]).catch(() => '')
  const files = numstat
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean)
    .map((l) => {
      const [add, del, ...rest] = l.split('\t')
      const n = (v: string) => (v === '-' ? -1 : parseInt(v, 10) || 0)
      return { path: rest.join('\t'), add: n(add), del: n(del) }
    })
  return { message: message.replace(/\n+$/, ''), files, isHead: head !== '' && head === full }
}

export interface GraphCommit {
  hash: string
  shortHash: string
  parents: string[]
  subject: string
  author: string
  email: string
  date: string
  relDate: string
  refs: string[] // decorations: branch names, tags, "HEAD -> main"
  coauthors: { name: string; email: string }[] // parsed from Co-authored-by trailers
}

// "Name <email>" -> {name, email}. Trailer values that omit the angle brackets
// keep the whole string as the name.
function parseTrailerPerson(raw: string): { name: string; email: string } {
  const m = raw.match(/^(.*?)\s*<(.*?)>\s*$/)
  return m ? { name: m[1].trim(), email: m[2].trim() } : { name: raw.trim(), email: '' }
}

export interface LogQuery {
  all?: boolean // include every branch, not just HEAD
  limit?: number
  grep?: string // filter by commit message (case-insensitive)
  author?: string // filter by author name/email
  path?: string // limit to commits touching this path
}

/**
 * Recent commits with their parent topology and ref decorations, suitable for
 * drawing a branch graph. Supports message/author/path search filters.
 */
export async function logGraph(cwd: string, q: LogQuery = {}): Promise<GraphCommit[]> {
  const args = ['log', `--pretty=format:${GRAPH_FMT}${GREC}`, '--date=iso', '--topo-order', `-n${q.limit ?? 300}`]
  if (q.all) args.push('--all')
  if (q.grep && q.grep.trim()) args.push('-i', `--grep=${q.grep.trim()}`)
  if (q.author && q.author.trim()) args.push(`--author=${q.author.trim()}`)
  if (q.path && q.path.trim()) args.push('--', q.path.trim())
  return parseGraphCommits(await git(cwd, args))
}

const GSEP = '\x1f' // field separator
const GREC = '\x1e' // record separator
const GCO = '\x02' // separates multiple co-author trailers within one field
// Trailing field harvests every Co-authored-by line so the UI can show them.
const GRAPH_FMT = ['%H', '%h', '%P', '%s', '%an', '%ae', '%ad', '%ar', '%D',
  `%(trailers:key=Co-authored-by,valueonly,separator=%x02)`].join(GSEP)

function parseGraphCommits(raw: string): GraphCommit[] {
  return raw
    .split(GREC)
    .map((r) => r.replace(/^\n/, ''))
    .filter((r) => r.trim())
    .map((r) => {
      const [hash, shortHash, parents, subject, author, email, date, relDate, refs, coRaw] = r.split(GSEP)
      return {
        hash,
        shortHash,
        parents: parents ? parents.split(' ').filter(Boolean) : [],
        subject,
        author,
        email,
        date,
        relDate,
        refs: refs ? refs.split(',').map((s) => s.trim()).filter(Boolean) : [],
        coauthors: coRaw ? coRaw.split(GCO).map((s) => s.trim()).filter(Boolean).map(parseTrailerPerson) : []
      }
    })
}

/** Commits on HEAD that no remote has yet - what a push would upload. Uses the
 * branch's upstream when set; otherwise (new branch, first push) falls back to
 * "not on any remote-tracking ref" so those commits still get checked. */
export async function unpushedCommits(cwd: string): Promise<GraphCommit[]> {
  const up = (await git(cwd, ['rev-parse', '--abbrev-ref', '--symbolic-full-name', '@{u}']).catch(() => '')).trim()
  const base = ['log', `--pretty=format:${GRAPH_FMT}${GREC}`, '--date=iso']
  const args = up ? [...base, `${up}..HEAD`] : [...base, 'HEAD', '--not', '--remotes']
  const raw = await git(cwd, args).catch(() => '')
  return parseGraphCommits(raw)
}

/** The Co-authored-by people on one commit, parsed to name/email. */
export async function commitCoauthors(cwd: string, hash: string): Promise<{ name: string; email: string }[]> {
  const raw = await git(cwd, [
    'show',
    '-s',
    `--format=%(trailers:key=Co-authored-by,valueonly,separator=%x02)`,
    hash
  ]).catch(() => '')
  return raw
    .split('\x02')
    .map((s) => s.trim())
    .filter(Boolean)
    .map(parseTrailerPerson)
}

export async function cherryPick(cwd: string, hash: string): Promise<string> {
  return git(cwd, ['cherry-pick', hash])
}

export async function revertCommit(cwd: string, hash: string): Promise<string> {
  return git(cwd, ['revert', '--no-edit', hash])
}

// mode decides how much to keep: soft keeps the changes staged, mixed keeps them in the
// worktree, hard throws them away
export async function resetTo(cwd: string, hash: string, mode: 'soft' | 'mixed' | 'hard'): Promise<void> {
  await git(cwd, ['reset', `--${mode}`, hash])
}

export async function checkoutDetached(cwd: string, hash: string): Promise<void> {
  await git(cwd, ['checkout', hash])
}

export async function createBranchAt(cwd: string, name: string, ref: string): Promise<void> {
  await git(cwd, ['checkout', '-b', name, ref])
}

// lightweight tag, no message
export async function tagAt(cwd: string, name: string, ref: string): Promise<void> {
  await git(cwd, ['tag', name, ref])
}

export interface BranchFull {
  name: string // short name, e.g. "main" or "origin/main"
  current: boolean
  remote: boolean // a remote-tracking branch (refs/remotes/*)
  upstream: string | null
  ahead: number
  behind: number
  gone: boolean // upstream is gone
  hash: string
  subject: string
  relDate: string
}

/** Local and remote-tracking branches with upstream + ahead/behind + tip info. */
export async function branchesFull(cwd: string): Promise<BranchFull[]> {
  const sep = '\x1f'
  const fmt = [
    '%(HEAD)',
    '%(refname)',
    '%(refname:short)',
    '%(upstream:short)',
    '%(upstream:track)',
    '%(objectname:short)',
    '%(contents:subject)',
    '%(committerdate:relative)'
  ].join(sep)
  const raw = await git(cwd, ['for-each-ref', `--format=${fmt}`, 'refs/heads', 'refs/remotes'])
  const out: BranchFull[] = []
  for (const line of raw.split('\n').filter(Boolean)) {
    const [head, refname, short, upstream, track, hash, subject, relDate] = line.split(sep)
    if (short.endsWith('/HEAD')) continue // skip the symbolic origin/HEAD
    let ahead = 0
    let behind = 0
    let gone = false
    if (track) {
      if (track.includes('gone')) gone = true
      const a = track.match(/ahead (\d+)/)
      const b = track.match(/behind (\d+)/)
      if (a) ahead = parseInt(a[1], 10)
      if (b) behind = parseInt(b[1], 10)
    }
    out.push({
      name: short,
      current: head === '*',
      remote: refname.startsWith('refs/remotes/'),
      upstream: upstream || null,
      ahead,
      behind,
      gone,
      hash,
      subject,
      relDate
    })
  }
  return out
}

export async function deleteBranch(cwd: string, name: string, force = false): Promise<void> {
  await git(cwd, ['branch', force ? '-D' : '-d', name])
}

export async function renameBranch(cwd: string, oldName: string, newName: string): Promise<void> {
  await git(cwd, ['branch', '-m', oldName, newName])
}

/** Force-move a (non-current) branch ref to point at another commit/ref. */
export async function moveBranch(cwd: string, name: string, target: string): Promise<void> {
  await git(cwd, ['branch', '-f', name, target])
}

export async function mergeBranch(cwd: string, name: string): Promise<string> {
  return git(cwd, ['merge', '--no-edit', name])
}

export async function setUpstream(cwd: string, branch: string, upstream: string): Promise<void> {
  await git(cwd, ['branch', '--set-upstream-to', upstream, branch])
}

/** Delete a branch on its remote (git push <remote> --delete <branch>). */
export async function deleteRemoteBranch(cwd: string, remote: string, branch: string): Promise<string> {
  return git(cwd, ['push', remote, '--delete', branch])
}

export interface Remote {
  name: string
  url: string
}

//configured remotes, deduped across the fetch/push lines
export async function remotes(cwd: string): Promise<Remote[]> {
  const raw = await git(cwd, ['remote', '-v']).catch(() => '')
  const seen = new Map<string, string>()
  for (const line of raw.split('\n').filter(Boolean)) {
    const m = line.match(/^(\S+)\s+(\S+)\s+\((?:fetch|push)\)$/)
    if (m && !seen.has(m[1])) seen.set(m[1], m[2])
  }
  return [...seen.entries()].map(([name, url]) => ({ name, url }))
}

// Origin's url, or null if there isn't one
export async function originUrl(cwd: string): Promise<string | null> {
  try {
    return (await git(cwd, ['remote', 'get-url', 'origin'])).trim()
  } catch {
    return null
  }
}

export interface BlameLine {
  hash: string
  shortHash: string
  author: string
  date: string // YYYY-MM-DD
  lineNo: number
  content: string
}

/**
 * Per-line authorship for a file. We ask for --line-porcelain instead of plain blame
 * because it repeats the author and timestamp on every line, which is wasteful on the
 * wire but means each line is self-contained and the parser below never has to carry
 * commit info forward from one line to the next.
 */
export async function blame(cwd: string, path: string): Promise<BlameLine[]> {
  const raw = await git(cwd, ['blame', '--line-porcelain', '--', path])
  const out: BlameLine[] = []
  let cur: { hash: string; author: string; date: string; lineNo: number } | null = null
  for (const l of raw.split('\n')) {
    const head = l.match(/^([0-9a-f]{40})\s+\d+\s+(\d+)/)
    if (head) {
      cur = { hash: head[1], author: '', date: '', lineNo: parseInt(head[2], 10) }
      continue
    }
    if (!cur) continue
    if (l.startsWith('author ')) cur.author = l.slice(7)
    else if (l.startsWith('author-time ')) {
      const ts = parseInt(l.slice(12), 10)
      if (!isNaN(ts)) cur.date = new Date(ts * 1000).toISOString().slice(0, 10)
    } else if (l.startsWith('\t')) {
      out.push({
        hash: cur.hash,
        shortHash: cur.hash.slice(0, 7),
        author: cur.author,
        date: cur.date,
        lineNo: cur.lineNo,
        content: l.slice(1)
      })
      cur = null
    }
  }
  return out
}

export type OpKind = 'cherry-pick' | 'revert' | 'merge' | 'rebase' | null

export interface OpState {
  kind: OpKind
  conflicts: number // number of unmerged files still to resolve
}

/**
 * Detect a multi-step operation that git paused (usually for conflicts) so the
 * UI can offer continue / abort / skip. Reads the marker files in the git dir.
 */
export async function opState(cwd: string): Promise<OpState> {
  let gitDir: string
  try {
    gitDir = (await git(cwd, ['rev-parse', '--absolute-git-dir'])).trim()
  } catch {
    return { kind: null, conflicts: 0 }
  }
  const has = (p: string) => existsSync(join(gitDir, p))
  let kind: OpKind = null
  if (has('rebase-merge') || has('rebase-apply')) kind = 'rebase'
  else if (has('CHERRY_PICK_HEAD')) kind = 'cherry-pick'
  else if (has('REVERT_HEAD')) kind = 'revert'
  else if (has('MERGE_HEAD')) kind = 'merge'
  const conflicts = kind ? (await conflictedPaths(cwd)).length : 0
  return { kind, conflicts }
}

// core.editor=true makes git use a no-op editor, so --continue never blocks on a
// commit-message prompt (we keep the message git already prepared).
export async function opContinue(cwd: string, kind: Exclude<OpKind, null>): Promise<string> {
  return git(cwd, ['-c', 'core.editor=true', kind, '--continue'])
}

export async function opAbort(cwd: string, kind: Exclude<OpKind, null>): Promise<string> {
  return git(cwd, [kind, '--abort'])
}

export async function opSkip(cwd: string, kind: Exclude<OpKind, null>): Promise<string> {
  //--skip applies to cherry-pick, revert and rebase (merge has no skip).
  return git(cwd, ['-c', 'core.editor=true', kind, '--skip'])
}

export interface BisectCommit {
  hash: string
  subject: string
  author: string
  relDate: string
}

export interface BisectState {
  active: boolean
  current: BisectCommit | null
  remaining: number // revisions still to test
  steps: number // roughly this many good/bad marks left
  firstBad: BisectCommit | null
}

async function bisectShow(cwd: string, ref: string): Promise<BisectCommit> {
  const sep = '\x1f'
  const out = await git(cwd, ['show', '-s', `--format=%h${sep}%s${sep}%an${sep}%cr`, ref])
  const [hash, subject, author, relDate] = out.trim().split(sep)
  return { hash, subject, author, relDate }
}

/** Where a bisect session stands: the commit to test now, how many are left, and the culprit once found. */
export async function bisectState(cwd: string): Promise<BisectState> {
  const idle: BisectState = { active: false, current: null, remaining: 0, steps: 0, firstBad: null }
  let gitDir: string
  try {
    gitDir = (await git(cwd, ['rev-parse', '--absolute-git-dir'])).trim()
  } catch {
    return idle
  }
  if (!existsSync(join(gitDir, 'BISECT_LOG'))) return idle

  const current = await bisectShow(cwd, 'HEAD')
  const goodRefs = (await git(cwd, ['for-each-ref', '--format=%(refname)', 'refs/bisect/good-*']))
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean)
  let remaining = 0
  let steps = 0
  if (goodRefs.length) {
    // git tracks the ends as refs/bisect/*; --bisect-vars reads the count back off them
    // so we don't have to scrape "N revisions left" out of the human-facing output.
    const vars = await git(cwd, ['rev-list', '--bisect-vars', 'refs/bisect/bad', '--not', ...goodRefs]).catch(() => '')
    remaining = Number(/bisect_nr=(\d+)/.exec(vars)?.[1] ?? 0)
    steps = Number(/bisect_steps=(\d+)/.exec(vars)?.[1] ?? 0)
  }
  // nothing left to test means HEAD is parked on the first bad commit
  const firstBad = goodRefs.length && remaining === 0 ? current : null
  return { active: true, current, remaining, steps, firstBad }
}

//`bisect start <bad> <good>` seeds both ends and checks out the midpoint in one go.
export async function bisectStart(cwd: string, good: string, bad: string): Promise<string> {
  return git(cwd, ['bisect', 'start', bad, good])
}

export async function bisectMark(cwd: string, verdict: 'good' | 'bad' | 'skip'): Promise<string> {
  return git(cwd, ['bisect', verdict])
}

export async function bisectReset(cwd: string): Promise<string> {
  return git(cwd, ['bisect', 'reset'])
}

//Rebase the current branch onto another branch/ref.
export async function rebaseOnto(cwd: string, upstream: string): Promise<string> {
  return git(cwd, ['-c', 'core.editor=true', 'rebase', upstream])
}

export interface RebaseItem {
  sha: string
  action: 'pick' | 'reword' | 'squash' | 'fixup' | 'drop'
  message?: string // new message for 'reword'
}

// Run git with a custom environment (needed to inject the rebase todo list).
function gitWithEnv(cwd: string, args: string[], env: NodeJS.ProcessEnv): Promise<string> {
  return new Promise((resolve, reject) => {
    execFile(
      'git',
      args,
      { cwd, maxBuffer: MAX_BUFFER, windowsHide: true, encoding: 'utf8', env },
      (err, stdout, stderr) => {
        if (err) return reject(new Error((stderr || err.message).trim()))
        resolve(stdout)
      }
    )
  })
}

/** Linear list of commits in base..HEAD, oldest first (the rebase todo order). */
export async function commitsSince(
  cwd: string,
  base: string
): Promise<{ hash: string; shortHash: string; subject: string }[]> {
  const sep = '\x1f'
  const rec = '\x1e'
  const fmt = ['%H', '%h', '%s'].join(sep)
  const raw = await git(cwd, ['log', '--reverse', `--pretty=format:${fmt}${rec}`, `${base}..HEAD`])
  return raw
    .split(rec)
    .map((r) => r.replace(/^\n/, ''))
    .filter((r) => r.trim())
    .map((r) => {
      const [hash, shortHash, subject] = r.split(sep)
      return { hash, shortHash, subject }
    })
}

/**
 * Non-interactive driver for git rebase -i. We generate the todo list from
 * items (already in apply order) and inject it via GIT_SEQUENCE_EDITOR; rewords
 * become pick + exec git commit --amend -F <msgfile> so nothing prompts.
 * Squash uses git's default combined message (GIT_EDITOR is a no-op).
 */
export async function interactiveRebase(cwd: string, base: string, items: RebaseItem[]): Promise<string> {
  const active = items.filter((it) => it.action !== 'drop')
  if (active.length && (active[0].action === 'squash' || active[0].action === 'fixup')) {
    //The first kept commit has nothing to meld into.
    active[0].action = 'pick'
  }
  const dir = mkdtempSync(join(tmpdir(), 'hydrodam-rebase-'))
  const fwd = (p: string) => p.replace(/\\/g, '/')
  const lines: string[] = []
  let n = 0
  for (const it of items) {
    if (it.action === 'drop') {
      lines.push(`drop ${it.sha}`)
    } else if (it.action === 'reword') {
      const msgFile = join(dir, `msg-${n++}.txt`)
      writeFileSync(msgFile, (it.message ?? '').replace(/\r\n/g, '\n'))
      lines.push(`pick ${it.sha}`)
      lines.push(`exec git commit --amend -F "${fwd(msgFile)}"`)
    } else {
      lines.push(`${it.action} ${it.sha}`)
    }
  }
  const todoFile = join(dir, 'todo.txt')
  writeFileSync(todoFile, lines.join('\n') + '\n')
  const helper = join(dir, 'seq.cjs')
  writeFileSync(
    helper,
    "const fs=require('fs');fs.writeFileSync(process.argv[2],fs.readFileSync(process.env.HYDRODAM_TODO));\n"
  )
  const env: NodeJS.ProcessEnv = {
    ...process.env,
    HYDRODAM_TODO: todoFile,
    GIT_SEQUENCE_EDITOR: `node "${fwd(helper)}"`,
    GIT_EDITOR: 'true'
  }
  const out = await gitWithEnv(cwd, ['rebase', '-i', '--autostash', base], env)
  // Only clean up on a clean finish; if it paused for conflicts the exec msg
  // files are still needed by rebase --continue.
  try {
    rmSync(dir, { recursive: true, force: true })
  } catch {
    //ignore
  }
  return out
}

export interface SigningConfig {
  enabled: boolean
  format: string // openpgp | ssh
  key: string
}

export async function signingConfig(cwd: string): Promise<SigningConfig> {
  const read = (k: string) => git(cwd, ['config', k]).then((s) => s.trim()).catch(() => '')
  const [enabled, format, key] = await Promise.all([
    read('commit.gpgsign'),
    read('gpg.format'),
    read('user.signingkey')
  ])
  return { enabled: enabled === 'true', format: format || 'openpgp', key }
}

export async function setSigning(cwd: string, cfg: SigningConfig, scope: 'local' | 'global'): Promise<void> {
  const flag = scope === 'global' ? '--global' : '--local'
  await git(cwd, ['config', flag, 'commit.gpgsign', cfg.enabled ? 'true' : 'false'])
  if (cfg.format) await git(cwd, ['config', flag, 'gpg.format', cfg.format])
  if (cfg.key) await git(cwd, ['config', flag, 'user.signingkey', cfg.key])
  else await git(cwd, ['config', flag, '--unset', 'user.signingkey']).catch(() => {})
}

/** Signature status of a commit: %G? code (G/B/U/N/E) plus the signer string. */
export async function commitSignature(cwd: string, hash = 'HEAD'): Promise<{ status: string; signer: string }> {
  const out = await git(cwd, ['log', '-1', '--format=%G?\x1f%GS', hash]).catch(() => '')
  const [status, signer] = out.trim().split('\x1f')
  return { status: status || 'N', signer: signer || '' }
}

export interface SshKey {
  name: string
  type: string
  pub: string
}

//Public SSH keys found in ~/.ssh.
export function sshKeys(): SshKey[] {
  const dir = join(homedir(), '.ssh')
  try {
    return readdirSync(dir)
      .filter((f) => f.endsWith('.pub'))
      .map((f) => {
        const pub = readFileSync(join(dir, f), 'utf8').trim()
        return { name: f, type: pub.split(' ')[0] || '', pub }
      })
  } catch {
    return []
  }
}

// Generate a new ed25519 key (no passphrase) and hand back the public half.
// TODO: let the user choose the key type, ed25519 is hardcoded for now
export async function generateSshKey(name: string, comment: string): Promise<string> {
  const safe = name.trim().replace(/[^A-Za-z0-9_.-]/g, '')
  if (!safe) throw new Error('Enter a key file name.')
  const dir = join(homedir(), '.ssh')
  mkdirSync(dir, { recursive: true })
  const path = join(dir, safe)
  if (existsSync(path) || existsSync(path + '.pub')) throw new Error('A key with that name already exists.')
  await pExecFile('ssh-keygen', ['-t', 'ed25519', '-f', path, '-N', '', '-C', comment || ''])
  return readFileSync(path + '.pub', 'utf8').trim()
}

export async function addSubmodule(cwd: string, url: string, path: string): Promise<string> {
  if (!url.trim() || !path.trim()) throw new Error('Enter both a URL and a path.')
  return git(cwd, ['submodule', 'add', url.trim(), path.trim()])
}

export interface SparseState {
  enabled: boolean
  patterns: string[]
}

export async function sparseState(cwd: string): Promise<SparseState> {
  try {
    const raw = await git(cwd, ['sparse-checkout', 'list'])
    return { enabled: true, patterns: raw.split('\n').map((l) => l.trim()).filter(Boolean) }
  } catch {
    return { enabled: false, patterns: [] }
  }
}

export async function sparseSet(cwd: string, patterns: string[]): Promise<void> {
  const clean = patterns.map((p) => p.trim()).filter(Boolean)
  if (!clean.length) throw new Error('Enter at least one path.')
  await git(cwd, ['sparse-checkout', 'set', '--no-cone', ...clean])
}

export async function sparseDisable(cwd: string): Promise<void> {
  await git(cwd, ['sparse-checkout', 'disable'])
}

export interface Insights {
  total: number
  authors: { name: string; count: number }[]
  days: { date: string; count: number }[]
}

/** Repo metrics: total commits, top authors, and per-day activity (last 30 days). */
export async function insights(cwd: string): Promise<Insights> {
  const total = parseInt((await git(cwd, ['rev-list', '--count', 'HEAD']).catch(() => '0')).trim(), 10) || 0
  const sl = await git(cwd, ['shortlog', '-sn', '--all', '--no-merges']).catch(() => '')
  const authors = sl
    .split('\n')
    .map((l) => l.trim().match(/^(\d+)\s+(.+)$/))
    .filter((m): m is RegExpMatchArray => !!m)
    .map((m) => ({ name: m[2], count: parseInt(m[1], 10) }))
    .slice(0, 12)
  const draw = await git(cwd, ['log', '--since=30 days ago', '--date=short', '--format=%ad']).catch(() => '')
  const map = new Map<string, number>()
  for (const d of draw.split('\n').filter(Boolean)) map.set(d, (map.get(d) || 0) + 1)
  const days = [...map.entries()].map(([date, count]) => ({ date, count })).sort((a, b) => a.date.localeCompare(b.date))
  return { total, authors, days }
}

export interface ReflogEntry {
  selector: string // e.g. HEAD@{2}
  shortHash: string
  action: string // reflog message, e.g. "commit: ...", "reset: moving to ..."
  subject: string // the commit subject
  relDate: string
}

/** Recent HEAD movements (git reflog) - the basis for undo. */
export async function reflog(cwd: string, limit = 100): Promise<ReflogEntry[]> {
  const sep = '\x1f'
  const rec = '\x1e'
  const fmt = ['%gD', '%h', '%gs', '%s', '%cr'].join(sep)
  const raw = await git(cwd, ['reflog', `--format=${fmt}${rec}`, `-n${limit}`]).catch(() => '')
  return raw
    .split(rec)
    .map((r) => r.replace(/^\n/, ''))
    .filter((r) => r.trim())
    .map((r) => {
      const [selector, shortHash, action, subject, relDate] = r.split(sep)
      return { selector, shortHash, action, subject, relDate }
    })
}

/** Read a blob (any bytes) at a ref:path - used for image diffs. */
export async function blobAt(cwd: string, ref: string, path: string): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    execFile(
      'git',
      ['show', `${ref}:${path}`],
      { cwd, maxBuffer: MAX_BUFFER, windowsHide: true },
      (err, stdout) => {
        if (err) return reject(err)
        resolve(stdout as unknown as Buffer)
      }
    )
  })
}

export interface LfsFile {
  oid: string
  present: boolean
  path: string
  size: string
}

export interface LfsInfo {
  installed: boolean
  files: LfsFile[]
  patterns: string[]
}

/** git-lfs status: whether it is installed, tracked patterns, and tracked files. */
export async function lfsInfo(cwd: string): Promise<LfsInfo> {
  try {
    await git(cwd, ['lfs', 'version'])
  } catch {
    return { installed: false, files: [], patterns: [] }
  }
  const files: LfsFile[] = []
  try {
    const raw = await git(cwd, ['lfs', 'ls-files', '-l', '-s'])
    for (const line of raw.split('\n').filter(Boolean)) {
      // "<oid> <* | -> <path> (<size>)"
      const m = line.match(/^(\S+)\s+([*-])\s+(.+?)(?:\s+\(([^)]+)\))?$/)
      if (m) files.push({ oid: m[1].slice(0, 10), present: m[2] === '*', path: m[3], size: m[4] || '' })
    }
  } catch {
    //ls-files can fail in a repo with no lfs objects; treat as empty
  }
  //git lfs track prints "Listing tracked patterns" then indented "pattern (.gitattributes)".
  let patterns: string[] = []
  try {
    const raw = await git(cwd, ['lfs', 'track'])
    patterns = raw
      .split('\n')
      .map((l) => l.trim())
      .filter((l) => l.includes('(') && l.includes(')'))
      .map((l) => l.replace(/\s*\(.*\)\s*$/, ''))
      .filter(Boolean)
  } catch {
    // Ignore
  }
  return { installed: true, files, patterns }
}

export async function lfsTrack(cwd: string, pattern: string): Promise<string> {
  const p = pattern.trim()
  if (!p) throw new Error('Enter a pattern to track (e.g. *.psd).')
  return git(cwd, ['lfs', 'track', p])
}

export async function lfsPull(cwd: string): Promise<string> {
  return git(cwd, ['lfs', 'pull'])
}

// Split a unified diff for ONE file into its header (everything before the first
// @@) and the individual hunk blocks (each starting with its @@ line).
function splitDiffHunks(diff: string): { header: string; hunks: string[] } {
  const lines = diff.replace(/\n$/, '').split('\n')
  const first = lines.findIndex((l) => l.startsWith('@@'))
  if (first === -1) return { header: diff, hunks: [] }
  const header = lines.slice(0, first).join('\n')
  const hunks: string[][] = []
  let cur: string[] = []
  for (let i = first; i < lines.length; i++) {
    const l = lines[i]
    if (l.startsWith('@@')) {
      if (cur.length) hunks.push(cur)
      cur = [l]
    } else cur.push(l)
  }
  if (cur.length) hunks.push(cur)
  return { header, hunks: hunks.map((h) => h.join('\n')) }
}

async function applyToIndex(cwd: string, patch: string, reverse: boolean): Promise<void> {
  const args = ['apply', '--cached', '--whitespace=nowarn']
  if (reverse) args.push('--reverse')
  await git(cwd, args, { input: patch.endsWith('\n') ? patch : patch + '\n' })
}

// Rebuild a hunk keeping only the selected changed lines. selected indexes the
// changed (+/-) and context lines of the hunk body in order. mode 'stage' builds
// a forward patch (working -> index); 'unstage' builds one to reverse-apply.
function rebuildHunk(hunk: string, selected: Set<number>, mode: 'stage' | 'unstage'): string | null {
  const lines = hunk.split('\n')
  const headerLine = lines[0]
  const body = lines.slice(1)
  const out: string[] = []
  let oldCount = 0
  let newCount = 0
  let idx = -1
  let kept = 0
  for (const l of body) {
    if (l === '') continue
    if (l.startsWith('\\')) {
      out.push(l)
      continue
    }
    const tag = l[0]
    if (tag === ' ') {
      out.push(l)
      oldCount++
      newCount++
      idx++
      continue
    }
    idx++
    const sel = selected.has(idx)
    if (tag === '+') {
      if (mode === 'stage') {
        if (sel) {
          out.push(l)
          newCount++
          kept++
        }
      } else if (sel) {
        out.push(l)
        newCount++
        kept++
      } else {
        out.push(' ' + l.slice(1))
        oldCount++
        newCount++
      }
    } else if (tag === '-') {
      if (mode === 'stage') {
        if (sel) {
          out.push(l)
          oldCount++
          kept++
        } else {
          out.push(' ' + l.slice(1))
          oldCount++
          newCount++
        }
      } else if (sel) {
        out.push(l)
        oldCount++
        kept++
      }
    }
  }
  if (kept === 0) return null
  const m = headerLine.match(/^@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@(.*)$/)
  if (!m) return null
  const newHeader = `@@ -${m[1]},${oldCount} +${m[2]},${newCount} @@${m[3]}`
  return [newHeader, ...out].join('\n')
}

/** Stage a single hunk (by index) of a tracked file's working changes. */
export async function stageHunk(cwd: string, path: string, hunkIndex: number): Promise<void> {
  const diff = await git(cwd, ['diff', '--no-color', '--', path])
  const { header, hunks } = splitDiffHunks(diff)
  if (!hunks[hunkIndex]) throw new Error('That hunk is no longer present (the file changed).')
  await applyToIndex(cwd, header + '\n' + hunks[hunkIndex] + '\n', false)
}

/** Unstage a single hunk (by index) from a file's staged changes. */
export async function unstageHunk(cwd: string, path: string, hunkIndex: number): Promise<void> {
  const diff = await git(cwd, ['diff', '--no-color', '--cached', '--', path])
  const { header, hunks } = splitDiffHunks(diff)
  if (!hunks[hunkIndex]) throw new Error('That hunk is no longer present (the file changed).')
  await applyToIndex(cwd, header + '\n' + hunks[hunkIndex] + '\n', true)
}

// Stage only the selected changed lines within a hunk.
export async function stageLines(cwd: string, path: string, hunkIndex: number, selected: number[]): Promise<void> {
  const diff = await git(cwd, ['diff', '--no-color', '--', path])
  const { header, hunks } = splitDiffHunks(diff)
  if (!hunks[hunkIndex]) throw new Error('That hunk is no longer present (the file changed).')
  const rebuilt = rebuildHunk(hunks[hunkIndex], new Set(selected), 'stage')
  if (!rebuilt) throw new Error('No lines selected to stage.')
  await applyToIndex(cwd, header + '\n' + rebuilt + '\n', false)
}

/** Unstage only the selected changed lines within a staged hunk. */
export async function unstageLines(cwd: string, path: string, hunkIndex: number, selected: number[]): Promise<void> {
  const diff = await git(cwd, ['diff', '--no-color', '--cached', '--', path])
  const { header, hunks } = splitDiffHunks(diff)
  if (!hunks[hunkIndex]) throw new Error('That hunk is no longer present (the file changed).')
  const rebuilt = rebuildHunk(hunks[hunkIndex], new Set(selected), 'unstage')
  if (!rebuilt) throw new Error('No lines selected to unstage.')
  await applyToIndex(cwd, header + '\n' + rebuilt + '\n', true)
}

export interface Worktree {
  path: string
  branch: string | null
  head: string
  bare: boolean
  detached: boolean
  locked: boolean
  current: boolean
}

/** Linked worktrees (git worktree list --porcelain), with the current one flagged. */
export async function worktrees(cwd: string): Promise<Worktree[]> {
  const raw = await git(cwd, ['worktree', 'list', '--porcelain'])
  const here = (await repoRoot(cwd)) || cwd
  const out: Worktree[] = []
  let cur: Partial<Worktree> | null = null
  const flush = () => {
    if (cur && cur.path) {
      out.push({
        path: cur.path,
        branch: cur.branch ?? null,
        head: cur.head ?? '',
        bare: !!cur.bare,
        detached: !!cur.detached,
        locked: !!cur.locked,
        current: samePath(cur.path, here)
      })
    }
    cur = null
  }
  for (const line of raw.split('\n')) {
    if (line.startsWith('worktree ')) {
      flush()
      cur = { path: line.slice('worktree '.length) }
    } else if (!cur) continue
    else if (line.startsWith('HEAD ')) cur.head = line.slice(5, 12)
    else if (line.startsWith('branch ')) cur.branch = line.slice('branch '.length).replace('refs/heads/', '')
    else if (line === 'bare') cur.bare = true
    else if (line === 'detached') cur.detached = true
    else if (line.startsWith('locked')) cur.locked = true
  }
  flush()
  return out
}

export async function addWorktree(cwd: string, path: string, branch: string): Promise<string> {
  // Create a new branch + worktree if the branch is new; otherwise check it out there.
  const exists = (await branches(cwd)).some((b) => b.name === branch)
  const args = exists ? ['worktree', 'add', path, branch] : ['worktree', 'add', '-b', branch, path]
  return git(cwd, args)
}

export async function removeWorktree(cwd: string, path: string, force = false): Promise<string> {
  const args = ['worktree', 'remove']
  if (force) args.push('--force')
  args.push(path)
  return git(cwd, args)
}

export interface Submodule {
  path: string
  head: string
  describe: string
  status: string // ' ' ok, '+' changed, '-' uninitialised, 'U' conflicts
}

// Submodules from git submodule status.
export async function submodules(cwd: string): Promise<Submodule[]> {
  const raw = await git(cwd, ['submodule', 'status', '--recursive']).catch(() => '')
  const out: Submodule[] = []
  for (const line of raw.split('\n').filter(Boolean)) {
    const m = line.match(/^([ +\-U])([0-9a-f]+)\s+(\S+)(?:\s+\((.+)\))?/)
    if (m) out.push({ status: m[1], head: m[2].slice(0, 7), path: m[3], describe: m[4] || '' })
  }
  return out
}

export async function updateSubmodules(cwd: string): Promise<string> {
  return git(cwd, ['submodule', 'update', '--init', '--recursive'])
}

export async function updateSubmodule(cwd: string, path: string): Promise<string> {
  return git(cwd, ['submodule', 'update', '--init', '--', path])
}

/** Re-sync a submodule's remote URL from .gitmodules into .git/config. */
export async function syncSubmodule(cwd: string, path: string): Promise<string> {
  return git(cwd, ['submodule', 'sync', '--', path])
}

/** Unregister a submodule and empty its working tree (config + .gitmodules stay). */
export async function deinitSubmodule(cwd: string, path: string, force: boolean): Promise<string> {
  const args = ['submodule', 'deinit']
  if (force) args.push('-f')
  args.push('--', path)
  return git(cwd, args)
}

/** Commit staged changes with a message + optional co-author trailers. */
export async function commit(
  cwd: string,
  message: string,
  coauthors: { name: string; email: string }[],
  amend = false
): Promise<string> {
  let full = message.trimEnd()
  if (coauthors.length) {
    full += '\n\n' + coauthors.map((c) => `Co-Authored-By: ${c.name} <${c.email}>`).join('\n')
  }
  const args = ['commit', '-F', '-']
  if (amend) args.push('--amend')
  return git(cwd, args, { input: full })
}

export interface BranchInfo {
  name: string
  current: boolean
  upstream: string | null
}

export async function branches(cwd: string): Promise<BranchInfo[]> {
  const raw = await git(cwd, [
    'for-each-ref',
    '--format=%(HEAD)\x1f%(refname:short)\x1f%(upstream:short)',
    'refs/heads'
  ])
  return raw
    .split('\n')
    .filter(Boolean)
    .map((l) => {
      const [head, name, upstream] = l.split('\x1f')
      return { name, current: head === '*', upstream: upstream || null }
    })
}

export async function checkout(cwd: string, branch: string): Promise<void> {
  await git(cwd, ['checkout', branch])
}

export async function createBranch(cwd: string, name: string): Promise<void> {
  await git(cwd, ['checkout', '-b', name])
}

export async function push(cwd: string, setUpstream = false, branch?: string): Promise<string> {
  const args = ['push']
  if (setUpstream && branch) args.push('--set-upstream', 'origin', branch)
  return git(cwd, args)
}

export async function pull(cwd: string): Promise<string> {
  // ff-only on purpose: fail loudly instead of creating a surprise merge commit
  // when the branch has diverged. TODO: optional pull --rebase toggle in settings.
  return git(cwd, ['pull', '--ff-only'])
}

export async function fetch(cwd: string): Promise<string> {
  return git(cwd, ['fetch', '--all', '--prune'])
}

export async function stash(cwd: string, message?: string): Promise<string> {
  const args = ['stash', 'push', '--include-untracked']
  if (message) args.push('-m', message)
  return git(cwd, args)
}

export async function stashPop(cwd: string): Promise<string> {
  return git(cwd, ['stash', 'pop'])
}

export interface StashEntry {
  ref: string // e.g. stash@{0}
  branch: string
  subject: string
  relDate: string
}

export async function stashList(cwd: string): Promise<StashEntry[]> {
  const raw = await git(cwd, [
    'stash',
    'list',
    '--pretty=format:%gd\x1f%gs\x1f%cr'
  ])
  return raw
    .split('\n')
    .filter(Boolean)
    .map((l) => {
      const [ref, gs, relDate] = l.split('\x1f')
      // %gs looks like "WIP on main: 1a2b3c subject" or "On main: message"
      const m = gs.match(/^(?:WIP on|On)\s+([^:]+):\s*(.*)$/)
      return {
        ref,
        branch: m ? m[1] : '',
        subject: m ? m[2] : gs,
        relDate
      }
    })
}

export async function stashApply(cwd: string, ref: string): Promise<string> {
  return git(cwd, ['stash', 'apply', ref])
}

export async function stashPopRef(cwd: string, ref: string): Promise<string> {
  return git(cwd, ['stash', 'pop', ref])
}

export async function stashDrop(cwd: string, ref: string): Promise<string> {
  return git(cwd, ['stash', 'drop', ref])
}

export interface StagedFile {
  path: string
  status: string // M, A, D, R, C...
  add: number // -1 for binary
  del: number
}

/** Files currently staged, with per-file added/deleted line counts. */
export async function stagedFiles(cwd: string): Promise<StagedFile[]> {
  const [numstat, nameStatus] = await Promise.all([
    git(cwd, ['diff', '--cached', '--numstat']),
    git(cwd, ['diff', '--cached', '--name-status'])
  ])
  const statusOf = new Map<string, string>()
  for (const line of nameStatus.split('\n').filter(Boolean)) {
    const parts = line.split('\t')
    const letter = parts[0][0]
    const path = parts[parts.length - 1]
    statusOf.set(path, letter)
  }
  const files: StagedFile[] = []
  for (const line of numstat.split('\n').filter(Boolean)) {
    const parts = line.split('\t')
    const addRaw = parts[0]
    const delRaw = parts[1]
    const path = parts.slice(2).join('\t')
    files.push({
      path,
      status: statusOf.get(path) ?? 'M',
      add: addRaw === '-' ? -1 : parseInt(addRaw, 10) || 0,
      del: delRaw === '-' ? -1 : parseInt(delRaw, 10) || 0
    })
  }
  return files
}

//The configured commit author (user.name / user.email).
export async function author(cwd: string): Promise<{ name: string; email: string }> {
  const name = (await git(cwd, ['config', 'user.name']).catch(() => '')).trim()
  const email = (await git(cwd, ['config', 'user.email']).catch(() => '')).trim()
  return { name, email }
}

export interface Identity {
  name: string
  email: string
  local: { name: string; email: string }
  global: { name: string; email: string }
  hasLocal: boolean
}

/** Who commits will be attributed to here - effective identity plus local/global sources. */
export async function identity(cwd: string): Promise<Identity> {
  const read = (args: string[]) => git(cwd, ['config', ...args]).then((s) => s.trim()).catch(() => '')
  const [name, email, lName, lEmail, gName, gEmail] = await Promise.all([
    read(['user.name']),
    read(['user.email']),
    read(['--local', 'user.name']),
    read(['--local', 'user.email']),
    read(['--global', 'user.name']),
    read(['--global', 'user.email'])
  ])
  return {
    name,
    email,
    local: { name: lName, email: lEmail },
    global: { name: gName, email: gEmail },
    hasLocal: !!(lName || lEmail)
  }
}

/** Set user.name / user.email at the given scope ('local' = this repo, 'global' = all repos). */
export async function setIdentity(
  cwd: string,
  name: string,
  email: string,
  scope: 'local' | 'global'
): Promise<void> {
  const flag = scope === 'global' ? '--global' : '--local'
  if (name.trim()) await git(cwd, ['config', flag, 'user.name', name.trim()])
  if (email.trim()) await git(cwd, ['config', flag, 'user.email', email.trim()])
}

// git log -n N --stat text for reviewing recent commits.
export async function logStat(cwd: string, n = 1): Promise<string> {
  return git(cwd, ['log', `-n${n}`, '--stat', '--no-color'])
}

/** Undo the last commit, keeping its changes staged (soft reset). */
export async function undoCommit(cwd: string): Promise<void> {
  await git(cwd, ['reset', '--soft', 'HEAD~1'])
}

/** Every file in the working tree: tracked + untracked (excluding ignored). */
export async function listTree(cwd: string): Promise<string[]> {
  const [tracked, others] = await Promise.all([
    git(cwd, ['ls-files', '-z']),
    git(cwd, ['ls-files', '-z', '--others', '--exclude-standard'])
  ])
  const set = new Set<string>()
  for (const raw of [tracked, others]) {
    for (const p of raw.split('\0')) if (p) set.add(p)
  }
  return [...set].sort((a, b) => a.localeCompare(b))
}

/** Identify whether a path is a git repo; return its toplevel. */
export async function repoRoot(cwd: string): Promise<string | null> {
  try {
    const out = await git(cwd, ['rev-parse', '--show-toplevel'])
    return out.trim()
  } catch {
    return null
  }
}

// One folder can have several spellings: Windows 8.3 short names (RUNNER~1 vs
// runneradmin), symlinked temp dirs (macOS /var -> /private/var). Canonicalize
// before comparing; fall back to resolve() for paths that do not exist.
function canonPath(p: string): string {
  try {
    return realpathSync.native(p)
  } catch {
    return resolve(p)
  }
}

/** True if two paths point at the same folder (case-insensitive on Windows). */
export function samePath(a: string, b: string): boolean {
  const x = canonPath(a)
  const y = canonPath(b)
  return process.platform === 'win32' ? x.toLowerCase() === y.toLowerCase() : x === y
}

export interface OpenProbe {
  /** Toplevel of the repo containing the selected folder, or null if none. */
  root: string | null
  //The folder the user actually picked.
  path: string
  /** True when path lives inside root but is not itself the repo root. */
  nested: boolean
}

/** Classify a folder the user chose to open: its own repo, nested, or not a repo. */
export async function probeOpen(path: string): Promise<OpenProbe> {
  const root = await repoRoot(path)
  if (!root) return { root: null, path, nested: false }
  return { root, path, nested: !samePath(root, path) }
}

/** The git identity from global config (used to seed a new repo's author/license). */
export async function globalIdentity(): Promise<{ name: string; email: string }> {
  const read = (k: string) =>
    git(process.cwd(), ['config', '--global', k]).then((s) => s.trim()).catch(() => '')
  const [name, email] = await Promise.all([read('user.name'), read('user.email')])
  return { name, email }
}

export interface NewRepoOptions {
  /** Folder that will contain the new repo (joined with name). */
  parentDir: string
  //Repository folder name.
  name: string
  //Default branch name; defaults to "main".
  branch?: string
  readme?: boolean
  gitignore?: string | null // template id from Templates.catalog()
  license?: string | null // template id
  initialCommit?: boolean
  /** Author for the license + initial commit; falls back to global identity. */
  author?: { name: string; email: string }

  // Extras used by saved "setups" (see Store.RepoSetup).
  /** Arbitrary starter files to drop in, paths relative to the repo root. */
  files?: { path: string; content: string }[]
  /** Extra lines appended to .gitignore on top of the template. */
  extraGitignore?: string
  /** Patterns for this clone's .git/info/exclude (never committed). */
  localExclude?: string[]
  //Patterns for the global excludesFile.
  globalExclude?: string[]
  /** Persist author as the repo-local git identity (so future commits use it). */
  setLocalIdentity?: boolean
  //Co-author trailers to add to the initial commit.
  coauthors?: { name: string; email: string }[]
}

/**
 * Create (and initialise) a new repository, scaffolding whatever the options ask
 * for (README, .gitignore, LICENSE, arbitrary starter files), seeding ignore
 * rules, optionally pinning a repo-local identity, and making a first commit so
 * the repo opens clean but not empty. If the folder is already a repo it is
 * opened as-is.
 */
export async function createRepo(opts: NewRepoOptions): Promise<string> {
  const name = opts.name.trim()
  if (!name) throw new Error('Enter a name for the repository.')
  const dir = join(opts.parentDir, name)
  mkdirSync(dir, { recursive: true })

  // Already a repo at exactly this folder? Just open it.
  const existing = await repoRoot(dir)
  if (existing && samePath(existing, dir)) return existing

  const branch = (opts.branch || 'main').trim() || 'main'
  try {
    await git(dir, ['init', '-b', branch])
  } catch {
    // Older git without -b: init then point the unborn HEAD at the branch.
    await git(dir, ['init'])
    await git(dir, ['symbolic-ref', 'HEAD', `refs/heads/${branch}`]).catch(() => {})
  }

  const author = opts.author?.name || opts.author?.email ? opts.author! : await globalIdentity()
  const authorName = (author.name || '').trim()

  // Pin the identity to the repo so every commit here is attributed correctly,
  // not just the initial one.
  if (opts.setLocalIdentity && author.name && author.email) {
    await git(dir, ['config', '--local', 'user.name', author.name])
    await git(dir, ['config', '--local', 'user.email', author.email])
  }

  const created: string[] = []
  if (opts.readme) {
    writeFileSync(join(dir, 'README.md'), `# ${name}\n`)
    created.push('README.md')
  }

  const giBase = (Templates.gitignoreBody(opts.gitignore) || '').trimEnd()
  const giExtra = (opts.extraGitignore || '').trim()
  const gi = [giBase, giExtra].filter(Boolean).join('\n\n')
  if (gi.trim()) {
    writeFileSync(join(dir, '.gitignore'), gi.endsWith('\n') ? gi : gi + '\n')
    created.push('.gitignore')
  }

  const lic = Templates.licenseBody(opts.license, authorName)
  if (lic) {
    writeFileSync(join(dir, 'LICENSE'), lic)
    created.push('LICENSE')
  }

  for (const f of opts.files ?? []) {
    const rel = f.path.trim()
    if (!rel) continue
    const abs = join(dir, rel)
    mkdirSync(dirname(abs), { recursive: true })
    writeFileSync(abs, f.content)
    created.push(rel)
  }

  // Local (.git/info/exclude) and global ignore rules.
  if (opts.localExclude?.length || opts.globalExclude?.length) {
    await seedExcludes(dir, { private: opts.localExclude, global: opts.globalExclude }).catch(() => {})
  }

  //Only commit when there's something to commit AND an identity to attribute it to.
  if (opts.initialCommit && created.length && author.name && author.email) {
    await git(dir, ['add', '-A'])
    let message = 'Initial commit'
    if (opts.coauthors?.length) {
      message += '\n\n' + opts.coauthors.map((c) => `Co-Authored-By: ${c.name} <${c.email}>`).join('\n')
    }
    await git(
      dir,
      ['-c', `user.name=${author.name}`, '-c', `user.email=${author.email}`, 'commit', '-F', '-'],
      { input: message }
    )
  }

  const root = await repoRoot(dir)
  if (!root) throw new Error('git init did not produce a repository.')
  return root
}

/** Clone url into parentDir (optionally renaming the folder) and return its toplevel. */
export async function cloneRepo(
  url: string,
  parentDir: string,
  name?: string,
  auth?: { provider: string; token: string }
): Promise<string> {
  const u = url.trim()
  if (!u) throw new Error('Enter a repository URL to clone.')
  mkdirSync(parentDir, { recursive: true })
  const folder = (name && name.trim()) || deriveCloneName(u)
  // With an account, clone through an authenticated URL so private repos work,
  // then reset origin to the clean URL so the token is never persisted in config.
  const authed = auth?.token ? authCloneUrl(u, auth.provider, auth.token) : null
  await git(parentDir, ['clone', authed || u, folder])
  const dir = join(parentDir, folder)
  if (authed) await git(dir, ['remote', 'set-url', 'origin', u]).catch(() => {})
  const root = await repoRoot(dir)
  if (!root) throw new Error('Clone finished but no repository was found.')
  return root
}

// Embed credentials into an https URL for a single clone invocation. Each
// provider expects a different username alongside the token as the password.
function authCloneUrl(url: string, provider: string, token: string): string {
  if (!/^https:\/\//i.test(url)) return url // ssh or other: leave untouched
  const user =
    provider === 'github'
      ? 'x-access-token'
      : provider === 'gitlab'
        ? 'oauth2'
        : provider === 'bitbucket'
          ? 'x-token-auth'
          : 'token'
  return url.replace(/^https:\/\//i, `https://${user}:${encodeURIComponent(token)}@`)
}

//Best-effort folder name git would pick for a clone URL.
function deriveCloneName(url: string): string {
  const tail = url
    .replace(/\.git$/i, '')
    .replace(/[/\\]+$/, '')
    .split(/[/\\:]/)
    .pop()
  return tail && tail.trim() ? tail.trim() : 'repository'
}

/** Existing co-author trailers harvested from recent history (for suggestions). */
export async function knownCoauthors(cwd: string): Promise<{ name: string; email: string }[]> {
  const raw = await git(cwd, ['log', '-n200', '--pretty=format:%(trailers:key=Co-authored-by,valueonly)'])
  const seen = new Map<string, { name: string; email: string }>()
  for (const line of raw.split('\n')) {
    const m = line.match(/^(.+?)\s*<(.+?)>\s*$/)
    if (m) {
      const key = m[2].toLowerCase()
      if (!seen.has(key)) seen.set(key, { name: m[1].trim(), email: m[2].trim() })
    }
  }
  return [...seen.values()]
}

/** File metadata: size on disk, mode, last commit that touched it. */
export async function fileMeta(cwd: string, path: string): Promise<Record<string, string>> {
  const meta: Record<string, string> = {}
  try {
    const lsTree = await git(cwd, ['ls-files', '-s', '--', path])
    if (lsTree.trim()) {
      const [mode, , , ] = lsTree.trim().split(/\s+/)
      meta.mode = mode
    }
  } catch {}
  try {
    const last = await log(cwd, path, 1)
    if (last[0]) {
      meta.lastCommit = last[0].shortHash
      meta.lastSubject = last[0].subject
      meta.lastAuthor = last[0].author
      meta.lastDate = last[0].relDate
    }
  } catch {}
  return meta
}
