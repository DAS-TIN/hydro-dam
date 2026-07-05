import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  api,
  confirmDialog,
  RepoStatus,
  FileEntry,
  Coauthor,
  CoauthorViolation,
  Branch,
  Settings,
  RepoMeta,
  Identity,
  OpState,
  IgnoredFileSets,
  TrackerView,
  WorkingNumstat,
  McpInfo,
  applyAccent,
  basename,
  relTime
} from './api'
import FileList from './components/FileList'
import RepoTree from './components/RepoTree'
import FilePreview from './components/FilePreview'
import FileContent from './components/FileContent'
import DiffView from './components/DiffView'
import { isMarkdown } from './highlight'
import {
  IconHome,
  IconBranch,
  IconArrowUp,
  IconArrowDown,
  IconCheck,
  IconWarning,
  IconRefresh,
  IconGear,
  IconLogo,
  IconHelp
} from './components/Icons'
import CoauthorPanel from './components/CoauthorPanel'
import CoauthorGuard from './components/CoauthorGuard'
import { PromptHost, promptDialog } from './components/PromptModal'
import PushPreview from './components/PushPreview'
import HistoryPanel from './components/HistoryPanel'
import CommitsPanel from './components/CommitsPanel'
import BranchesPanel from './components/BranchesPanel'
import RemotePanel from './components/RemotePanel'
import BlamePanel from './components/BlamePanel'
import ConnectionsPanel from './components/ConnectionsPanel'
import HunkStager from './components/HunkStager'
import InteractiveRebasePanel from './components/InteractiveRebasePanel'
import ReflogPanel from './components/ReflogPanel'
import LFSPanel from './components/LFSPanel'
import ImageDiff from './components/ImageDiff'
import TrackersPanel from './components/TrackersPanel'
import TrelloBoardView from './components/TrelloBoardView'
import SecurityPanel from './components/SecurityPanel'
import WorkspacesPanel from './components/WorkspacesPanel'
import InsightsPanel from './components/InsightsPanel'
import SetupsPanel from './components/SetupsPanel'
import AiResultModal from './components/AiResultModal'
import CommitComposerModal from './components/CommitComposerModal'
import WorktreesPanel from './components/WorktreesPanel'
import IssuesPanel from './components/IssuesPanel'
import SettingsPanel from './components/SettingsPanel'
import StashPanel from './components/StashPanel'
import ExcludePanel from './components/ExcludePanel'
import CommitPreview from './components/CommitPreview'
import CommitGuard from './components/CommitGuard'
import IdentityPanel from './components/IdentityPanel'
import ConflictPanel from './components/ConflictPanel'
import NewRepoPanel from './components/NewRepoPanel'
import Legend from './components/Legend'
import CommandPalette, { PaletteAction } from './components/CommandPalette'
import SubmodulesPanel from './components/SubmodulesPanel'
import HelpPanel from './components/HelpPanel'
import DiscardsPanel from './components/DiscardsPanel'
import IgnoredDialog from './components/IgnoredDialog'

type Toast = { id: number; kind: 'ok' | 'err' | 'info'; text: string }

/** Paths whose status changed between two snapshots (added, removed, or status flipped). */
function changedPaths(prev: RepoStatus | null, next: RepoStatus): string[] {
  const sig = (f: FileEntry) => f.index + f.work
  const prevMap = new Map((prev?.files ?? []).filter((f) => !f.ignored).map((f) => [f.path, sig(f)]))
  const out: string[] = []
  for (const f of next.files) {
    if (f.ignored) continue
    const before = prevMap.get(f.path)
    if (before === undefined || before !== sig(f)) out.push(f.path)
    prevMap.delete(f.path)
  }
  for (const p of prevMap.keys()) out.push(p) // disappeared since last seen
  return out
}

const IMAGE_RE = /\.(png|jpe?g|gif|webp|bmp|ico)$/i

const DEFAULT_SETTINGS: Settings = {
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
  secretScanOnPush: false
}

function SplashScreen({ onDone }: { onDone: () => void }) {
  const [fading, setFading] = React.useState(false)
  React.useEffect(() => {
    const t1 = setTimeout(() => setFading(true), 560)
    const t2 = setTimeout(() => onDone(), 900)
    return () => { clearTimeout(t1); clearTimeout(t2) }
  }, [onDone])
  return (
    <div
      style={{
        position: 'fixed', inset: 0, zIndex: 9999,
        background: '#080a10',
        display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
        gap: '18px',
        opacity: fading ? 0 : 1,
        transition: 'opacity 340ms ease'
      }}
    >
      <IconLogo className="h-16 w-auto" />
      <div style={{ width: '200px', height: '2px', background: '#1e2436', borderRadius: '1px', overflow: 'hidden' }}>
        <div style={{
          height: '100%', width: '100%',
          background: '#ffffff',
          borderRadius: '1px',
          transformOrigin: 'left',
          animation: 'hd-bar 500ms cubic-bezier(.4,0,.2,1) forwards'
        }} />
      </div>
    </div>
  )
}

