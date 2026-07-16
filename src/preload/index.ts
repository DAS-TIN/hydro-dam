import { contextBridge, ipcRenderer } from 'electron'

type Result<T> = { ok: true; data: T } | { ok: false; error: string }

//Thin invoke helper; unwraps {ok,data} and throws on {ok:false}
async function call<T>(channel: string, ...args: any[]): Promise<T> {
  const res = (await ipcRenderer.invoke(channel, ...args)) as Result<T>
  if (!res.ok) throw new Error(res.error)
  return res.data
}

const api = {
  //repo
  openRepo: () => call<any>('repo:open'),
  browseDir: (title?: string) => call<string | null>('repo:browseDir', title),
  messageBox: (opts: any) => call<number>('dialog:message', opts),
  repoTemplates: () => call<any>('repo:templates'),
  createRepo: (opts: any) => call<string>('repo:create', opts),
  createFromSetup: (setupId: string, parentDir: string, name: string) =>
    call<string>('repo:createFromSetup', setupId, parentDir, name),
  cloneRepo: (url: string, parentDir: string, name?: string, accountId?: string) =>
    call<string>('repo:clone', url, parentDir, name, accountId),
  globalIdentity: () => call<{ name: string; email: string }>('identity:global'),
  validateRepo: (p: string) => call<string | null>('repo:validate', p),
  recentRepos: () => call<{ recent: string[]; last: string | null }>('repo:recent'),
  forgetRecentRepo: (root: string) => call<string[]>('repo:forgetRecent', root),
  status: (cwd: string) => call<any>('repo:status', cwd),
  hidden: (cwd: string) => call<string[]>('repo:hidden', cwd),
  seenUntracked: (cwd: string) => call<string[]>('untracked:seen', cwd),
  markUntrackedSeen: (cwd: string, paths: string[]) => call<string[]>('untracked:markSeen', cwd, paths),
  seenIgnored: (cwd: string) => call<string[]>('ignored:seen', cwd),
  markIgnoredSeen: (cwd: string, paths: string[]) => call<string[]>('ignored:markSeen', cwd, paths),
  branches: (cwd: string) => call<any[]>('repo:branches', cwd),
  tree: (cwd: string) => call<string[]>('repo:tree', cwd),
  numstat: (cwd: string) => call<any>('repo:numstat', cwd),
  identityGet: (cwd: string) => call<any>('identity:get', cwd),
  identitySet: (cwd: string, name: string, email: string, scope: 'local' | 'global') =>
    call<void>('identity:set', cwd, name, email, scope),
  profilesList: () => call<any>('profiles:list'),
  profilesAdd: (label: string, name: string, email: string) =>
    call<any[]>('profiles:add', label, name, email),
  profilesUpdate: (id: string, label: string, name: string, email: string) =>
    call<any[]>('profiles:update', id, label, name, email),
  profilesRemove: (id: string) => call<any>('profiles:remove', id),
  profilesUse: (cwd: string, id: string, scope: 'local' | 'global') =>
    call<any>('profiles:use', cwd, id, scope),
  readFile: (cwd: string, path: string) => call<any>('file:read', cwd, path),
  writeFile: (cwd: string, path: string, content: string) =>
    call<boolean>('file:write', cwd, path, content),
  openFile: (cwd: string, path: string) => call<boolean>('file:open', cwd, path),
  revealFile: (cwd: string, path: string) => call<boolean>('file:reveal', cwd, path),

  //files
  fileDiff: (cwd: string, path: string, staged: boolean, untracked: boolean) =>
    call<string>('file:diff', cwd, path, staged, untracked),
  fileMeta: (cwd: string, path: string) => call<Record<string, string>>('file:meta', cwd, path),
  fileLog: (cwd: string, path: string) => call<any[]>('file:log', cwd, path),
  fileAtCommit: (cwd: string, hash: string, path: string) =>
    call<string>('file:atCommit', cwd, hash, path),
  commitFileDiff: (cwd: string, hash: string, path: string) =>
    call<string>('file:commitDiff', cwd, hash, path),
  commitShow: (cwd: string, hash: string) => call<string>('commit:show', cwd, hash),
  commitMeta: (cwd: string, hash: string) => call<any>('commit:meta', cwd, hash),
  reflog: (cwd: string) => call<any[]>('reflog', cwd),
  imageAt: (cwd: string, ref: string, path: string) => call<string | null>('image:at', cwd, ref, path),
  lfsInfo: (cwd: string) => call<any>('lfs:info', cwd),
  lfsTrack: (cwd: string, pattern: string) => call<string>('lfs:track', cwd, pattern),
  lfsPull: (cwd: string) => call<string>('lfs:pull', cwd),
  logGraph: (cwd: string, q: any) => call<any[]>('log:graph', cwd, q),
  blame: (cwd: string, path: string) => call<any[]>('blame', cwd, path),

  //commit actions
  cherryPick: (cwd: string, hash: string) => call<string>('commit:cherryPick', cwd, hash),
  revertCommit: (cwd: string, hash: string) => call<string>('commit:revert', cwd, hash),
  resetTo: (cwd: string, hash: string, mode: 'soft' | 'mixed' | 'hard') =>
    call<void>('commit:reset', cwd, hash, mode),
  resetPreview: (cwd: string, hash: string, mode: 'soft' | 'mixed' | 'hard') =>
    call<any>('commit:resetPreview', cwd, hash, mode),
  checkoutCommit: (cwd: string, hash: string) => call<void>('commit:checkout', cwd, hash),
  branchAt: (cwd: string, name: string, ref: string) => call<void>('commit:branchAt', cwd, name, ref),
  tagAt: (cwd: string, name: string, ref: string) => call<void>('commit:tagAt', cwd, name, ref),

  // branches & remotes
  branchesFull: (cwd: string) => call<any[]>('branches:full', cwd),
  deleteBranch: (cwd: string, name: string, force: boolean) => call<void>('branch:delete', cwd, name, force),
  renameBranch: (cwd: string, oldName: string, newName: string) =>
    call<void>('branch:rename', cwd, oldName, newName),
  moveBranch: (cwd: string, name: string, target: string) => call<void>('branch:move', cwd, name, target),
  mergeBranch: (cwd: string, name: string) => call<string>('branch:merge', cwd, name),
  setUpstream: (cwd: string, branch: string, upstream: string) =>
    call<void>('branch:setUpstream', cwd, branch, upstream),
  deleteRemoteBranch: (cwd: string, remote: string, branch: string) =>
    call<string>('branch:deleteRemote', cwd, remote, branch),
  remotesList: (cwd: string) => call<any[]>('remotes:list', cwd),

  //GitHub / GitLab
  remotePulls: (cwd: string) => call<any>('remote:pulls', cwd),
  remoteCreatePull: (cwd: string, pull: any) => call<any>('remote:createPull', cwd, pull),
  remoteInfo: (cwd: string) => call<any>('remote:info', cwd),
  openExternal: (url: string) => call<boolean>('shell:openExternal', url),

  //hosting accounts
  accountsList: () => call<any[]>('accounts:list'),
  accountsAdd: (provider: string, host: string, label: string, token: string) =>
    call<any[]>('accounts:add', provider, host, label, token),
  accountsRemove: (id: string) => call<any[]>('accounts:remove', id),
  accountsSetActive: (provider: string, id: string) => call<any[]>('accounts:setActive', provider, id),
  accountsValidate: (provider: string, host: string, token: string) =>
    call<{ username: string }>('accounts:validate', provider, host, token),
  accountRepos: (accountId: string) => call<any[]>('accounts:repos', accountId),

  // GitHub OAuth device flow
  oauthDeviceStart: (clientId: string) => call<any>('oauth:deviceStart', clientId),
  oauthDevicePoll: (clientId: string, deviceCode: string) => call<any>('oauth:devicePoll', clientId, deviceCode),

  // External trackers (Jira / Trello)
  trackersList: () => call<any[]>('trackers:list'),
  trackersAdd: (t: any) => call<any[]>('trackers:add', t),
  trackersRemove: (id: string) => call<any[]>('trackers:remove', id),
  trackersItems: (id: string) => call<any[]>('trackers:items', id),
  trackersBoard: (id: string) => call<any[]>('trackers:board', id),

  // Signing & ssh keys
  signingGet: (cwd: string) => call<any>('signing:get', cwd),
  signingSet: (cwd: string, cfg: any, scope: 'local' | 'global') => call<void>('signing:set', cwd, cfg, scope),
  signingStatus: (cwd: string, hash: string) => call<any>('signing:status', cwd, hash),
  sshKeys: () => call<any[]>('ssh:keys'),
  sshGenerate: (name: string, comment: string) => call<string>('ssh:generate', name, comment),

  //submodule add & sparse-checkout
  submoduleAdd: (cwd: string, url: string, path: string) => call<string>('submodule:add', cwd, url, path),
  sparseState: (cwd: string) => call<any>('sparse:state', cwd),
  sparseSet: (cwd: string, patterns: string[]) => call<void>('sparse:set', cwd, patterns),
  sparseDisable: (cwd: string) => call<void>('sparse:disable', cwd),

  //insights, tools, workspaces, sync, notify
  insights: (cwd: string) => call<any>('insights', cwd),
  difftool: (cwd: string, path: string) => call<boolean>('tool:difftool', cwd, path),
  mergetool: (cwd: string) => call<boolean>('tool:mergetool', cwd),
  openTerminal: (cwd: string) => call<boolean>('tool:terminal', cwd),
  workspacesList: () => call<any[]>('workspaces:list'),
  workspacesSave: (name: string, repos: string[]) => call<any[]>('workspaces:save', name, repos),
  workspacesRemove: (id: string) => call<any[]>('workspaces:remove', id),
  setupsList: () => call<any[]>('setups:list'),
  setupsSave: (setup: any) => call<any[]>('setups:save', setup),
  setupsRemove: (id: string) => call<any[]>('setups:remove', id),
  settingsExport: () => call<boolean>('settings:export'),
  settingsImport: () => call<boolean>('settings:import'),
  notify: (title: string, body: string) => call<boolean>('notify', title, body),

  // in-progress operations (cherry-pick / revert / merge / rebase)
  opState: (cwd: string) => call<any>('op:state', cwd),
  opContinue: (cwd: string, kind: string) => call<string>('op:continue', cwd, kind),
  opAbort: (cwd: string, kind: string) => call<string>('op:abort', cwd, kind),
  opSkip: (cwd: string, kind: string) => call<string>('op:skip', cwd, kind),
  bisectState: (cwd: string) => call<any>('bisect:state', cwd),
  bisectStart: (cwd: string, good: string, bad: string) => call<string>('bisect:start', cwd, good, bad),
  bisectMark: (cwd: string, verdict: string) => call<string>('bisect:mark', cwd, verdict),
  bisectReset: (cwd: string) => call<string>('bisect:reset', cwd),
  rebaseBranch: (cwd: string, upstream: string) => call<string>('branch:rebase', cwd, upstream),
  rebaseList: (cwd: string, base: string) => call<any[]>('rebase:list', cwd, base),
  rebaseInteractive: (cwd: string, base: string, items: any[]) =>
    call<string>('rebase:interactive', cwd, base, items),

  // worktrees & submodules
  worktreesList: (cwd: string) => call<any[]>('worktrees:list', cwd),
  worktreesAdd: (cwd: string, path: string, branch: string) => call<string>('worktrees:add', cwd, path, branch),
  worktreesRemove: (cwd: string, path: string, force: boolean) =>
    call<string>('worktrees:remove', cwd, path, force),
  submodulesList: (cwd: string) => call<any[]>('submodules:list', cwd),
  submodulesUpdate: (cwd: string) => call<string>('submodules:update', cwd),
  submoduleUpdateOne: (cwd: string, path: string) => call<string>('submodules:updateOne', cwd, path),
  submoduleSync: (cwd: string, path: string) => call<string>('submodules:sync', cwd, path),
  submoduleDeinit: (cwd: string, path: string, force: boolean) =>
    call<string>('submodules:deinit', cwd, path, force),

  // issues
  remoteIssues: (cwd: string, mentioned?: boolean) => call<any>('remote:issues', cwd, mentioned),
  issueComment: (cwd: string, issueNumber: number, body: string) =>
    call<string>('remote:commentIssue', cwd, issueNumber, body),
  issueClose: (cwd: string, issueNumber: number, comment?: string) =>
    call<void>('remote:closeIssue', cwd, issueNumber, comment),
  issueReopen: (cwd: string, issueNumber: number) => call<void>('remote:reopenIssue', cwd, issueNumber),
  remoteActions: (cwd: string) => call<any[]>('remote:actions', cwd),
  remoteMilestones: (cwd: string) => call<any[]>('remote:milestones', cwd),
  remoteLanguages: (cwd: string) => call<any[]>('remote:languages', cwd),
  remoteSecurity: (cwd: string) => call<any>('remote:security', cwd),
  secretScan: (cwd: string) => call<any[]>('push:scanSecrets', cwd),
  remoteFork: (cwd: string) => call<string>('remote:fork', cwd),

  //staging
  stage: (cwd: string, paths: string[]) => call<void>('stage', cwd, paths),
  stageAll: (cwd: string) => call<void>('stage:all', cwd),
  unstage: (cwd: string, paths: string[]) => call<void>('unstage', cwd, paths),
  unstageAll: (cwd: string) => call<void>('unstage:all', cwd),
  discard: (cwd: string, path: string, untracked: boolean) =>
    call<void>('discard', cwd, path, untracked),
  discardsList: (cwd: string) => call<any[]>('discards:list', cwd),
  discardsRestore: (cwd: string, id: string) => call<string>('discards:restore', cwd, id),
  untrack: (cwd: string, path: string) => call<void>('untrack', cwd, path),
  stageHunk: (cwd: string, path: string, hunk: number) => call<void>('stage:hunk', cwd, path, hunk),
  unstageHunk: (cwd: string, path: string, hunk: number) => call<void>('unstage:hunk', cwd, path, hunk),
  stageLines: (cwd: string, path: string, hunk: number, lines: number[]) =>
    call<void>('stage:lines', cwd, path, hunk, lines),
  unstageLines: (cwd: string, path: string, hunk: number, lines: number[]) =>
    call<void>('unstage:lines', cwd, path, hunk, lines),
  hide: (cwd: string, path: string, hidden: boolean) => call<void>('hide', cwd, path, hidden),
  integrity: (cwd: string) => call<string>('repo:integrity', cwd),

  // Ignore / exclude rules
  excludesListIgnored: (cwd: string) => call<any>('excludes:listIgnored', cwd),
  excludesCheck: (cwd: string, path: string) => call<any>('excludes:check', cwd, path),
  excludesList: (cwd: string) => call<any>('excludes:list', cwd),
  excludesAdd: (cwd: string, scope: string, pattern: string) =>
    call<any>('excludes:add', cwd, scope, pattern),
  excludesRemove: (cwd: string, scope: string, pattern: string) =>
    call<any>('excludes:remove', cwd, scope, pattern),
  excludesGetDefaults: () => call<any>('excludes:getDefaults'),
  excludesSetDefaults: (profile: any) => call<any>('excludes:setDefaults', profile),
  excludesApplyDefaults: (cwd: string) => call<any>('excludes:applyDefaults', cwd),

  // merge conflicts
  conflictsList: (cwd: string) => call<any[]>('conflicts:list', cwd),
  conflictStages: (cwd: string, path: string) =>
    call<{ base: string; ours: string; theirs: string }>('conflicts:stages', cwd, path),
  conflictOurs: (cwd: string, path: string) => call<void>('conflicts:ours', cwd, path),
  conflictTheirs: (cwd: string, path: string) => call<void>('conflicts:theirs', cwd, path),
  conflictKeepFile: (cwd: string, path: string) => call<void>('conflicts:keepFile', cwd, path),
  conflictDeleteFile: (cwd: string, path: string) => call<void>('conflicts:deleteFile', cwd, path),
  conflictResolve: (cwd: string, path: string, content: string) =>
    call<void>('conflicts:resolve', cwd, path, content),
  aiAvailable: () => call<boolean>('ai:available'),
  aiResolveConflict: (cwd: string, path: string) => call<string>('ai:resolveConflict', cwd, path),
  aiCommitMessage: (cwd: string) => call<string>('ai:commitMessage', cwd),
  aiPrDescribe: (cwd: string, base: string, head: string) => call<string>('ai:prDescribe', cwd, base, head),
  aiStashMessage: (cwd: string) => call<string>('ai:stashMessage', cwd),
  aiExplainCommit: (cwd: string, hash: string) => call<string>('ai:explainCommit', cwd, hash),
  aiExplainWorking: (cwd: string, path: string) => call<string>('ai:explainWorking', cwd, path),
  aiChangelog: (cwd: string, base: string) => call<string>('ai:changelog', cwd, base),
  aiReview: (cwd: string) => call<string>('ai:review', cwd),
  aiExplainConflict: (cwd: string, path: string) => call<string>('ai:explainConflict', cwd, path),
  aiComposeCommits: (cwd: string) => call<any>('ai:composeCommits', cwd),

  // Commit / remote
  commit: (cwd: string, message: string, coauthors: any[], amend: boolean) =>
    call<string>('commit', cwd, message, coauthors, amend),
  log: (cwd: string) => call<any[]>('log', cwd),
  unpushedCommits: (cwd: string) => call<any[]>('repo:unpushed', cwd),
  pushCoauthorGuard: (cwd: string) => call<any[]>('push:coauthorGuard', cwd),
  commitTamperCheck: (cwd: string) => call<any>('commit:tamperCheck', cwd),
  trustCommit: (cwd: string, hash: string) => call<void>('commit:trust', cwd, hash),
  push: (cwd: string, setUpstream: boolean, branch: string) =>
    call<string>('push', cwd, setUpstream, branch),
  pull: (cwd: string) => call<string>('pull', cwd),
  fetch: (cwd: string) => call<string>('fetch', cwd),
  repoMeta: (cwd: string) => call<any>('repo:meta', cwd),
  stash: (cwd: string, message: string) => call<string>('stash', cwd, message),
  stashPop: (cwd: string) => call<string>('stash:pop', cwd),
  stashList: (cwd: string) => call<any[]>('stash:list', cwd),
  stashApply: (cwd: string, ref: string) => call<string>('stash:apply', cwd, ref),
  stashPopRef: (cwd: string, ref: string) => call<string>('stash:popRef', cwd, ref),
  stashDrop: (cwd: string, ref: string) => call<string>('stash:drop', cwd, ref),
  checkout: (cwd: string, branch: string) => call<void>('checkout', cwd, branch),
  createBranch: (cwd: string, name: string) => call<void>('branch:create', cwd, name),

  // Co-authors
  coauthorsList: () => call<any[]>('coauthors:list'),
  coauthorsAdd: (name: string, email: string) => call<any[]>('coauthors:add', name, email),
  coauthorsToggle: (id: string, enabled: boolean) => call<any[]>('coauthors:toggle', id, enabled),
  coauthorsRemove: (id: string) => call<any[]>('coauthors:remove', id),
  coauthorsKnown: (cwd: string) => call<any[]>('coauthors:known', cwd),

  //settings
  settingsGet: () => call<any>('settings:get'),
  settingsSet: (patch: any) => call<any>('settings:set', patch),

  //commit preview / review
  commitPreview: (cwd: string) => call<any>('commit:preview', cwd),
  undoCommit: (cwd: string) => call<void>('commit:undo', cwd),
  logStat: (cwd: string, count: number) => call<string>('log:stat', cwd, count),

  // MCP server
  mcpStatus: () => call<any>('mcp:status'),
  mcpSetRepo: (cwd: string | null) => call<boolean>('mcp:setRepo', cwd),

  // the log of git commands the app has run
  commandLog: () => call<any[]>('git:log:commands'),
  onGitCommand: (cb: (entry: any) => void) => {
    const listener = (_e: unknown, entry: any) => cb(entry)
    ipcRenderer.on('git:command', listener)
    return () => ipcRenderer.removeListener('git:command', listener)
  },

  // menu-driven actions from the native application menu
  onMenu: (
    cb: (
      action: 'new-repo' | 'open-repo' | 'settings' | 'stash' | 'commit' | 'push' | 'pull' | 'fetch'
    ) => void
  ) => {
    const listener = (_e: unknown, action: any) => cb(action)
    ipcRenderer.on('menu', listener)
    return () => ipcRenderer.removeListener('menu', listener)
  }
}

contextBridge.exposeInMainWorld('hydrodam', api)

export type HydrodamApi = typeof api
