import { app } from 'electron'
import { readFileSync, writeFileSync, existsSync, mkdirSync, copyFileSync } from 'node:fs'
import { join, dirname } from 'node:path'

export interface Coauthor {
  id: string
  name: string
  email: string
  enabled: boolean
}

export interface IdentityProfile {
  id: string
  label: string
  name: string
  email: string
}

export interface Settings {
  showLegend: boolean
  treeView: boolean
  showOpStatus: boolean
  showIgnored: boolean
  mcpEnabled: boolean
  mcpPort: number
  mcpDangerous: boolean
  anthropicApiKey: string
  // When true, the default ignore profile is applied to repos created or cloned in Hydrodam.
  autoSeedExcludes: boolean
  // Personal access tokens for the GitHub / GitLab integration (optional).
  githubToken: string
  gitlabToken: string
  //Auto-fetch interval in minutes (0 = off) and desktop notifications.
  autoFetchMinutes: number
  notifyOnUpdates: boolean
  // Accent theme preset id (see renderer theme map).
  accent: string
  // Show text labels next to the left-rail icons.
  navLabels: boolean
  // Model used for all AI assist features.
  aiModel: string
  // Freeform user instructions appended to every AI system prompt.
  aiInstructions: string
  // UI scale in percent (100 = default).
  uiZoom: number
  // Warn before pushing when outgoing commits contain key-shaped strings.
  secretScanOnPush: boolean
  // Multi-line live-blame labels draw as a bracket spanning the edited lines
  // with the label at its middle; off = a plain label on the first line.
  liveBrackets: boolean
}

// Reusable set of ignore patterns Hydrodam can seed into repositories. "private" goes
// into each repo's .git/info/exclude; "global" goes into the global excludesFile.
export interface ExcludeProfile {
  private: string[]
  global: string[]
}

export interface RepoMeta {
  lastFetch?: number
  lastPull?: number
  lastPush?: number
}

export type Provider = 'github' | 'gitlab' | 'bitbucket' | 'azure'

// A connected hosting account. The token never leaves the main process; the
// renderer only ever receives the redacted AccountView below.
export interface HostAccount {
  id: string
  provider: Provider
  host: string // github.com / gitlab.com / an Enterprise or self-hosted host
  label: string
  username: string
  token: string
}

export interface AccountView {
  id: string
  provider: Provider
  host: string
  label: string
  username: string
  active: boolean
}

export type TrackerType = 'jira' | 'trello'

//An external issue tracker connection. Secrets stay in the main process.
export interface Tracker {
  id: string
  type: TrackerType
  label: string
  site?: string // jira base url
  email?: string // jira email
  token?: string // jira api token / trello token
  key?: string // trello api key
  boardId?: string // trello board short ID (extracted from board URL)
}

export interface TrackerView {
  id: string
  type: TrackerType
  label: string
  site?: string
  boardId?: string
}

// A commit Hydrodam itself created (or amended), with the co-authors it applied.
// Used to tell trusted co-author trailers from ones injected outside the app.
export interface VerifiedCommit {
  root: string
  hash: string
  coauthors: { name: string; email: string }[]
  ts: number
}

interface Store {
  coauthors: Coauthor[]
  recentRepos: string[]
  lastRepo: string | null
  settings: Settings
  repoMeta: Record<string, RepoMeta>
  profiles: IdentityProfile[]
  activeProfileId: string | null
  defaultExcludes: ExcludeProfile
  accounts: HostAccount[]
  activeAccounts: Partial<Record<Provider, string | null>>
  trackers: Tracker[]
  workspaces: Workspace[]
  setups: RepoSetup[]
  verifiedCommits: VerifiedCommit[]
}

export interface Workspace {
  id: string
  name: string
  repos: string[]
}

export interface SetupFile {
  path: string
  content: string
}

// A reusable "new folder" recipe: the files, ignore rules, identity and options
// to apply when starting a repo, so you never hand-assemble the same setup twice.
export interface RepoSetup {
  id: string
  name: string
  branch: string
  readme: boolean
  gitignore: string | null // template id
  extraGitignore: string // extra lines appended to .gitignore
  license: string | null // template id
  files: SetupFile[] // arbitrary starter files
  localExclude: string[] // .git/info/exclude (per-clone, never committed)
  globalExclude: string[] // global excludesFile
  identityProfileId: string | null // identity profile to pin on the repo
  coauthors: boolean // add co-author trailers to the initial commit
  initialCommit: boolean
}

