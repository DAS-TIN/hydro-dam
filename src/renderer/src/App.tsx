import React, { Suspense, lazy, useCallback, useEffect, useMemo, useRef, useState } from 'react'
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
import { RtcState, buildCollabMarks, buildLiveLineMarks, presenceLabel } from './rtc'
import Avatar from './components/Avatar'
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
import { PromptHost, promptDialog } from './components/PromptModal'
import CommitsPanel from './components/CommitsPanel'
import HunkStager from './components/HunkStager'
import ImageDiff from './components/ImageDiff'
import Legend from './components/Legend'
import CommandPalette, { PaletteAction } from './components/CommandPalette'
import ShortcutSheet from './components/ShortcutSheet'
import UltraDock, { ULTRA_ORDER } from './components/UltraDock'
import {
  Region,
  REGION_LABELS,
  SHORTCUTS,
  comboOf,
  findShortcut,
  focusables,
  isTextTarget,
  moveFocusWithin
} from './shortcuts'

// Dialog panels load on first open; none of them are needed to paint the
// main window and together they were most of the bundle.
const CoauthorPanel = lazy(() => import('./components/CoauthorPanel'))
const CoauthorGuard = lazy(() => import('./components/CoauthorGuard'))
const PushPreview = lazy(() => import('./components/PushPreview'))
const HistoryPanel = lazy(() => import('./components/HistoryPanel'))
const BranchesPanel = lazy(() => import('./components/BranchesPanel'))
const RemotePanel = lazy(() => import('./components/RemotePanel'))
const BlamePanel = lazy(() => import('./components/BlamePanel'))
const ConnectionsPanel = lazy(() => import('./components/ConnectionsPanel'))
const InteractiveRebasePanel = lazy(() => import('./components/InteractiveRebasePanel'))
const ReflogPanel = lazy(() => import('./components/ReflogPanel'))
const LFSPanel = lazy(() => import('./components/LFSPanel'))
const TrackersPanel = lazy(() => import('./components/TrackersPanel'))
const TrelloBoardView = lazy(() => import('./components/TrelloBoardView'))
const SecurityPanel = lazy(() => import('./components/SecurityPanel'))
const WorkspacesPanel = lazy(() => import('./components/WorkspacesPanel'))
const InsightsPanel = lazy(() => import('./components/InsightsPanel'))
const SetupsPanel = lazy(() => import('./components/SetupsPanel'))
const AiResultModal = lazy(() => import('./components/AiResultModal'))
const CommitComposerModal = lazy(() => import('./components/CommitComposerModal'))
const WorktreesPanel = lazy(() => import('./components/WorktreesPanel'))
const IssuesPanel = lazy(() => import('./components/IssuesPanel'))
const SettingsPanel = lazy(() => import('./components/SettingsPanel'))
const StashPanel = lazy(() => import('./components/StashPanel'))
const ExcludePanel = lazy(() => import('./components/ExcludePanel'))
const CommitPreview = lazy(() => import('./components/CommitPreview'))
const CommitGuard = lazy(() => import('./components/CommitGuard'))
const IdentityPanel = lazy(() => import('./components/IdentityPanel'))
const ConflictPanel = lazy(() => import('./components/ConflictPanel'))
const NewRepoPanel = lazy(() => import('./components/NewRepoPanel'))
const SubmodulesPanel = lazy(() => import('./components/SubmodulesPanel'))
const HelpPanel = lazy(() => import('./components/HelpPanel'))
const DiscardsPanel = lazy(() => import('./components/DiscardsPanel'))
const IgnoredDialog = lazy(() => import('./components/IgnoredDialog'))
// Compiled out of lite builds; the chunk only exists when __COLLAB__ is true.
const RtcWorkspace = __COLLAB__ ? lazy(() => import('./components/rtc/RtcWorkspace')) : null
const UltraCommit = lazy(() => import('./components/UltraCommit'))
const UltraTop = lazy(() => import('./components/UltraTop'))
const UltraFiles = lazy(() => import('./components/UltraFiles'))
const UltraGraph = lazy(() => import('./components/UltraGraph'))

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

// Tab walks the regions in this order; the first Tab always lands on the rail.
const REGION_ORDER: Region[] = ['rail', 'files', 'main', 'commit', 'topbar']

// Focus marker for a region. Its own overlay element rather than an outline or
// ring on the container: sticky headers and z-indexed children inside the
// panels paint over both of those, but not over a sibling drawn at z-30.
function FocusHalo({ on }: { on: boolean }) {
  if (!on) return null
  return <div className="pointer-events-none absolute inset-0 z-30 border-2 border-accent" />
}

