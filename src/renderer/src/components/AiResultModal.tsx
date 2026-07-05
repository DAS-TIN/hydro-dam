import React, { useEffect, useState } from 'react'
import { IconClose } from './Icons'

/**
 * Shows the result of a one-shot AI call (explain / review / changelog).
 * Calls run() once on mount.
 */
export default function AiResultModal({
  title,
  run,
  onClose
}: {
  title: string
  run: () => Promise<string>
  onClose: () => void
}) {
  const [text, setText] = useState('')
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [copied, setCopied] = useState(false)

  useEffect(() => {
    let live = true
    run()
      .then((t) => live && setText(t))
      .catch((e) => live && setError(e?.message || String(e)))
      .finally(() => live && setLoading(false))
    return () => {
      live = false
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const copy = () =>
    navigator.clipboard.writeText(text).then(() => {
      setCopied(true)
      setTimeout(() => setCopied(false), 1400)
    })

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/60 backdrop-blur-sm" onClick={onClose}>
      <div className="card flex max-h-[86vh] w-[720px] flex-col overflow-hidden shadow-2xl" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between border-b border-ink-700/60 px-5 py-4">
          <h2 className="text-base font-semibold text-white">{title}</h2>
          <div className="flex items-center gap-2">
            {!loading && !error && (
              <button className="btn-ghost text-xs" onClick={copy}>
                {copied ? 'copied!' : 'copy'}
              </button>
            )}
            <button className="btn-ghost px-2" onClick={onClose} title="Close">
              <IconClose className="w-4 h-4" />
            </button>
          </div>
        </div>
        <div className="min-h-0 flex-1 overflow-auto px-5 py-4">
          {loading && (
            <div className="flex items-center gap-2 text-sm text-slate-400">
              <span className="h-2 w-2 animate-pulse rounded-full bg-accent" /> Asking AI...
            </div>
          )}
          {error && <div className="text-sm text-bad">{error}</div>}
          {!loading && !error && (
            <pre className="whitespace-pre-wrap font-sans text-sm leading-relaxed text-slate-200 select-text">
              {text}
            </pre>
          )}
        </div>
        <div className="border-t border-ink-700/60 px-5 py-2 text-[11px] text-slate-600">
          AI-generated. Review before relying on it.
        </div>
      </div>
    </div>
  )
}
