//Typed access to the bridge exposed by the preload script.

export interface FileEntry {
  path: string
  index: string
  work: string
  orig?: string
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

export interface NumstatEntry {
  path: string
  add: number // -1 for binary
  del: number
}

export interface WorkingNumstat {
  staged: NumstatEntry[]
  unstaged: NumstatEntry[]
}

export interface Commit {
  hash: string
  shortHash: string
  subject: string
  author: string
  email: string
  date: string
  relDate: string
}

export interface Coauthor {
  id: string
  name: string
  email: string
  enabled: boolean
}

export interface Branch {
  name: string
  current: boolean
  upstream: string | null
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
  refs: string[]
  coauthors: { name: string; email: string }[]
}

export interface CommitMeta {
  message: string
  files: { path: string; add: number; del: number }[]
  isHead: boolean
}

export interface Person {
  name: string
  email: string
}

export interface CoauthorViolation {
  hash: string
  shortHash: string
  subject: string
  authoredAt: string // when the commit was originally authored (Commit pressed)
  committedAt: string // committer date - when the trailer was slipped in
  coauthors: Person[] // injected: added outside Hydrodam
  dropped: Person[] // an authored co-author that was stripped out
}

export interface LogQuery {
  all?: boolean
  limit?: number
  grep?: string
  author?: string
  path?: string
}

export interface BranchFull {
  name: string
  current: boolean
  remote: boolean
  upstream: string | null
  ahead: number
  behind: number
  gone: boolean
  hash: string
  subject: string
  relDate: string
}

export interface Remote {
  name: string
  url: string
}

export interface BlameLine {
  hash: string
  shortHash: string
  author: string
  date: string
  lineNo: number
  content: string
}

export type Provider = 'github' | 'gitlab' | 'bitbucket' | 'azure'

export interface RemoteRepo {
  provider: Provider
  host: string
  owner: string
  repo: string
  slug: string
  webUrl: string
  azure?: { org: string; project: string; repo: string }
}

export interface PullRequest {
  number: number
  title: string
  author: string
  head: string
  base: string
  url: string
  draft: boolean
  state: string
  updatedAt: string
}

export interface AccountView {
  id: string
  provider: Provider
  host: string
  label: string
  username: string
  active: boolean
}

export interface OwnedRepo {
  name: string
  fullName: string
  cloneUrl: string
  private: boolean
  description: string
  updatedAt: string
}

export interface RemoteInfo {
  url: string | null
  repo: RemoteRepo | null
  hasToken: boolean
  account: AccountView | null
}

export interface DeviceStart {
  deviceCode: string
  userCode: string
  verificationUri: string
  interval: number
}

export interface DevicePoll {
  token?: string
  pending?: boolean
  error?: string
}

export interface SigningConfig {
  enabled: boolean
  format: string
  key: string
}

export interface SshKey {
  name: string
  type: string
  pub: string
}

export interface SparseState {
  enabled: boolean
  patterns: string[]
}

export interface Insights {
  total: number
  authors: { name: string; count: number }[]
  days: { date: string; count: number }[]
}

export interface Workspace {
  id: string
  name: string
  repos: string[]
}

export type TrackerType = 'jira' | 'trello'

export interface TrackerView {
  id: string
  type: TrackerType
  label: string
  site?: string
  boardId?: string
}

export interface TrackerItem {
  id: string
  title: string
  url: string
  status: string
}

export interface TrelloList {
  id: string
  name: string
  cards: TrackerItem[]
}

export type OpKind = 'cherry-pick' | 'revert' | 'merge' | 'rebase' | null

export interface OpState {
  kind: OpKind
  conflicts: number
}

export interface ReflogEntry {
  selector: string
  shortHash: string
  action: string
  subject: string
  relDate: string
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

export type RebaseAction = 'pick' | 'reword' | 'squash' | 'fixup' | 'drop'

export interface RebaseItem {
  sha: string
  action: RebaseAction
  message?: string
}

export interface RebaseCommit {
  hash: string
  shortHash: string
  subject: string
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

export interface Submodule {
  path: string
  head: string
  describe: string
  status: string
}

export interface Issue {
  number: number
  title: string
  author: string
  url: string
  state: string
  labels: string[]
  updatedAt: string
  milestone?: string
  assignees?: string[]
  subTotal?: number
  subCompleted?: number
}

export interface WorkflowRun {
  id: number
  name: string
  branch: string
  status: string
  conclusion: string
  url: string
  updatedAt: string
}

export interface Milestone {
  title: string
  description: string
  dueOn: string | null
  openIssues: number
  closedIssues: number
  url: string
}

export interface SecurityFeature {
  state: 'ok' | 'forbidden' | 'disabled'
  count: number
}

export interface SecurityOverview {
  supported: boolean
  dependabot: SecurityFeature
  codeScanning: SecurityFeature
  secretScanning: SecurityFeature
  pushProtection: 'enabled' | 'disabled' | 'unknown'
}

export interface SecretFinding {
  kind: string
  file: string
  snippet: string
}

export interface NewPull {
  title: string
  head: string
  base: string
  body?: string
}

export interface ComposedCommit {
  message: string
  files: string[]
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
  autoSeedExcludes: boolean
  githubToken: string
  gitlabToken: string
  autoFetchMinutes: number
  notifyOnUpdates: boolean
  accent: string
  navLabels: boolean
  aiModel: string
  aiInstructions: string
  uiZoom: number
  secretScanOnPush: boolean
  liveBrackets: boolean
}

export interface ExcludeProfile {
  private: string[]
  global: string[]
}

export interface ConflictSegment {
  type: 'text' | 'conflict'
  lines?: string[]
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
  xy?: string
  kind?: 'content' | 'delete' | 'both-deleted'
}

export interface Identity {
  name: string
  email: string
  local: { name: string; email: string }
  global: { name: string; email: string }
  hasLocal: boolean
}

export interface IdentityProfile {
  id: string
  label: string
  name: string
  email: string
}

export interface ProfilesState {
  profiles: IdentityProfile[]
  activeId: string | null
}

export interface StagedFile {
  path: string
  status: string
  add: number
  del: number
}

export interface CommitPreview {
  files: StagedFile[]
  author: { name: string; email: string }
  coauthors: { name: string; email: string }[]
}

export interface McpInfo {
  running: boolean
  port: number
  url: string | null
  dangerous: boolean
  error: string | null
}

export interface RepoMeta {
  lastFetch?: number
  lastPull?: number
  lastPush?: number
}

export interface StashEntry {
  ref: string
  branch: string
  subject: string
  relDate: string
}

export interface FilePreview {
  path: string
  kind: 'text' | 'image' | 'binary' | 'too-large' | 'missing'
  text?: string
  dataUrl?: string
  size: number
  ext: string
}

export interface TemplateMeta {
  id: string
  label: string
}

export interface PresetMeta {
  id: string
  label: string
  readme: boolean
  gitignore: string | null
  license: string | null
}

export interface TemplateCatalog {
  gitignore: TemplateMeta[]
  license: TemplateMeta[]
  presets: PresetMeta[]
}

export interface OpenProbe {
  root: string | null
  path: string
  nested: boolean
}

export interface MessageBoxOptions {
  type?: 'none' | 'info' | 'error' | 'question' | 'warning'
  title?: string
  message: string
  detail?: string
  buttons?: string[]
  defaultId?: number
  cancelId?: number
  noLink?: boolean
}

export type ExcludeScope = 'shared' | 'private' | 'global'

export interface ExcludeSets {
  shared: string[]
  private: string[]
  global: string[]
  globalPath: string
}

export interface IgnoredFileSets {
  gitignore: string[]
  local: string[]
  global: string[]
}

export interface IgnoreCheck {
  ignored: boolean
  source?: string
  line?: string
  pattern?: string
}

export interface DiscardEntry {
  id: string
  path: string
  when: number
  size: number
}

export interface NewRepoOptions {
  parentDir: string
  name: string
  branch?: string
  readme?: boolean
  gitignore?: string | null
  license?: string | null
  initialCommit?: boolean
  author?: { name: string; email: string }
  files?: { path: string; content: string }[]
  extraGitignore?: string
  localExclude?: string[]
  globalExclude?: string[]
  setLocalIdentity?: boolean
  coauthors?: { name: string; email: string }[]
}

export interface SetupFile {
  path: string
  content: string
}

export interface RepoSetup {
  id: string
  name: string
  branch: string
  readme: boolean
  gitignore: string | null
  extraGitignore: string
  license: string | null
  files: SetupFile[]
  localExclude: string[]
  globalExclude: string[]
  identityProfileId: string | null
  coauthors: boolean
  initialCommit: boolean
}

export interface HydrodamApi {
  openRepo(): Promise<OpenProbe | null>
  browseDir(title?: string): Promise<string | null>
  messageBox(opts: MessageBoxOptions): Promise<number>
  repoTemplates(): Promise<TemplateCatalog>
  createRepo(opts: NewRepoOptions): Promise<string>
  createFromSetup(setupId: string, parentDir: string, name: string): Promise<string>
  cloneRepo(url: string, parentDir: string, name?: string, accountId?: string): Promise<string>
  globalIdentity(): Promise<{ name: string; email: string }>
  validateRepo(p: string): Promise<string | null>
  recentRepos(): Promise<{ recent: string[]; last: string | null }>
  forgetRecentRepo(root: string): Promise<string[]>
  status(cwd: string): Promise<RepoStatus>
  hidden(cwd: string): Promise<string[]>
  branches(cwd: string): Promise<Branch[]>
  tree(cwd: string): Promise<string[]>
  numstat(cwd: string): Promise<WorkingNumstat>
  identityGet(cwd: string): Promise<Identity>
  identitySet(cwd: string, name: string, email: string, scope: 'local' | 'global'): Promise<void>
  profilesList(): Promise<ProfilesState>
  profilesAdd(label: string, name: string, email: string): Promise<IdentityProfile[]>
  profilesUpdate(id: string, label: string, name: string, email: string): Promise<IdentityProfile[]>
  profilesRemove(id: string): Promise<ProfilesState>
  profilesUse(cwd: string, id: string, scope: 'local' | 'global'): Promise<ProfilesState>
  readFile(cwd: string, path: string): Promise<FilePreview>
  writeFile(cwd: string, path: string, content: string): Promise<boolean>
  openFile(cwd: string, path: string): Promise<boolean>
  revealFile(cwd: string, path: string): Promise<boolean>
  fileDiff(cwd: string, path: string, staged: boolean, untracked: boolean): Promise<string>
  fileMeta(cwd: string, path: string): Promise<Record<string, string>>
  fileLog(cwd: string, path: string): Promise<Commit[]>
  fileAtCommit(cwd: string, hash: string, path: string): Promise<string>
  commitFileDiff(cwd: string, hash: string, path: string): Promise<string>
  commitShow(cwd: string, hash: string): Promise<string>
  commitMeta(cwd: string, hash: string): Promise<CommitMeta>
  reflog(cwd: string): Promise<ReflogEntry[]>
  imageAt(cwd: string, ref: string, path: string): Promise<string | null>
  lfsInfo(cwd: string): Promise<LfsInfo>
  lfsTrack(cwd: string, pattern: string): Promise<string>
  lfsPull(cwd: string): Promise<string>
  logGraph(cwd: string, q: LogQuery): Promise<GraphCommit[]>
  blame(cwd: string, path: string, rev?: string): Promise<BlameLine[]>
  cherryPick(cwd: string, hash: string): Promise<string>
  revertCommit(cwd: string, hash: string): Promise<string>
  resetTo(cwd: string, hash: string, mode: 'soft' | 'mixed' | 'hard'): Promise<void>
  checkoutCommit(cwd: string, hash: string): Promise<void>
  branchAt(cwd: string, name: string, ref: string): Promise<void>
  tagAt(cwd: string, name: string, ref: string): Promise<void>
  branchesFull(cwd: string): Promise<BranchFull[]>
  deleteBranch(cwd: string, name: string, force: boolean): Promise<void>
  renameBranch(cwd: string, oldName: string, newName: string): Promise<void>
  moveBranch(cwd: string, name: string, target: string): Promise<void>
  mergeBranch(cwd: string, name: string): Promise<string>
  setUpstream(cwd: string, branch: string, upstream: string): Promise<void>
  deleteRemoteBranch(cwd: string, remote: string, branch: string): Promise<string>
  remotesList(cwd: string): Promise<Remote[]>
  remotePulls(cwd: string): Promise<{ repo: RemoteRepo | null; pulls: PullRequest[] }>
  remoteCreatePull(cwd: string, pull: NewPull): Promise<PullRequest>
  remoteInfo(cwd: string): Promise<RemoteInfo>
  openExternal(url: string): Promise<boolean>
  accountsList(): Promise<AccountView[]>
  accountsAdd(provider: string, host: string, label: string, token: string): Promise<AccountView[]>
  accountsRemove(id: string): Promise<AccountView[]>
  accountsSetActive(provider: string, id: string): Promise<AccountView[]>
  accountsValidate(provider: string, host: string, token: string): Promise<{ username: string }>
  accountRepos(accountId: string): Promise<OwnedRepo[]>
  oauthDeviceStart(clientId: string): Promise<DeviceStart>
  oauthDevicePoll(clientId: string, deviceCode: string): Promise<DevicePoll>
  trackersList(): Promise<TrackerView[]>
  trackersAdd(t: { type: TrackerType; label: string; site?: string; email?: string; token?: string; key?: string; boardId?: string }): Promise<TrackerView[]>
  trackersRemove(id: string): Promise<TrackerView[]>
  trackersItems(id: string): Promise<TrackerItem[]>
  trackersBoard(id: string): Promise<TrelloList[]>
  signingGet(cwd: string): Promise<SigningConfig>
  signingSet(cwd: string, cfg: SigningConfig, scope: 'local' | 'global'): Promise<void>
  signingStatus(cwd: string, hash: string): Promise<{ status: string; signer: string }>
  sshKeys(): Promise<SshKey[]>
  sshGenerate(name: string, comment: string): Promise<string>
  submoduleAdd(cwd: string, url: string, path: string): Promise<string>
  sparseState(cwd: string): Promise<SparseState>
  sparseSet(cwd: string, patterns: string[]): Promise<void>
  sparseDisable(cwd: string): Promise<void>
  insights(cwd: string): Promise<Insights>
  difftool(cwd: string, path: string): Promise<boolean>
  mergetool(cwd: string): Promise<boolean>
  openTerminal(cwd: string): Promise<boolean>
  workspacesList(): Promise<Workspace[]>
  workspacesSave(name: string, repos: string[]): Promise<Workspace[]>
  workspacesRemove(id: string): Promise<Workspace[]>
  setupsList(): Promise<RepoSetup[]>
  setupsSave(setup: RepoSetup): Promise<RepoSetup[]>
  setupsRemove(id: string): Promise<RepoSetup[]>
  settingsExport(): Promise<boolean>
  settingsImport(): Promise<boolean>
  notify(title: string, body: string): Promise<boolean>
  opState(cwd: string): Promise<OpState>
  opContinue(cwd: string, kind: string): Promise<string>
  opAbort(cwd: string, kind: string): Promise<string>
  opSkip(cwd: string, kind: string): Promise<string>
  rebaseBranch(cwd: string, upstream: string): Promise<string>
  rebaseList(cwd: string, base: string): Promise<RebaseCommit[]>
  rebaseInteractive(cwd: string, base: string, items: RebaseItem[]): Promise<string>
  worktreesList(cwd: string): Promise<Worktree[]>
  worktreesAdd(cwd: string, path: string, branch: string): Promise<string>
  worktreesRemove(cwd: string, path: string, force: boolean): Promise<string>
  submodulesList(cwd: string): Promise<Submodule[]>
  submodulesUpdate(cwd: string): Promise<string>
  submoduleUpdateOne(cwd: string, path: string): Promise<string>
  submoduleSync(cwd: string, path: string): Promise<string>
  submoduleDeinit(cwd: string, path: string, force: boolean): Promise<string>
  remoteIssues(cwd: string, mentioned?: boolean): Promise<{ repo: RemoteRepo | null; issues: Issue[] }>
  issueComment(cwd: string, issueNumber: number, body: string): Promise<string>
  issueClose(cwd: string, issueNumber: number, comment?: string): Promise<void>
  issueReopen(cwd: string, issueNumber: number): Promise<void>
  remoteActions(cwd: string): Promise<WorkflowRun[]>
  remoteMilestones(cwd: string): Promise<Milestone[]>
  remoteLanguages(cwd: string): Promise<{ name: string; share: number }[]>
  remoteSecurity(cwd: string): Promise<SecurityOverview>
  secretScan(cwd: string): Promise<SecretFinding[]>
  remoteFork(cwd: string): Promise<string>
  stage(cwd: string, paths: string[]): Promise<void>
  stageAll(cwd: string): Promise<void>
  unstage(cwd: string, paths: string[]): Promise<void>
  unstageAll(cwd: string): Promise<void>
  discard(cwd: string, path: string, untracked: boolean): Promise<void>
  discardsList(cwd: string): Promise<DiscardEntry[]>
  discardsRestore(cwd: string, id: string): Promise<string>
  untrack(cwd: string, path: string): Promise<void>
  stageHunk(cwd: string, path: string, hunk: number): Promise<void>
  unstageHunk(cwd: string, path: string, hunk: number): Promise<void>
  stageLines(cwd: string, path: string, hunk: number, lines: number[]): Promise<void>
  unstageLines(cwd: string, path: string, hunk: number, lines: number[]): Promise<void>
  hide(cwd: string, path: string, hidden: boolean): Promise<void>
  integrity(cwd: string): Promise<string>
  excludesListIgnored(cwd: string): Promise<IgnoredFileSets>
  excludesCheck(cwd: string, path: string): Promise<IgnoreCheck>
  excludesList(cwd: string): Promise<ExcludeSets>
  excludesAdd(cwd: string, scope: ExcludeScope, pattern: string): Promise<ExcludeSets>
  excludesRemove(cwd: string, scope: ExcludeScope, pattern: string): Promise<ExcludeSets>
  excludesGetDefaults(): Promise<ExcludeProfile>
  excludesSetDefaults(profile: ExcludeProfile): Promise<ExcludeProfile>
  excludesApplyDefaults(cwd: string): Promise<ExcludeSets>
  conflictsList(cwd: string): Promise<ConflictFile[]>
  conflictStages(cwd: string, path: string): Promise<{ base: string; ours: string; theirs: string }>
  conflictOurs(cwd: string, path: string): Promise<void>
  conflictTheirs(cwd: string, path: string): Promise<void>
  conflictKeepFile(cwd: string, path: string): Promise<void>
  conflictDeleteFile(cwd: string, path: string): Promise<void>
  conflictResolve(cwd: string, path: string, content: string): Promise<void>
  aiAvailable(): Promise<boolean>
  aiResolveConflict(cwd: string, path: string): Promise<string>
  aiCommitMessage(cwd: string): Promise<string>
  aiPrDescribe(cwd: string, base: string, head: string): Promise<string>
  aiStashMessage(cwd: string): Promise<string>
  aiExplainCommit(cwd: string, hash: string): Promise<string>
  aiExplainWorking(cwd: string, path: string): Promise<string>
  aiChangelog(cwd: string, base: string): Promise<string>
  aiReview(cwd: string): Promise<string>
  aiExplainConflict(cwd: string, path: string): Promise<string>
  aiComposeCommits(cwd: string): Promise<{ commits: ComposedCommit[] }>
  commit(cwd: string, message: string, coauthors: { name: string; email: string }[], amend: boolean): Promise<string>
  log(cwd: string): Promise<Commit[]>
  unpushedCommits(cwd: string): Promise<GraphCommit[]>
  pushCoauthorGuard(cwd: string): Promise<CoauthorViolation[]>
  commitTamperCheck(cwd: string): Promise<{ injected: Person[]; dropped: Person[] }>
  trustCommit(cwd: string, hash: string): Promise<void>
  push(cwd: string, setUpstream: boolean, branch: string): Promise<string>
  pull(cwd: string): Promise<string>
  fetch(cwd: string): Promise<string>
  repoMeta(cwd: string): Promise<RepoMeta>
  stash(cwd: string, message: string): Promise<string>
  stashPop(cwd: string): Promise<string>
  stashList(cwd: string): Promise<StashEntry[]>
  stashApply(cwd: string, ref: string): Promise<string>
  stashPopRef(cwd: string, ref: string): Promise<string>
  stashDrop(cwd: string, ref: string): Promise<string>
  checkout(cwd: string, branch: string): Promise<void>
  createBranch(cwd: string, name: string): Promise<void>
  coauthorsList(): Promise<Coauthor[]>
  coauthorsAdd(name: string, email: string): Promise<Coauthor[]>
  coauthorsToggle(id: string, enabled: boolean): Promise<Coauthor[]>
  coauthorsRemove(id: string): Promise<Coauthor[]>
  coauthorsKnown(cwd: string): Promise<{ name: string; email: string }[]>
  settingsGet(): Promise<Settings>
  settingsSet(patch: Partial<Settings>): Promise<Settings>
  commitPreview(cwd: string): Promise<CommitPreview>
  undoCommit(cwd: string): Promise<void>
  logStat(cwd: string, count: number): Promise<string>
  mcpStatus(): Promise<McpInfo>
  mcpSetRepo(cwd: string | null): Promise<boolean>
  rtcProbe(cwd: string): Promise<any>
  rtcState(cwd: string): Promise<any>
  rtcCreate(cwd: string, opts: any): Promise<any>
  rtcEnd(cwd: string): Promise<any>
  rtcInviteExport(cwd: string): Promise<string | null>
  rtcSnapshotExport(cwd: string): Promise<any>
  rtcSnapshotVerify(srcDir: string): Promise<any>
  rtcSnapshotImport(srcDir: string, destDir: string, guestName: string): Promise<any>
  rtcCloneJoin(cwd: string, inviteFile: string, guestName: string): Promise<any>
  rtcPickFile(title: string): Promise<string | null>
  rtcManifestRefresh(cwd: string): Promise<any>
  rtcActorAdd(cwd: string, opts: any): Promise<any>
  rtcActorSetActive(cwd: string, actorId: string, taskId?: string | null): Promise<any>
  rtcPresence(cwd: string, actorId: string, patch: any): Promise<any>
  rtcTaskCreate(cwd: string, opts: any): Promise<any>
  rtcTaskClaim(cwd: string, taskId: string, actorId: string): Promise<any>
  rtcTaskTransition(cwd: string, taskId: string, to: string): Promise<any>
  rtcTaskUpdate(cwd: string, taskId: string, patch: any): Promise<any>
  rtcLockAcquire(cwd: string, opts: any): Promise<any>
  rtcLockRelease(cwd: string, lockId: string): Promise<any>
  rtcChangesAssign(cwd: string, paths: string[], actorId: string, taskId?: string | null): Promise<any>
  rtcPatchCreate(cwd: string, opts: any): Promise<any>
  rtcPatchStatus(cwd: string, patchId: string, status: string): Promise<any>
  rtcPatchApply(cwd: string, patchId: string, checkOnly: boolean): Promise<any>
  rtcCheckpointCreate(cwd: string, opts: any): Promise<any>
  rtcAdvise(cwd: string): Promise<any[]>
  rtcCommitSuggest(cwd: string, checkpointId: string): Promise<any>
  rtcCommitApprove(cwd: string, suggestionId: string, edits: any): Promise<any>
  rtcSettingsSet(cwd: string, patch: any): Promise<any>
  rtcWatchStart(cwd: string): Promise<boolean>
  rtcWatchStop(): Promise<boolean>
  onRtcEvent(cb: (payload: any) => void): () => void
  onMenu(
    cb: (
      action: 'new-repo' | 'open-repo' | 'settings' | 'stash' | 'commit' | 'push' | 'pull' | 'fetch'
    ) => void
  ): () => void
}

declare global {
  interface Window {
    hydrodam: HydrodamApi
  }
}

export const api = (): HydrodamApi => window.hydrodam

/** Accent theme presets: id -> space-separated RGB for the --accent CSS var. */
export const ACCENTS: { id: string; label: string; rgb: string }[] = [
  { id: 'blue', label: 'Blue', rgb: '109 139 255' },
  { id: 'violet', label: 'Violet', rgb: '167 139 250' },
  { id: 'green', label: 'Green', rgb: '52 211 153' },
  { id: 'amber', label: 'Amber', rgb: '251 191 36' },
  { id: 'rose', label: 'Rose', rgb: '251 113 133' },
  { id: 'cyan', label: 'Cyan', rgb: '34 211 238' }
]

export function applyAccent(id: string): void {
  const a = ACCENTS.find((x) => x.id === id) ?? ACCENTS[0]
  document.documentElement.style.setProperty('--accent', a.rgb)
}

/**
 * Native two-button confirmation backed by the OS message box. Returns true
 * when the user picks the affirmative action. Prefer this over window.confirm
 * so prompts match the rest of the app.
 */
export async function confirmDialog(opts: {
  title?: string
  message: string
  detail?: string
  confirmLabel?: string
  cancelLabel?: string
  danger?: boolean
}): Promise<boolean> {
  const response = await api().messageBox({
    type: opts.danger ? 'warning' : 'question',
    title: opts.title ?? 'Hydrodam',
    message: opts.message,
    detail: opts.detail,
    buttons: [opts.confirmLabel ?? 'OK', opts.cancelLabel ?? 'Cancel'],
    defaultId: 0,
    cancelId: 1,
    noLink: true
  })
  return response === 0
}

export function basename(p: string): string {
  const i = Math.max(p.lastIndexOf('/'), p.lastIndexOf('\\'))
  return i >= 0 ? p.slice(i + 1) : p
}

export function dirname(p: string): string {
  const i = Math.max(p.lastIndexOf('/'), p.lastIndexOf('\\'))
  return i >= 0 ? p.slice(0, i) : ''
}

/** Human-readable byte size, e.g. "512 B", "4.2 KB", "1.8 MB". */
export function humanSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

/** Compact relative time, e.g. "just now", "5m ago", "3h ago", "2d ago". */
export function relTime(ts?: number): string {
  if (!ts) return 'never'
  const s = Math.floor((Date.now() - ts) / 1000)
  if (s < 10) return 'just now'
  if (s < 60) return `${s}s ago`
  const m = Math.floor(s / 60)
  if (m < 60) return `${m}m ago`
  const h = Math.floor(m / 60)
  if (h < 24) return `${h}h ago`
  const d = Math.floor(h / 24)
  if (d < 30) return `${d}d ago`
  return new Date(ts).toLocaleDateString()
}