// One in-app undoable operation (stage, unstage, hide...). Git itself is the
// source of truth; undo/redo just replay the inverse command.
type UndoOp = { label: string; undo: () => Promise<unknown>; redo: () => Promise<unknown> }

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
  // Keyboard focus region. kbNav means the user is steering by keyboard right
  // now; the focus rings only show then, so mouse users never see them.
  const [focusRegion, setFocusRegion] = useState<Region>('files')
  const [kbNav, setKbNav] = useState(false)
  const [focusLock, setFocusLock] = useState(false)
  // ultra focus (Ctrl+Shift+Tab): one view takes the whole window
  const [ultra, setUltra] = useState<Region | null>(null)
  const [showCheats, setShowCheats] = useState(false)
  const [undoStack, setUndoStack] = useState<UndoOp[]>([])
  const [redoStack, setRedoStack] = useState<UndoOp[]>([])
  const [undoMenu, setUndoMenu] = useState(false)
  const topRef = useRef<HTMLDivElement | null>(null)
  const railRef = useRef<HTMLElement | null>(null)
  const filesRef = useRef<HTMLDivElement | null>(null)
  const mainRef = useRef<HTMLDivElement | null>(null)
  const commitZoneRef = useRef<HTMLDivElement | null>(null)
  const commitRef = useRef<HTMLTextAreaElement | null>(null)
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
  const [showRtc, setShowRtc] = useState(false)
  // Active collab session, if any, for the ambient UI: the LIVE chip by the
  // toolbar and the per-file marks in the changes list.
  const [rtcLive, setRtcLive] = useState<RtcState | null>(null)
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

  // Debounced so holding an arrow key fires one fetch, not one per row. The
  // seq counter drops stale replies and the old diff stays up while the next
  // renders, otherwise cycling the list flashes and stutters.
  const diffSeq = useRef(0)
  useEffect(() => {
    if (!cwd || !sel) {
      setDiff('')
      setMeta({})
      return
    }
    const { file, staged } = sel
    const seq = ++diffSeq.current
    const t = setTimeout(() => {
      api()
        .fileDiff(cwd, file.path, staged, file.untracked)
        .then((d) => {
          if (seq !== diffSeq.current) return
          React.startTransition(() => setDiff(d))
        })
        .catch((e) => seq === diffSeq.current && setDiff(e.message))
      api()
        .fileMeta(cwd, file.path)
        .then((m) => seq === diffSeq.current && setMeta(m))
        .catch(() => {})
    }, 120)
    return () => clearTimeout(t)
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

  // Track the repo's collab session for the ambient UI. The watcher is kept
  // running so presence and attribution flow with the workspace closed.
  useEffect(() => {
    if (!__COLLAB__ || !cwd) {
      setRtcLive(null)
      return
    }
    let gone = false
    const load = () =>
      api()
        .rtcState(cwd)
        .then((s) => {
          if (gone) return
          setRtcLive(s?.session?.status === 'active' ? s : null)
          if (s?.session?.status === 'active') api().rtcWatchStart(cwd).catch(() => {})
        })
        .catch(() => { if (!gone) setRtcLive(null) })
    load()
    const off = api().onRtcEvent((ev) => { if (ev.cwd === cwd) load() })
    return () => {
      gone = true
      off()
    }
  }, [cwd])

  const collabMarks = useMemo(
    () => (__COLLAB__ && rtcLive ? buildCollabMarks(rtcLive) : null),
    [rtcLive]
  )

  // Selecting a file in the changes list tells the session you are on it,
  // the way an IDE shares your open editor.
  const selPath = sel?.file?.path ?? null

  // Line-level attribution for the selected file, shared by the diff and
  // file views so both colour uncommitted lines by who wrote them.
  const liveMarks = useMemo(
    () => (__COLLAB__ && rtcLive && selPath ? buildLiveLineMarks(rtcLive, selPath) : null),
    [rtcLive, selPath]
  )
  useEffect(() => {
    if (!__COLLAB__ || !cwd || !selPath) return
    const me = rtcLive?.local.activeActorId
    if (me) api().rtcPresence(cwd, me, { activeFiles: [selPath] }).catch(() => {})
  }, [cwd, selPath])

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

  // Shared by the file-list hover button and the Ctrl+D shortcut.
  async function discardFile(f: FileEntry) {
    if (!cwd) return
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
  }

  // In-app undo/redo journal (z / Shift+Z, log in the status bar). Only ops
  // with a safe inverse are recorded: staging, unstaging, hide/unhide.
  const pushOp = (op: UndoOp) => {
    setUndoStack((s) => [...s.slice(-19), op]) // keep the last 20
    setRedoStack([])
  }

  const fileWord = (paths: string[]) =>
    paths.length === 1 ? basename(paths[0]) : `${paths.length} files`

  function stagePaths(paths: string[]) {
    if (!cwd || paths.length === 0) return
    run(() => A.stage(cwd, paths).then(() => refresh()))
    pushOp({
      label: `Stage ${fileWord(paths)}`,
      undo: () => A.unstage(cwd, paths).then(() => refresh()),
      redo: () => A.stage(cwd, paths).then(() => refresh())
    })
  }

  function unstagePaths(paths: string[]) {
    if (!cwd || paths.length === 0) return
    run(() => A.unstage(cwd, paths).then(() => refresh()))
    pushOp({
      label: `Unstage ${fileWord(paths)}`,
      undo: () => A.stage(cwd, paths).then(() => refresh()),
      redo: () => A.unstage(cwd, paths).then(() => refresh())
    })
  }

  function hidePath(path: string, hide: boolean) {
    if (!cwd) return
    run(() => A.hide(cwd, path, hide).then(() => refresh()), hide ? 'Hidden from commits.' : 'Unhidden.')
    pushOp({
      label: `${hide ? 'Hide' : 'Unhide'} ${basename(path)}`,
      undo: () => A.hide(cwd, path, !hide).then(() => refresh()),
      redo: () => A.hide(cwd, path, hide).then(() => refresh())
    })
  }

  const doUndoOp = () => {
    const op = undoStack[undoStack.length - 1]
    if (!op) {
      toast('info', 'Nothing to undo.')
      return
    }
    setUndoStack((s) => s.slice(0, -1))
    setRedoStack((s) => [...s, op])
    run(() => op.undo(), `Undone: ${op.label}`)
  }

  const doRedoOp = () => {
    const op = redoStack[redoStack.length - 1]
    if (!op) {
      toast('info', 'Nothing to redo.')
      return
    }
    setRedoStack((s) => s.slice(0, -1))
    setUndoStack((s) => [...s, op])
    run(() => op.redo(), `Redone: ${op.label}`)
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

  // Keyboard-first navigation (docs/keyboard-shortcuts.md): one window-level
  // dispatcher, contextual single keys, Tab-cycled focus regions. The binding
  // table lives in shortcuts.ts and the "?" sheet renders the same table.

  // Files in the order FileList draws its sections, for arrow-key selection.
  const orderedFiles = useMemo(() => {
    const tracked = (status?.files ?? []).filter((f) => !f.ignored)
    return [
      ...tracked.filter((f) => f.conflicted).map((file) => ({ file, staged: false })),
      ...tracked.filter((f) => f.staged && !f.conflicted).map((file) => ({ file, staged: true })),
      ...tracked.filter((f) => f.unstaged && !f.conflicted).map((file) => ({ file, staged: false })),
      ...tracked.filter((f) => f.untracked).map((file) => ({ file, staged: false }))
    ]
  }, [status])

  const moveSelection = (dir: 1 | -1) => {
    if (orderedFiles.length === 0) return
    const at = orderedFiles.findIndex((e) => e.file.path + (e.staged ? ':staged' : '') === selKey)
    const next =
      at === -1
        ? dir === 1
          ? 0
          : orderedFiles.length - 1
        : Math.min(Math.max(at + dir, 0), orderedFiles.length - 1)
    selectFile(orderedFiles[next].file, orderedFiles[next].staged)
  }

  const toggleStage = () => {
    if (!cwd || !sel) return
    const { file, staged } = sel
    if (staged) unstagePaths([file.path])
    else stagePaths([file.path])
    // Follow the file into its new section so the next toggle flips it back.
    setSel({ file, staged: !staged })
  }

  // Ctrl+1..9 in left-rail order.
  const jumpPanel = (n: number) => {
    ;[
      () => setMainTab('diff'),
      () => setMainTab('graph'),
      () => setShowBranches(true),
      () => setShowRemote(true),
      () => setShowIssues(true),
      () => setShowStash(true),
      () => setShowWorktrees(true),
      () => setShowReflog(true),
      () => setShowExcludes(true)
    ][n - 1]?.()
  }

  const regionEl = (r: Region): HTMLElement | null =>
    r === 'topbar'
      ? topRef.current
      : r === 'rail'
        ? railRef.current
        : r === 'files'
          ? filesRef.current
          : r === 'main'
            ? mainRef.current
            : commitZoneRef.current

  // Close the top-most open dialog; true if one was closed. Ordered so
  // stacked dialogs (settings -> connections) close inner-first.
  const closeTopDialog = () => {
    const closers: [boolean, () => void][] = [
      [showCheats, () => setShowCheats(false)],
      [showPalette, () => setShowPalette(false)],
      [!!ignoredDialog, () => setIgnoredDialog(null)],
      [conflictPrompt !== null, () => setConflictPrompt(null)],
      [!!aiModal, () => setAiModal(null)],
      [showComposer, () => setShowComposer(false)],
      [!!coauthorGuard, () => setCoauthorGuard(null)],
      [!!guard, () => setGuard(null)],
      [showReview, () => setShowReview(false)],
      [showIdentity, () => setShowIdentity(false)],
      [showConnections, () => setShowConnections(false)],
      [showCoauthors, () => setShowCoauthors(false)],
      [showPushPreview, () => setShowPushPreview(false)],
      [!!historyPath, () => setHistoryPath(null)],
      [!!blamePath, () => setBlamePath(null)],
      [!!graphPath, () => setGraphPath(null)],
      [!!rebaseBase, () => setRebaseBase(null)],
      [showBranches, () => setShowBranches(false)],
      [showRemote, () => setShowRemote(false)],
      [showIssues, () => setShowIssues(false)],
      [showWorktrees, () => setShowWorktrees(false)],
      [showReflog, () => setShowReflog(false)],
      [showLFS, () => setShowLFS(false)],
      [showTrackers, () => setShowTrackers(false)],
      [showSecurity, () => setShowSecurity(false)],
      [showWorkspaces, () => setShowWorkspaces(false)],
      [showInsights, () => setShowInsights(false)],
      [showSetups, () => setShowSetups(false)],
      [showSubmodules, () => setShowSubmodules(false)],
      [showStash, () => setShowStash(false)],
      [showExcludes, () => setShowExcludes(false)],
      [showDiscards, () => setShowDiscards(false)],
      [showConflicts, () => { setShowConflicts(false); setConflictAutoAi(false) }],
      [showHelp, () => setShowHelp(false)],
      [showSettings, () => setShowSettings(false)],
      [!!newRepo, () => setNewRepo(null)]
    ]
    const open = closers.find(([on]) => on)
    if (open) open[1]()
    return !!open
  }

  // Same ref trick as `nav` below: one listener, always the current closures.
  const keys = useRef<(e: KeyboardEvent) => void>(() => {})
  keys.current = (e) => {
    if (!cwd) return
    const combo = comboOf(e)
    const inText = isTextTarget(e.target)
    const inCommitBox = e.target === commitRef.current
    // Topmost open dialog, if any (they all render as fixed full-screen overlays).
    const overlay = [...document.querySelectorAll<HTMLElement>('.fixed.inset-0')].pop() ?? null

    if (combo === 'escape') {
      if (branchMenu) { setBranchMenu(false); return }
      if (moreMenu) { setMoreMenu(false); return }
      if (undoMenu) { setUndoMenu(false); return }
      if (closeTopDialog()) return
      if (ultra) { setUltra(null); return }
      if (focusLock) { setFocusLock(false); return }
      if (inCommitBox) {
        // First Esc: out of the message onto the commit buttons; next Esc leaves.
        const els = focusables(commitZoneRef.current)
        const at = els.indexOf(commitRef.current as unknown as HTMLElement)
        commitRef.current?.blur()
        ;(els[at + 1] ?? els[0])?.focus()
        setKbNav(true)
        return
      }
      if (inText) return
      if (kbNav) { setKbNav(false); return }
      if (sel) setSel(null)
      return
    }

    if (combo === 'ctrl+shift+tab') {
      e.preventDefault()
      setKbNav(true)
      // the sidebar has no ultra view of its own; its dock lives at the bottom
      setUltra(ultra ? null : focusRegion === 'rail' ? 'files' : focusRegion)
      return
    }

    if (combo === 'ctrl+tab') {
      if (overlay) return
      e.preventDefault()
      setKbNav(true)
      setFocusLock((v) => !v)
      return
    }

    if (combo === 'tab' || combo === 'shift+tab') {
      if (ultra) {
        // Tab cycles inside the ultra view (wrapping around at the end);
        // Shift+Left/Right switches views. A dialog on top keeps native Tab.
        if (overlay && !overlay.hasAttribute('data-ultra')) return
        e.preventDefault()
        setKbNav(true)
        moveFocusWithin(overlay, e.shiftKey ? -1 : 1, { wrap: true, all: true })
        return
      }
      if (overlay) return // let Tab move focus inside the dialog natively
      if (inText && !inCommitBox) return
      e.preventDefault()
      setKbNav(true)
      const dir = e.shiftKey ? -1 : 1
      if (focusLock) {
        // Locked: Tab reaches every control in the area and wraps around.
        moveFocusWithin(regionEl(focusRegion), dir, { wrap: true, all: true })
        return
      }
      if (!kbNav) {
        setFocusRegion('rail') // keyboard navigation always starts at the sidebar
        return
      }
      const at = REGION_ORDER.indexOf(focusRegion)
      const len = REGION_ORDER.length
      setFocusRegion(REGION_ORDER[(at + dir + len) % len])
      return
    }

    if (combo === 'ctrl+k' || combo === 'ctrl+shift+p') {
      e.preventDefault()
      setShowPalette(true)
      return
    }

    const num = /^ctrl\+([1-9])$/.exec(combo)
    if (num) {
      e.preventDefault()
      jumpPanel(Number(num[1]))
      return
    }

    // Shift+Left/Right hop along the ultra dock without leaving ultra.
    // Works even from the commit message; only a dialog on top blocks it.
    if (ultra && (combo === 'shift+arrowleft' || combo === 'shift+arrowright')) {
      if (overlay && !overlay.hasAttribute('data-ultra')) return
      e.preventDefault()
      setKbNav(true)
      const at = ULTRA_ORDER.indexOf(ultra)
      const len = ULTRA_ORDER.length
      const next = ULTRA_ORDER[(at + (combo === 'shift+arrowright' ? 1 : -1) + len) % len]
      setUltra(next)
      setFocusRegion(next)
      return
    }

    // Up/Down step out of the commit message at its edges, onto the controls.
    if (inCommitBox && (combo === 'arrowup' || combo === 'arrowdown')) {
      const ta = commitRef.current!
      const up = combo === 'arrowup'
      if ((up && ta.selectionStart === 0) || (!up && ta.selectionEnd === ta.value.length)) {
        e.preventDefault()
        setKbNav(true)
        moveFocusWithin(commitZoneRef.current, up ? -1 : 1)
      }
      return
    }

    if (inText) return

    if (combo === '?') {
      e.preventDefault()
      setShowCheats((v) => !v)
      return
    }

    // A dialog is open: arrows rove its controls, everything else stays dead
    // so contextual keys cannot reach the app behind it.
    if (overlay) {
      if (combo === 'arrowdown' || combo === 'arrowup') {
        e.preventDefault()
        moveFocusWithin(overlay, combo === 'arrowdown' ? 1 : -1)
      }
      return
    }

    // Single letters only fire from the app surface itself, not from focused
    // controls inside menus (those sit outside any data-region container).
    const el = e.target instanceof HTMLElement ? e.target : null
    const onSurface = el === document.body || !!el?.closest('[data-region]')
    if (!onSurface) return

    const hit = findShortcut(focusRegion, combo)
    if (!hit) return
    switch (hit.id) {
      case 'files.move': {
        e.preventDefault()
        setKbNav(true)
        const dir = e.key === 'ArrowDown' ? 1 : -1
        if (leftMode === 'changes') {
          moveSelection(dir)
          break
        }
        // Files (tree) view: walk the rows RepoTree currently shows, in order.
        const rows = [...(filesRef.current?.querySelectorAll<HTMLElement>('[data-tree-path]') ?? [])]
        const at = rows.findIndex((r) => r.dataset.treePath === previewPath)
        const next =
          rows[at === -1 ? (dir === 1 ? 0 : rows.length - 1) : Math.min(Math.max(at + dir, 0), rows.length - 1)]
        if (next?.dataset.treePath) selectTreeFile(next.dataset.treePath)
        break
      }
      case 'files.mode':
        e.preventDefault()
        setLeftMode(e.key === 'ArrowRight' ? 'tree' : 'changes')
        break
      case 'files.toggle':
        e.preventDefault()
        toggleStage()
        break
      case 'files.stageAll':
        stagePaths(orderedFiles.filter((x) => !x.staged).map((x) => x.file.path))
        break
      case 'files.unstageAll':
        unstagePaths(orderedFiles.filter((x) => x.staged).map((x) => x.file.path))
        break
      case 'files.open':
        if (sel) {
          setMainTab('diff')
          setViewTab('diff')
          setKbNav(true)
          setFocusRegion('main')
        }
        break
      case 'files.discard':
        e.preventDefault()
        if (sel) discardFile(sel.file)
        break
      case 'files.commitBox':
        e.preventDefault()
        setKbNav(true)
        setFocusRegion('commit')
        break
      case 'main.scroll':
        e.preventDefault()
        if (mainTab === 'diff') {
          mainRef.current
            ?.querySelector('.overflow-auto')
            ?.scrollBy({ top: e.key === 'ArrowDown' ? 60 : -60 })
        } else {
          // graph/board rows are focusable; arrows walk them, Enter opens
          moveFocusWithin(mainRef.current, e.key === 'ArrowDown' ? 1 : -1)
        }
        break
      case 'main.diffmode':
        mainRef.current
          ?.querySelector<HTMLElement>('[data-diff-mode][data-active="false"]')
          ?.click()
        break
      case 'main.tabs': {
        e.preventDefault()
        // With a button in the diff area focused, left/right walk the
        // buttons; otherwise they switch the main tabs.
        if (el?.tagName === 'BUTTON' && mainRef.current?.contains(el)) {
          moveFocusWithin(mainRef.current, e.key === 'ArrowRight' ? 1 : -1)
          break
        }
        const tabs: ('diff' | 'graph' | 'trello')[] = ['diff', 'graph']
        if (trackers.some((t) => t.type === 'trello' && t.boardId)) tabs.push('trello')
        const next = tabs[tabs.indexOf(mainTab) + (e.key === 'ArrowRight' ? 1 : -1)]
        if (next) setMainTab(next)
        break
      }
      case 'main.view':
        if (!sel) break
        e.preventDefault()
        if (e.key === 'd') setViewTab('diff')
        else if (e.key === 'f') setViewTab('file')
        else if (e.key === 'p' && isMarkdown(sel.file.path)) setViewTab('preview')
        break
      case 'main.toggle':
        e.preventDefault()
        toggleStage()
        break
      case 'main.blame':
        if (sel && !sel.file.untracked) setBlamePath(sel.file.path)
        break
      case 'main.history':
        if (sel) setHistoryPath(sel.file.path)
        break
      case 'main.graph':
        if (sel && !sel.file.untracked) setGraphPath(sel.file.path)
        break
      case 'main.difftool':
        if (sel && !sel.file.untracked)
          run(() => A.difftool(cwd, sel.file.path), 'Launched external diff tool.')
        break
      case 'main.reveal':
        if (sel) run(() => A.revealFile(cwd, sel.file.path))
        break
      case 'main.open':
        if (sel) run(() => A.openFile(cwd, sel.file.path))
        break
      case 'undo':
        doUndoOp()
        break
      case 'redo':
        doRedoOp()
        break
      case 'commit.controls':
        e.preventDefault()
        moveFocusWithin(commitZoneRef.current, e.key === 'ArrowDown' ? 1 : -1)
        break
      case 'topbar.move':
        e.preventDefault()
        moveFocusWithin(
          topRef.current,
          e.key === 'ArrowRight' || e.key === 'ArrowDown' ? 1 : -1
        )
        break
      case 'rail.move':
        e.preventDefault()
        moveFocusWithin(railRef.current, e.key === 'ArrowDown' ? 1 : -1)
        break
    }
  }

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => keys.current(e)
    const onMouse = (e: MouseEvent) => {
      setKbNav(false)
      const region = (e.target as HTMLElement | null)
        ?.closest?.('[data-region]')
        ?.getAttribute('data-region') as Region | null
      if (region) setFocusRegion(region)
    }
    window.addEventListener('keydown', onKey)
    window.addEventListener('mousedown', onMouse)
    return () => {
      window.removeEventListener('keydown', onKey)
      window.removeEventListener('mousedown', onMouse)
    }
  }, [])

  // Moving regions by keyboard also moves DOM focus, so typing lands in the
  // commit box and Enter works on the highlighted rail button.
  useEffect(() => {
    if (!kbNav) return
    if (focusRegion === 'commit') {
      commitRef.current?.focus()
      return
    }
    if (document.activeElement === commitRef.current) commitRef.current?.blur()
    if (focusRegion === 'topbar') focusables(topRef.current)[0]?.focus()
    else if (focusRegion === 'rail') railRef.current?.querySelector<HTMLButtonElement>('button')?.focus()
    else if (focusRegion === 'files') filesRef.current?.focus()
    else if (focusRegion === 'main') mainRef.current?.focus()
  }, [focusRegion, kbNav])

  // hint-strip rows, narrowed to what applies to the current selection
  const stripShortcuts = useMemo(() => {
    const needsSel = new Set([
      'files.toggle', 'files.open', 'files.discard',
      'main.view', 'main.toggle', 'main.blame', 'main.history',
      'main.graph', 'main.difftool', 'main.reveal', 'main.open'
    ])
    const trackedOnly = new Set(['main.blame', 'main.graph', 'main.difftool'])
    return SHORTCUTS.filter((s) => s.scope === focusRegion)
      .filter((s) => !(needsSel.has(s.id) && !sel))
      .filter((s) => !(trackedOnly.has(s.id) && sel?.file.untracked))
      .map((s) =>
        s.id === 'main.view' && sel && !isMarkdown(sel.file.path) ? { ...s, display: 'd / f' } : s
      )
  }, [focusRegion, sel])

  // Respond to native menu actions. Latest handlers kept in a ref so the
  // one-time subscription always calls current closures.
  const nav = useRef({
    open: doOpen,
    new: doNew,
    settings: () => {},
    stash: () => {},
    commit: () => {},
    push: () => {},
    pull: () => {},
    fetch: () => {}
  })
  nav.current.open = doOpen
  nav.current.new = doNew
  nav.current.settings = () => setShowSettings(true)
  nav.current.stash = () => cwd && setShowStash(true)
  nav.current.commit = () => cwd && attemptCommit(false)
  nav.current.push = () => cwd && pushWithGuard()
  nav.current.pull = () => cwd && run(() => A.pull(cwd).then(() => refresh()), 'Pulled.')
  nav.current.fetch = () => cwd && run(() => A.fetch(cwd).then(() => refresh()), 'Fetched.')
  useEffect(
    () =>
      api().onMenu((a) => {
        if (a === 'open-repo') nav.current.open()
        else if (a === 'new-repo') nav.current.new()
        else if (a === 'settings') nav.current.settings()
        else if (a === 'stash') nav.current.stash()
        else if (a === 'commit') nav.current.commit()
        else if (a === 'push') nav.current.push()
        else if (a === 'pull') nav.current.pull()
        else if (a === 'fetch') nav.current.fetch()
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
          <Suspense fallback={null}>
            <NewRepoPanel
              initPath={newRepo.initPath}
              toast={(k, t) => toast(k, t)}
              onClose={() => setNewRepo(null)}
              onCreated={(root) => {
                setNewRepo(null)
                openRepo(root)
              }}
            />
          </Suspense>
        )}
        <Toasts toasts={toasts} />
      </div>
    )
  }

  // sidebar entries; railMore is the group behind the More toggle
  interface RailItem {
    key: string
    label: string
    icon: React.ReactNode
    run: () => void
    active?: boolean
    badge?: number
  }
  const railMain: RailItem[] = [
    {
      key: 'changes',
      label: 'Changes',
      icon: (
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
          <rect x="3" y="3" width="18" height="18" rx="2"/>
          <path d="M7 12h10M7 8h7M7 16h5"/>
        </svg>
      ),
      run: () => setMainTab('diff'),
      active: mainTab === 'diff',
      badge: status && !status.clean ? status.files.filter((f) => !f.ignored).length : undefined
    },
    {
      key: 'graph',
      label: 'Graph / History',
      icon: (
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
          <circle cx="12" cy="12" r="9.5"/><path d="M12 6.8V12l3.6 2.2"/>
        </svg>
      ),
      run: () => setMainTab('graph'),
      active: mainTab === 'graph'
    },
    { key: 'branches', label: 'Branches', icon: <IconBranch className="w-[18px] h-[18px]" />, run: () => setShowBranches(true) },
    {
      key: 'prs',
      label: 'Pull requests',
      icon: (
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
          <circle cx="6" cy="6" r="3"/><path d="M6 9v12M21 6H16m0 0l3-3m-3 3l3 3"/>
          <circle cx="18" cy="18" r="3"/>
        </svg>
      ),
      run: () => setShowRemote(true)
    },
    { key: 'issues', label: 'Issues', icon: <IconWarning className="w-[18px] h-[18px]" />, run: () => setShowIssues(true) },
    ...(__COLLAB__
      ? [
          {
            key: 'collab',
            label: 'Live collab',
            icon: (
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
                <circle cx="8" cy="8" r="3"/><circle cx="17" cy="10" r="2.4"/>
                <path d="M2.8 19.5a5.2 5.2 0 0 1 10.4 0M13.6 17.2a4.2 4.2 0 0 1 7.6 2.3"/>
              </svg>
            ),
            run: () => setShowRtc(true),
            active: showRtc
          }
        ]
      : [])
  ]
  const railTools: RailItem[] = [
    {
      key: 'stashes',
      label: 'Stashes',
      icon: (
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
          <path d="M4.2 8.8V20.5h15.6V8.8"/>
          <rect x="2.2" y="3.5" width="19.6" height="5" rx="0.8"/>
          <path d="M9.7 12.4h4.6"/>
        </svg>
      ),
      run: () => setShowStash(true)
    },
    {
      key: 'worktrees',
      label: 'Worktrees',
      icon: (
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
          <rect x="3" y="3" width="8" height="8" rx="1"/><rect x="13" y="3" width="8" height="8" rx="1"/>
          <rect x="3" y="13" width="8" height="8" rx="1"/><rect x="13" y="13" width="8" height="8" rx="1"/>
        </svg>
      ),
      run: () => setShowWorktrees(true)
    },
    {
      key: 'reflog',
      label: 'Undo / Reflog',
      icon: (
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
          <path d="M2.6 4.4v4.8h4.8"/>
          <path d="M4.3 14.8a8.2 8.2 0 101.9-8.5L2.6 9.2"/>
        </svg>
      ),
      run: () => setShowReflog(true)
    },
    {
      key: 'ignore',
      label: 'Ignore rules',
      icon: (
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
          <circle cx="12" cy="12" r="9.5"/>
          <path d="M5.4 5.4l13.2 13.2"/>
        </svg>
      ),
      run: () => setShowExcludes(true)
    },
    {
      key: 'trackers',
      label: 'Trackers',
      icon: (
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
          <path d="M8.4 6.2h12.4M8.4 12h12.4M8.4 17.8h12.4"/>
          <path d="M3.4 6.2h.02M3.4 12h.02M3.4 17.8h.02" strokeLinecap="round" strokeWidth="2.4"/>
        </svg>
      ),
      run: () => setShowTrackers(true)
    }
  ]
  const railMore: RailItem[] = [
    {
      key: 'insights',
      label: 'Insights',
      icon: (
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
          <path d="M5 20v-8M11 20V5M17 20v-11M2.5 20h19"/>
        </svg>
      ),
      run: () => setShowInsights(true)
    },
    {
      key: 'workspaces',
      label: 'Workspaces',
      icon: (
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
          <rect x="3" y="7.5" width="18" height="12.5" rx="2"/>
          <path d="M9 7.5V6a2 2 0 012-2h2a2 2 0 012 2v1.5M3 12.5h18"/>
        </svg>
      ),
      run: () => setShowWorkspaces(true)
    },
    {
      key: 'setups',
      label: 'New-repo setups',
      icon: (
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
          <rect x="3" y="3" width="18" height="18" rx="2"/>
          <path d="M12 8v8M8 12h8"/>
        </svg>
      ),
      run: () => setShowSetups(true)
    },
    {
      key: 'keys',
      label: 'Signing & keys',
      icon: (
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
          <circle cx="8" cy="12" r="3.6"/>
          <path d="M11.6 12H21m-2.8 0v3.4M14.8 12v2.6"/>
        </svg>
      ),
      run: () => setShowSecurity(true)
    },
    {
      key: 'submodules',
      label: 'Submodules',
      icon: (
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
          <rect x="3" y="3" width="12" height="12" rx="1.5"/>
          <rect x="9" y="9" width="12" height="12" rx="1.5"/>
        </svg>
      ),
      run: () => setShowSubmodules(true)
    },
    {
      key: 'lfs',
      label: 'LFS',
      icon: (
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
          <ellipse cx="12" cy="5.6" rx="8" ry="2.8"/>
          <path d="M4 5.6v12.8c0 1.5 3.6 2.8 8 2.8s8-1.3 8-2.8V5.6"/>
          <path d="M4 12c0 1.5 3.6 2.8 8 2.8s8-1.3 8-2.8"/>
        </svg>
      ),
      run: () => setShowLFS(true)
    },
    {
      key: 'discards',
      label: 'Recently discarded',
      icon: (
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
          <path d="M4 7h16M9.2 7V5.2A1.7 1.7 0 0110.9 3.5h2.2a1.7 1.7 0 011.7 1.7V7"/>
          <path d="M6.4 7l.8 12.1a2 2 0 002 1.9h5.6a2 2 0 002-1.9L17.6 7"/>
        </svg>
      ),
      run: () => setShowDiscards(true)
    },
    {
      key: 'terminal',
      label: 'Open terminal here',
      icon: (
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
          <rect x="2.5" y="4" width="19" height="16" rx="2"/>
          <path d="M6.5 9l3.5 3-3.5 3M12.5 15.5H17"/>
        </svg>
      ),
      run: () => A.openTerminal(cwd)
    }
  ]

  return (
    <div className="flex h-full flex-col bg-ink-950">
      {/* top bar */}
      <div
        ref={topRef}
        data-region="topbar"
        className="relative flex items-center gap-2 border-b border-ink-800 bg-ink-900 px-3 py-2"
      >
        <FocusHalo on={kbNav && focusRegion === 'topbar'} />
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

        {__COLLAB__ && rtcLive && (() => {
          const humans = rtcLive.actors.filter((a) => a.type === 'human')
          const bots = rtcLive.actors.filter((a) => a.type === 'agent')
          const who = humans
            .map((h) => {
              const own = bots.filter((b) => b.humanOwnerActorId === h.id).map((b) => b.displayName)
              return h.displayName + (own.length ? ` (AI: ${own.join(', ')})` : '')
            })
            .join('\n')
          return (
            <button
              className="flex items-center gap-2 rounded-md border border-red-500/30 bg-red-500/10 px-2.5 py-1 text-xs text-slate-300 hover:border-red-400/60"
              onClick={() => setShowRtc(true)}
              title={`Live collaboration session\n${who}\n\nClick to open the workspace`}
            >
              <span className="relative flex h-2 w-2">
                <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-red-500 opacity-60" style={{ animationDuration: '2.4s' }} />
                <span className="relative inline-flex h-2 w-2 rounded-full bg-red-500" />
              </span>
              <span className="font-semibold uppercase tracking-wide text-red-300">Live</span>
              <span className="max-w-40 truncate">
                {humans.length <= 2 ? humans.map((h) => h.displayName).join(', ') : `${humans.length} users`}
              </span>
              {bots.length > 0 && (
                <>
                  <span className="text-slate-600">/</span>
                  <span>{bots.length} AI</span>
                </>
              )}
            </button>
          )
        })()}

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


      {/* focus hint strip; only rendered while steering by keyboard */}
      {kbNav && (
        <div className="flex h-7 shrink-0 items-center gap-3 overflow-hidden whitespace-nowrap border-b border-accent/30 bg-accent/10 px-3 text-[11px]">
          <span className="rounded bg-accent px-1.5 py-px text-[10px] font-bold uppercase tracking-wide text-white">
            {REGION_LABELS[focusRegion]} {ultra ? 'ultra' : focusLock ? 'locked' : 'in focus'}
          </span>
          {stripShortcuts.map((s) => (
            <span key={s.id} className="flex items-baseline gap-1 text-slate-400">
              <span className="font-mono text-accent">{s.display}</span>
              {s.short ?? s.label}
            </span>
          ))}
          <span className="flex-1" />
          {!ultra && (
            <span className="text-ink-500">
              <span className="font-mono text-slate-400">Esc</span> {focusLock ? 'unlock' : 'leave focus'}
            </span>
          )}
          <span className="text-ink-500">
            <span className="font-mono text-slate-400">Tab</span> {focusLock ? 'moves inside' : 'next area'}
          </span>
          <span className="text-ink-500">
            <span className="font-mono text-slate-400">Ctrl+Tab</span> {focusLock ? 'unlock' : 'lock'}
          </span>
          <span className="text-ink-500">
            <span className="font-mono text-slate-400">?</span> all shortcuts
          </span>
        </div>
      )}


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
            // the wrapper carries the halo: the nav scrolls, so an absolute
            // overlay inside it would scroll away with the content
            <div className="relative flex shrink-0">
            <nav
              ref={railRef}
              data-region="rail"
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
              {railMain.map((i) => navBtn(i.key, i.label, i.icon, i.run, i.active, i.badge))}
              {divider('d1')}
              {railTools.map((i) => navBtn(i.key, i.label, i.icon, i.run))}
              {divider('d2')}
              {/* the More rows render inline so the rail only grows downwards */}
              {navBtn(
                'more',
                'More',
                <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor">
                  <circle cx="12" cy="5" r="1.5"/><circle cx="12" cy="12" r="1.5"/><circle cx="12" cy="19" r="1.5"/>
                </svg>,
                () => setMoreMenu((v) => !v),
                moreMenu
              )}
              {moreMenu && railMore.map((i) => navBtn(i.key, i.label, i.icon, i.run))}
              <div className={`mt-auto flex shrink-0 flex-col gap-0.5 ${expanded ? 'w-full' : 'items-center'}`}>
                {navBtn('help', 'Help', <IconHelp className="w-[18px] h-[18px]" />, () => setShowHelp(true))}
                {navBtn('settings', 'Settings', <IconGear className="w-[18px] h-[18px]" />, () => setShowSettings(true))}
              </div>
            </nav>
            <FocusHalo on={kbNav && focusRegion === 'rail'} />
            </div>
          )
        })()}

        {/* left: files */}
        <div
          ref={filesRef}
          data-region="files"
          tabIndex={-1}
          className="relative flex shrink-0 flex-col outline-none"
          style={{ width: leftW }}
        >
          <FocusHalo on={kbNav && focusRegion === 'files'} />
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
                collab={collabMarks ?? undefined}
                onSelect={selectFile}
                onStage={stagePaths}
                onUnstage={unstagePaths}
                onDiscard={discardFile}
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
                onHide={hidePath}
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
        <div
          ref={mainRef}
          data-region="main"
          tabIndex={-1}
          className="relative flex min-w-0 flex-1 flex-col bg-ink-900 outline-none"
        >
          <FocusHalo on={kbNav && focusRegion === 'main'} />
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
                <Suspense fallback={<div className="p-4 text-sm text-slate-500">Loading board...</div>}>
                  <TrelloBoardView
                    tracker={trelloTracker}
                    cwd={cwd}
                    toast={(k, t) => toast(k, t)}
                    onBranchCreated={() => { refresh(); setMainTab('diff') }}
                  />
                </Suspense>
              </div>
            )
          })()}
          {mainTab === 'diff' && (previewPath ? (
            <FilePreview cwd={cwd} path={previewPath} toast={(k, t) => toast(k, t)} />
          ) : sel ? (
            <>
              {/* wraps on narrow windows so the action buttons never clip away */}
              <div className="flex flex-wrap items-center gap-x-3 gap-y-1 border-b border-ink-800 px-4 py-2.5">
                <span className="min-w-0 truncate text-sm font-medium text-slate-100">{sel.file.path}</span>
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
                <button
                  className="btn-ghost text-xs"
                  onClick={() => run(() => A.revealFile(cwd, sel.file.path))}
                  title="Show the file in the system file manager (r)"
                >
                  Reveal
                </button>
                <button
                  className="btn-ghost text-xs"
                  onClick={() => run(() => A.openFile(cwd, sel.file.path))}
                  title="Open the file with its default application (o)"
                >
                  Open
                </button>
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
              {/* who else is on this file right now, IDE-style */}
              {__COLLAB__ && collabMarks?.get(sel.file.path) && (() => {
                const m = collabMarks.get(sel.file.path)!
                return (
                  <div className="flex flex-wrap items-center gap-x-4 gap-y-1 border-b border-ink-800 bg-ink-850/60 px-4 py-1.5">
                    {m.actors.map((a) => (
                      <span key={a.id} className="flex items-center gap-1.5 text-[11px]">
                        <Avatar name={a.name} bg={a.bg} size={16} />
                        <span className={`font-medium ${a.text}`}>{a.name}</span>
                        <span className="text-slate-400">{presenceLabel(a)}</span>
                      </span>
                    ))}
                    {m.lock && (
                      <span
                        className={`flex items-center gap-1 text-[11px] ${m.lock.mine ? 'text-amber-300' : 'text-bad'}`}
                        title={m.lock.mine ? 'You hold this lock.' : 'Someone else locked this file - treat it as read-only.'}
                      >
                        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={m.lock.hard ? 2.6 : 1.8} className="h-3 w-3">
                          <rect x="5" y="11" width="14" height="9" rx="2" />
                          <path d="M8 11V7a4 4 0 0 1 8 0v4" />
                        </svg>
                        {m.lock.hard ? 'hard-locked' : 'locked'} by {m.lock.byName}
                        {m.lock.reason ? `: ${m.lock.reason}` : ''}
                        {m.lock.mine ? ' (yours)' : ' - read-only'}
                      </span>
                    )}
                  </div>
                )
              })()}
              <div className="min-h-0 flex-1 overflow-auto">
                {viewTab !== 'diff' ? (
                  <FileContent
                    cwd={cwd}
                    path={sel.file.path}
                    view={viewTab === 'preview' ? 'preview' : 'code'}
                    editable
                    live={liveMarks ?? undefined}
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
                    live={liveMarks ?? undefined}
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
        <div
          ref={commitZoneRef}
          data-region="commit"
          className="relative flex shrink-0 flex-col"
          style={{ width: commitW }}
        >
          <FocusHalo on={kbNav && focusRegion === 'commit'} />
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
                    data-rove-skip // arrow cycling skips these; locked mode (Ctrl+Tab) reaches them
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
                <span className="flex-1 text-ink-500">No co-authors active</span>
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
              ref={commitRef}
              value={message}
              onChange={(e) => setMessage(e.target.value)}
              placeholder={`Commit message${stagedCount ? ` (${stagedCount} staged)` : ''}...`}
              rows={4}
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
          <span className="h-3 w-px bg-ink-700" />
          <div className="relative">
            <button
              className="rounded px-1.5 hover:bg-ink-750 hover:text-slate-300"
              onClick={() => setUndoMenu((v) => !v)}
              title="Undo/redo log for staging operations (z to undo, Shift+Z to redo)"
            >
              undo <span className="font-semibold text-slate-400">{undoStack.length}</span> / redo{' '}
              <span className="font-semibold text-slate-400">{redoStack.length}</span>
            </button>
            {undoMenu && (
              <div
                className="absolute bottom-6 left-0 z-40 w-72 rounded-lg border border-ink-700 bg-ink-850 py-1.5 shadow-2xl"
                onMouseLeave={() => setUndoMenu(false)}
              >
                <div className="flex gap-2 px-3 pb-1.5">
                  <button
                    className="btn-soft flex-1 text-xs"
                    disabled={busy || undoStack.length === 0}
                    onClick={doUndoOp}
                  >
                    Undo (z)
                  </button>
                  <button
                    className="btn-soft flex-1 text-xs"
                    disabled={busy || redoStack.length === 0}
                    onClick={doRedoOp}
                  >
                    Redo (Shift+Z)
                  </button>
                </div>
                <div className="max-h-52 overflow-auto">
                  {undoStack.length === 0 && (
                    <div className="px-3 py-1 text-slate-600">
                      Nothing to undo - stage, unstage or hide something first.
                    </div>
                  )}
                  {[...undoStack].reverse().map((op, i) => (
                    <div key={'u' + i} className="flex items-center px-3 py-1">
                      <span className={i === 0 ? 'text-slate-200' : 'text-slate-500'}>{op.label}</span>
                      {i === 0 && <span className="ml-auto text-[10px] text-accent">next undo</span>}
                    </div>
                  ))}
                  {redoStack.length > 0 && (
                    <>
                      <div className="mt-1 border-t border-ink-800 px-3 pt-1 text-[10px] font-semibold uppercase tracking-wide text-slate-600">
                        Redo
                      </div>
                      {[...redoStack].reverse().map((op, i) => (
                        <div key={'r' + i} className="px-3 py-1 text-slate-500">
                          {op.label}
                        </div>
                      ))}
                    </>
                  )}
                </div>
              </div>
            )}
          </div>
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

      {/* lazy dialog panels */}
      <Suspense fallback={null}>
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
        <BlamePanel
          cwd={cwd}
          path={blamePath}
          live={
            __COLLAB__ && rtcLive
              ? { actors: rtcLive.actors, segments: rtcLive.liveblame ?? [], changes: rtcLive.changes }
              : undefined
          }
          toast={(k, t) => toast(k, t)}
          onClose={() => setBlamePath(null)}
        />
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
      {showRtc && cwd && RtcWorkspace && <RtcWorkspace cwd={cwd} onClose={() => setShowRtc(false)} />}
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
              ...(__COLLAB__ ? [{ label: 'Live collab session', run: () => setShowRtc(true) }] : []),
              { label: 'Commit identity', run: () => setShowIdentity(true) },
              { label: 'Connections', run: () => setShowConnections(true) },
              { label: 'Settings', run: () => setShowSettings(true) },
              { label: 'Open terminal here', run: () => A.openTerminal(cwd) },
              { label: 'Switch repository', run: () => setCwd(null) },
              { label: 'Refresh', run: () => run(() => refresh(), 'Refreshed.') },
              { label: 'Recently discarded', run: () => setShowDiscards(true) },
              { label: 'Undo last operation', hint: 'z', run: doUndoOp },
              { label: 'Redo operation', hint: 'Shift+Z', run: doRedoOp },
              { label: 'Keyboard shortcuts', hint: '?', run: () => setShowCheats(true) },
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
      {showCheats && <ShortcutSheet onClose={() => setShowCheats(false)} />}
      {ultra === 'topbar' && (
        <UltraTop
          cwd={cwd}
          status={status}
          busy={busy}
          onHome={() => {
            setUltra(null)
            setCwd(null)
          }}
          onMainView={() => setUltra(null)}
          onOpenFolder={() => run(() => A.openFile(cwd, '.'))}
          onRefresh={() => {
            loadIdentity()
            run(() => refresh(), 'Refreshed.')
          }}
          onFetch={() => run(() => A.fetch(cwd).then(() => refresh()), 'Fetched.')}
          onPull={() => run(() => A.pull(cwd).then(() => refresh()), 'Pulled.')}
          onReview={() => setShowPushPreview(true)}
          onPush={() => pushWithGuard()}
        />
      )}
      {ultra === 'files' && (
        <UltraFiles
          cwd={cwd}
          statusMap={statusMap}
          onPick={(p) => {
            setUltra(null)
            setMainTab('diff')
            setLeftMode('tree')
            selectTreeFile(p)
          }}
        />
      )}
      {ultra === 'main' && (
        <UltraGraph
          cwd={cwd}
          currentBranch={status?.branch ?? ''}
          trelloTracker={trackers.find((t) => t.type === 'trello' && t.boardId) ?? null}
          aiAvailable={aiAvailable}
          toast={(k, t) => toast(k, t)}
          onChanged={() => {
            refresh()
            loadIdentity()
          }}
          onInteractiveRebase={(base) => setRebaseBase(base)}
          onAi={(title, runFn) => setAiModal({ title, run: runFn })}
          onBranchCreated={() => {
            setUltra(null)
            refresh()
            setMainTab('diff')
          }}
        />
      )}
      {ultra === 'commit' && (
        <UltraCommit
          cwd={cwd}
          status={status}
          identity={identity}
          coauthors={activeCo}
          message={message}
          setMessage={setMessage}
          amend={amend}
          setAmend={setAmend}
          busy={busy}
          stagedCount={stagedCount}
          stagedAdd={stagedTotals.add}
          stagedDel={stagedTotals.del}
          onCommit={(push) => attemptCommit(push)}
          onPreview={() => {
            refresh()
            setShowReview(true)
          }}
          onFetch={() => run(() => A.fetch(cwd).then(() => refresh()), 'Fetched.')}
          onPull={() => run(() => A.pull(cwd).then(() => refresh()), 'Pulled.')}
          onPush={() => pushWithGuard()}
          onCoauthors={() => setShowCoauthors(true)}
          onIdentity={() => setShowIdentity(true)}
        />
      )}
      {showDiscards && (
        <DiscardsPanel
          cwd={cwd}
          toast={(k, t) => toast(k, t)}
          onChanged={() => refresh()}
          onClose={() => setShowDiscards(false)}
        />
      )}
      </Suspense>
      {/* outside the overlays so its buttons stay out of Tab's reach */}
      {ultra && (
        <UltraDock
          current={ultra}
          onPick={(r) => {
            setUltra(r)
            setFocusRegion(r)
          }}
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
