import React, { useEffect, useState } from 'react'
import { IconClose } from './Icons'
import { api, confirmDialog, RepoSetup, TemplateCatalog, IdentityProfile } from '../api'

function blankSetup(): RepoSetup {
  return {
    id: crypto.randomUUID(),
    name: '',
    branch: 'main',
    readme: true,
    gitignore: null,
    extraGitignore: '',
    license: null,
    files: [],
    localExclude: [],
    globalExclude: [],
    identityProfileId: null,
    coauthors: false,
    initialCommit: true
  }
}

export default function SetupsPanel({
  toast,
  onClose
}: {
  toast: (kind: 'ok' | 'err' | 'info', text: string) => void
  onClose: () => void
}) {
  const [setups, setSetups] = useState<RepoSetup[]>([])
  const [catalog, setCatalog] = useState<TemplateCatalog | null>(null)
  const [profiles, setProfiles] = useState<IdentityProfile[]>([])
  const [draft, setDraft] = useState<RepoSetup | null>(null)
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    api().setupsList().then(setSetups).catch(() => {})
    api().repoTemplates().then(setCatalog).catch(() => {})
    api()
      .profilesList()
      .then((p) => setProfiles(p.profiles))
      .catch(() => {})
  }, [])

  const patch = (p: Partial<RepoSetup>) => setDraft((d) => (d ? { ...d, ...p } : d))

  const save = async () => {
    if (!draft) return
    if (!draft.name.trim()) {
      toast('err', 'Give the setup a name.')
      return
    }
    setBusy(true)
    try {
      const clean: RepoSetup = {
        ...draft,
        name: draft.name.trim(),
        branch: draft.branch.trim() || 'main',
        files: draft.files.filter((f) => f.path.trim()),
        localExclude: draft.localExclude.map((x) => x.trim()).filter(Boolean),
        globalExclude: draft.globalExclude.map((x) => x.trim()).filter(Boolean)
      }
      setSetups(await api().setupsSave(clean))
      setDraft(clean)
      toast('ok', 'Setup saved.')
    } catch (e: any) {
      toast('err', e?.message || String(e))
    } finally {
      setBusy(false)
    }
  }

  const remove = (s: RepoSetup) =>
    confirmDialog({ title: 'Delete setup', danger: true, message: `Delete "${s.name}"?`, confirmLabel: 'Delete' }).then(
      async (ok) => {
        if (!ok) return
        setSetups(await api().setupsRemove(s.id))
        if (draft?.id === s.id) setDraft(null)
      }
    )

  const input = 'w-full rounded-md border border-ink-700 bg-ink-950 px-2.5 py-1.5 text-sm outline-none focus:border-accent select-text'

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm" onClick={onClose}>
      <div className="card flex h-[88vh] w-[1000px] overflow-hidden shadow-2xl" onClick={(e) => e.stopPropagation()}>
        {/* list */}
        <div className="flex w-64 shrink-0 flex-col border-r border-ink-700/60">
          <div className="flex items-center justify-between border-b border-ink-700/60 px-4 py-3">
            <div>
              <div className="text-xs uppercase tracking-wide text-slate-500">New-repo setups</div>
              <div className="text-sm font-medium text-white">{setups.length} saved</div>
            </div>
          </div>
          <div className="flex-1 overflow-auto">
            {setups.map((s) => (
              <button
                key={s.id}
                onClick={() => setDraft(s)}
                className={`block w-full border-b border-ink-800 px-4 py-2.5 text-left ${
                  draft?.id === s.id ? 'bg-ink-750' : 'hover:bg-ink-850'
                }`}
              >
                <div className="truncate text-sm text-slate-100">{s.name}</div>
                <div className="truncate text-[11px] text-slate-500">
                  {s.branch} - {s.files.length + (s.readme ? 1 : 0)} file(s)
                  {s.identityProfileId ? ' - identity' : ''}
                </div>
              </button>
            ))}
          </div>
          <div className="border-t border-ink-700/60 p-2">
            <button className="btn-soft w-full text-sm" onClick={() => setDraft(blankSetup())}>
              + New setup
            </button>
          </div>
        </div>

        {/* editor */}
        <div className="flex min-w-0 flex-1 flex-col">
          <div className="flex items-center justify-between border-b border-ink-700/60 px-5 py-3">
            <div className="text-sm font-medium text-slate-100">{draft ? draft.name || 'New setup' : 'Setups'}</div>
            <div className="flex items-center gap-2">
              {draft && (
                <button className="btn-ghost text-xs text-bad" onClick={() => remove(draft)}>
                  Delete
                </button>
              )}
              {draft && (
                <button className="btn-accent text-sm" disabled={busy} onClick={save}>
                  Save
                </button>
              )}
              <button className="btn-ghost px-2" onClick={onClose} title="Close">
                <IconClose className="w-4 h-4" />
              </button>
            </div>
          </div>

          {!draft ? (
            <div className="flex flex-1 flex-col items-center justify-center gap-1 text-sm text-slate-500">
              <div>Pick a setup to edit, or create a new one.</div>
              <div className="text-xs text-slate-600">A setup is a reusable recipe for "git init".</div>
            </div>
          ) : (
            <div className="flex-1 space-y-4 overflow-auto px-5 py-4">
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <div className="mb-1 text-xs font-semibold text-slate-400">Name</div>
                  <input className={input} value={draft.name} onChange={(e) => patch({ name: e.target.value })} placeholder="e.g. Personal TypeScript" />
                </div>
                <div>
                  <div className="mb-1 text-xs font-semibold text-slate-400">Default branch</div>
                  <input className={input} value={draft.branch} onChange={(e) => patch({ branch: e.target.value })} placeholder="main" />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <div className="mb-1 text-xs font-semibold text-slate-400">.gitignore template</div>
                  <select className={input} value={draft.gitignore ?? ''} onChange={(e) => patch({ gitignore: e.target.value || null })}>
                    <option value="">None</option>
                    {catalog?.gitignore.map((t) => (
                      <option key={t.id} value={t.id}>
                        {t.label}
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <div className="mb-1 text-xs font-semibold text-slate-400">License</div>
                  <select className={input} value={draft.license ?? ''} onChange={(e) => patch({ license: e.target.value || null })}>
                    <option value="">None</option>
                    {catalog?.license.map((t) => (
                      <option key={t.id} value={t.id}>
                        {t.label}
                      </option>
                    ))}
                  </select>
                </div>
              </div>

              <div>
                <div className="mb-1 text-xs font-semibold text-slate-400">Extra .gitignore lines</div>
                <textarea className={input} rows={2} value={draft.extraGitignore} onChange={(e) => patch({ extraGitignore: e.target.value })} placeholder={'.env.local\n*.tmp'} />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <div className="mb-1 text-xs font-semibold text-slate-400">Local exclude (.git/info/exclude)</div>
                  <textarea
                    className={input}
                    rows={3}
                    value={draft.localExclude.join('\n')}
                    onChange={(e) => patch({ localExclude: e.target.value.split('\n') })}
                    placeholder={'.idea/\nscratch/'}
                  />
                </div>
                <div>
                  <div className="mb-1 text-xs font-semibold text-slate-400">Global exclude</div>
                  <textarea
                    className={input}
                    rows={3}
                    value={draft.globalExclude.join('\n')}
                    onChange={(e) => patch({ globalExclude: e.target.value.split('\n') })}
                    placeholder={'.DS_Store'}
                  />
                </div>
              </div>

              <div>
                <div className="mb-1 text-xs font-semibold text-slate-400">Identity</div>
                <select
                  className={input}
                  value={draft.identityProfileId ?? ''}
                  onChange={(e) => patch({ identityProfileId: e.target.value || null })}
                >
                  <option value="">Use global git identity</option>
                  {profiles.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.label} ({p.name || 'no name'})
                    </option>
                  ))}
                </select>
                <div className="mt-1 text-[11px] text-slate-600">
                  Pinned as the repo-local identity so commits here always use it.
                </div>
              </div>

              {/* starter files */}
              <div>
                <div className="mb-1 flex items-center justify-between">
                  <span className="text-xs font-semibold text-slate-400">Starter files</span>
                  <button className="btn-ghost text-xs" onClick={() => patch({ files: [...draft.files, { path: '', content: '' }] })}>
                    + Add file
                  </button>
                </div>
                <div className="space-y-2">
                  {draft.files.map((f, i) => (
                    <div key={i} className="rounded-lg border border-ink-800 bg-ink-900 p-2">
                      <div className="mb-1 flex gap-2">
                        <input
                          className={input}
                          value={f.path}
                          onChange={(e) => patch({ files: draft.files.map((x, k) => (k === i ? { ...x, path: e.target.value } : x)) })}
                          placeholder="path, e.g. src/index.ts or .editorconfig"
                        />
                        <button
                          className="btn-ghost text-xs text-bad"
                          onClick={() => patch({ files: draft.files.filter((_, k) => k !== i) })}
                        >
                          Remove
                        </button>
                      </div>
                      <textarea
                        className={`${input} font-mono`}
                        rows={3}
                        value={f.content}
                        onChange={(e) => patch({ files: draft.files.map((x, k) => (k === i ? { ...x, content: e.target.value } : x)) })}
                        placeholder="file contents"
                      />
                    </div>
                  ))}
                </div>
              </div>

              <div className="flex flex-wrap items-center gap-4 border-t border-ink-800 pt-3">
                <label className="flex items-center gap-2 text-sm text-slate-200">
                  <input type="checkbox" className="accent-accent" checked={draft.readme} onChange={(e) => patch({ readme: e.target.checked })} />
                  README.md
                </label>
                <label className="flex items-center gap-2 text-sm text-slate-200">
                  <input type="checkbox" className="accent-accent" checked={draft.initialCommit} onChange={(e) => patch({ initialCommit: e.target.checked })} />
                  Make initial commit
                </label>
                <label className="flex items-center gap-2 text-sm text-slate-200">
                  <input type="checkbox" className="accent-accent" checked={draft.coauthors} onChange={(e) => patch({ coauthors: e.target.checked })} />
                  Add active co-authors to first commit
                </label>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