const defaultSettings: Settings = {
  showLegend: true,
  treeView: false,
  showOpStatus: true,
  showIgnored: true,
  mcpEnabled: false,
  mcpPort: 4319,
  mcpDangerous: false,
  anthropicApiKey: '',
  autoSeedExcludes: true,
  githubToken: '',
  gitlabToken: '',
  autoFetchMinutes: 0,
  notifyOnUpdates: false,
  accent: 'blue',
  navLabels: true,
  aiModel: 'claude-opus-4-8',
  aiInstructions: '',
  uiZoom: 100,
  secretScanOnPush: false,
  liveBrackets: true
}

// Default private excludes for a fresh repo: local tool config that should stay
// out of git without appearing in a committed .gitignore.
const defaultExcludeProfile: ExcludeProfile = {
  private: ['.claude/'],
  global: []
}

const defaults: Store = {
  coauthors: [],
  recentRepos: [],
  lastRepo: null,
  settings: { ...defaultSettings },
  repoMeta: {},
  profiles: [],
  activeProfileId: null,
  defaultExcludes: structuredClone(defaultExcludeProfile),
  accounts: [],
  activeAccounts: {},
  trackers: [],
  workspaces: [],
  setups: [],
  verifiedCommits: []
}

function file(): string {
  const p = join(app.getPath('userData'), 'hydrodam-store.json')
  if (!existsSync(p)) migrateLegacyStore(p)
  return p
}

// Settings written before the rename lived in the "coda" app dir under the old
// file name. Copy (not move) the first one found, so a rollback still works.
function migrateLegacyStore(dest: string): void {
  const candidates = [
    join(app.getPath('userData'), 'coda-store.json'),
    join(app.getPath('appData'), 'coda', 'coda-store.json'),
    join(app.getPath('appData'), 'Coda', 'coda-store.json')
  ]
  for (const c of candidates) {
    if (!existsSync(c)) continue
    try {
      copyFileSync(c, dest)
    } catch {
      // Unreadable legacy store: start fresh rather than crash at boot.
    }
    return
  }
}

export function load(): Store {
  try {
    const p = file()
    if (!existsSync(p)) return structuredClone(defaults)
    const data = JSON.parse(readFileSync(p, 'utf8'))
    return {
      ...defaults,
      ...data,
      settings: { ...defaultSettings, ...(data.settings ?? {}) },
      repoMeta: data.repoMeta ?? {},
      profiles: data.profiles ?? [],
      activeProfileId: data.activeProfileId ?? null,
      defaultExcludes: {
        private: data.defaultExcludes?.private ?? defaultExcludeProfile.private,
        global: data.defaultExcludes?.global ?? defaultExcludeProfile.global
      },
      accounts: data.accounts ?? [],
      activeAccounts: data.activeAccounts ?? {},
      trackers: data.trackers ?? [],
      workspaces: data.workspaces ?? [],
      setups: data.setups ?? [],
      verifiedCommits: data.verifiedCommits ?? []
    }
  } catch {
    return structuredClone(defaults)
  }
}

export function save(store: Store): void {
  const p = file()
  if (!existsSync(dirname(p))) mkdirSync(dirname(p), { recursive: true })
  writeFileSync(p, JSON.stringify(store, null, 2), 'utf8')
}

export function rememberRepo(root: string): void {
  const s = load()
  s.recentRepos = [root, ...s.recentRepos.filter((r) => r !== root)].slice(0, 12)
  s.lastRepo = root
  save(s)
}

/** Remember that Hydrodam made this commit with these co-authors (newest first, capped). */
export function recordVerifiedCommit(
  root: string,
  hash: string,
  coauthors: { name: string; email: string }[]
): void {
  const s = load()
  s.verifiedCommits = [
    { root, hash, coauthors, ts: Date.now() },
    ...s.verifiedCommits.filter((v) => !(v.root === root && v.hash === hash))
  ].slice(0, 1000)
  save(s)
}

/** The co-authors Hydrodam recorded for a commit, or null if it never made it. */
export function verifiedCommit(root: string, hash: string): VerifiedCommit | null {
  return load().verifiedCommits.find((v) => v.root === root && v.hash === hash) ?? null
}

/** Drop a repo that no longer resolves from the recent list. */
export function forgetRepo(root: string): string[] {
  const s = load()
  s.recentRepos = s.recentRepos.filter((r) => r !== root)
  if (s.lastRepo === root) s.lastRepo = null
  save(s)
  return s.recentRepos
}

