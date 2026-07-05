import React, { useEffect, useState } from 'react'
import { IconClose } from './Icons'
import { api, Insights } from '../api'

export default function InsightsPanel({
  cwd,
  toast,
  onClose
}: {
  cwd: string
  toast: (kind: 'ok' | 'err' | 'info', text: string) => void
  onClose: () => void
}) {
  const [data, setData] = useState<Insights | null>(null)
  const [loading, setLoading] = useState(true)
  const [languages, setLanguages] = useState<{ name: string; share: number }[]>([])

  useEffect(() => {
    setLoading(true)
    api()
      .insights(cwd)
      .then(setData)
      .catch((e) => toast('err', e?.message || String(e)))
      .finally(() => setLoading(false))
    api().remoteLanguages(cwd).then(setLanguages).catch(() => setLanguages([]))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cwd])

  // A stable-ish colour per language bar segment.
  const LANG_COLORS = ['#7b95ff', '#34d399', '#fbbf24', '#f472b6', '#22d3ee', '#a78bfa', '#fb7185', '#a3e635']

  const maxAuthor = Math.max(1, ...(data?.authors.map((a) => a.count) ?? [1]))
  const maxDay = Math.max(1, ...(data?.days.map((d) => d.count) ?? [1]))

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm" onClick={onClose}>
      <div className="card flex max-h-[88vh] w-[680px] flex-col overflow-hidden shadow-2xl" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between border-b border-ink-700/60 px-5 py-4">
          <div>
            <h2 className="text-base font-semibold text-white">Insights</h2>
            <p className="text-xs text-slate-400">Repository activity and contributors.</p>
          </div>
          <button className="btn-ghost px-2" onClick={onClose} title="Close">
            <IconClose className="w-4 h-4" />
          </button>
        </div>

        <div className="overflow-auto px-5 py-4">
          {loading && <div className="text-sm text-slate-500">Loading...</div>}
          {data && (
            <>
              <div className="mb-4 text-sm text-slate-300">
                <span className="text-2xl font-semibold text-white">{data.total}</span> total commits
              </div>

              <div className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-slate-500">
                Top contributors
              </div>
              <div className="mb-5 space-y-1.5">
                {data.authors.map((a) => (
                  <div key={a.name} className="flex items-center gap-2">
                    <span className="w-40 shrink-0 truncate text-sm text-slate-300">{a.name}</span>
                    <div className="h-3 flex-1 overflow-hidden rounded bg-ink-800">
                      <div className="h-full rounded bg-accent" style={{ width: `${(a.count / maxAuthor) * 100}%` }} />
                    </div>
                    <span className="w-10 shrink-0 text-right text-xs text-slate-500">{a.count}</span>
                  </div>
                ))}
              </div>

              <div className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-slate-500">
                Activity (last 30 days)
              </div>
              {data.days.length === 0 ? (
                <div className="text-sm text-slate-500">No commits in the last 30 days.</div>
              ) : (
                <div className="flex h-28 items-end gap-1">
                  {data.days.map((d) => (
                    <div key={d.date} className="flex flex-1 flex-col items-center justify-end" title={`${d.date}: ${d.count}`}>
                      <div className="w-full rounded-t bg-accent/70" style={{ height: `${(d.count / maxDay) * 100}%` }} />
                    </div>
                  ))}
                </div>
              )}

              {languages.length > 0 && (
                <>
                  <div className="mb-2 mt-5 text-[11px] font-semibold uppercase tracking-wide text-slate-500">
                    Languages (from the remote host)
                  </div>
                  <div className="flex h-3 overflow-hidden rounded-full">
                    {languages.slice(0, 8).map((l, i) => (
                      <div
                        key={l.name}
                        title={`${l.name} ${l.share.toFixed(1)}%`}
                        style={{ width: `${l.share}%`, background: LANG_COLORS[i % LANG_COLORS.length] }}
                      />
                    ))}
                  </div>
                  <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1">
                    {languages.slice(0, 8).map((l, i) => (
                      <span key={l.name} className="flex items-center gap-1.5 text-xs text-slate-400">
                        <span className="h-2 w-2 rounded-full" style={{ background: LANG_COLORS[i % LANG_COLORS.length] }} />
                        {l.name} <span className="text-slate-600">{l.share.toFixed(1)}%</span>
                      </span>
                    ))}
                  </div>
                </>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  )
}
