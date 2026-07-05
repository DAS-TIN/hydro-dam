import React, { useEffect, useState } from 'react'
import { IconClose } from './Icons'
import { api, LfsInfo } from '../api'

export default function LFSPanel({
  cwd,
  toast,
  onChanged,
  onClose
}: {
  cwd: string
  toast: (kind: 'ok' | 'err' | 'info', text: string) => void
  onChanged: () => void
  onClose: () => void
}) {
  const [info, setInfo] = useState<LfsInfo | null>(null)
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)
  const [pattern, setPattern] = useState('')

  const load = () => {
    setLoading(true)
    api()
      .lfsInfo(cwd)
      .then(setInfo)
      .catch((e) => toast('err', e?.message || String(e)))
      .finally(() => setLoading(false))
  }
  useEffect(load, [cwd])

  const act = async (fn: () => Promise<any>, msg: string) => {
    setBusy(true)
    try {
      await fn()
      toast('ok', msg)
      onChanged()
      load()
    } catch (e: any) {
      toast('err', e?.message || String(e))
    } finally {
      setBusy(false)
    }
  }

  const track = () => {
    if (!pattern.trim()) return
    act(() => api().lfsTrack(cwd, pattern.trim()), `Tracking ${pattern.trim()} with LFS.`).then(() => setPattern(''))
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm" onClick={onClose}>
      <div className="card flex max-h-[88vh] w-[680px] flex-col overflow-hidden shadow-2xl" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between border-b border-ink-700/60 px-5 py-4">
          <div className="flex items-center gap-2">
            <h2 className="text-base font-semibold text-white">Git LFS</h2>
            {info && (
              <span className={`chip ${info.installed ? 'bg-good/20 text-good' : 'bg-bad/20 text-bad'}`}>
                {info.installed ? 'installed' : 'not installed'}
              </span>
            )}
          </div>
          <div className="flex items-center gap-2">
            {info?.installed && (
              <button
                className="btn-soft text-sm"
                disabled={busy}
                onClick={() => act(() => api().lfsPull(cwd), 'LFS objects pulled.')}
              >
                Pull LFS
              </button>
            )}
            <button className="btn-ghost px-2" onClick={onClose} title="Close">
              <IconClose className="w-4 h-4" />
            </button>
          </div>
        </div>

        <div className="overflow-auto px-5 py-4">
          {loading && <div className="text-sm text-slate-500">Loading...</div>}

          {!loading && info && !info.installed && (
            <div className="rounded-lg border border-warn/30 bg-warn/5 px-4 py-6 text-center text-sm text-slate-300">
              git-lfs is not installed. Install it from{' '}
              <button className="text-accent hover:underline" onClick={() => api().openExternal('https://git-lfs.com')}>
                git-lfs.com
              </button>{' '}
              and run <code>git lfs install</code>.
            </div>
          )}

          {!loading && info?.installed && (
            <>
              <div className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-slate-500">
                Track a pattern
              </div>
              <div className="mb-4 flex gap-2">
                <input
                  value={pattern}
                  onChange={(e) => setPattern(e.target.value)}
                  onKeyDown={(e) => e.key === 'Enter' && track()}
                  placeholder="e.g. *.psd, assets/**"
                  className="flex-1 rounded-md border border-ink-700 bg-ink-950 px-3 py-1.5 text-sm outline-none focus:border-accent select-text"
                />
                <button className="btn-accent text-sm" disabled={busy || !pattern.trim()} onClick={track}>
                  Track
                </button>
              </div>

              {info.patterns.length > 0 && (
                <div className="mb-4">
                  <div className="mb-1 text-[11px] font-semibold uppercase tracking-wide text-slate-500">
                    Tracked patterns ({info.patterns.length})
                  </div>
                  <div className="flex flex-wrap gap-1">
                    {info.patterns.map((p) => (
                      <span key={p} className="chip bg-ink-750 font-mono text-slate-300">
                        {p}
                      </span>
                    ))}
                  </div>
                </div>
              )}

              <div className="mb-1 text-[11px] font-semibold uppercase tracking-wide text-slate-500">
                LFS files ({info.files.length})
              </div>
              {info.files.length === 0 ? (
                <div className="rounded-lg border border-dashed border-ink-700 py-6 text-center text-sm text-slate-500">
                  No files are managed by LFS yet.
                </div>
              ) : (
                <div className="space-y-1">
                  {info.files.map((f) => (
                    <div key={f.path} className="flex items-center gap-3 rounded-lg border border-ink-800 bg-ink-900 px-3 py-2">
                      <span
                        className={`w-3 text-center text-xs ${f.present ? 'text-good' : 'text-slate-600'}`}
                        title={f.present ? 'downloaded' : 'pointer only'}
                      >
                        {f.present ? '*' : '-'}
                      </span>
                      <span className="min-w-0 flex-1 truncate text-sm text-slate-200">{f.path}</span>
                      {f.size && <span className="shrink-0 text-[11px] text-slate-500">{f.size}</span>}
                      <span className="shrink-0 font-mono text-[11px] text-slate-600">{f.oid}</span>
                    </div>
                  ))}
                </div>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  )
}