export function getSettings(): Settings {
  return load().settings
}

export function setSettings(patch: Partial<Settings>): Settings {
  const s = load()
  s.settings = { ...s.settings, ...patch }
  save(s)
  return s.settings
}

export function getDefaultExcludes(): ExcludeProfile {
  return load().defaultExcludes
}

export function setDefaultExcludes(profile: ExcludeProfile): ExcludeProfile {
  const s = load()
  const clean = (xs: string[]) => [...new Set((xs ?? []).map((x) => x.trim()).filter(Boolean))]
  s.defaultExcludes = { private: clean(profile.private), global: clean(profile.global) }
  save(s)
  return s.defaultExcludes
}

export function recordOp(root: string, op: 'lastFetch' | 'lastPull' | 'lastPush'): RepoMeta {
  const s = load()
  const m = s.repoMeta[root] ?? {}
  m[op] = Date.now()
  s.repoMeta[root] = m
  save(s)
  return m
}

export function getRepoMeta(root: string): RepoMeta {
  return load().repoMeta[root] ?? {}
}

function randomId(): string {
  return Math.random().toString(36).slice(2, 10)
}

// Guarantee exactly one valid active profile whenever any profiles exist.
function ensureActive(s: Store): void {
  if (s.profiles.length === 0) {
    s.activeProfileId = null
  } else if (!s.profiles.some((p) => p.id === s.activeProfileId)) {
    s.activeProfileId = s.profiles[0].id
  }
}

export function listProfiles(): { profiles: IdentityProfile[]; activeId: string | null } {
  const s = load()
  ensureActive(s)
  save(s)
  return { profiles: s.profiles, activeId: s.activeProfileId }
}

export function addProfile(label: string, name: string, email: string): IdentityProfile[] {
  const s = load()
  const existing = s.profiles.find((p) => p.email.toLowerCase() === email.toLowerCase())
  if (existing) {
    existing.label = label
    existing.name = name
  } else {
    const p = { id: randomId(), label, name, email }
    s.profiles.push(p)
    if (!s.activeProfileId) s.activeProfileId = p.id // first one becomes active
  }
  ensureActive(s)
  save(s)
  return s.profiles
}

export function updateProfile(id: string, label: string, name: string, email: string): IdentityProfile[] {
  const s = load()
  const p = s.profiles.find((p) => p.id === id)
  if (p) {
    p.label = label
    p.name = name
    p.email = email
  }
  save(s)
  return s.profiles
}

export function removeProfile(id: string): { profiles: IdentityProfile[]; activeId: string | null } {
  const s = load()
  s.profiles = s.profiles.filter((p) => p.id !== id)
  ensureActive(s)
  save(s)
  return { profiles: s.profiles, activeId: s.activeProfileId }
}

export function setActiveProfile(id: string): IdentityProfile | null {
  const s = load()
  if (s.profiles.some((p) => p.id === id)) s.activeProfileId = id
  ensureActive(s)
  save(s)
  return s.profiles.find((p) => p.id === s.activeProfileId) ?? null
}

// Redacted view (no tokens) for the renderer.
export function accountsView(): AccountView[] {
  const s = load()
  return s.accounts.map((a) => ({
    id: a.id,
    provider: a.provider,
    host: a.host,
    label: a.label,
    username: a.username,
    active: s.activeAccounts[a.provider] === a.id
  }))
}

export function addAccount(a: Omit<HostAccount, 'id'>): AccountView[] {
  const s = load()
  //Replace an existing account on the same host+username, else add a new one.
  const existing = s.accounts.find(
    (x) => x.provider === a.provider && x.host === a.host && x.username.toLowerCase() === a.username.toLowerCase()
  )
  let id: string
  if (existing) {
    existing.label = a.label
    existing.token = a.token
    id = existing.id
  } else {
    id = randomId()
    s.accounts.push({ id, ...a })
  }
  // First account for a provider becomes active.
  if (!s.activeAccounts[a.provider]) s.activeAccounts[a.provider] = id
  save(s)
  return accountsView()
}

export function removeAccount(id: string): AccountView[] {
  const s = load()
  const acc = s.accounts.find((a) => a.id === id)
  s.accounts = s.accounts.filter((a) => a.id !== id)
  if (acc && s.activeAccounts[acc.provider] === id) {
    const next = s.accounts.find((a) => a.provider === acc.provider)
    s.activeAccounts[acc.provider] = next ? next.id : null
  }
  save(s)
  return accountsView()
}

