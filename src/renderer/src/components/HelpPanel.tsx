import React, { useState } from 'react'
import { IconClose } from './Icons'

interface Section {
  id: string
  title: string
  body: React.ReactNode
}

const P = ({ children }: { children: React.ReactNode }) => (
  <p className="my-2 text-sm leading-relaxed text-slate-300">{children}</p>
)
const K = ({ children }: { children: React.ReactNode }) => (
  <kbd className="rounded border border-ink-700 bg-ink-950 px-1.5 py-px font-mono text-[11px] text-slate-200">
    {children}
  </kbd>
)
const B = ({ children }: { children: React.ReactNode }) => (
  <span className="font-semibold text-slate-100">{children}</span>
)

const SECTIONS: Section[] = [
  {
    id: 'layout',
    title: 'Layout',
    body: (
      <>
        <P>
          Left to right: the <B>sidebar</B> (views and panels), the <B>file panel</B> (Changes or the
          full Files tree), the <B>main pane</B> (Changes / Graph tabs), and the <B>commit zone</B>.
          The bar at the bottom shows branch, sync times, ignore counts, and the MCP server state.
        </P>
        <P>
          <K>Ctrl+P</K> or <K>Ctrl+K</K> opens the command palette: type any command, branch, file, or
          commit message to jump to it. The sidebar collapses with the highlighted arrow at its top.
          Clicking outside a dialog closes it, except in flows where that could lose work (commit
          preview, conflict resolution, new-repo forms).
        </P>
      </>
    )
  },
  {
    id: 'files',
    title: 'File panel',
    body: (
      <>
        <P>
          <B>Changes</B> groups the working tree into Conflicts, Staged, Changes, Untracked, Hidden, and
          Ignored. Each row shows a status letter (A added, M modified, D deleted, R renamed, U
          untracked, ! conflict) and the +/- line counts. Hover a row for actions: stage, unstage,
          history, hide, untrack, discard.
        </P>
        <P>
          <B>Files</B> shows the whole tree. Click a file to preview it; markdown opens rendered, code
          opens in the highlighted viewer with line numbers. Every viewer has an <B>Edit</B> button
          (save with <K>Ctrl+S</K>). Drag the panel's right edge to resize it. The colour key at the
          bottom can be hidden and re-enabled in Settings or via the palette.
        </P>
      </>
    )
  },
  {
    id: 'staging',
    title: 'Diffs and staging',
    body: (
      <>
        <P>
          Selecting a changed file shows its diff. <B>Stage hunk</B> stages one block of changes;
          clicking individual red/green lines selects them so you can stage or unstage just those
          lines. Whatever you leave out simply stays as an uncommitted working change - nothing is
          deleted by selecting or deselecting.
        </P>
        <P>
          The <B>Diff | File | Preview</B> switch shows the same file as a diff, as the full file in
          the editor, or (for markdown) rendered. Unified/Split toggles side-by-side view.
        </P>
      </>
    )
  },
  {
    id: 'graph',
    title: 'Graph and history',
    body: (
      <>
        <P>
          The <B>Graph</B> tab is the commit history with branch lanes. Click a commit to preview it;
          right-click for actions (checkout, branch, tag, cherry-pick, revert, rebase, reset).
        </P>
        <P>
          Drag and drop: drag a <B>branch label onto a commit</B> to move the branch there, onto{' '}
          <B>another branch label</B> to merge or rebase, or drag a <B>commit onto a branch label</B>{' '}
          to cherry-pick it. Dragging a branch onto its own commit does nothing.
        </P>
      </>
    )
  },
  {
    id: 'commit',
    title: 'Commit zone',
    body: (
      <>
        <P>
          The right panel shows who the commit will be attributed to (click to change identity; the
          badge says whether it comes from repo-local or global git config), the active{' '}
          <B>co-authors</B> that will be appended as trailers, the staged file and line counts, and the
          message box (<K>Ctrl+Enter</K> commits).
        </P>
        <P>
          <B>Preview changes</B> shows exactly what will land before you commit. If the working tree
          changed since you last looked, Hydrodam warns instead of committing blindly.
        </P>
      </>
    )
  },
  {
    id: 'branches',
    title: 'Branches, remotes, panels',
    body: (
      <>
        <P>
          The sidebar opens panels for <B>Branches</B> (create, rename, merge, rebase, upstreams),{' '}
          <B>Pull requests</B> and <B>Issues</B> (GitHub/GitLab via Connections), <B>Stashes</B>,{' '}
          <B>Worktrees</B>, <B>Submodules</B>, and the <B>Reflog</B> for recovering lost commits.
        </P>
        <P>
          The issue workflow is built in: filter issues by label, milestone, or yourself, comment or
          close them from the app, and <B>Start branch</B> creates a branch named after the issue.
          When you merge that branch into main with the purple merge button in Branches, Hydrodam
          offers to close the issue with an editable "fixed by" comment. The Pull requests panel also
          shows the latest <B>GitHub Actions</B> runs and can <B>fork</B> the repository to your
          account.
        </P>
        <P>
          <B>Recently discarded</B> (under More) keeps a copy of every file you discard, stored in the
          app's data folder outside the repository, so a discard is never final.
        </P>
      </>
    )
  },
  {
    id: 'ignore',
    title: 'Ignore rules',
    body: (
      <>
        <P>
          Three sources: <B>.gitignore</B> (committed, shared), <B>local exclude</B> (private to this
          clone), and the <B>global exclude</B> (machine-wide). The counts in the status bar open a
          dialog per source where you can see affected files, add patterns, and test whether a path
          would be ignored.
        </P>
        <P>
          <B>Hide from commits</B> on a file row is different: it uses git's assume-unchanged flag so
          local edits stop showing up, without any ignore rule.
        </P>
      </>
    )
  },
  {
    id: 'ai-mcp',
    title: 'AI and MCP',
    body: (
      <>
        <P>
          With an API key (Settings), Hydrodam can draft commit messages, review diffs,
          group changes into commits, explain diffs and conflicts, and suggest conflict resolutions
          (always shown for review before saving).
        </P>
        <P>
          The <B>MCP server</B> (Settings) lets MCP-capable AI tools operate on the focused repo over
          http://127.0.0.1:PORT/mcp. Read-only by default; write tools appear only in dangerous mode.
          Its state shows at the right end of the status bar.
        </P>
      </>
    )
  },
  {
    id: 'keys',
    title: 'Keyboard shortcuts',
    body: (
      <>
        <P>
          <K>Ctrl+P</K> / <K>Ctrl+K</K> command palette. <K>Ctrl+Enter</K> commit. <K>Ctrl+S</K> save in
          the file editor. <K>Ctrl+Shift+N</K> new window. <K>Ctrl+,</K> settings.
        </P>
      </>
    )
  }
]

