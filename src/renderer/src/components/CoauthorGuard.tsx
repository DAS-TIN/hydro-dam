import { CoauthorViolation } from '../api'
import { IconClose, IconWarning } from './Icons'

function fmt(iso: string): string {
  if (!iso) return 'unknown'
  const d = new Date(iso)
  return isNaN(d.getTime()) ? iso : d.toLocaleString()
}

// Shown when a push is blocked because an unpushed commit gained a co-author
// that wasn't added through Hydrodam - i.e. slipped in after you committed.
export default function CoauthorGuard({
  violations,
  onReview,
  onTrust,
  onClose
}: {
  violations: CoauthorViolation[]
  onReview: () => void
  onTrust: () => void
  onClose: () => void
}) {
  const names = (people: { name: string; email: string }[]) =>
    people.map((c) => c.name + (c.email ? ` <${c.email}>` : '')).join(', ')
  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/70 backdrop-blur-sm">
      <div className="card flex max-h-[86vh] w-[600px] flex-col overflow-hidden border border-bad/50 shadow-2xl">
        <div className="flex items-start gap-3 border-b border-bad/30 bg-bad/10 px-5 py-4">
          <IconWarning className="mt-0.5 h-6 w-6 shrink-0 text-bad" />
          <div className="min-w-0 flex-1">
            <h2 className="text-base font-bold text-bad">STOP - you pressed Push</h2>
            <p className="text-xs text-slate-300">
              Hydrodam detected a last-minute co-author that was NOT added through Hydrodam. Your
              original commit had no co-authors on it. Review and remove it before pushing.
            </p>
          </div>
          <button className="btn-ghost px-2" onClick={onClose} title="Close">
            <IconClose className="w-4 h-4" />
          </button>
        </div>

        <div className="space-y-3 overflow-auto px-5 py-4">
          {violations.map((v) => (
            <div key={v.hash} className="rounded-lg border border-ink-800 bg-ink-900 px-3 py-2.5">
              <div className="flex items-baseline gap-2">
                <span className="font-mono text-[11px] text-accent">{v.shortHash}</span>
                <span className="min-w-0 flex-1 truncate text-sm text-slate-100">{v.subject}</span>
              </div>
              <div className="mt-2 grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-[11px]">
                <span className="text-slate-500">Commit pressed</span>
                <span className="font-mono text-slate-300">{fmt(v.authoredAt)}</span>
                <span className="text-slate-500">Metadata changed</span>
                <span className="font-mono text-warn">{fmt(v.committedAt)}</span>
                {v.coauthors.length > 0 && (
                  <>
                    <span className="text-slate-500">Injected</span>
                    <span className="text-bad">{names(v.coauthors)}</span>
                  </>
                )}
                {v.dropped.length > 0 && (
                  <>
                    <span className="text-slate-500">Removed</span>
                    <span className="text-warn">{names(v.dropped)}</span>
                  </>
                )}
              </div>
            </div>
          ))}
        </div>

        <div className="flex items-center gap-2 border-t border-ink-700/60 px-5 py-3">
          <button
            className="btn-ghost text-xs text-slate-500"
            onClick={onTrust}
            title="These changes are legitimate (e.g. a rebase you did on purpose). Trust and allow the push."
          >
            I made these - trust &amp; push
          </button>
          <div className="flex-1" />
          <button className="btn-ghost" onClick={onClose}>
            Cancel push
          </button>
          <button className="btn-accent" onClick={onReview}>
            Review &amp; remove
          </button>
        </div>
      </div>
    </div>
  )
}
