import React, { useEffect, useMemo, useState } from 'react'
import { api, ExcludeScope, ExcludeSets } from '../api'

type ToastFn = (kind: 'ok' | 'err' | 'info', text: string) => void

const SCOPES: {
  key: ExcludeScope
  title: string
  tag: string
  tagClass: string
  blurb: string
  suggestions: string[]
}[] = [
  {
    key: 'private',
    title: 'Private (this repo only)',
    tag: 'not committed',
    tagClass: 'bg-good/20 text-good',
    blurb:
      'Stored in .git/info/exclude. Never committed or pushed, so nobody who clones the repo sees these. Best for personal clutter the rest of the team does not need.',
    suggestions: ['.idea/', '.vscode/', '.cursor/', '.claude/', 'scratch/', 'NOTES.md']
  },
  {
    key: 'global',
    title: 'Global (all your repos)',
    tag: 'this machine',
    tagClass: 'bg-info/20 text-info',
    blurb:
      'Stored in your global core.excludesFile and applied to every repo on this machine. Also never committed.',
    suggestions: ['.DS_Store', 'Thumbs.db', '.idea/', '.vscode/', '.claude/', '*.local']
  },
  {
    key: 'shared',
    title: 'Shared (.gitignore)',
    tag: 'committed',
    tagClass: 'bg-warn/20 text-warn',
    blurb:
      'Stored in .gitignore and committed, so everyone who clones the repo gets these rules and can see them.',
    suggestions: ['node_modules/', 'dist/', 'build/', '*.log', '.env', 'coverage/']
  }
]

export default function ExcludePanel({
  cwd,
  onChanged,
  onClose,
  toast
}: {
  cwd: string
  onChanged: () => void
  onClose: () => void
  toast: ToastFn
}) {
  const [sets, setSets] = useState<ExcludeSets | null>(null)
  const [inputs, setInputs] = useState<Record<ExcludeScope, string>>({
    private: '',
    global: '',
    shared: ''
  })
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    api()
      .excludesList(cwd)
      .then(setSets)
      .catch((e) => toast('err', e?.message || String(e)))
  }, [cwd, toast])

  const listFor = useMemo(
    () => (scope: ExcludeScope): string[] => (sets ? sets[scope] : []),
    [sets]
  )

  async function mutate(fn: () => Promise<ExcludeSets>) {
    setBusy(true)
    try {
      setSets(await fn())
      onChanged()
    } catch (e: any) {
      toast('err', e?.message || String(e))
    } finally {
      setBusy(false)
    }
  }

  const add = (scope: ExcludeScope, pattern: string) => {
    const pat = pattern.trim()
    if (!pat) return
    setInputs((s) => ({ ...s, [scope]: '' }))
    mutate(() => api().excludesAdd(cwd, scope, pat))
  }

  const remove = (scope: ExcludeScope, pattern: string) =>
    mutate(() => api().excludesRemove(cwd, scope, pattern))

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm" onClick={onClose}>
      <div className="card flex max-h-[88vh] w-[600px] flex-col overflow-hidden shadow-2xl" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between border-b border-ink-700/60 px-5 py-4">
          <h2 className="text-base font-semibold text-white">Ignore rules</h2>
          <button className="btn-ghost text-xs" onClick={onClose}>
            Close
          </button>
        </div>

        <div className="divide-y divide-ink-800 overflow-auto">
          {SCOPES.map((s) => {
            const list = listFor(s.key)
            const open = inputs[s.key]
            const remaining = s.suggestions.filter((x) => !list.includes(x))
            return (
              <div key={s.key} className="px-5 py-4">
                <div className="mb-1 flex items-center gap-2">
                  <span className="text-sm font-semibold text-white">{s.title}</span>
                  <span className={`chip ${s.tagClass}`}>{s.tag}</span>
                </div>
                <p className="mb-3 text-xs text-slate-500">{s.blurb}</p>
                {s.key === 'global' && sets?.globalPath && (
                  <p className="mb-3 truncate text-[11px] text-slate-600" title={sets.globalPath}>
                    File: <code className="text-slate-400">{sets.globalPath}</code>
                  </p>
                )}

                {/* current patterns */}
                <div className="mb-3 flex flex-wrap gap-1.5">
                  {list.length === 0 && <span className="text-xs text-slate-600">No patterns yet.</span>}
                  {list.map((p) => (
                    <span
                      key={p}
                      className="inline-flex items-center gap-1.5 rounded-md border border-ink-700 bg-ink-850 py-1 pl-2.5 pr-1.5 text-xs text-slate-200"
                    >
                      <code>{p}</code>
                      <button
                        className="rounded px-1 text-slate-500 hover:bg-bad/20 hover:text-bad"
                        disabled={busy}
                        title="Remove"
                        onClick={() => remove(s.key, p)}
                      >
                        x
                      </button>
                    </span>
                  ))}
                </div>

                {/* add a pattern */}
                <div className="flex gap-2">
                  <input
                    value={open}
                    placeholder="e.g. .vscode/ or *.log"
                    disabled={busy}
                    onChange={(e) => setInputs((st) => ({ ...st, [s.key]: e.target.value }))}
                    onKeyDown={(e) => e.key === 'Enter' && add(s.key, open)}
                    className="flex-1 rounded-md border border-ink-700 bg-ink-950 px-3 py-1.5 font-mono text-sm outline-none focus:border-accent"
                  />
                  <button className="btn-soft text-xs" disabled={busy} onClick={() => add(s.key, open)}>
                    Add
                  </button>
                </div>

                {/* one-click common patterns */}
                {remaining.length > 0 && (
                  <div className="mt-2 flex flex-wrap items-center gap-1.5">
                    <span className="text-[11px] text-slate-600">Quick add:</span>
                    {remaining.map((x) => (
                      <button
                        key={x}
                        disabled={busy}
                        onClick={() => add(s.key, x)}
                        className="rounded-md border border-ink-800 bg-ink-900 px-2 py-0.5 font-mono text-[11px] text-slate-400 hover:border-accent hover:text-accent"
                      >
                        {x}
                      </button>
                    ))}
                  </div>
                )}
              </div>
            )
          })}
        </div>

        <div className="border-t border-ink-700/60 px-5 py-3 text-[11px] text-slate-500">
          Private and Global rules stay on your machine. Tip: to hide that you use a tool, prefer Private
          or Global over the committed .gitignore.
        </div>
      </div>
    </div>
  )
}
