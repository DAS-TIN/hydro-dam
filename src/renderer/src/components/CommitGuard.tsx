import React from 'react'

export default function CommitGuard({
  changed,
  onReview,
  onCommitAnyway,
  onCancel
}: {
  changed: string[]
  onReview: () => void
  onCommitAnyway: () => void
  onCancel: () => void
}) {
  return (
    <div className="fixed inset-0 z-[70] flex items-center justify-center bg-black/70 backdrop-blur-sm">
      <div className="w-[520px] overflow-hidden rounded-xl border border-bad/50 bg-ink-850 shadow-2xl">
        <div className="flex items-center gap-3 border-b border-bad/30 bg-bad/10 px-5 py-4">
          <span className="text-bad text-lg font-bold">STOP</span>
          <div>
            <h2 className="text-base font-bold text-bad">STOP - changes detected before committing</h2>
            <p className="text-xs text-slate-300">
              The repository changed since you last looked at it.
            </p>
          </div>
        </div>

        <div className="px-5 py-4">
          <p className="mb-3 text-sm text-slate-300">
            Something modified your files between your review and this commit. This is often
            harmless (you or a tool edited a file) - but it can also mean an unexpected or{' '}
            <b className="text-bad">injected change</b> slipped in. Check before you commit.
          </p>

          {changed.length > 0 ? (
            <div className="max-h-40 overflow-auto rounded-lg border border-ink-700 bg-ink-900">
              {changed.map((p) => (
                <div key={p} className="border-b border-ink-850 px-3 py-1.5 text-sm last:border-0">
                  <span className="text-warn font-bold">!</span>{' '}
                  <span className="text-slate-200">{p}</span>
                </div>
              ))}
            </div>
          ) : (
            <div className="rounded-lg border border-ink-700 bg-ink-900 px-3 py-2 text-sm text-slate-400">
              File contents changed (the diff is different from what you reviewed), even though the
              file list looks the same.
            </div>
          )}

          <p className="mt-3 text-xs text-slate-500">
            Could be a false positive - but it's worth a 5-second look.
          </p>
        </div>

        <div className="flex items-center gap-2 border-t border-ink-700/60 bg-ink-900 px-5 py-3">
          <button className="btn-ghost text-xs" onClick={onCancel}>
            Cancel
          </button>
          <div className="flex-1" />
          <button className="btn-accent" onClick={onReview}>
            Review changes
          </button>
          <button
            className="btn text-xs text-bad hover:bg-bad/15"
            onClick={onCommitAnyway}
            title="Ignore the warning and commit what is currently staged"
          >
            Commit anyway
          </button>
        </div>
      </div>
    </div>
  )
}
