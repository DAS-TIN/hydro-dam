import React, { useEffect, useState } from 'react'
import { api, Coauthor } from '../api'
import Toggle from './Toggle'
import { IconClose } from './Icons'

export default function CoauthorPanel({
  cwd,
  coauthors,
  onChange,
  onClose
}: {
  cwd: string | null
  coauthors: Coauthor[]
  onChange: (list: Coauthor[]) => void
  onClose: () => void
}) {
  const [name, setName] = useState('')
  const [email, setEmail] = useState('')
  const [known, setKnown] = useState<{ name: string; email: string }[]>([])
  const [err, setErr] = useState('')

  useEffect(() => {
    if (cwd) api().coauthorsKnown(cwd).then(setKnown).catch(() => {})
  }, [cwd])

  async function add(n: string, e: string) {
    setErr('')
    if (!n.trim() || !e.trim()) {
      setErr('Name and email are both required.')
      return
    }
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(e.trim())) {
      setErr('That email looks off.')
      return
    }
    const list = await api().coauthorsAdd(n.trim(), e.trim())
    onChange(list)
    setName('')
    setEmail('')
  }

  async function toggle(c: Coauthor) {
    onChange(await api().coauthorsToggle(c.id, !c.enabled))
  }

  async function remove(c: Coauthor) {
    onChange(await api().coauthorsRemove(c.id))
  }

  const enabledCount = coauthors.filter((c) => c.enabled).length
  const existingEmails = new Set(coauthors.map((c) => c.email.toLowerCase()))
  const suggestions = known.filter((k) => !existingEmails.has(k.email.toLowerCase()))

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm" onClick={onClose}>
      <div className="card w-[560px] max-h-[82vh] overflow-hidden flex flex-col shadow-2xl" onClick={(e) => e.stopPropagation()}>
        {/* header */}
        <div className="flex items-center justify-between border-b border-ink-700/60 px-5 py-4">
          <div>
            <h2 className="text-base font-semibold text-white">Co-authors</h2>
            <p className="text-xs text-slate-400">
              Enabled co-authors are appended to every commit as{' '}
              <code className="text-accent">Co-Authored-By</code> trailers. No files written.
            </p>
          </div>
          <button className="btn-ghost px-2" onClick={onClose}>
            <IconClose className="w-4 h-4" />
          </button>
        </div>

        {/* roster */}
        <div className="flex-1 overflow-auto px-5 py-3">
          {coauthors.length === 0 && (
            <div className="rounded-lg border border-dashed border-ink-700 py-8 text-center text-sm text-slate-500">
              No co-authors yet. Add one below.
            </div>
          )}
          <ul className="space-y-1.5">
            {coauthors.map((c) => (
              <li
                key={c.id}
                className="group flex items-center gap-3 rounded-lg border border-ink-700/50 bg-ink-800 px-3 py-2"
              >
                <Toggle on={c.enabled} onClick={() => toggle(c)} />
                <div className="min-w-0 flex-1">
                  <div className="truncate text-base font-medium text-slate-100">{c.name}</div>
                  <div className="truncate text-sm text-slate-500">{c.email}</div>
                </div>
                <button
                  onClick={() => remove(c)}
                  className="opacity-0 group-hover:opacity-100 text-xs text-bad hover:underline"
                >
                  remove
                </button>
              </li>
            ))}
          </ul>

          {suggestions.length > 0 && (
            <div className="mt-4">
              <div className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-slate-500">
                Found in this repo's history
              </div>
              <div className="flex flex-wrap gap-1.5">
                {suggestions.slice(0, 8).map((k) => (
                  <button
                    key={k.email}
                    onClick={() => add(k.name, k.email)}
                    className="chip bg-ink-750 text-slate-300 hover:bg-ink-700"
                    title={k.email}
                  >
                    + {k.name}
                  </button>
                ))}
              </div>
            </div>
          )}
        </div>

        {/* add form */}
        <div className="border-t border-ink-700/60 px-5 py-4">
          {err && <div className="mb-2 text-xs text-bad">{err}</div>}
          <div className="flex gap-2">
            <input
              className="flex-1 rounded-md border border-ink-700 bg-ink-900 px-3 py-1.5 text-sm outline-none focus:border-accent"
              placeholder="Name"
              value={name}
              onChange={(e) => setName(e.target.value)}
            />
            <input
              className="flex-1 rounded-md border border-ink-700 bg-ink-900 px-3 py-1.5 text-sm outline-none focus:border-accent"
              placeholder="email@example.com"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && add(name, email)}
            />
            <button className="btn-accent" onClick={() => add(name, email)}>
              Add
            </button>
          </div>
          <div className="mt-2 text-xs text-slate-500">
            {enabledCount} of {coauthors.length} active - they'll co-sign your next commit.
          </div>
        </div>
      </div>
    </div>
  )
}
