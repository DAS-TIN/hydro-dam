import { useEffect, useMemo, useState } from 'react'
import { api, confirmDialog, GraphCommit, CommitMeta, Coauthor } from '../api'
import { IconClose, IconArrowUp } from './Icons'

type Toast = (kind: 'ok' | 'err' | 'info', text: string) => void

// Drop Co-authored-by trailers from a message body; they're edited separately
// and re-appended on amend, so the textarea only shows the human-written part.
function stripTrailers(msg: string): string {
  return msg
    .split('\n')
    .filter((l) => !/^\s*co-authored-by:/i.test(l))
    .join('\n')
    .replace(/\n+$/, '')
}

const coKey = (c: { name: string; email: string }) => (c.email || c.name).toLowerCase()
function sameCoauthors(a: { name: string; email: string }[], b: { name: string; email: string }[]): boolean {
  if (a.length !== b.length) return false
  const set = new Set(a.map(coKey))
  return b.every((c) => set.has(coKey(c)))
}

// Review the commits a push would upload. For the tip commit you can amend the
// message and co-authors before pushing; any commit can be reverted.
export default function PushPreview({
  cwd,
  upstream,
  onPush,
  onChanged,
  toast,
  onClose
}: {
  cwd: string
  upstream: string | null
  onPush: () => void
  onChanged: () => void
  toast: Toast
  onClose: () => void
}) {
  const [commits, setCommits] = useState<GraphCommit[] | null>(null)
  const [sel, setSel] = useState<string | null>(null)
  const [meta, setMeta] = useState<CommitMeta | null>(null)
  const [msg, setMsg] = useState('')
  const [cos, setCos] = useState<{ name: string; email: string }[]>([])
  const [known, setKnown] = useState<Coauthor[]>([])
  const [coName, setCoName] = useState('')
  const [coEmail, setCoEmail] = useState('')
  const [busy, setBusy] = useState(false)

  async function loadList(keep?: string) {
    const list = await api().unpushedCommits(cwd).catch(() => [])
    setCommits(list)
    const next = keep && list.some((c) => c.hash === keep) ? keep : list[0]?.hash ?? null
    setSel(next)
  }

  useEffect(() => {
    loadList()
    api().coauthorsList().then(setKnown).catch(() => {})
  }, [cwd])

  // Load the selected commit's message/files and seed the edit fields.
  useEffect(() => {
    if (!sel) {
      setMeta(null)
      return
    }
    const commit = commits?.find((c) => c.hash === sel)
    api()
      .commitMeta(cwd, sel)
      .then((m) => {
        setMeta(m)
        setMsg(stripTrailers(m.message))
        setCos(commit ? commit.coauthors : [])
      })
      .catch((e) => toast('err', e?.message || String(e)))
  }, [sel, commits])

  const selCommit = commits?.find((c) => c.hash === sel) || null
  const count = commits?.length ?? 0

  const dirty = useMemo(() => {
    if (!meta?.isHead) return false
    return msg.trim() !== stripTrailers(meta.message).trim() || !sameCoauthors(cos, selCommit?.coauthors ?? [])
  }, [meta, msg, cos, selCommit])

  function addCoauthor(name: string, email: string) {
    const n = name.trim()
    const e = email.trim()
    if (!n) return
    if (cos.some((c) => coKey(c) === (e || n).toLowerCase())) return
    setCos([...cos, { name: n, email: e }])
    setCoName('')
    setCoEmail('')
  }

  async function amend(thenPush: boolean) {
    setBusy(true)
    try {
      await api().commit(cwd, msg, cos, true)
      onChanged()
      toast('ok', 'Commit amended.')
      if (thenPush) {
        onPush()
        onClose()
        return
      }
      await loadList(sel ?? undefined)
    } catch (e: any) {
      toast('err', e?.message || String(e))
    } finally {
      setBusy(false)
    }
  }

  async function revert() {
    if (!selCommit) return
    const ok = await confirmDialog({
      title: 'Revert commit',
      danger: true,
      message: `Revert ${selCommit.shortHash} "${selCommit.subject}"?`,
      detail: 'Creates a new commit that undoes this one. Your history is kept.',
      confirmLabel: 'Revert'
    })
    if (!ok) return
    setBusy(true)
    try {
      await api().revertCommit(cwd, selCommit.hash)
      onChanged()
      toast('ok', 'Commit reverted.')
      await loadList()
    } catch (e: any) {
      toast('err', e?.message || String(e))
    } finally {
      setBusy(false)
    }
  }

  const quickAdd = known.filter((k) => !cos.some((c) => coKey(c) === coKey(k)))

  return (
    <div className="fixed inset-0 z-[55] flex items-center justify-center bg-black/60 backdrop-blur-sm">
      <div className="card flex max-h-[86vh] w-[760px] flex-col overflow-hidden shadow-2xl">
        <div className="flex items-center justify-between border-b border-ink-700/60 px-5 py-4">
          <div>
            <h2 className="text-base font-semibold text-white">Commits to push</h2>
            <p className="text-xs text-slate-400">
              {commits === null
                ? 'Loading...'
                : count === 0
                  ? 'Nothing to push - your branch is up to date.'
                  : `${count} commit${count === 1 ? '' : 's'} ahead of ${upstream || 'upstream'}.`}
            </p>
          </div>
          <button className="btn-ghost px-2" onClick={onClose} title="Close">
            <IconClose className="w-4 h-4" />
          </button>
        </div>

        <div className="flex min-h-0 flex-1">
          {/* commit list */}
          <div className="w-60 shrink-0 overflow-auto border-r border-ink-800 bg-ink-900/40 p-2">
            {count === 0 && <div className="p-3 text-center text-xs text-slate-500">No unpushed commits.</div>}
            {commits?.map((c) => (
              <button
                key={c.hash}
                onClick={() => setSel(c.hash)}
                className={`mb-1 flex w-full flex-col gap-0.5 rounded-md px-2.5 py-1.5 text-left ${
                  sel === c.hash ? 'bg-ink-750' : 'hover:bg-ink-850'
                }`}
              >
                <span className="truncate text-sm text-slate-100">{c.subject}</span>
                <span className="flex items-center gap-1.5 text-[11px] text-slate-500">
                  <span className="font-mono text-accent">{c.shortHash}</span>
                  {c.coauthors.length > 0 && <span className="chip bg-ink-800 text-slate-400">+{c.coauthors.length}</span>}
                </span>
              </button>
            ))}
          </div>

          {/* detail */}
          <div className="min-w-0 flex-1 overflow-auto px-4 py-3">
            {!selCommit ? (
              <div className="flex h-full items-center justify-center text-sm text-slate-500">
                Select a commit.
              </div>
            ) : (
              <div className="space-y-4">
                <div>
                  <div className="mb-1 flex items-center justify-between">
                    <span className="text-xs font-semibold text-slate-400">Message</span>
                    {!meta?.isHead && (
                      <span className="text-[11px] text-slate-600">Only the latest commit can be amended</span>
                    )}
                  </div>
                  <textarea
                    value={msg}
                    onChange={(e) => setMsg(e.target.value)}
                    disabled={!meta?.isHead || busy}
                    rows={Math.min(8, Math.max(3, msg.split('\n').length))}
                    className="w-full resize-none rounded-md border border-ink-700 bg-ink-950 px-3 py-2 font-mono text-[13px] outline-none focus:border-accent disabled:opacity-70"
                  />
                </div>

                <div>
                  <div className="mb-1 text-xs font-semibold text-slate-400">Co-authors</div>
                  {cos.length === 0 && <div className="mb-2 text-[11px] text-slate-600">None on this commit.</div>}
                  <div className="mb-2 flex flex-wrap gap-1.5">
                    {cos.map((c) => (
                      <span
                        key={coKey(c)}
                        className="chip flex items-center gap-1 bg-ink-750 text-slate-200"
                        title={c.email ? `${c.name} <${c.email}>` : c.name}
                      >
                        {c.name}
                        {meta?.isHead && (
                          <button
                            className="text-slate-500 hover:text-bad"
                            onClick={() => setCos(cos.filter((x) => coKey(x) !== coKey(c)))}
                            title="Remove"
                          >
                            <IconClose className="w-3 h-3" />
                          </button>
                        )}
                      </span>
                    ))}
                  </div>
                  {meta?.isHead && (
                    <>
                      {quickAdd.length > 0 && (
                        <div className="mb-2 flex flex-wrap gap-1.5">
                          {quickAdd.map((k) => (
                            <button
                              key={coKey(k)}
                              className="chip bg-ink-800 text-slate-400 hover:text-accent"
                              onClick={() => addCoauthor(k.name, k.email)}
                            >
                              + {k.name}
                            </button>
                          ))}
                        </div>
                      )}
                      <div className="flex gap-2">
                        <input
                          value={coName}
                          onChange={(e) => setCoName(e.target.value)}
                          placeholder="Name"
                          className="w-36 rounded-md border border-ink-700 bg-ink-950 px-2.5 py-1 text-xs outline-none focus:border-accent"
                        />
                        <input
                          value={coEmail}
                          onChange={(e) => setCoEmail(e.target.value)}
                          placeholder="email@example.com"
                          className="flex-1 rounded-md border border-ink-700 bg-ink-950 px-2.5 py-1 font-mono text-xs outline-none focus:border-accent"
                        />
                        <button
                          className="btn-soft text-xs"
                          disabled={!coName.trim()}
                          onClick={() => addCoauthor(coName, coEmail)}
                        >
                          Add
                        </button>
                      </div>
                    </>
                  )}
                </div>

                <div>
                  <div className="mb-1 text-xs font-semibold text-slate-400">
                    Files changed {meta && `(${meta.files.length})`}
                  </div>
                  <div className="rounded-md border border-ink-800">
                    {meta?.files.length === 0 && (
                      <div className="px-3 py-2 text-[11px] text-slate-600">No file changes.</div>
                    )}
                    {meta?.files.map((f) => (
                      <div
                        key={f.path}
                        className="flex items-center gap-3 border-b border-ink-800 px-3 py-1.5 text-[12px] last:border-0"
                      >
                        <span className="min-w-0 flex-1 truncate font-mono text-slate-300">{f.path}</span>
                        {f.add < 0 ? (
                          <span className="text-slate-500">binary</span>
                        ) : (
                          <span className="shrink-0 font-mono">
                            <span className="text-good">+{f.add}</span> <span className="text-bad">-{f.del}</span>
                          </span>
                        )}
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            )}
          </div>
        </div>

        <div className="flex items-center gap-2 border-t border-ink-700/60 px-5 py-3">
          <button className="btn-ghost" onClick={onClose} disabled={busy}>
            Cancel
          </button>
          {selCommit && (
            <button className="btn-ghost text-bad" onClick={revert} disabled={busy}>
              Revert commit
            </button>
          )}
          <div className="flex-1" />
          {dirty ? (
            <>
              <button className="btn-soft" onClick={() => amend(false)} disabled={busy}>
                {busy ? 'Working...' : 'Amend'}
              </button>
              <button className="btn-accent flex items-center gap-1" onClick={() => amend(true)} disabled={busy}>
                <IconArrowUp className="w-3.5 h-3.5" />
                Amend & Push
              </button>
            </>
          ) : (
            <button
              className="btn-accent flex items-center gap-1"
              disabled={count === 0 || busy}
              onClick={() => {
                onPush()
                onClose()
              }}
            >
              <IconArrowUp className="w-3.5 h-3.5" />
              Push {count > 0 ? count : ''}
            </button>
          )}
        </div>
      </div>
    </div>
  )
}