export default function App() {
  const [splashDone, setSplashDone] = useState(false)
  const [cwd, setCwd] = useState<string | null>(null)
  const [recent, setRecent] = useState<string[]>([])
  const [status, setStatus] = useState<RepoStatus | null>(null)
  const [numstat, setNumstat] = useState<WorkingNumstat | null>(null)
  const [hidden, setHidden] = useState<string[]>([])
  const [branches, setBranches] = useState<Branch[]>([])
  const [coauthors, setCoauthors] = useState<Coauthor[]>([])

  const [sel, setSel] = useState<{ file: FileEntry; staged: boolean } | null>(null)
  const [diff, setDiff] = useState('')
  const [meta, setMeta] = useState<Record<string, string>>({})
  // How the selected change is shown: its diff, the file itself, or rendered markdown.
  const [viewTab, setViewTab] = useState<'diff' | 'file' | 'preview'>('diff')

  const [leftMode, setLeftMode] = useState<'changes' | 'tree'>('changes')
  const [treePaths, setTreePaths] = useState<string[]>([])
  const [previewPath, setPreviewPath] = useState<string | null>(null)

  const [message, setMessage] = useState('')
  const [amend, setAmend] = useState(false)
  const [busy, setBusy] = useState(false)
  const [showCoauthors, setShowCoauthors] = useState(false)
  const [showPushPreview, setShowPushPreview] = useState(false)
  const [coauthorGuard, setCoauthorGuard] = useState<CoauthorViolation[] | null>(null)
  const [historyPath, setHistoryPath] = useState<string | null>(null)
  const [showBranches, setShowBranches] = useState(false)
  const [showRemote, setShowRemote] = useState(false)
  const [showConnections, setShowConnections] = useState(false)
  const [showWorktrees, setShowWorktrees] = useState(false)
  const [showIssues, setShowIssues] = useState(false)
  const [rebaseBase, setRebaseBase] = useState<string | null>(null)
  const [showReflog, setShowReflog] = useState(false)
  const [showLFS, setShowLFS] = useState(false)
  const [showTrackers, setShowTrackers] = useState(false)
  const [trackers, setTrackers] = useState<TrackerView[]>([])
  const [mainTab, setMainTab] = useState<'diff' | 'graph' | 'trello'>('diff')
  const [showSecurity, setShowSecurity] = useState(false)
  const [showWorkspaces, setShowWorkspaces] = useState(false)
  const [showInsights, setShowInsights] = useState(false)
  const [showSetups, setShowSetups] = useState(false)
  const [showSubmodules, setShowSubmodules] = useState(false)
  const [showHelp, setShowHelp] = useState(false)
  const [showDiscards, setShowDiscards] = useState(false)
  const [showPalette, setShowPalette] = useState(false)
  const [leftW, setLeftW] = useState(300)
  const [commitW, setCommitW] = useState(272)
  const [mcp, setMcp] = useState<McpInfo | null>(null)
  const [graphFocus, setGraphFocus] = useState<string | null>(null)
  const [graphPath, setGraphPath] = useState<string | null>(null)
  const [moreMenu, setMoreMenu] = useState(false)
  const [aiModal, setAiModal] = useState<{ title: string; run: () => Promise<string> } | null>(null)
  const [showComposer, setShowComposer] = useState(false)
  const [op, setOp] = useState<OpState | null>(null)
  const [blamePath, setBlamePath] = useState<string | null>(null)
  const [branchMenu, setBranchMenu] = useState(false)
  const [remoteBranches, setRemoteBranches] = useState<string[]>([])
  const [conflictPrompt, setConflictPrompt] = useState<number | null>(null)
  const [conflictAutoAi, setConflictAutoAi] = useState(false)
  const prevConflicts = useRef(0)
  const [toasts, setToasts] = useState<Toast[]>([])

  const [settings, setSettings] = useState<Settings>(DEFAULT_SETTINGS)
  const [repoMeta, setRepoMeta] = useState<RepoMeta>({})
  const [showSettings, setShowSettings] = useState(false)
  const [showStash, setShowStash] = useState(false)
  const [showExcludes, setShowExcludes] = useState(false)
  const [showReview, setShowReview] = useState(false)
  const [guard, setGuard] = useState<{ push: boolean; changed: string[] } | null>(null)
  const [identity, setIdentity] = useState<Identity | null>(null)
  const [showIdentity, setShowIdentity] = useState(false)
  const [showConflicts, setShowConflicts] = useState(false)
  const [ignoredFiles, setIgnoredFiles] = useState<IgnoredFileSets | null>(null)
  const [ignoredDialog, setIgnoredDialog] = useState<'gitignore' | 'local' | 'global' | null>(null)
  // New-repository dialog. initPath set => initialise that existing folder in place.
  const [newRepo, setNewRepo] = useState<{ initPath: string | null } | null>(null)

  //Fingerprint of the repo the last time we showed it; used to detect changes before commit.
  const baselineSig = useRef<string>('')

  const refreshTrackers = useCallback(() => {
    api().trackersList().then(setTrackers).catch(() => {})
  }, [])

  const toast = useCallback((kind: Toast['kind'], text: string) => {
    const id = Date.now() + Math.random()
    setToasts((t) => [...t, { id, kind, text }])
    setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), 4200)
  }, [])

  const run = useCallback(
    async (fn: () => Promise<any>, okMsg?: string) => {
      setBusy(true)
      try {
        const out = await fn()
        if (okMsg) toast('ok', okMsg)
        return out
      } catch (e: any) {
        toast('err', e?.message || String(e))
      } finally {
        setBusy(false)
      }
    },
    [toast]
  )

  const refresh = useCallback(
    async (dir = cwd) => {
      if (!dir) return
      try {
        const [s, h, b, m, sig, o, ns, mi] = await Promise.all([
          api().status(dir),
          api().hidden(dir),
          api().branches(dir),
          api().repoMeta(dir),
          api().integrity(dir).catch(() => ''),
          api().opState(dir).catch(() => null),
          api().numstat(dir).catch(() => null),
          api().mcpStatus().catch(() => null)
        ])
        setStatus(s)
        setNumstat(ns)
        setHidden(h)
        setBranches(b)
        setRepoMeta(m)
        setOp(o)
        setMcp(mi)
        if (sig) baselineSig.current = sig
      } catch (e: any) {
        toast('err', e?.message || String(e))
      }
    },
    [cwd, toast]
  )

  const updateSettings = useCallback((patch: Partial<Settings>) => {
    api().settingsSet(patch).then(setSettings)
  }, [])

  useEffect(() => applyAccent(settings.accent), [settings.accent])

  // UI scale (Settings > Text size). CSS zoom scales the whole tree.
  useEffect(() => {
    document.documentElement.style.setProperty('zoom', String((settings.uiZoom || 100) / 100))
  }, [settings.uiZoom])

  // Auto-fetch on an interval, with an optional desktop notification when behind.
  useEffect(() => {
    if (!cwd || !settings.autoFetchMinutes || settings.autoFetchMinutes < 1) return
    const t = setInterval(
      async () => {
        try {
          await api().fetch(cwd)
          const s = await api().status(cwd)
          if (settings.notifyOnUpdates && s.behind > 0) {
            api().notify('Hydrodam', `${basename(cwd)} is ${s.behind} commit(s) behind ${s.upstream ?? 'upstream'}.`)
          }
          refresh()
        } catch {
          //Ignore transient fetch errors
        }
      },
      settings.autoFetchMinutes * 60 * 1000
    )
    return () => clearInterval(t)
  }, [cwd, settings.autoFetchMinutes, settings.notifyOnUpdates, refresh])

  useEffect(() => {
    api().settingsGet().then(setSettings)
    api().coauthorsList().then(setCoauthors)
    api().trackersList().then(setTrackers).catch(() => {})
    api().recentRepos().then(({ recent, last }) => {
      setRecent(recent)
      if (last) {
        api()
          .validateRepo(last)
          .then((root) => root && openRepo(root))
          .catch(() => {})
      }
    })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  function openRepo(root: string) {
    setCwd(root)
    setSel(null)
    setDiff('')
    setMessage('')
    api().mcpSetRepo(root).catch(() => {})
    refresh(root)
  }

  // Ctrl+P / Ctrl+K opens the command palette once a repo is open.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && (e.key === 'p' || e.key === 'k')) {
        e.preventDefault()
        if (cwd) setShowPalette(true)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [cwd])

  // Poll for external changes while a repo is open. Pause during review / guard
  // so the baseline fingerprint stays frozen at what the user is looking at.
  useEffect(() => {
    if (!cwd || showReview || guard) return
    const t = setInterval(() => refresh(), 4000)
    return () => clearInterval(t)
  }, [cwd, refresh, showReview, guard])

  // Refresh the moment Hydrodam regains focus, so commits, pushes, or pulls made in
  // an external terminal are reflected as soon as you switch back to the app.
  useEffect(() => {
    if (!cwd) return
    const onFocus = () => {
      if (!showReview && !guard) refresh()
    }
    window.addEventListener('focus', onFocus)
    return () => window.removeEventListener('focus', onFocus)
  }, [cwd, refresh, showReview, guard])

  useEffect(() => {
    if (!cwd || !sel) {
      setDiff('')
      setMeta({})
      return
    }
    const { file, staged } = sel
    api()
      .fileDiff(cwd, file.path, staged, file.untracked)
      .then(setDiff)
      .catch((e) => setDiff(e.message))
    api().fileMeta(cwd, file.path).then(setMeta).catch(() => setMeta({}))
  }, [cwd, sel, status])

  function selectFile(file: FileEntry, staged: boolean) {
    setPreviewPath(null)
    if (sel?.file.path !== file.path) setViewTab('diff')
    setSel({ file, staged })
  }

  function selectTreeFile(path: string) {
    setSel(null)
    setPreviewPath(path)
  }

  const selKey = sel ? sel.file.path + (sel.staged ? ':staged' : '') : null

  // Remote branches with no local counterpart, for the branch menu. Loaded
  // when the menu opens; checking one out DWIM-creates a tracking branch.
  useEffect(() => {
    if (!cwd || !branchMenu) return
    api()
      .branchesFull(cwd)
      .then((all) => {
        const locals = new Set(all.filter((b) => !b.remote).map((b) => b.name))
        setRemoteBranches(
          all
            .filter((b) => b.remote && !b.name.endsWith('/HEAD'))
            .filter((b) => !locals.has(b.name.split('/').slice(1).join('/')))
            .map((b) => b.name)
        )
      })
      .catch(() => setRemoteBranches([]))
  }, [cwd, branchMenu])

  // Map path -> status entry, for colouring the full file tree.
  const statusMap = useMemo(() => {
    const m = new Map<string, FileEntry>()
    for (const f of status?.files ?? []) if (!f.ignored) m.set(f.path, f)
    return m
  }, [status])

  useEffect(() => {
    if (!cwd || leftMode !== 'tree') return
    api().tree(cwd).then(setTreePaths).catch(() => {})
  }, [cwd, leftMode, status])

  //Load the commit identity (who you're committing as) for the open repo.
  const loadIdentity = useCallback(() => {
    if (cwd) api().identityGet(cwd).then(setIdentity).catch(() => {})
  }, [cwd])
  useEffect(() => loadIdentity(), [loadIdentity])

  useEffect(() => {
    if (!cwd) { setIgnoredFiles(null); return }
    api().excludesListIgnored(cwd).then(setIgnoredFiles).catch(() => {})
  }, [cwd])

  const A = api()

  // Re-check the repo at the moment of committing. If anything changed since the
  // baseline the user is looking at, stop and warn instead of committing blindly.
  async function attemptCommit(push: boolean) {
    if (!cwd) return
    if (!message.trim() && !amend) {
      toast('err', 'Write a commit message first.')
      return
    }
    const fresh = await api().integrity(cwd).catch(() => '')
    if (fresh && baselineSig.current && fresh !== baselineSig.current) {
      const freshStatus = await api().status(cwd).catch(() => null)
      const changed = freshStatus ? changedPaths(status, freshStatus) : []
      setGuard({ push, changed })
      return
    }
    await doCommit(push)
  }

  async function doCommit(push = false) {
    if (!cwd) return
    if (!message.trim() && !amend) {
      toast('err', 'Write a commit message first.')
      return
    }
    const active = coauthors.filter((c) => c.enabled)
    await run(
      () => A.commit(cwd, message, active, amend),
      `Committed${active.length ? ` with ${active.length} co-author(s)` : ''}.`
    )
    // Immediately verify the commit we just wrote wasn't rewritten by a hook.
    const tamper = await api().commitTamperCheck(cwd).catch(() => ({ injected: [], dropped: [] }))
    if (tamper.injected.length) {
      toast('err', `Warning: HEAD gained a co-author you didn't add (${tamper.injected.map((c) => c.name).join(', ')}). A hook or tool modified your commit.`)
    } else if (tamper.dropped.length) {
      toast('err', `Warning: a co-author you added was stripped from HEAD (${tamper.dropped.map((c) => c.name).join(', ')}).`)
    }
    setMessage('')
    setAmend(false)
    setShowReview(false)
    if (push) await pushWithGuard()
    refresh()
  }

  // Every push goes through here so the optional secret scan always applies.
  async function pushWithGuard() {
    if (!cwd) return
    // Block if a co-author was slipped onto an unpushed commit outside Hydrodam.
    const injected = await api().pushCoauthorGuard(cwd).catch(() => [])
    if (injected.length > 0) {
      setCoauthorGuard(injected)
      refresh()
      return
    }
    if (settings.secretScanOnPush) {
      const findings = await api().secretScan(cwd).catch(() => [])
      if (findings.length > 0) {
        const list = findings
          .slice(0, 5)
          .map((f) => `${f.kind}: ${f.snippet}${f.file ? `  (${f.file})` : ''}`)
          .join('\n')
        const ok = await confirmDialog({
          title: 'Possible secrets in this push',
          danger: true,
          message: `${findings.length} secret-looking string${findings.length === 1 ? '' : 's'} found in the outgoing commits.`,
          detail: `${list}\n\nPushing publishes these to the remote. Push anyway?`,
          confirmLabel: 'Push anyway',
          cancelLabel: 'Cancel push'
        })
        if (!ok) {
          toast('info', 'Push cancelled. Amend or rebase the commits to remove the secret.')
          return
        }
      }
    }
    await run(() => A.push(cwd, !status?.upstream, status?.branch ?? '').then(() => refresh()), 'Pushed.')
  }

  async function doUndo() {
    if (!cwd) return
    const ok = await confirmDialog({
      title: 'Undo last commit',
      message: 'Undo the last commit?',
      detail: 'Its changes are kept staged so you can recommit.',
      confirmLabel: 'Undo commit',
      cancelLabel: 'Cancel'
    })
    if (ok) {
      run(() => A.undoCommit(cwd).then(() => refresh()), 'Last commit undone (changes kept staged).').then(
        () => setShowReview(false)
      )
    }
  }

  const stagedCount = status?.files.filter((f) => f.staged && !f.conflicted).length ?? 0
  const conflictCount = status?.files.filter((f) => f.conflicted).length ?? 0
  const activeCo = coauthors.filter((c) => c.enabled)
  const aiAvailable = !!settings.anthropicApiKey.trim()

  // Offer the resolver (and AI) the moment conflicts first appear.
  useEffect(() => {
    if (conflictCount > 0 && prevConflicts.current === 0 && !showConflicts) {
      setConflictPrompt(conflictCount)
    }
    prevConflicts.current = conflictCount
  }, [conflictCount, showConflicts])

  // Total staged +/- lines, for the commit-zone summary.
  const stagedTotals = useMemo(() => {
    let add = 0
    let del = 0
    for (const e of numstat?.staged ?? []) {
      if (e.add > 0) add += e.add
      if (e.del > 0) del += e.del
    }
    return { add, del }
  }, [numstat])

  const startLeftSplit = (e: React.MouseEvent) => {
    e.preventDefault()
    const startX = e.clientX
    const startW = leftW
    const move = (ev: MouseEvent) => setLeftW(Math.min(Math.max(220, startW + ev.clientX - startX), 560))
    const up = () => {
      window.removeEventListener('mousemove', move)
      window.removeEventListener('mouseup', up)
    }
    window.addEventListener('mousemove', move)
    window.addEventListener('mouseup', up)
  }

  const startCommitSplit = (e: React.MouseEvent) => {
    e.preventDefault()
    const startX = e.clientX
    const startW = commitW
    // Dragging left grows the commit zone (it sits on the right edge).
    const move = (ev: MouseEvent) => setCommitW(Math.min(Math.max(230, startW - (ev.clientX - startX)), 460))
    const up = () => {
      window.removeEventListener('mousemove', move)
      window.removeEventListener('mouseup', up)
    }
    window.addEventListener('mousemove', move)
    window.addEventListener('mouseup', up)
  }

  const doOpen = () =>
    run(async () => {
      const probe = await A.openRepo()
      if (!probe) return
      //Its own repo - open it.
      if (probe.root && !probe.nested) {
        openRepo(probe.root)
        return
      }
      // Inside another repo: open the parent, or make this folder its own repo.
      if (probe.nested && probe.root) {
        const choice = await A.messageBox({
          type: 'question',
          title: 'Open repository',
          message: `"${basename(probe.path)}" is inside an existing repository.`,
          detail:
            `${probe.root}\n\n` +
            `Open that repository, or initialise "${basename(probe.path)}" as its own repository?`,
          buttons: ['Open repository', 'Initialise here', 'Cancel'],
          defaultId: 0,
          cancelId: 2,
          noLink: true
        })
        if (choice === 0) openRepo(probe.root)
        else if (choice === 1) setNewRepo({ initPath: probe.path })
        return
      }
      // Not a git repository at all: offer to initialise it.
      const initialise = await confirmDialog({
        title: 'Initialise repository',
        message: `"${basename(probe.path)}" is not a git repository.`,
        detail: 'Initialise it as a new repository?',
        confirmLabel: 'Initialise',
        cancelLabel: 'Cancel'
      })
      if (initialise) setNewRepo({ initPath: probe.path })
    })

  const doNew = () => setNewRepo({ initPath: null })

  // Respond to native menu actions. Latest handlers kept in a ref so the
  // one-time subscription always calls current closures.
  const nav = useRef({ open: doOpen, new: doNew, settings: () => {}, stash: () => {} })
  nav.current.open = doOpen
  nav.current.new = doNew
  nav.current.settings = () => setShowSettings(true)
  nav.current.stash = () => cwd && setShowStash(true)
  useEffect(
    () =>
      api().onMenu((a) => {
        if (a === 'open-repo') nav.current.open()
        else if (a === 'new-repo') nav.current.new()
        else if (a === 'settings') nav.current.settings()
        else if (a === 'stash') nav.current.stash()
      }),
    []
  )

  if (!splashDone) {
    return <SplashScreen onDone={() => setSplashDone(true)} />
  }

  if (!cwd) {
    return (
      <div className="welcome-bg flex h-full flex-col items-center justify-center gap-8 px-6">
        <div className="text-center">
          {/* The logo artwork carries the wordmark, so no separate title text. */}
          <IconLogo className="mx-auto h-52 w-auto" />
          <div className="mt-4 font-mono text-[13px] text-slate-400">Just a better git tool.</div>
        </div>
        <div className="flex gap-3">
          <button className="btn-accent px-5 py-2.5 text-base" onClick={doOpen}>
            Open repository
          </button>
          <button className="btn-soft px-5 py-2.5 text-base" onClick={doNew}>
            New repository
          </button>
        </div>
        {recent.length > 0 && (
          <div className="w-96">
            <div className="mb-2 text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-600">
              Recent
            </div>
            <div className="space-y-1">
              {recent.map((r) => (
                <button
                  key={r}
                  onClick={() =>
                    run(async () => {
                      const root = await A.validateRepo(r)
                      if (root) {
                        openRepo(root)
                      } else {
                        // Folder is gone or no longer a repo: drop the dead entry.
                        const left = await A.forgetRecentRepo(r).catch(() => null)
                        if (left) setRecent(left)
                        toast('err', 'Repo no longer exists - removed from recent.')
                      }
                    })
                  }
                  className="group flex w-full items-center gap-3 rounded-lg border border-ink-800 bg-ink-900/60 px-3 py-2 text-left transition-colors hover:border-accent/50 hover:bg-ink-850"
                  title={r}
                >
                  <span className="shrink-0 truncate text-sm text-slate-100">{basename(r)}</span>
                  <span className="min-w-0 flex-1 truncate text-xs text-slate-600">{r}</span>
                  <span className="shrink-0 text-[11px] text-accent opacity-0 transition-opacity group-hover:opacity-100">
                    open
                  </span>
                </button>
              ))}
            </div>
          </div>
        )}
        {newRepo && (
          <NewRepoPanel
            initPath={newRepo.initPath}
            toast={(k, t) => toast(k, t)}
            onClose={() => setNewRepo(null)}
            onCreated={(root) => {
              setNewRepo(null)
              openRepo(root)
            }}
          />
        )}
        <Toasts toasts={toasts} />
      </div>
    )
  }

  return (
    <div className="flex h-full flex-col bg-ink-950">
      {/* top bar */}
      <div className="flex items-center gap-2 border-b border-ink-800 bg-ink-900 px-3 py-2">
        <button
          onClick={() => setCwd(null)}
          className="btn-ghost px-2 text-slate-400"
          title="Switch repository"
        >
          <IconHome className="w-4 h-4" />
        </button>
        <div className="font-semibold text-slate-100">{basename(cwd)}</div>

        <div className="relative">
          <button
            className="btn-soft"
            onClick={() => setBranchMenu((v) => !v)}
            title="Switch branches - local ones directly, remote ones get a local tracking branch"
          >
            <IconBranch className="w-4 h-4 text-accent" />
            {status?.branch ?? '...'}
            {status && status.ahead > 0 && <span className="text-good flex items-center gap-1"><IconArrowUp className="w-3 h-3" />{status.ahead}</span>}
            {status && status.behind > 0 && <span className="text-warn flex items-center gap-1"><IconArrowDown className="w-3 h-3" />{status.behind}</span>}
          </button>
          {branchMenu && (
            <div className="absolute left-0 top-full z-30 mt-1 w-60 rounded-lg border border-ink-700 bg-ink-850 py-1 shadow-2xl">
              {branches.map((b) => (
                <button
                  key={b.name}
                  onClick={() =>
                    run(async () => {
                      await A.checkout(cwd, b.name)
                      setBranchMenu(false)
                      refresh()
                    }, `Switched to ${b.name}`)
                  }
                  className={`flex w-full items-center gap-2 px-3 py-1.5 text-left text-sm hover:bg-ink-800 ${
                    b.current ? 'text-accent' : 'text-slate-300'
                  }`}
                >
                  <span className="w-3">{b.current ? <IconCheck className="w-4 h-4" /> : ''}</span>
                  {b.name}
                </button>
              ))}
              {remoteBranches.length > 0 && (
                <>
                  <div className="my-1 border-t border-ink-800" />
                  <div className="px-3 py-1 text-[10px] font-semibold uppercase tracking-wide text-slate-600">
                    Remote only
                  </div>
                  {remoteBranches.map((name) => {
                    const short = name.split('/').slice(1).join('/')
                    return (
                      <button
                        key={name}
                        onClick={() =>
                          run(async () => {
                            await A.checkout(cwd, short)
                            setBranchMenu(false)
                            refresh()
                          }, `Created local ${short} tracking ${name}.`)
                        }
                        title={`Create a local branch "${short}" that tracks ${name} and switch to it`}
                        className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-sm text-info hover:bg-ink-800"
                      >
                        <span className="w-3" />
                        {name}
                      </button>
                    )
                  })}
                </>
              )}
              <div className="my-1 border-t border-ink-800" />
              <button
                onClick={async () => {
                  const name = await promptDialog({
                    title: 'New branch',
                    label: `Branch name (from ${status?.branch || 'HEAD'})`,
                    placeholder: 'feature/my-change',
                    confirmLabel: 'Create'
                  })
                  if (name)
                    run(async () => {
                      await A.createBranch(cwd, name)
                      setBranchMenu(false)
                      refresh()
                    }, `Created ${name}`)
                }}
                className="w-full px-3 py-1.5 text-left text-sm text-slate-400 hover:bg-ink-800"
              >
                + New branch...
              </button>
            </div>
          )}
        </div>

        {conflictCount > 0 && (
          <button
            className="btn bg-bad/20 text-bad hover:bg-bad/30"
            onClick={() => setShowConflicts(true)}
            title="Resolve merge conflicts"
          >
            <IconWarning className="w-4 h-4" /> Resolve {conflictCount} conflict{conflictCount === 1 ? '' : 's'}
          </button>
        )}

        <div className="flex-1" />

        <button
          className="btn-ghost px-2"
          disabled={busy}
          onClick={() => {
            loadIdentity()
            run(() => refresh(), 'Refreshed.')
          }}
          title="Force refresh - re-read the working tree, branches and identity now"
        >
          <IconRefresh className="w-4 h-4" />
        </button>
        <button
          className="btn-ghost"
          disabled={busy}
          onClick={() => run(() => A.fetch(cwd).then(() => refresh()), 'Fetched.')}
          title="Check the remote for new commits without touching your files (git fetch)"
        >
          Fetch
        </button>
        <button
          className="btn-ghost"
          disabled={busy}
          onClick={() => run(() => A.pull(cwd).then(() => refresh()), 'Pulled.')}
          title="Update this branch with the latest changes from the remote (git pull)"
        >
          Pull{status && status.behind > 0 ? <span className="inline-flex items-center gap-0.5 ml-1"><IconArrowDown className="w-3 h-3" />{status.behind}</span> : ''}
        </button>
        {status && status.ahead > 0 && (
          <button
            className="btn-ghost"
            disabled={busy}
            onClick={() => setShowPushPreview(true)}
            title="Review the commits you're about to push, with their co-authors"
          >
            Review
          </button>
        )}
        <button
          className="btn-accent"
          disabled={busy}
          onClick={() => pushWithGuard()}
          title="Upload your local commits to the remote (git push)"
        >
          Push{status && status.ahead > 0 ? <span className="inline-flex items-center gap-0.5 ml-1"><IconArrowUp className="w-3 h-3" />{status.ahead}</span> : ''}
        </button>
      </div>


      {/* in-progress operation (cherry-pick / revert / merge / rebase) */}
      {op && op.kind && (
        <div className="flex items-center gap-3 border-b border-warn/40 bg-warn/10 px-4 py-2 text-sm">
          <span className="font-semibold text-warn">{op.kind} in progress</span>
          <span className="text-slate-300">
            {op.conflicts > 0
              ? `${op.conflicts} conflict${op.conflicts === 1 ? '' : 's'} left to resolve`
              : 'conflicts resolved - ready to continue'}
          </span>
          <div className="flex-1" />
          {op.conflicts > 0 && (
            <button className="btn-soft text-xs" onClick={() => setShowConflicts(true)}>
              Resolve
            </button>
          )}
          <button
            className="btn-accent text-xs"
            disabled={busy || op.conflicts > 0}
            onClick={() => run(() => A.opContinue(cwd, op.kind as string).then(() => refresh()), `${op.kind} continued.`)}
          >
            Continue
          </button>
          {op.kind !== 'merge' && (
            <button
              className="btn-ghost text-xs"
              disabled={busy}
              onClick={() => run(() => A.opSkip(cwd, op.kind as string).then(() => refresh()), 'Skipped.')}
            >
              Skip
            </button>
          )}
          <button
            className="btn-ghost text-xs text-bad"
            disabled={busy}
            onClick={() => run(() => A.opAbort(cwd, op.kind as string).then(() => refresh()), `${op.kind} aborted.`)}
          >
            Abort
          </button>
        </div>
      )}

      {/* body */}
      <div className="flex min-h-0 flex-1">
        {/* nav rail: icon + label, collapsible to icons only */}
        {(() => {
          const expanded = settings.navLabels
          const navBtn = (
            key: string,
            label: string,
            icon: React.ReactNode,
            onClick: () => void,
            active = false,
            badge?: number
          ) => (
            <button
              key={key}
              onClick={onClick}
              title={label}
              className={`relative flex shrink-0 items-center rounded-lg ${
                expanded ? 'h-8 w-full gap-2.5 px-2.5' : 'h-9 w-9 justify-center'
              } ${active ? 'bg-accent/10 text-accent' : 'text-ink-500 hover:bg-ink-750 hover:text-slate-300'}`}
            >
              <span className="shrink-0">{icon}</span>
              {expanded && (
                <span className="min-w-0 flex-1 truncate text-left text-[12px] font-medium">{label}</span>
              )}
              {badge !== undefined && badge > 0 && (
                <span
                  className={
                    expanded
                      ? 'shrink-0 rounded-full bg-accent px-1.5 text-[9px] font-bold text-white'
                      : 'absolute right-0.5 top-0.5 flex h-3.5 min-w-[14px] items-center justify-center rounded-full bg-accent px-0.5 text-[9px] font-bold text-white'
                  }
                >
                  {badge}
                </span>
              )}
            </button>
          )
          const divider = (k: string) => (
            <div key={k} className={`my-1 h-px shrink-0 bg-ink-800 ${expanded ? 'w-full' : 'w-6'}`} />
          )
          return (
            <nav
              className={`flex shrink-0 flex-col gap-0.5 overflow-y-auto border-r border-ink-800 bg-ink-900 p-1.5 ${
                expanded ? 'w-44' : 'w-12 items-center'
              }`}
            >
              <button
                onClick={() => updateSettings({ navLabels: !expanded })}
                title={expanded ? 'Collapse sidebar' : 'Expand sidebar'}
                className={`mb-1 flex h-7 shrink-0 items-center justify-center gap-2 rounded-md bg-accent/15 text-accent hover:bg-accent/25 ${
                  expanded ? 'w-full' : 'w-9'
                }`}
              >
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  {expanded ? <path d="M15.2 5.8L9 12l6.2 6.2"/> : <path d="M8.8 5.8L15 12l-6.2 6.2"/>}
                </svg>
                {expanded && <span className="text-[11px] font-medium">Collapse</span>}
              </button>
              {navBtn(
                'changes',
                'Changes',
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
                  <rect x="3" y="3" width="18" height="18" rx="2"/>
                  <path d="M7 12h10M7 8h7M7 16h5"/>
                </svg>,
                () => setMainTab('diff'),
                mainTab === 'diff',
                status && !status.clean ? status.files.filter((f) => !f.ignored).length : undefined
              )}
              {navBtn(
                'graph',
                'Graph / History',
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
                  <circle cx="12" cy="12" r="9.5"/><path d="M12 6.8V12l3.6 2.2"/>
                </svg>,
                () => setMainTab('graph'),
                mainTab === 'graph'
              )}
              {navBtn('branches', 'Branches', <IconBranch className="w-[18px] h-[18px]" />, () => setShowBranches(true))}
              {navBtn(
                'prs',
                'Pull requests',
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
                  <circle cx="6" cy="6" r="3"/><path d="M6 9v12M21 6H16m0 0l3-3m-3 3l3 3"/>
                  <circle cx="18" cy="18" r="3"/>
                </svg>,
                () => setShowRemote(true)
              )}
              {navBtn('issues', 'Issues', <IconWarning className="w-[18px] h-[18px]" />, () => setShowIssues(true))}
              {divider('d1')}
              {navBtn(
                'stashes',
                'Stashes',
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
                  <path d="M4.2 8.8V20.5h15.6V8.8"/>
                  <rect x="2.2" y="3.5" width="19.6" height="5" rx="0.8"/>
                  <path d="M9.7 12.4h4.6"/>
                </svg>,
                () => setShowStash(true)
              )}
              {navBtn(
                'worktrees',
                'Worktrees',
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
                  <rect x="3" y="3" width="8" height="8" rx="1"/><rect x="13" y="3" width="8" height="8" rx="1"/>
                  <rect x="3" y="13" width="8" height="8" rx="1"/><rect x="13" y="13" width="8" height="8" rx="1"/>
                </svg>,
                () => setShowWorktrees(true)
              )}
              {navBtn(
                'reflog',
                'Undo / Reflog',
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
                  <path d="M2.6 4.4v4.8h4.8"/>
                  <path d="M4.3 14.8a8.2 8.2 0 101.9-8.5L2.6 9.2"/>
                </svg>,
                () => setShowReflog(true)
              )}
              {navBtn(
                'ignore',
                'Ignore rules',
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
                  <circle cx="12" cy="12" r="9.5"/>
                  <path d="M5.4 5.4l13.2 13.2"/>
                </svg>,
                () => setShowExcludes(true)
              )}
              {navBtn(
                'trackers',
                'Trackers',
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
                  <path d="M8.4 6.2h12.4M8.4 12h12.4M8.4 17.8h12.4"/>
                  <path d="M3.4 6.2h.02M3.4 12h.02M3.4 17.8h.02" strokeLinecap="round" strokeWidth="2.4"/>
                </svg>,
                () => setShowTrackers(true)
              )}
              {divider('d2')}
              {(() => {
                const moreItems = [
                  { label: 'Insights', run: () => setShowInsights(true) },
                  { label: 'Workspaces', run: () => setShowWorkspaces(true) },
                  { label: 'New-repo setups', run: () => setShowSetups(true) },
                  { label: 'Signing & keys', run: () => setShowSecurity(true) },
                  { label: 'Submodules', run: () => setShowSubmodules(true) },
                  { label: 'LFS', run: () => setShowLFS(true) },
                  { label: 'Recently discarded', run: () => setShowDiscards(true) },
                  { label: 'Open terminal here', run: () => A.openTerminal(cwd) }
                ]
                return (
                  <>
                    <div className={`relative shrink-0 ${expanded ? 'w-full' : ''}`}>
                      {navBtn(
                        'more',
                        'More',
                        <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor">
                          <circle cx="12" cy="5" r="1.5"/><circle cx="12" cy="12" r="1.5"/><circle cx="12" cy="19" r="1.5"/>
                        </svg>,
                        () => setMoreMenu((v) => !v),
                        moreMenu
                      )}
                      {/* collapsed rail has no room for inline rows; fall back to a flyout */}
                      {moreMenu && !expanded && (
                        <div
                          className="absolute left-full top-0 z-30 ml-1 w-48 rounded-lg border border-ink-700 bg-ink-850 py-1 shadow-2xl"
                          onMouseLeave={() => setMoreMenu(false)}
                        >
                          {moreItems.map((m) => (
                            <button
                              key={m.label}
                              onClick={() => { setMoreMenu(false); m.run() }}
                              className="block w-full px-3 py-1.5 text-left text-sm text-slate-300 hover:bg-ink-800"
                            >
                              {m.label}
                            </button>
                          ))}
                        </div>
                      )}
                    </div>
                    {moreMenu &&
                      expanded &&
                      moreItems.map((m) => (
                        <button
                          key={m.label}
                          onClick={() => { setMoreMenu(false); m.run() }}
                          className="flex h-7 w-full shrink-0 items-center rounded-md pl-9 pr-2.5 text-left text-[12px] text-slate-400 hover:bg-ink-750 hover:text-slate-200"
                        >
                          {m.label}
                        </button>
                      ))}
                  </>
                )
              })()}
              <div className={`mt-auto flex shrink-0 flex-col gap-0.5 ${expanded ? 'w-full' : 'items-center'}`}>
                {navBtn('help', 'Help', <IconHelp className="w-[18px] h-[18px]" />, () => setShowHelp(true))}
                {navBtn('settings', 'Settings', <IconGear className="w-[18px] h-[18px]" />, () => setShowSettings(true))}
              </div>
            </nav>
          )
        })()}

        {/* left: files */}
        <div className="flex shrink-0 flex-col" style={{ width: leftW }}>
          {/* Changes / Tree switch */}
          <div className="flex items-center gap-1 border-b border-ink-800 bg-ink-900 px-2 py-1.5">
            <div className="flex flex-1 gap-1 rounded-lg bg-ink-950 p-0.5">
              <button
                className={`flex-1 rounded-md py-1 text-xs font-medium transition-colors ${
                  leftMode === 'changes' ? 'bg-ink-750 text-white' : 'text-slate-400 hover:text-slate-200'
                }`}
                onClick={() => setLeftMode('changes')}
              >
                Changes
                {status && !status.clean && (
                  <span className="ml-1.5 text-[10px] text-slate-500">
                    {status.files.filter((f) => !f.ignored).length}
                  </span>
                )}
              </button>
              <button
                className={`flex-1 rounded-md py-1 text-xs font-medium transition-colors ${
                  leftMode === 'tree' ? 'bg-ink-750 text-white' : 'text-slate-400 hover:text-slate-200'
                }`}
                onClick={() => setLeftMode('tree')}
              >
                Files
                {treePaths.length > 0 && (
                  <span className="ml-1.5 text-[10px] text-slate-500">{treePaths.length}</span>
                )}
              </button>
            </div>
          </div>

          {leftMode === 'changes' ? (
            status && (
              <FileList
                status={status}
                stats={numstat}
                hidden={hidden}
                selected={selKey}
                treeView={settings.treeView}
                showIgnored={settings.showIgnored}
                onSelect={selectFile}
                onStage={(p) => run(() => A.stage(cwd, p).then(() => refresh()))}
                onUnstage={(p) => run(() => A.unstage(cwd, p).then(() => refresh()))}
                onDiscard={async (f) => {
                  const ok = await confirmDialog({
                    title: f.untracked ? 'Delete untracked file' : 'Discard changes',
                    danger: true,
                    message: f.untracked
                      ? `Delete untracked file ${basename(f.path)} from disk?`
                      : `Discard changes to ${basename(f.path)}?`,
                    detail: f.untracked
                      ? 'This is permanent.'
                      : 'It will be reverted to the last commit. This cannot be undone.',
                    confirmLabel: f.untracked ? 'Delete' : 'Discard',
                    cancelLabel: 'Cancel'
                  })
                  if (ok) run(() => A.discard(cwd, f.path, f.untracked).then(() => refresh()))
                }}
                onUntrack={async (p) => {
                  const ok = await confirmDialog({
                    title: 'Stop tracking file',
                    message: `Stop tracking ${basename(p)}?`,
                    detail: 'The file stays on disk but git will no longer track it.',
                    confirmLabel: 'Untrack',
                    cancelLabel: 'Cancel'
                  })
                  if (ok) run(() => A.untrack(cwd, p).then(() => refresh()), 'Untracked (file kept on disk).')
                }}
                onHide={(p, h) => run(() => A.hide(cwd, p, h).then(() => refresh()), h ? 'Hidden from commits.' : 'Unhidden.')}
                onHistory={(p) => setHistoryPath(p)}
              />
            )
          ) : (
            <RepoTree
              paths={treePaths}
              statusMap={statusMap}
              selected={previewPath}
              onSelect={selectTreeFile}
            />
          )}

          {/* colour key */}
          {settings.showLegend && <Legend onClose={() => updateSettings({ showLegend: false })} />}

        </div>

        {/* left panel splitter */}
        <div
          onMouseDown={startLeftSplit}
          className="w-1 shrink-0 cursor-col-resize bg-ink-800 transition-colors hover:bg-accent/60"
          title="Drag to resize"
        />

        {/* right: diff + meta */}
        <div className="flex min-w-0 flex-1 flex-col bg-ink-900">
          {(() => {
            const trelloTracker = trackers.find((t) => t.type === 'trello' && t.boardId)
            const tabs: { id: 'diff' | 'graph' | 'trello'; label: string }[] = [
              { id: 'diff', label: 'Changes' },
              { id: 'graph', label: 'Graph' }
            ]
            if (trelloTracker) tabs.push({ id: 'trello', label: trelloTracker.label || 'Trello' })
            return (
              <div className="flex border-b border-ink-800 px-4 pt-1 gap-1 flex-shrink-0">
                {tabs.map((t) => (
                  <button
                    key={t.id}
                    className={`px-3 py-1.5 text-xs font-medium border-b-2 -mb-px ${
                      mainTab === t.id ? 'border-accent text-accent' : 'border-transparent text-slate-400 hover:text-slate-200'
                    }`}
                    onClick={() => setMainTab(t.id)}
                  >
                    {t.label}
                  </button>
                ))}
              </div>
            )
          })()}
          {mainTab === 'graph' && (
            <CommitsPanel
              embedded
              cwd={cwd}
              currentBranch={status?.branch ?? ''}
              focusHash={graphFocus ?? undefined}
              toast={(k, t) => toast(k, t)}
              onChanged={() => {
                refresh()
                loadIdentity()
              }}
              onInteractiveRebase={(base) => setRebaseBase(base)}
              aiAvailable={aiAvailable}
              onAi={(title, runFn) => setAiModal({ title, run: runFn })}
            />
          )}
          {mainTab === 'trello' && (() => {
            const trelloTracker = trackers.find((t) => t.type === 'trello' && t.boardId)
            if (!trelloTracker) return null
            return (
              <div className="flex flex-1 min-h-0">
                <TrelloBoardView
                  tracker={trelloTracker}
                  cwd={cwd}
                  toast={(k, t) => toast(k, t)}
                  onBranchCreated={() => { refresh(); setMainTab('diff') }}
                />
              </div>
            )
          })()}
          {mainTab === 'diff' && (previewPath ? (
            <FilePreview cwd={cwd} path={previewPath} toast={(k, t) => toast(k, t)} />
          ) : sel ? (
            <>
              <div className="flex items-center gap-3 border-b border-ink-800 px-4 py-2.5">
                <span className="truncate text-sm font-medium text-slate-100">{sel.file.path}</span>
                <span className="text-[11px] text-slate-500">
                  {sel.staged ? 'staged changes' : sel.file.untracked ? 'new file' : 'working changes'}
                </span>
                <div className="flex shrink-0 gap-0.5 rounded-md bg-ink-950 p-0.5">
                  {(isMarkdown(sel.file.path)
                    ? (['diff', 'file', 'preview'] as const)
                    : (['diff', 'file'] as const)
                  ).map((v) => (
                    <button
                      key={v}
                      onClick={() => setViewTab(v)}
                      className={`rounded px-2 py-0.5 text-[11px] font-medium ${
                        viewTab === v ? 'bg-ink-750 text-white' : 'text-slate-400 hover:text-slate-200'
                      }`}
                    >
                      {v === 'diff' ? 'Diff' : v === 'file' ? 'File' : 'Preview'}
                    </button>
                  ))}
                </div>
                <div className="flex-1" />
                {!sel.file.untracked && (
                  <>
                    <button className="btn-ghost text-xs" onClick={() => setBlamePath(sel.file.path)}>
                      Blame
                    </button>
                    <button className="btn-ghost text-xs" onClick={() => setHistoryPath(sel.file.path)}>
                      History
                    </button>
                    <button className="btn-ghost text-xs" onClick={() => setGraphPath(sel.file.path)}>
                      Graph
                    </button>
                    <button
                      className="btn-ghost text-xs"
                      onClick={() => run(() => A.difftool(cwd, sel.file.path), 'Launched external diff tool.')}
                      title="Open in the configured external diff tool"
                    >
                      Difftool
                    </button>
                    {aiAvailable && (
                      <button
                        className="btn-ghost text-xs"
                        onClick={() =>
                          setAiModal({
                            title: `Explain changes - ${basename(sel.file.path)}`,
                            run: () => A.aiExplainWorking(cwd, sel.file.path)
                          })
                        }
                        title="Explain these changes with AI"
                      >
                        Explain
                      </button>
                    )}
                  </>
                )}
              </div>
              <div className="min-h-0 flex-1 overflow-auto">
                {viewTab !== 'diff' ? (
                  <FileContent
                    cwd={cwd}
                    path={sel.file.path}
                    view={viewTab === 'preview' ? 'preview' : 'code'}
                    editable
                    toast={(k, t) => toast(k, t)}
                    onSaved={() => refresh()}
                  />
                ) : IMAGE_RE.test(sel.file.path) ? (
                  <ImageDiff
                    cwd={cwd}
                    path={sel.file.path}
                    staged={sel.staged}
                    untracked={sel.file.untracked}
                  />
                ) : !sel.file.untracked && diff.includes('@@') ? (
                  <HunkStager
                    cwd={cwd}
                    path={sel.file.path}
                    staged={sel.staged}
                    text={diff}
                    toast={(k, t) => toast(k, t)}
                    onChanged={() => refresh()}
                  />
                ) : (
                  <DiffView text={diff} empty="Binary file or no textual diff." />
                )}
              </div>
              {/* metadata strip */}
              {Object.keys(meta).length > 0 && (
                <div className="flex flex-wrap items-center gap-x-5 gap-y-1 border-t border-ink-800 bg-ink-850 px-4 py-2 text-[11px] text-slate-500">
                  {meta.mode && <span>mode <span className="text-slate-300">{meta.mode}</span></span>}
                  {meta.lastCommit && (
                    <span>
                      last <span className="font-mono text-accent">{meta.lastCommit}</span>{' '}
                      <span className="text-slate-300">{meta.lastSubject}</span>
                    </span>
                  )}
                  {meta.lastAuthor && (
                    <span>
                      by <span className="text-slate-300">{meta.lastAuthor}</span> | {meta.lastDate}
                    </span>
                  )}
                </div>
              )}
            </>
          ) : (
            <div className="flex h-full flex-col items-center justify-center gap-1 text-slate-600">
              <div className="text-sm">Select a file to view its diff.</div>
              <div className="text-xs">
                Switch to <span className="text-slate-400">Files</span> to browse and preview the whole tree.
              </div>
            </div>
          ))}
        </div>

        {/* commit zone splitter */}
        <div
          onMouseDown={startCommitSplit}
          className="w-1 shrink-0 cursor-col-resize bg-ink-800 transition-colors hover:bg-accent/60"
          title="Drag to resize"
        />

        {/* commit zone */}
        <div className="flex shrink-0 flex-col" style={{ width: commitW }}>
          {/* terminal-style header: the signature element */}
          <div className="border-b border-ink-800 bg-ink-900 px-3 py-2.5">
            <div className="mb-1.5 flex items-center font-mono text-[11px]">
              <span className="text-accent">$</span>
              <span className="ml-1.5 text-ink-500">git commit</span>
              <span className="ml-auto text-[10px] text-ink-600">Ctrl+Enter</span>
            </div>
            <button
              onClick={() => setShowIdentity(true)}
              className={`flex w-full items-center gap-0.5 font-mono text-[11px] ${
                identity && !identity.name ? 'text-bad' : 'text-slate-400 hover:text-slate-200'
              }`}
              title="View or change the git identity used for commits here"
            >
              <span className="text-accent mr-0.5">&gt;</span>
              {identity && (identity.name || identity.email) ? (
                <>
                  <span className="font-medium text-slate-100">{identity.name || '(no name)'}</span>
                  <span className="text-ink-600">@</span>
                  <span className="text-slate-400">{basename(cwd)}</span>
                  <span className="ml-1.5 rounded bg-ink-750 px-1 py-px text-[10px] text-ink-500">
                    {identity.hasLocal ? 'repo' : 'global'}
                  </span>
                </>
              ) : (
                <span className="text-bad text-[11px]">identity not set</span>
              )}
              <span className="flex-1" />
              <span className="text-[10px] text-accent">Edit</span>
            </button>
          </div>

          {/* body */}
          <div className="flex flex-1 flex-col gap-2.5 overflow-y-auto p-3">
            {stagedCount > 0 && (
              <div className="flex items-center gap-2 text-[11px] text-slate-500">
                <span className="h-1.5 w-1.5 rounded-full bg-accent" />
                <span>
                  <span className="font-semibold text-accent">{stagedCount}</span>{' '}
                  file{stagedCount === 1 ? '' : 's'} staged
                </span>
                {(stagedTotals.add > 0 || stagedTotals.del > 0) && (
                  <span className="ml-auto font-mono text-[10px]">
                    <span className="text-good">+{stagedTotals.add}</span>{' '}
                    <span className="text-bad">-{stagedTotals.del}</span>
                  </span>
                )}
              </div>
            )}

            {ignoredFiles && (
              <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[10px] text-ink-500">
                <span>excluded:</span>
                {(
                  [
                    ['gitignore', ignoredFiles.gitignore.length],
                    ['local', ignoredFiles.local.length],
                    ['global', ignoredFiles.global.length]
                  ] as const
                ).map(([key, n]) => (
                  <button
                    key={key}
                    className="rounded px-1 hover:bg-ink-750 hover:text-slate-300"
                    onClick={() => setIgnoredDialog(key)}
                  >
                    {key} <span className="font-semibold text-slate-400">{n}</span>
                  </button>
                ))}
              </div>
            )}

            <button
              onClick={() => setShowCoauthors(true)}
              className="flex items-center gap-1.5 rounded-md border border-ink-700/60 bg-ink-900 px-2.5 py-1.5 text-left text-[11px] text-slate-500 hover:border-accent/40 hover:text-slate-300"
            >
              <span className="font-medium shrink-0">Co-authors</span>
              {activeCo.length === 0 ? (
                <span className="flex-1 text-ink-500">none active</span>
              ) : (
                <span className="flex flex-1 flex-wrap gap-1">
                  {activeCo.slice(0, 2).map((c) => (
                    <span key={c.id} className="chip bg-accent/15 text-accent">{c.name}</span>
                  ))}
                  {activeCo.length > 2 && (
                    <span className="chip bg-ink-750 text-slate-400">+{activeCo.length - 2}</span>
                  )}
                </span>
              )}
              <span className="text-[10px] text-accent shrink-0">Manage</span>
            </button>

            <textarea
              value={message}
              onChange={(e) => setMessage(e.target.value)}
              placeholder={`Commit message${stagedCount ? ` (${stagedCount} staged)` : ''}...`}
              rows={4}
              onKeyDown={(e) => {
                if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') attemptCommit(false)
              }}
              className="w-full resize-none rounded-lg border border-ink-700 bg-ink-950 px-3 py-2 text-sm leading-relaxed outline-none focus:border-accent select-text"
            />

            {aiAvailable && (
              <div className="flex gap-1.5">
                {[
                  { label: 'Draft', action: () => run(async () => setMessage(await A.aiCommitMessage(cwd)), 'Drafted.'), title: 'Draft a commit message with AI' },
                  { label: 'Review', action: () => setAiModal({ title: 'AI code review', run: () => A.aiReview(cwd) }), title: 'Review changes with AI' },
                  { label: 'Compose', action: () => setShowComposer(true), title: 'Group changes into logical commits with AI' }
                ].map((b) => (
                  <button
                    key={b.label}
                    className="flex-1 rounded-md border border-ink-700/60 py-1.5 text-[11px] text-slate-500 hover:bg-ink-750 hover:text-slate-200"
                    disabled={busy}
                    onClick={b.action}
                    title={b.title}
                  >
                    {b.label}
                  </button>
                ))}
              </div>
            )}

            <label className="flex cursor-pointer items-center gap-2 text-[11px] text-slate-500">
              <input
                type="checkbox"
                checked={amend}
                onChange={(e) => setAmend(e.target.checked)}
                className="accent-accent"
              />
              Amend last commit
            </label>
          </div>

          {/* footer */}
          <div className="flex flex-col gap-2 border-t border-ink-800 bg-ink-900 p-3">
            <button
              className="w-full rounded-md border border-ink-700/60 py-1.5 text-[11px] text-slate-400 hover:bg-ink-750 hover:text-slate-200 disabled:opacity-40 disabled:pointer-events-none"
              disabled={busy || stagedCount === 0}
              onClick={() => { refresh(); setShowReview(true) }}
              title="Preview exactly what will be committed"
            >
              Preview changes
            </button>
            <div className="flex gap-2">
              <button
                className="btn-accent flex-1 py-2 text-sm font-semibold"
                disabled={busy || (stagedCount === 0 && !amend)}
                onClick={() => attemptCommit(false)}
                title="Record the staged changes in history (git commit)"
              >
                {amend ? 'Amend' : `Commit${stagedCount ? ` ${stagedCount}` : ''}`}
              </button>
              <button
                className="btn-soft px-2.5"
                disabled={busy || (stagedCount === 0 && !amend)}
                onClick={() => attemptCommit(true)}
                title="Commit and push to remote"
              >
                <IconArrowUp className="w-3.5 h-3.5" />
              </button>
            </div>
          </div>
        </div>
      </div>

      {/* bottom status bar */}
      {settings.showOpStatus && (
        <div className="flex h-6 shrink-0 items-center gap-4 border-t border-ink-800 bg-ink-900 px-3 text-[11px] text-ink-500">
          <span className="flex items-center gap-1.5">
            <IconBranch className="w-3 h-3 text-accent" />
            <span className="font-medium text-accent">{status?.branch ?? '...'}</span>
          </span>
          <span className="h-3 w-px bg-ink-700" />
          <span className="flex items-center gap-1">
            <span className="text-info">fetched</span>
            <span className="text-slate-500">{relTime(repoMeta.lastFetch)}</span>
          </span>
          <span className="flex items-center gap-1">
            <span className="text-good">pulled</span>
            <span className="text-slate-500">{relTime(repoMeta.lastPull)}</span>
          </span>
          <span className="flex items-center gap-1">
            <span className="text-accent">pushed</span>
            <span className="text-slate-500">{relTime(repoMeta.lastPush)}</span>
          </span>
          {ignoredFiles && (
            <>
              <span className="h-3 w-px bg-ink-700" />
              {(
                [
                  ['gitignore', ignoredFiles.gitignore, '.gitignore'],
                  ['local', ignoredFiles.local, 'local exclude'],
                  ['global', ignoredFiles.global, 'global exclude']
                ] as const
              ).map(([key, files, label]) => (
                <button
                  key={key}
                  className="rounded px-1 hover:bg-ink-750 hover:text-slate-300"
                  onClick={() => setIgnoredDialog(key)}
                  title={`${label}: ${files.length} ignored file${files.length === 1 ? '' : 's'}`}
                >
                  {label} <span className="font-semibold text-slate-400">{files.length}</span>
                </button>
              ))}
            </>
          )}
          <span className="flex-1" />
          <button
            className={`flex items-center gap-1.5 rounded px-1.5 hover:bg-ink-750 ${
              mcp?.running ? (mcp.dangerous ? 'text-warn' : 'text-good') : 'text-ink-500'
            }`}
            onClick={() => setShowSettings(true)}
            title={
              mcp?.running
                ? `MCP server on ${mcp.url}${mcp.dangerous ? ' (dangerous mode: write tools enabled)' : ' (read-only)'}`
                : 'MCP server is off - enable it in Settings'
            }
          >
            <span className={`h-1.5 w-1.5 rounded-full ${mcp?.running ? (mcp.dangerous ? 'bg-warn' : 'bg-good') : 'bg-ink-600'}`} />
            MCP {mcp?.running ? `:${mcp.port}` : 'off'}
          </button>
        </div>
      )}

      {showCoauthors && (
        <CoauthorPanel
          cwd={cwd}
          coauthors={coauthors}
          onChange={setCoauthors}
          onClose={() => setShowCoauthors(false)}
        />
      )}
      {showPushPreview && (
        <PushPreview
          cwd={cwd}
          upstream={status?.upstream ?? null}
          onPush={() => pushWithGuard()}
          onChanged={() => refresh()}
          toast={toast}
          onClose={() => setShowPushPreview(false)}
        />
      )}
      {coauthorGuard && (
        <CoauthorGuard
          violations={coauthorGuard}
          onReview={() => {
            setCoauthorGuard(null)
            setShowPushPreview(true)
          }}
          onTrust={async () => {
            for (const v of coauthorGuard) await api().trustCommit(cwd, v.hash).catch(() => {})
            setCoauthorGuard(null)
            pushWithGuard()
          }}
          onClose={() => setCoauthorGuard(null)}
        />
      )}
      {historyPath && (
        <HistoryPanel cwd={cwd} path={historyPath} onClose={() => setHistoryPath(null)} />
      )}
      {blamePath && (
        <BlamePanel cwd={cwd} path={blamePath} toast={(k, t) => toast(k, t)} onClose={() => setBlamePath(null)} />
      )}
      {rebaseBase && (
        <InteractiveRebasePanel
          cwd={cwd}
          base={rebaseBase}
          currentBranch={status?.branch ?? ''}
          toast={(k, t) => toast(k, t)}
          onChanged={() => refresh()}
          onClose={() => setRebaseBase(null)}
        />
      )}
      {showBranches && (
        <BranchesPanel
          cwd={cwd}
          currentBranch={status?.branch ?? ''}
          toast={(k, t) => toast(k, t)}
          onChanged={() => refresh()}
          onClose={() => setShowBranches(false)}
        />
      )}
      {showRemote && (
        <RemotePanel
          cwd={cwd}
          currentBranch={status?.branch ?? ''}
          aiAvailable={aiAvailable}
          toast={(k, t) => toast(k, t)}
          onManageAccounts={() => setShowConnections(true)}
          onClose={() => setShowRemote(false)}
        />
      )}
      {showConnections && (
        <ConnectionsPanel toast={(k, t) => toast(k, t)} onClose={() => setShowConnections(false)} />
      )}
      {showIssues && (
        <IssuesPanel
          cwd={cwd}
          toast={(k, t) => toast(k, t)}
          onManageAccounts={() => setShowConnections(true)}
          onChanged={() => refresh()}
          onClose={() => setShowIssues(false)}
        />
      )}
      {showWorktrees && (
        <WorktreesPanel
          cwd={cwd}
          toast={(k, t) => toast(k, t)}
          onChanged={() => refresh()}
          onClose={() => setShowWorktrees(false)}
        />
      )}
      {showReflog && (
        <ReflogPanel
          cwd={cwd}
          currentBranch={status?.branch ?? ''}
          toast={(k, t) => toast(k, t)}
          onChanged={() => {
            refresh()
            loadIdentity()
          }}
          onClose={() => setShowReflog(false)}
        />
      )}
      {showLFS && (
        <LFSPanel
          cwd={cwd}
          toast={(k, t) => toast(k, t)}
          onChanged={() => refresh()}
          onClose={() => setShowLFS(false)}
        />
      )}
      {showTrackers && (
        <TrackersPanel
          cwd={cwd}
          toast={(k, t) => toast(k, t)}
          onChanged={() => refresh()}
          onClose={() => { setShowTrackers(false); refreshTrackers() }}
        />
      )}
      {showSecurity && (
        <SecurityPanel
          cwd={cwd}
          toast={(k, t) => toast(k, t)}
          onChanged={() => {
            refresh()
            loadIdentity()
          }}
          onClose={() => setShowSecurity(false)}
        />
      )}
      {showWorkspaces && (
        <WorkspacesPanel
          cwd={cwd}
          onOpenRepo={(root) => openRepo(root)}
          toast={(k, t) => toast(k, t)}
          onClose={() => setShowWorkspaces(false)}
        />
      )}
      {showInsights && (
        <InsightsPanel cwd={cwd} toast={(k, t) => toast(k, t)} onClose={() => setShowInsights(false)} />
      )}
      {showSetups && <SetupsPanel toast={(k, t) => toast(k, t)} onClose={() => setShowSetups(false)} />}
      {showSubmodules && (
        <SubmodulesPanel
          cwd={cwd}
          toast={(k, t) => toast(k, t)}
          onChanged={() => refresh()}
          onOpenRepo={(root) => openRepo(root)}
          onClose={() => setShowSubmodules(false)}
        />
      )}
      {showPalette && (
        <CommandPalette
          cwd={cwd}
          branches={branches}
          actions={(
            [
              { label: 'Go to Changes', run: () => setMainTab('diff') },
              { label: 'Go to Graph / History', run: () => setMainTab('graph') },
              { label: 'Fetch', run: () => run(() => A.fetch(cwd).then(() => refresh()), 'Fetched.') },
              { label: 'Pull', run: () => run(() => A.pull(cwd).then(() => refresh()), 'Pulled.') },
              { label: 'Push', run: () => pushWithGuard() },
              {
                label: 'New branch...',
                run: async () => {
                  const name = await promptDialog({
                    title: 'New branch',
                    label: `Branch name (from ${status?.branch || 'HEAD'})`,
                    placeholder: 'feature/my-change',
                    confirmLabel: 'Create'
                  })
                  if (name)
                    run(async () => {
                      await A.createBranch(cwd, name)
                      refresh()
                    }, `Created ${name}`)
                }
              },
              { label: 'Branches', run: () => setShowBranches(true) },
              { label: 'Pull requests', run: () => setShowRemote(true) },
              { label: 'Issues', run: () => setShowIssues(true) },
              { label: 'Stashes', run: () => setShowStash(true) },
              { label: 'Worktrees', run: () => setShowWorktrees(true) },
              { label: 'Submodules', run: () => setShowSubmodules(true) },
              { label: 'Reflog / Undo', run: () => setShowReflog(true) },
              { label: 'Ignore rules', run: () => setShowExcludes(true) },
              { label: 'Trackers', run: () => setShowTrackers(true) },
              { label: 'Signing & keys', run: () => setShowSecurity(true) },
              { label: 'LFS', run: () => setShowLFS(true) },
              { label: 'Insights', run: () => setShowInsights(true) },
              { label: 'Workspaces', run: () => setShowWorkspaces(true) },
              { label: 'New-repo setups', run: () => setShowSetups(true) },
              { label: 'Co-authors', run: () => setShowCoauthors(true) },
              { label: 'Commit identity', run: () => setShowIdentity(true) },
              { label: 'Connections', run: () => setShowConnections(true) },
              { label: 'Settings', run: () => setShowSettings(true) },
              { label: 'Open terminal here', run: () => A.openTerminal(cwd) },
              { label: 'Switch repository', run: () => setCwd(null) },
              { label: 'Refresh', run: () => run(() => refresh(), 'Refreshed.') },
              { label: 'Recently discarded', run: () => setShowDiscards(true) },
              { label: 'Help', run: () => setShowHelp(true) },
              { label: 'Show file colour key', run: () => updateSettings({ showLegend: true }) }
            ] as PaletteAction[]
          )}
          onCheckout={(name) =>
            run(async () => {
              await A.checkout(cwd, name)
              refresh()
            }, `Switched to ${name}`)
          }
          onOpenFile={(p) => {
            setMainTab('diff')
            setLeftMode('tree')
            selectTreeFile(p)
          }}
          onOpenCommit={(hash) => {
            setGraphFocus(hash)
            setMainTab('graph')
          }}
          onClose={() => setShowPalette(false)}
        />
      )}
      {graphPath && (
        <CommitsPanel
          cwd={cwd}
          currentBranch={status?.branch ?? ''}
          path={graphPath}
          toast={(k, t) => toast(k, t)}
          onChanged={() => refresh()}
          onInteractiveRebase={(base) => {
            setGraphPath(null)
            setRebaseBase(base)
          }}
          aiAvailable={aiAvailable}
          onAi={(title, runFn) => setAiModal({ title, run: runFn })}
          onClose={() => setGraphPath(null)}
        />
      )}
      {showSettings && (
        <SettingsPanel
          settings={settings}
          onChange={updateSettings}
          onManageAccounts={() => {
            setShowSettings(false)
            setShowConnections(true)
          }}
          onReloaded={() => {
            api().settingsGet().then(setSettings)
            api().coauthorsList().then(setCoauthors)
          }}
          onClose={() => setShowSettings(false)}
        />
      )}
      {showStash && (
        <StashPanel
          cwd={cwd}
          aiAvailable={aiAvailable}
          toast={(k, t) => toast(k, t)}
          onChanged={() => refresh()}
          onClose={() => setShowStash(false)}
        />
      )}
      {showExcludes && (
        <ExcludePanel
          cwd={cwd}
          toast={(k, t) => toast(k, t)}
          onChanged={() => refresh()}
          onClose={() => setShowExcludes(false)}
        />
      )}
      {showIdentity && identity && (
        <IdentityPanel
          cwd={cwd}
          identity={identity}
          toast={(k, t) => toast(k, t)}
          onChanged={loadIdentity}
          onClose={() => setShowIdentity(false)}
        />
      )}
      {showConflicts && (
        <ConflictPanel
          cwd={cwd}
          aiAvailable={aiAvailable}
          autoAi={conflictAutoAi}
          toast={(k, t) => toast(k, t)}
          onResolved={() => refresh()}
          onAi={(title, runFn) => setAiModal({ title, run: runFn })}
          onClose={() => {
            setShowConflicts(false)
            setConflictAutoAi(false)
          }}
        />
      )}
      {conflictPrompt !== null && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm"
          onClick={() => setConflictPrompt(null)}
        >
          <div className="card w-[440px] overflow-hidden shadow-2xl" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center gap-2 border-b border-ink-700/60 px-5 py-3.5">
              <IconWarning className="h-5 w-5 text-warn" />
              <h2 className="text-sm font-semibold text-white">Merge conflicts detected</h2>
            </div>
            <div className="px-5 py-4 text-sm text-slate-300">
              {conflictPrompt} file{conflictPrompt === 1 ? ' needs' : 's need'} a decision before the
              merge can finish.
              {aiAvailable && ' The AI can propose a merged version of each file for you to review.'}
            </div>
            <div className="flex justify-end gap-2 border-t border-ink-700/60 px-5 py-3">
              <button className="btn-ghost text-sm" onClick={() => setConflictPrompt(null)}>
                Later
              </button>
              <button
                className="btn-soft text-sm"
                onClick={() => {
                  setConflictPrompt(null)
                  setShowConflicts(true)
                }}
              >
                Open resolver
              </button>
              {aiAvailable && (
                <button
                  className="btn-accent text-sm"
                  onClick={() => {
                    setConflictPrompt(null)
                    setConflictAutoAi(true)
                    setShowConflicts(true)
                  }}
                >
                  Resolve with AI
                </button>
              )}
            </div>
          </div>
        </div>
      )}
      {showReview && (
        <CommitPreview
          cwd={cwd}
          message={message}
          busy={busy}
          onCommit={(push) => attemptCommit(push)}
          onStash={() => run(() => A.stash(cwd, '').then(() => refresh()), 'Stashed.').then(() => setShowReview(false))}
          onUndo={doUndo}
          onClose={() => setShowReview(false)}
        />
      )}
      {guard && (
        <CommitGuard
          changed={guard.changed}
          onCancel={() => setGuard(null)}
          onReview={() => {
            setGuard(null)
            refresh()
            setLeftMode('changes')
            setShowReview(true)
          }}
          onCommitAnyway={() => {
            const push = guard.push
            setGuard(null)
            doCommit(push)
          }}
        />
      )}
      {aiModal && (
        <AiResultModal title={aiModal.title} run={aiModal.run} onClose={() => setAiModal(null)} />
      )}
      {showComposer && (
        <CommitComposerModal
          cwd={cwd}
          coauthors={activeCo}
          toast={(k, t) => toast(k, t)}
          onApplied={() => refresh()}
          onClose={() => setShowComposer(false)}
        />
      )}
      {newRepo && (
        <NewRepoPanel
          initPath={newRepo.initPath}
          toast={(k, t) => toast(k, t)}
          onClose={() => setNewRepo(null)}
          onCreated={(root) => {
            setNewRepo(null)
            openRepo(root)
          }}
        />
      )}
      {ignoredDialog && ignoredFiles && (
        <IgnoredDialog
          cwd={cwd}
          which={ignoredDialog}
          files={ignoredFiles[ignoredDialog]}
          toast={(k, t) => toast(k, t)}
          onChanged={() => {
            refresh()
            api().excludesListIgnored(cwd).then(setIgnoredFiles).catch(() => {})
          }}
          onManageRules={() => {
            setIgnoredDialog(null)
            setShowExcludes(true)
          }}
          onClose={() => setIgnoredDialog(null)}
        />
      )}
      {showHelp && <HelpPanel onClose={() => setShowHelp(false)} />}
      {showDiscards && (
        <DiscardsPanel
          cwd={cwd}
          toast={(k, t) => toast(k, t)}
          onChanged={() => refresh()}
          onClose={() => setShowDiscards(false)}
        />
      )}
      <Toasts toasts={toasts} />
      <PromptHost />
    </div>
  )
}

function Toasts({ toasts }: { toasts: Toast[] }) {
  return (
    <div className="pointer-events-none fixed bottom-4 right-4 z-[60] flex flex-col gap-2">
      {toasts.map((t) => (
        <div
          key={t.id}
          className={`pointer-events-auto max-w-sm rounded-lg border px-4 py-2.5 text-sm shadow-2xl ${
            t.kind === 'err'
              ? 'border-bad/40 bg-bad/15 text-red-200'
              : t.kind === 'ok'
                ? 'border-good/40 bg-good/15 text-green-200'
                : 'border-ink-700 bg-ink-800 text-slate-200'
          }`}
        >
          {t.text}
        </div>
      ))}
    </div>
  )
}
