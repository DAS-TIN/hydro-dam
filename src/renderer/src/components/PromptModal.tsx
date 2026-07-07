import { useEffect, useRef, useState } from 'react'
import { IconClose } from './Icons'

// Electron disables window.prompt(), so use this instead: an imperative
// text-input dialog. Mount <PromptHost/> once, then call promptDialog() anywhere.
export interface PromptOptions {
  title?: string
  label?: string
  initial?: string
  placeholder?: string
  confirmLabel?: string
}

type Resolver = (value: string | null) => void
let opener: ((opts: PromptOptions) => Promise<string | null>) | null = null

/** Ask the user for one line of text. Resolves to the trimmed value, or null if cancelled. */
export function promptDialog(opts: PromptOptions): Promise<string | null> {
  return opener ? opener(opts) : Promise.resolve(null)
}

export function PromptHost() {
  const [req, setReq] = useState<PromptOptions | null>(null)
  const [value, setValue] = useState('')
  const resolve = useRef<Resolver | null>(null)
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    opener = (opts) =>
      new Promise<string | null>((res) => {
        resolve.current = res
        setValue(opts.initial ?? '')
        setReq(opts)
      })
    return () => {
      opener = null
    }
  }, [])

  useEffect(() => {
    if (req) inputRef.current?.focus()
  }, [req])

  if (!req) return null

  const finish = (result: string | null) => {
    resolve.current?.(result)
    resolve.current = null
    setReq(null)
  }
  const submit = () => {
    const v = value.trim()
    finish(v || null)
  }

  return (
    <div className="fixed inset-0 z-[70] flex items-center justify-center bg-black/60 backdrop-blur-sm">
      <div className="card w-[420px] overflow-hidden shadow-2xl">
        <div className="flex items-center justify-between border-b border-ink-700/60 px-5 py-3.5">
          <h2 className="text-sm font-semibold text-white">{req.title ?? 'Enter a value'}</h2>
          <button className="btn-ghost px-2" onClick={() => finish(null)} title="Cancel">
            <IconClose className="w-4 h-4" />
          </button>
        </div>
        <div className="px-5 py-4">
          {req.label && <div className="mb-1.5 text-xs font-semibold text-slate-400">{req.label}</div>}
          <input
            ref={inputRef}
            value={value}
            onChange={(e) => setValue(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault()
                e.stopPropagation()
                submit()
              } else if (e.key === 'Escape') {
                e.preventDefault()
                e.stopPropagation()
                finish(null)
              }
            }}
            placeholder={req.placeholder}
            className="w-full rounded-md border border-ink-700 bg-ink-950 px-3 py-1.5 text-sm outline-none focus:border-accent"
          />
        </div>
        <div className="flex items-center justify-end gap-2 border-t border-ink-700/60 px-5 py-3">
          <button className="btn-ghost" onClick={() => finish(null)}>
            Cancel
          </button>
          <button className="btn-accent" disabled={!value.trim()} onClick={submit}>
            {req.confirmLabel ?? 'OK'}
          </button>
        </div>
      </div>
    </div>
  )
}
