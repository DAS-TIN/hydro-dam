import React, { useEffect, useState } from 'react'
import { IconClose } from './Icons'
import { api, confirmDialog, BisectState, Commit } from '../api'

export default function BisectPanel({
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
  const [state, setState] = useState<BisectState | null>(null)
  const [recent, setRecent] = useState<Commit[]>([])
  const [good, setGood] = useState('')
  const [bad, setBad] = useState('HEAD')
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)

  const load = () => {
    setLoading(true)
    Promise.all([api().bisectState(cwd), api().log(cwd)])
      .then(([s, log]) => {
        setState(s)
        setRecent(log)
        if (!good && log[1]) setGood(log[1].shortHash)
      })
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

  const start = () => {
    if (!good.trim()) return toast('err', 'Pick a commit you know was good.')
    act(() => api().bisectStart(cwd, good.trim(), bad.trim() || 'HEAD'), 'Bisect started.')
  }

  const mark = (verdict: 'good' | 'bad' | 'skip') =>
    act(() => api().bisectMark(cwd, verdict), `Marked ${verdict}.`)

  const stop = () =>
    confirmDialog({
      title: 'Stop bisect',
      message: 'End the bisect and return to where you were?',
      detail: 'Runs git bisect reset. Any good/bad marks are dropped.',
      confirmLabel: 'Stop'
    }).then((ok) => {
      if (ok) act(() => api().bisectReset(cwd), 'Bisect stopped.')
    })

  const active = state?.active
  const found = state?.firstBad

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm" onClick={onClose}>
      <div className="card flex max-h-[88vh] w-[680px] flex-col overflow-hidden shadow-2xl" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between border-b border-ink-700/60 px-5 py-4">
          <div>
            <h2 className="text-base font-semibold text-white">Bisect</h2>
            <p className="text-xs text-slate-400">Mark commits good or bad to track down the one that introduced a bug.</p>
          </div>
          <div className="flex items-center gap-2">
            {active && (
              <button className="btn-ghost text-sm text-bad" disabled={busy} onClick={stop}>
                Stop bisect
              </button>
            )}
            <button className="btn-ghost px-2" onClick={onClose} title="Close">
              <IconClose className="w-4 h-4" />
            </button>
          </div>
        </div>

        <div className="overflow-auto px-5 py-4">
          {loading && <div className="text-sm text-slate-500">Loading...</div>}

          {!loading && !active && (
            <div className="space-y-4">
              <label className="block">
                <span className="text-xs text-slate-400">Known good (a commit from before the bug)</span>
                <select
                  className="input mt-1 w-full font-mono text-sm"
                  value={good}
                  onChange={(e) => setGood(e.target.value)}
                >
                  {recent.map((c) => (
                    <option key={c.hash} value={c.shortHash}>
                      {c.shortHash} - {c.subject}
                    </option>
                  ))}
                </select>
              </label>
              <label className="block">
                <span className="text-xs text-slate-400">Known bad</span>
                <input
                  className="input mt-1 w-full font-mono text-sm"
                  value={bad}
                  onChange={(e) => setBad(e.target.value)}
                  placeholder="HEAD"
                />
              </label>
              <button className="btn-accent text-sm" disabled={busy} onClick={start}>
                Start bisect
              </button>
            </div>
          )}

          {!loading && active && !found && state?.current && (
            <div className="space-y-4">
              <div className="text-sm text-slate-300">
                <span className="font-medium text-white">{state.remaining}</span> revisions left,
                roughly <span className="font-medium text-white">{state.steps}</span> more{' '}
                {state.steps === 1 ? 'step' : 'steps'}.
              </div>
              <div className="rounded-lg border border-accent/40 bg-accent/5 px-4 py-3">
                <div className="text-xs text-slate-400">Testing now</div>
                <div className="mt-1 flex items-baseline gap-3">
                  <span className="font-mono text-sm text-accent">{state.current.hash}</span>
                  <span className="truncate text-sm text-slate-200">{state.current.subject}</span>
                </div>
                <div className="mt-1 text-[11px] text-slate-500">
                  {state.current.author}, {state.current.relDate}
                </div>
              </div>
              <p className="text-xs text-slate-400">Check out this commit, test it, then tell git how it went.</p>
              <div className="flex gap-2">
                <button className="btn-ghost text-sm text-ok" disabled={busy} onClick={() => mark('good')}>
                  Mark good
                </button>
                <button className="btn-ghost text-sm text-bad" disabled={busy} onClick={() => mark('bad')}>
                  Mark bad
                </button>
                <button className="btn-ghost text-sm" disabled={busy} onClick={() => mark('skip')}>
                  Skip
                </button>
              </div>
            </div>
          )}

          {!loading && found && (
            <div className="space-y-4">
              <div className="rounded-lg border border-bad/40 bg-bad/5 px-4 py-3">
                <div className="text-xs text-bad">First bad commit</div>
                <div className="mt-1 flex items-baseline gap-3">
                  <span className="font-mono text-sm text-white">{found.hash}</span>
                  <span className="truncate text-sm text-slate-200">{found.subject}</span>
                </div>
                <div className="mt-1 text-[11px] text-slate-500">
                  {found.author}, {found.relDate}
                </div>
              </div>
              <button className="btn-accent text-sm" disabled={busy} onClick={stop}>
                Done, stop bisect
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
