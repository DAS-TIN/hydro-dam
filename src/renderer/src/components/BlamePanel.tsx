import React, { useEffect, useState } from 'react'
import { IconClose } from './Icons'
import { api, BlameLine, basename } from '../api'

export default function BlamePanel({
  cwd,
  path,
  toast,
  onClose
}: {
  cwd: string
  path: string
  toast: (kind: 'ok' | 'err' | 'info', text: string) => void
  onClose: () => void
}) {
  const [lines, setLines] = useState<BlameLine[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    setLoading(true)
    api()
      .blame(cwd, path)
      .then(setLines)
      .catch((e) => {
        setLines([])
        toast('err', e?.message || String(e))
      })
      .finally(() => setLoading(false))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cwd, path])

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm" onClick={onClose}>
      <div className="card flex h-[84vh] w-[1040px] flex-col overflow-hidden shadow-2xl" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between border-b border-ink-700/60 px-4 py-2.5">
          <div className="min-w-0">
            <div className="text-xs uppercase tracking-wide text-slate-500">Blame</div>
            <div className="truncate text-sm font-medium text-white">{basename(path)}</div>
          </div>
          <button className="btn-ghost px-2" onClick={onClose} title="Close">
            <IconClose className="w-4 h-4" />
          </button>
        </div>
        <div className="min-h-0 flex-1 overflow-auto bg-ink-900 font-mono text-[12.5px] leading-[1.6] select-text">
          {loading && <div className="p-4 text-sm text-slate-500">Loading...</div>}
          {!loading && lines.length === 0 && (
            <div className="p-4 text-sm text-slate-500">No blame (file may be binary or untracked).</div>
          )}
          {!loading &&
            lines.map((l, i) => {
              const prev = lines[i - 1]
              const sameAsPrev = prev && prev.hash === l.hash
              return (
                <div key={i} className="flex items-start hover:bg-ink-850">
                  <span
                    className="w-[230px] shrink-0 select-none truncate border-r border-ink-800 px-2 text-[11px] text-slate-500"
                    title={`${l.hash} ${l.author} ${l.date}`}
                  >
                    {sameAsPrev ? (
                      <span className="opacity-25">{l.shortHash}</span>
                    ) : (
                      <>
                        <span className="text-accent">{l.shortHash}</span> {l.date}{' '}
                        <span className="text-slate-400">{l.author}</span>
                      </>
                    )}
                  </span>
                  <span className="w-12 shrink-0 select-none px-2 text-right text-slate-600">{l.lineNo}</span>
                  <span className="whitespace-pre px-2 text-slate-300">{l.content === '' ? ' ' : l.content}</span>
                </div>
              )
            })}
        </div>
      </div>
    </div>
  )
}