export default function HelpPanel({ onClose }: { onClose: () => void }) {
  const [active, setActive] = useState(SECTIONS[0].id)
  const section = SECTIONS.find((s) => s.id === active) ?? SECTIONS[0]

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm" onClick={onClose}>
      <div className="card flex h-[76vh] w-[760px] overflow-hidden shadow-2xl" onClick={(e) => e.stopPropagation()}>
        <div className="flex w-48 shrink-0 flex-col border-r border-ink-700/60 bg-ink-900 py-2">
          <div className="px-4 pb-2 pt-1 text-sm font-semibold text-white">Help</div>
          {SECTIONS.map((s) => (
            <button
              key={s.id}
              onClick={() => setActive(s.id)}
              className={`px-4 py-1.5 text-left text-sm ${
                active === s.id ? 'bg-accent/10 text-accent' : 'text-slate-400 hover:bg-ink-850 hover:text-slate-200'
              }`}
            >
              {s.title}
            </button>
          ))}
        </div>
        <div className="flex min-w-0 flex-1 flex-col">
          <div className="flex items-center justify-between border-b border-ink-700/60 px-5 py-3">
            <h2 className="text-sm font-semibold text-white">{section.title}</h2>
            <button className="btn-ghost px-2" onClick={onClose}>
              <IconClose className="w-4 h-4" />
            </button>
          </div>
          <div className="min-h-0 flex-1 overflow-auto px-5 py-3 select-text">{section.body}</div>
        </div>
      </div>
    </div>
  )
}
