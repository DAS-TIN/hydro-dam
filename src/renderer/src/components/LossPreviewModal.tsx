import React from 'react'
import { ResetPreview, basename, dirname } from '../api'

// Spells out exactly what a hard reset (or any reset) throws away before the user
// commits to it: the commits it moves past and the tracked changes it discards.
export default function LossPreviewModal({
  target,
  branch,
  preview,
  busy,
  onConfirm,
  onCancel
}: {
  target: string
  branch: string
  preview: ResetPreview
  busy: boolean
  onConfirm: () => void
  onCancel: () => void
}) {
  const { mode, droppedCommits, discardedFiles } = preview
  const lines = discardedFiles.reduce((n, f) => n + Math.max(0, f.add) + Math.max(0, f.del), 0)
  const nothingLost = droppedCommits.length === 0 && discardedFiles.length === 0
  const verb = mode === 'hard' ? 'Discard' : `Reset (${mode})`

  return (
    <div className="fixed inset-0 z-[80] flex items-center justify-center bg-black/70 backdrop-blur-sm" onClick={onCancel}>
      <div
        className="flex max-h-[80vh] w-[560px] flex-col overflow-hidden rounded-xl border border-bad/50 bg-ink-850 shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="border-b border-bad/30 bg-bad/10 px-5 py-4">
          <h2 className="text-base font-bold text-bad">
            {mode === 'hard' ? 'Hard reset' : 'Reset'} {branch} to {target}
          </h2>
          <p className="mt-0.5 text-xs text-slate-300">
            {nothingLost
              ? 'This only moves the branch pointer. Nothing is lost.'
              : mode === 'hard'
                ? "Here's exactly what this throws away."
                : 'The commits below leave the branch, but their changes are kept.'}
          </p>
        </div>

        <div className="min-h-0 flex-1 overflow-auto px-5 py-4">
          {droppedCommits.length > 0 && (
            <div className="mb-4">
              <div className="mb-1.5 text-[11px] font-semibold uppercase tracking-wide text-slate-400">
                {droppedCommits.length} commit{droppedCommits.length === 1 ? '' : 's'} moved past
              </div>
              <div className="max-h-40 overflow-auto rounded-lg border border-ink-700 bg-ink-900">
                {droppedCommits.map((c) => (
                  <div key={c.shortHash} className="flex gap-2 border-b border-ink-850 px-3 py-1.5 text-sm last:border-0">
                    <span className="shrink-0 font-mono text-warn">{c.shortHash}</span>
                    <span className="min-w-0 truncate text-slate-200">{c.subject}</span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {discardedFiles.length > 0 && (
            <div>
              <div className="mb-1.5 text-[11px] font-semibold uppercase tracking-wide text-slate-400">
                {discardedFiles.length} file{discardedFiles.length === 1 ? '' : 's'} reverted
                <span className="ml-1.5 font-mono normal-case text-slate-500">~{lines} lines</span>
              </div>
              <div className="max-h-40 overflow-auto rounded-lg border border-ink-700 bg-ink-900">
                {discardedFiles.map((f) => (
                  <div key={f.path} className="flex items-center gap-2 border-b border-ink-850 px-3 py-1.5 text-sm last:border-0">
                    <span className="min-w-0 flex-1 truncate text-slate-200">
                      {basename(f.path)}
                      <span className="ml-1.5 text-[11px] text-slate-600">{dirname(f.path)}</span>
                    </span>
                    {f.add < 0 ? (
                      <span className="shrink-0 font-mono text-[11px] text-slate-500">bin</span>
                    ) : (
                      <span className="shrink-0 font-mono text-[11px]">
                        <span className="text-good">+{f.add}</span> <span className="text-bad">-{f.del}</span>
                      </span>
                    )}
                  </div>
                ))}
              </div>
            </div>
          )}

          {nothingLost && (
            <div className="rounded-lg border border-ink-700 bg-ink-900 px-3 py-4 text-center text-sm text-slate-400">
              {branch} just moves to {target}. No commits or changes are lost.
            </div>
          )}

          {mode === 'hard' && !nothingLost && (
            <p className="mt-3 text-xs text-slate-500">
              Committed work is still reachable through Undo / Reflog for a while. Untracked files are
              not touched.
            </p>
          )}
        </div>

        <div className="flex items-center gap-2 border-t border-ink-700/60 bg-ink-900 px-5 py-3">
          <button className="btn-ghost text-xs" onClick={onCancel} disabled={busy}>
            Cancel
          </button>
          <div className="flex-1" />
          <button
            className="btn text-xs text-bad hover:bg-bad/15 disabled:opacity-50"
            onClick={onConfirm}
            disabled={busy}
          >
            {busy ? 'Working...' : `${verb} anyway`}
          </button>
        </div>
      </div>
    </div>
  )
}
