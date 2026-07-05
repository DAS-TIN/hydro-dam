import React, { useEffect, useMemo, useState } from 'react'
import { api, TemplateCatalog, RepoSetup, AccountView, OwnedRepo, basename, dirname } from '../api'
import { IconClose, IconArrowRight } from "./Icons"

type Toast = (kind: 'ok' | 'err' | 'info', text: string) => void

export default function NewRepoPanel({
  initPath,
  onCreated,
  onClose,
  toast
}: {
  // When set, we are initialising an existing folder in place (location locked).
  initPath?: string | null
  onCreated: (root: string) => void
  onClose: () => void
  toast: Toast
}) {
  const inPlace = !!initPath
  const [tab, setTab] = useState<'create' | 'clone'>('create')
  const [catalog, setCatalog] = useState<TemplateCatalog | null>(null)
  const [busy, setBusy] = useState(false)

  //Create fields
  const [parentDir, setParentDir] = useState(initPath ? dirname(initPath) : '')
  const [name, setName] = useState(initPath ? basename(initPath) : '')
  const [branch, setBranch] = useState('main')
  const [readme, setReadme] = useState(true)
  const [gitignoreId, setGitignoreId] = useState('')
  const [licenseId, setLicenseId] = useState('')
  const [initialCommit, setInitialCommit] = useState(true)
  const [presetId, setPresetId] = useState('')
  const [setups, setSetups] = useState<RepoSetup[]>([])
  const [setupId, setSetupId] = useState('')
  const [authorName, setAuthorName] = useState('')
  const [authorEmail, setAuthorEmail] = useState('')

  //clone fields
  const [cloneUrl, setCloneUrl] = useState('')
  const [cloneParent, setCloneParent] = useState('')
  const [cloneName, setCloneName] = useState('')
  const [accounts, setAccounts] = useState<AccountView[]>([])
  const [accountId, setAccountId] = useState('') // '' = public URL, no sign-in
  const [repos, setRepos] = useState<OwnedRepo[] | null>(null)
  const [reposBusy, setReposBusy] = useState(false)
  const [repoFilter, setRepoFilter] = useState('')

  useEffect(() => {
    api().repoTemplates().then(setCatalog).catch(() => {})
    api().setupsList().then(setSetups).catch(() => {})
    // Only GitHub / GitLab can browse + authenticate clones.
    api()
      .accountsList()
      .then((list) => setAccounts(list.filter((a) => a.provider === 'github' || a.provider === 'gitlab')))
      .catch(() => {})
    api()
      .globalIdentity()
      .then((id) => {
        setAuthorName(id.name)
        setAuthorEmail(id.email)
      })
      .catch(() => {})
  }, [])

  // Switching account clears any loaded repo list; it belongs to the old token.
  function pickAccount(id: string) {
    setAccountId(id)
    setRepos(null)
    setRepoFilter('')
  }

  async function loadRepos() {
    if (!accountId) return
    setReposBusy(true)
    try {
      setRepos(await api().accountRepos(accountId))
    } catch (e: any) {
      toast('err', e?.message || String(e))
    } finally {
      setReposBusy(false)
    }
  }

  const shownRepos = useMemo(() => {
    if (!repos) return []
    const q = repoFilter.trim().toLowerCase()
    return q ? repos.filter((r) => r.fullName.toLowerCase().includes(q)) : repos
  }, [repos, repoFilter])

  // Applying a preset fills the scaffolding choices; editing a field after that
  // drops back to "Custom".
  function applyPreset(id: string) {
    setPresetId(id)
    const p = catalog?.presets.find((x) => x.id === id)
    if (!p) return
    setReadme(p.readme)
    setGitignoreId(p.gitignore ?? '')
    setLicenseId(p.license ?? '')
  }
  const custom = <T,>(setter: (v: T) => void) => (v: T) => {
    setPresetId('')
    setter(v)
  }

  const targetPath = useMemo(() => {
    if (!parentDir || !name) return ''
    const sep = parentDir.includes('\\') ? '\\' : '/'
    return parentDir.replace(/[\\/]+$/, '') + sep + name.trim()
  }, [parentDir, name])

  const noIdentity = initialCommit && (!authorName.trim() || !authorEmail.trim())
  const canCreate = !!parentDir && !!name.trim() && !busy
  const canClone = !!cloneUrl.trim() && !!cloneParent && !busy

  async function browse(setter: (p: string) => void, title: string) {
    const p = await api().browseDir(title)
    if (p) setter(p)
  }

  async function doCreate() {
    if (!canCreate) return
    setBusy(true)
    try {
      const root = setupId
        ? await api().createFromSetup(setupId, parentDir, name.trim())
        : await api().createRepo({
            parentDir,
            name: name.trim(),
            branch: branch.trim() || 'main',
            readme,
            gitignore: gitignoreId || null,
            license: licenseId || null,
            initialCommit,
            author: { name: authorName.trim(), email: authorEmail.trim() }
          })
      toast('ok', inPlace ? 'Folder initialised as a repository.' : 'Repository created.')
      onCreated(root)
    } catch (e: any) {
      toast('err', e?.message || String(e))
    } finally {
      setBusy(false)
    }
  }

  async function doClone() {
    if (!canClone) return
    setBusy(true)
    try {
      const root = await api().cloneRepo(
        cloneUrl.trim(),
        cloneParent,
        cloneName.trim() || undefined,
        accountId || undefined
      )
      toast('ok', 'Repository cloned.')
      onCreated(root)
    } catch (e: any) {
      toast('err', e?.message || String(e))
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm">
      <div className="card flex max-h-[90vh] w-[560px] flex-col overflow-hidden shadow-2xl">
        <div className="flex items-center justify-between border-b border-ink-700/60 px-5 py-4">
          <h2 className="text-base font-semibold text-white">
            {inPlace ? 'Initialise repository' : 'New repository'}
          </h2>
          <button className="btn-ghost px-2" onClick={onClose}>
            <IconClose className="w-4 h-4" />
          </button>
        </div>

        {/* tabs (hidden when initialising an existing folder) */}
        {!inPlace && (
          <div className="flex gap-1 border-b border-ink-800 bg-ink-900 px-5 py-2">
            {(['create', 'clone'] as const).map((t) => (
              <button
                key={t}
                onClick={() => setTab(t)}
                className={`rounded-md px-3 py-1 text-sm font-medium transition-colors ${
                  tab === t ? 'bg-ink-750 text-white' : 'text-slate-400 hover:text-slate-200'
                }`}
              >
                {t === 'create' ? 'Create' : 'Clone'}
              </button>
            ))}
          </div>
        )}

        <div className="overflow-auto px-5 py-4">
          {inPlace && (
            <div className="mb-4 rounded-lg border border-accent/30 bg-accent/5 px-3 py-2 text-xs text-slate-300">
              <span className="font-mono text-accent">{initPath}</span> isn't a git repository yet.
              Choose what to scaffold, then initialise it in place.
            </div>
          )}

          {tab === 'create' ? (
            <div className="space-y-4">
              {/* location */}
              <Field label="Location">
                <div className="flex gap-2">
                  <input
                    value={parentDir}
                    onChange={(e) => setParentDir(e.target.value)}
                    placeholder="Parent folder..."
                    disabled={inPlace}
                    className="flex-1 rounded-md border border-ink-700 bg-ink-950 px-3 py-1.5 text-sm outline-none focus:border-accent disabled:opacity-60"
                  />
                  {!inPlace && (
                    <button
                      className="btn-soft text-xs"
                      onClick={() => browse(setParentDir, 'Choose a parent folder')}
                    >
                      Browse...
                    </button>
                  )}
                </div>
              </Field>

              <Field label="Repository name">
                <input
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="my-project"
                  disabled={inPlace}
                  className="w-full rounded-md border border-ink-700 bg-ink-950 px-3 py-1.5 text-sm outline-none focus:border-accent disabled:opacity-60"
                />
                {targetPath && (
                  <div className="mt-1 truncate font-mono text-[11px] text-slate-500" title={targetPath}>
                    <IconArrowRight className="inline w-3 h-3 mr-0.5" />{targetPath}
                  </div>
                )}
              </Field>

              {setups.length > 0 && (
                <Field label="Setup">
                  <select
                    value={setupId}
                    onChange={(e) => setSetupId(e.target.value)}
                    className="w-full rounded-md border border-ink-700 bg-ink-950 px-3 py-1.5 text-sm outline-none focus:border-accent"
                  >
                    <option value="">None (configure below)</option>
                    {setups.map((s) => (
                      <option key={s.id} value={s.id}>
                        {s.name}
                      </option>
                    ))}
                  </select>
                </Field>
              )}

              {setupId ? (
                <div className="rounded-lg border border-accent/30 bg-accent/5 px-3 py-2 text-xs text-slate-300">
                  This setup decides the branch, files, ignore rules and identity. Just pick a location and
                  name above, then create.
                </div>
              ) : (
                <>
                  <div className="grid grid-cols-2 gap-3">
                    <Field label="Default branch">
                  <input
                    value={branch}
                    onChange={(e) => setBranch(e.target.value)}
                    placeholder="main"
                    className="w-full rounded-md border border-ink-700 bg-ink-950 px-3 py-1.5 text-sm outline-none focus:border-accent"
                  />
                </Field>
                <Field label="Preset">
                  <select
                    value={presetId}
                    onChange={(e) => applyPreset(e.target.value)}
                    className="w-full rounded-md border border-ink-700 bg-ink-950 px-3 py-1.5 text-sm outline-none focus:border-accent"
                  >
                    <option value="">Custom</option>
                    {catalog?.presets.map((p) => (
                      <option key={p.id} value={p.id}>
                        {p.label}
                      </option>
                    ))}
                  </select>
                </Field>
              </div>

              {/* scaffolding */}
              <div className="rounded-lg border border-ink-800 bg-ink-900/40 p-3">
                <div className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-500">
                  Initialise with
                </div>

                <label className="flex cursor-pointer items-center gap-2 py-1.5 text-sm text-slate-200">
                  <input
                    type="checkbox"
                    className="accent-accent"
                    checked={readme}
                    onChange={(e) => custom(setReadme)(e.target.checked)}
                  />
                  README.md
                </label>

                <Row
                  label=".gitignore"
                  checked={!!gitignoreId}
                  onToggle={(on) =>
                    custom(setGitignoreId)(on ? catalog?.gitignore[0]?.id ?? '' : '')
                  }
                >
                  <select
                    value={gitignoreId}
                    onChange={(e) => custom(setGitignoreId)(e.target.value)}
                    className="rounded-md border border-ink-700 bg-ink-950 px-2 py-1 text-xs outline-none focus:border-accent"
                  >
                    <option value="">None</option>
                    {catalog?.gitignore.map((t) => (
                      <option key={t.id} value={t.id}>
                        {t.label}
                      </option>
                    ))}
                  </select>
                </Row>

                <Row
                  label="LICENSE"
                  checked={!!licenseId}
                  onToggle={(on) => custom(setLicenseId)(on ? catalog?.license[0]?.id ?? '' : '')}
                >
                  <select
                    value={licenseId}
                    onChange={(e) => custom(setLicenseId)(e.target.value)}
                    className="rounded-md border border-ink-700 bg-ink-950 px-2 py-1 text-xs outline-none focus:border-accent"
                  >
                    <option value="">None</option>
                    {catalog?.license.map((t) => (
                      <option key={t.id} value={t.id}>
                        {t.label}
                      </option>
                    ))}
                  </select>
                </Row>

                <label className="mt-1 flex cursor-pointer items-center gap-2 border-t border-ink-800 pt-2 text-sm text-slate-200">
                  <input
                    type="checkbox"
                    className="accent-accent"
                    checked={initialCommit}
                    onChange={(e) => setInitialCommit(e.target.checked)}
                  />
                  Make initial commit
                  <span className="text-xs text-slate-500">(opens clean, not empty)</span>
                </label>
              </div>

              {/* author - only relevant for license text + initial commit */}
              {(licenseId || initialCommit) && (
                <div className="grid grid-cols-2 gap-3">
                  <Field label="Author name">
                    <input
                      value={authorName}
                      onChange={(e) => setAuthorName(e.target.value)}
                      placeholder="Your Name"
                      className="w-full rounded-md border border-ink-700 bg-ink-950 px-3 py-1.5 text-sm outline-none focus:border-accent"
                    />
                  </Field>
                  <Field label="Author email">
                    <input
                      value={authorEmail}
                      onChange={(e) => setAuthorEmail(e.target.value)}
                      placeholder="you@example.com"
                      className="w-full rounded-md border border-ink-700 bg-ink-950 px-3 py-1.5 text-sm outline-none focus:border-accent"
                    />
                  </Field>
                </div>
              )}
              {noIdentity && (
                <div className="text-[11px] text-warn">
                  No author set - the files will be created but the initial commit will be skipped
                  until you fill in a name and email.
                </div>
              )}
            </>
            )}
          </div>
          ) : (
            <div className="space-y-4">
              <Field label="Account">
                <select
                  value={accountId}
                  onChange={(e) => pickAccount(e.target.value)}
                  className="w-full rounded-md border border-ink-700 bg-ink-950 px-3 py-1.5 text-sm outline-none focus:border-accent"
                >
                  <option value="">Public URL (no sign-in)</option>
                  {accounts.map((a) => (
                    <option key={a.id} value={a.id}>
                      {a.provider === 'github' ? 'GitHub' : 'GitLab'} - {a.username}
                      {a.host !== 'github.com' && a.host !== 'gitlab.com' ? ` (${a.host})` : ''}
                    </option>
                  ))}
                </select>
                {accountId && (
                  <div className="mt-1 text-[11px] text-slate-500">
                    Private repos clone through this account. The token isn't stored in the clone.
                  </div>
                )}
              </Field>

              {accountId && (
                <div className="rounded-lg border border-ink-800 bg-ink-900/40 p-3">
                  {repos === null ? (
                    <button className="btn-soft w-full text-xs" disabled={reposBusy} onClick={loadRepos}>
                      {reposBusy ? 'Loading repositories...' : 'Browse my repositories'}
                    </button>
                  ) : (
                    <>
                      <input
                        value={repoFilter}
                        onChange={(e) => setRepoFilter(e.target.value)}
                        placeholder="Filter repositories..."
                        className="mb-2 w-full rounded-md border border-ink-700 bg-ink-950 px-3 py-1.5 text-sm outline-none focus:border-accent"
                      />
                      <div className="max-h-52 overflow-auto">
                        {shownRepos.length === 0 ? (
                          <div className="py-4 text-center text-xs text-slate-500">No repositories match.</div>
                        ) : (
                          shownRepos.map((r) => (
                            <button
                              key={r.fullName}
                              onClick={() => {
                                setCloneUrl(r.cloneUrl)
                                setCloneName(r.name)
                              }}
                              className={`flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left hover:bg-ink-850 ${
                                cloneUrl === r.cloneUrl ? 'bg-ink-800' : ''
                              }`}
                            >
                              <span className="min-w-0 flex-1 truncate text-sm text-slate-200">{r.fullName}</span>
                              {r.private && <span className="chip bg-ink-750 text-slate-400">private</span>}
                            </button>
                          ))
                        )}
                      </div>
                    </>
                  )}
                </div>
              )}

              <Field label="Repository URL">
                <input
                  value={cloneUrl}
                  onChange={(e) => setCloneUrl(e.target.value)}
                  placeholder="https://github.com/owner/repo.git"
                  className="w-full rounded-md border border-ink-700 bg-ink-950 px-3 py-1.5 font-mono text-sm outline-none focus:border-accent"
                />
              </Field>
              <Field label="Clone into">
                <div className="flex gap-2">
                  <input
                    value={cloneParent}
                    onChange={(e) => setCloneParent(e.target.value)}
                    placeholder="Parent folder..."
                    className="flex-1 rounded-md border border-ink-700 bg-ink-950 px-3 py-1.5 text-sm outline-none focus:border-accent"
                  />
                  <button
                    className="btn-soft text-xs"
                    onClick={() => browse(setCloneParent, 'Choose where to clone')}
                  >
                    Browse...
                  </button>
                </div>
              </Field>
              <Field label="Folder name (optional)">
                <input
                  value={cloneName}
                  onChange={(e) => setCloneName(e.target.value)}
                  placeholder="defaults to the repo name"
                  className="w-full rounded-md border border-ink-700 bg-ink-950 px-3 py-1.5 text-sm outline-none focus:border-accent"
                />
              </Field>
            </div>
          )}
        </div>

        <div className="flex items-center justify-end gap-2 border-t border-ink-700/60 px-5 py-3">
          <button className="btn-ghost" onClick={onClose} disabled={busy}>
            Cancel
          </button>
          {tab === 'create' ? (
            <button className="btn-accent" onClick={doCreate} disabled={!canCreate}>
              {busy ? 'Working...' : inPlace ? 'Initialise' : 'Create repository'}
            </button>
          ) : (
            <button className="btn-accent" onClick={doClone} disabled={!canClone}>
              {busy ? 'Cloning...' : 'Clone'}
            </button>
          )}
        </div>
      </div>
    </div>
  )
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <div className="mb-1 text-xs font-semibold text-slate-400">{label}</div>
      {children}
    </div>
  )
}

function Row({
  label,
  checked,
  onToggle,
  children
}: {
  label: string
  checked: boolean
  onToggle: (on: boolean) => void
  children: React.ReactNode
}) {
  return (
    <div className="flex items-center gap-2 py-1.5">
      <label className="flex flex-1 cursor-pointer items-center gap-2 text-sm text-slate-200">
        <input
          type="checkbox"
          className="accent-accent"
          checked={checked}
          onChange={(e) => onToggle(e.target.checked)}
        />
        {label}
      </label>
      {children}
    </div>
  )
}