export function setActiveAccount(provider: Provider, id: string): AccountView[] {
  const s = load()
  if (s.accounts.some((a) => a.id === id && a.provider === provider)) s.activeAccounts[provider] = id
  save(s)
  return accountsView()
}

/** Full account (including token) by id - main-process only, never sent to the renderer. */
export function getAccount(id: string): HostAccount | null {
  return load().accounts.find((a) => a.id === id) ?? null
}

/** Token for the active account of a provider, preferring one whose host matches. */
export function activeToken(provider: Provider, host?: string): string {
  const s = load()
  if (host) {
    const onHost = s.accounts.find((a) => a.provider === provider && a.host === host)
    if (onHost) return onHost.token
  }
  const activeId = s.activeAccounts[provider]
  const active = s.accounts.find((a) => a.id === activeId)
  if (active) return active.token
  //Legacy fallback: tokens that used to live directly in settings.
  return provider === 'github' ? s.settings.githubToken || '' : s.settings.gitlabToken || ''
}

/** Map of every connected account's host -> provider (for self-hosted detection). */
export function hostProviders(): Record<Provider | string, Provider> {
  const s = load()
  const map: Record<string, Provider> = {}
  for (const a of s.accounts) map[a.host] = a.provider
  return map
}

export function trackersView(): TrackerView[] {
  return load().trackers.map((t) => ({ id: t.id, type: t.type, label: t.label, site: t.site, boardId: t.boardId }))
}

export function addTracker(t: Omit<Tracker, 'id'>): TrackerView[] {
  const s = load()
  s.trackers.push({ id: randomId(), ...t })
  save(s)
  return trackersView()
}

export function removeTracker(id: string): TrackerView[] {
  const s = load()
  s.trackers = s.trackers.filter((t) => t.id !== id)
  save(s)
  return trackersView()
}

export function getTracker(id: string): Tracker | null {
  return load().trackers.find((t) => t.id === id) ?? null
}

export function listWorkspaces(): Workspace[] {
  return load().workspaces
}

export function saveWorkspace(name: string, repos: string[]): Workspace[] {
  const s = load()
  const existing = s.workspaces.find((w) => w.name.toLowerCase() === name.toLowerCase())
  if (existing) existing.repos = repos
  else s.workspaces.push({ id: randomId(), name, repos })
  save(s)
  return s.workspaces
}

export function removeWorkspace(id: string): Workspace[] {
  const s = load()
  s.workspaces = s.workspaces.filter((w) => w.id !== id)
  save(s)
  return s.workspaces
}

export function listSetups(): RepoSetup[] {
  return load().setups
}

//Upsert: a setup with no id (or an unknown one) is added, otherwise replaced.
export function saveSetup(setup: RepoSetup): RepoSetup[] {
  const s = load()
  if (!setup.id) setup.id = randomId()
  const i = s.setups.findIndex((x) => x.id === setup.id)
  if (i >= 0) s.setups[i] = setup
  else s.setups.push(setup)
  save(s)
  return s.setups
}

export function removeSetup(id: string): RepoSetup[] {
  const s = load()
  s.setups = s.setups.filter((x) => x.id !== id)
  save(s)
  return s.setups
}

//A portable bundle of preferences (NOT tokens/account secrets) for "sync".
export function exportableSettings(): any {
  const s = load()
  return {
    version: 1,
    settings: s.settings,
    coauthors: s.coauthors,
    profiles: s.profiles,
    activeProfileId: s.activeProfileId,
    defaultExcludes: s.defaultExcludes,
    workspaces: s.workspaces
  }
}

export function importSettings(data: any): void {
  if (!data || typeof data !== 'object') throw new Error('Not a valid Hydrodam settings file.')
  const s = load()
  if (data.settings) s.settings = { ...s.settings, ...data.settings }
  if (Array.isArray(data.coauthors)) s.coauthors = data.coauthors
  if (Array.isArray(data.profiles)) s.profiles = data.profiles
  if ('activeProfileId' in data) s.activeProfileId = data.activeProfileId
  if (data.defaultExcludes) s.defaultExcludes = data.defaultExcludes
  if (Array.isArray(data.workspaces)) s.workspaces = data.workspaces
  ensureActive(s)
  save(s)
}
