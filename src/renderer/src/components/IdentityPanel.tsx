import React, { useEffect, useState } from 'react'
import { api, Identity, IdentityProfile } from '../api'
import { IconClose } from "./Icons"

export default function IdentityPanel({
  cwd,
  identity,
  onChanged,
  onClose,
  toast
}: {
  cwd: string
  identity: Identity
  onChanged: () => void
  onClose: () => void
  toast: (kind: 'ok' | 'err', text: string) => void
}) {
  const [profiles, setProfiles] = useState<IdentityProfile[]>([])
  const [activeId, setActiveId] = useState<string | null>(null)
  const [scope, setScope] = useState<'local' | 'global'>('local')
  const [busy, setBusy] = useState(false)

  // add / edit form
  const [editingId, setEditingId] = useState<string | null>(null)
  const [label, setLabel] = useState('')
  const [name, setName] = useState('')
  const [email, setEmail] = useState('')

  const reload = () => api().profilesList().then((s) => {
    setProfiles(s.profiles)
    setActiveId(s.activeId)
  })
  useEffect(() => {
    reload()
  }, [])

  const resetForm = () => {
    setEditingId(null)
    setLabel('')
    setName('')
    setEmail('')
  }

  const valid = (n: string, e: string) =>
    n.trim() && e.trim() && /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(e.trim())

  async function saveForm() {
    if (!valid(name, email)) {
      toast('err', 'Enter a name and a valid email.')
      return
    }
    const lbl = label.trim() || name.trim()
    if (editingId) await api().profilesUpdate(editingId, lbl, name.trim(), email.trim())
    else await api().profilesAdd(lbl, name.trim(), email.trim())
    await reload()
    resetForm()
  }

  async function use(p: IdentityProfile) {
    setBusy(true)
    try {
      const s = await api().profilesUse(cwd, p.id, scope)
      setProfiles(s.profiles)
      setActiveId(s.activeId)
      toast('ok', `Now committing as ${p.name}${scope === 'global' ? ' (global)' : ' in this repo'}.`)
      onChanged()
    } catch (e: any) {
      toast('err', e.message)
    } finally {
      setBusy(false)
    }
  }

  async function remove(p: IdentityProfile) {
    const s = await api().profilesRemove(p.id)
    setProfiles(s.profiles)
    setActiveId(s.activeId)
    if (editingId === p.id) resetForm()
  }

  function edit(p: IdentityProfile) {
    setEditingId(p.id)
    setLabel(p.label)
    setName(p.name)
    setEmail(p.email)
  }

  const effectiveInProfiles = profiles.some(
    (p) => p.email.toLowerCase() === identity.email.toLowerCase()
  )

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm" onClick={onClose}>
      <div className="card flex max-h-[88vh] w-[500px] flex-col overflow-hidden shadow-2xl" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between border-b border-ink-700/60 px-5 py-4">
          <div>
            <h2 className="text-base font-semibold text-white">Commit identity</h2>
            <p className="text-xs text-slate-400">Swap between saved profiles - one is always active.</p>
          </div>
          <button className="btn-ghost px-2" onClick={onClose}>
            <IconClose className="w-4 h-4" />
          </button>
        </div>

        <div className="overflow-auto px-5 py-4">
          {/* effective */}
          <div className="mb-3 rounded-lg border border-accent/30 bg-accent/5 px-3 py-2">
            <div className="text-[11px] uppercase tracking-wide text-accent">Committing as (this repo)</div>
            {identity.name || identity.email ? (
              <div className="truncate text-sm text-slate-100">
                {identity.name || '(no name)'}{' '}
                <span className="text-slate-400">&lt;{identity.email || 'no email'}&gt;</span>
                <span className="ml-2 text-[11px] text-slate-500">
                  ({identity.hasLocal ? 'repo-local' : 'from global'})
                </span>
              </div>
            ) : (
              <div className="text-sm text-bad">WARNING: no identity configured - commits will fail</div>
            )}
            {identity.name && !effectiveInProfiles && (
              <button
                className="mt-1.5 text-[11px] font-semibold text-accent hover:underline"
                onClick={() => api().profilesAdd(identity.name, identity.name, identity.email).then(reload)}
              >
                + Save this as a profile
              </button>
            )}
          </div>

          {/* scope for applying */}
          <div className="mb-3 flex items-center gap-2">
            <span className="text-xs text-slate-500">Apply to:</span>
            <div className="flex gap-1 rounded-lg bg-ink-950 p-0.5">
              {(['local', 'global'] as const).map((s) => (
                <button
                  key={s}
                  className={`rounded-md px-2.5 py-1 text-xs font-medium ${
                    scope === s ? 'bg-ink-750 text-white' : 'text-slate-400 hover:text-slate-200'
                  }`}
                  onClick={() => setScope(s)}
                >
                  {s === 'local' ? 'This repo' : 'All repos (global)'}
                </button>
              ))}
            </div>
          </div>

          {/* profiles */}
          <div className="mb-1 text-[11px] font-semibold uppercase tracking-wide text-slate-500">
            Profiles
          </div>
          {profiles.length === 0 && (
            <div className="rounded-lg border border-dashed border-ink-700 py-6 text-center text-sm text-slate-500">
              No profiles yet. Add one below.
            </div>
          )}
          <ul className="space-y-1.5">
            {profiles.map((p) => {
              const active = p.id === activeId
              return (
                <li
                  key={p.id}
                  className={`group flex items-center gap-3 rounded-lg border px-3 py-2 ${
                    active ? 'border-accent/50 bg-accent/5' : 'border-ink-700/50 bg-ink-800'
                  }`}
                >
                  <button
                    onClick={() => use(p)}
                    disabled={busy}
                    className="flex min-w-0 flex-1 items-center gap-3 text-left"
                    title={active ? 'Active profile' : 'Switch to this profile (applies it to git config)'}
                  >
                    <span
                      className={`flex h-4 w-4 shrink-0 items-center justify-center rounded-full border ${
                        active ? 'border-accent' : 'border-ink-600'
                      }`}
                    >
                      {active && <span className="h-2 w-2 rounded-full bg-accent" />}
                    </span>
                    <span className="min-w-0">
                      <span className="block truncate text-sm font-medium text-slate-100">
                        {p.label}
                        {active && <span className="ml-2 text-[10px] text-accent">ACTIVE</span>}
                      </span>
                      <span className="block truncate text-xs text-slate-500">
                        {p.name} &lt;{p.email}&gt;
                      </span>
                    </span>
                  </button>
                  <span className="flex items-center gap-1 opacity-0 group-hover:opacity-100">
                    <button
                      className="rounded px-1.5 py-0.5 text-[11px] text-slate-400 hover:bg-ink-700 hover:text-white"
                      onClick={() => edit(p)}
                    >
                      edit
                    </button>
                    <button
                      className="rounded px-1.5 py-0.5 text-[11px] text-bad hover:bg-bad/15"
                      onClick={() => remove(p)}
                    >
                      delete
                    </button>
                  </span>
                </li>
              )
            })}
          </ul>

          {/* add / edit form */}
          <div className="mt-4 rounded-lg border border-ink-700/60 bg-ink-900 p-3">
            <div className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-slate-500">
              {editingId ? 'Edit profile' : 'New profile'}
            </div>
            <div className="space-y-2">
              <input
                className="w-full rounded-md border border-ink-700 bg-ink-950 px-3 py-1.5 text-sm outline-none focus:border-accent"
                placeholder="Label (e.g. Work, Personal)"
                value={label}
                onChange={(e) => setLabel(e.target.value)}
              />
              <input
                className="w-full rounded-md border border-ink-700 bg-ink-950 px-3 py-1.5 text-sm outline-none focus:border-accent"
                placeholder="Name"
                value={name}
                onChange={(e) => setName(e.target.value)}
              />
              <input
                className="w-full rounded-md border border-ink-700 bg-ink-950 px-3 py-1.5 text-sm outline-none focus:border-accent"
                placeholder="email@example.com"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && saveForm()}
              />
              <div className="flex gap-2">
                <button className="btn-accent flex-1" onClick={saveForm}>
                  {editingId ? 'Save changes' : 'Add profile'}
                </button>
                {editingId && (
                  <button className="btn-soft" onClick={resetForm}>
                    Cancel
                  </button>
                )}
              </div>
            </div>
          </div>
        </div>

        <div className="border-t border-ink-700/60 px-5 py-3 text-[11px] text-slate-500">
          Switching a profile runs <code>git config {scope === 'global' ? '--global' : '--local'} user.*</code>.
        </div>
      </div>
    </div>
  )
}
