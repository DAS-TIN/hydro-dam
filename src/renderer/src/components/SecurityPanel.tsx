import React, { useEffect, useState } from 'react'
import { IconClose } from './Icons'
import { api, SecurityFeature, SecurityOverview, SigningConfig, SshKey } from '../api'

// Text + tone for one GitHub security feature probe.
function featureLabel(f: SecurityFeature): { text: string; cls: string } {
  if (f.state === 'ok') {
    return f.count === 0
      ? { text: 'no open alerts', cls: 'bg-good/20 text-good' }
      : { text: `${f.count} open alert${f.count === 1 ? '' : 's'}`, cls: 'bg-bad/20 text-bad' }
  }
  if (f.state === 'forbidden') return { text: 'no access (token scope or plan)', cls: 'bg-warn/15 text-warn' }
  return { text: 'not enabled', cls: 'bg-ink-750 text-slate-400' }
}

const SIG_LABEL: Record<string, string> = {
  G: 'good signature',
  B: 'BAD signature',
  U: 'good, unknown validity',
  X: 'good, expired',
  Y: 'good, expired key',
  R: 'good, revoked key',
  E: 'cannot check',
  N: 'not signed'
}

export default function SecurityPanel({
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
  const [cfg, setCfg] = useState<SigningConfig>({ enabled: false, format: 'openpgp', key: '' })
  const [scope, setScope] = useState<'local' | 'global'>('local')
  const [status, setStatus] = useState<{ status: string; signer: string } | null>(null)
  const [keys, setKeys] = useState<SshKey[]>([])
  const [busy, setBusy] = useState(false)
  const [copied, setCopied] = useState('')
  const [genName, setGenName] = useState('id_hydrodam')
  const [genComment, setGenComment] = useState('')

  const [overview, setOverview] = useState<SecurityOverview | null>(null)

  const load = () => {
    api().signingGet(cwd).then(setCfg).catch(() => {})
    api().signingStatus(cwd, 'HEAD').then(setStatus).catch(() => setStatus(null))
    api().sshKeys().then(setKeys).catch(() => setKeys([]))
    api().remoteSecurity(cwd).then(setOverview).catch(() => setOverview(null))
  }
  useEffect(load, [cwd])

  const save = async (next: SigningConfig) => {
    setBusy(true)
    try {
      await api().signingSet(cwd, next, scope)
      setCfg(next)
      toast('ok', 'Signing settings saved.')
      onChanged()
    } catch (e: any) {
      toast('err', e?.message || String(e))
    } finally {
      setBusy(false)
    }
  }

  const copy = (text: string, id: string) =>
    navigator.clipboard.writeText(text).then(() => {
      setCopied(id)
      setTimeout(() => setCopied(''), 1400)
    })

  const generate = async () => {
    setBusy(true)
    try {
      const pub = await api().sshGenerate(genName.trim(), genComment.trim())
      toast('ok', 'SSH key generated.')
      copy(pub, 'gen')
      load()
    } catch (e: any) {
      toast('err', e?.message || String(e))
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm" onClick={onClose}>
      <div className="card flex max-h-[88vh] w-[680px] flex-col overflow-hidden shadow-2xl" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between border-b border-ink-700/60 px-5 py-4">
          <div>
            <h2 className="text-base font-semibold text-white">Signing &amp; keys</h2>
            <p className="text-xs text-slate-400">Sign commits (GPG/SSH) and manage SSH keys.</p>
          </div>
          <button className="btn-ghost px-2" onClick={onClose} title="Close">
            <IconClose className="w-4 h-4" />
          </button>
        </div>

        <div className="overflow-auto px-5 py-4">
          {/* signing */}
          <div className="mb-2 flex items-center justify-between">
            <div>
              <div className="text-sm font-semibold text-white">Commit signing</div>
              {status && (
                <div className="text-xs text-slate-500">
                  HEAD: <span className={status.status === 'G' ? 'text-good' : status.status === 'N' ? 'text-slate-500' : 'text-warn'}>
                    {SIG_LABEL[status.status] || status.status}
                  </span>
                  {status.signer && ` - ${status.signer}`}
                </div>
              )}
            </div>
            <select
              value={scope}
              onChange={(e) => setScope(e.target.value as 'local' | 'global')}
              className="rounded-md border border-ink-700 bg-ink-950 px-2 py-1 text-xs outline-none focus:border-accent"
            >
              <option value="local">this repo</option>
              <option value="global">global</option>
            </select>
          </div>

          <div className="flex items-center justify-between rounded-lg border border-ink-800 bg-ink-900 px-3 py-2">
            <div className="text-sm text-slate-200">Sign every commit</div>
            <input
              type="checkbox"
              className="accent-accent h-4 w-4"
              checked={cfg.enabled}
              onChange={(e) => save({ ...cfg, enabled: e.target.checked })}
            />
          </div>

          <div className="mt-2 flex items-center gap-2 text-sm">
            <span className="text-slate-400">Format</span>
            {(['openpgp', 'ssh'] as const).map((f) => (
              <label key={f} className="flex items-center gap-1 text-slate-300">
                <input
                  type="radio"
                  name="sigfmt"
                  className="accent-accent"
                  checked={cfg.format === f}
                  onChange={() => setCfg({ ...cfg, format: f })}
                />
                {f === 'openpgp' ? 'GPG' : 'SSH'}
              </label>
            ))}
          </div>
          <div className="mt-2 flex gap-2">
            <input
              value={cfg.key}
              onChange={(e) => setCfg({ ...cfg, key: e.target.value })}
              placeholder={cfg.format === 'ssh' ? 'SSH public key or path' : 'GPG key id'}
              className="flex-1 rounded-md border border-ink-700 bg-ink-950 px-3 py-1.5 font-mono text-sm outline-none focus:border-accent select-text"
            />
            <button className="btn-accent text-sm" disabled={busy} onClick={() => save(cfg)}>
              Save
            </button>
          </div>

          {/* ssh keys */}
          <div className="mt-5 border-t border-ink-800 pt-4">
            <div className="mb-2 text-sm font-semibold text-white">SSH keys (~/.ssh)</div>
            {keys.length === 0 && <div className="text-sm text-slate-500">No public keys found.</div>}
            <div className="space-y-1">
              {keys.map((k) => (
                <div key={k.name} className="flex items-center gap-2 rounded-lg border border-ink-800 bg-ink-900 px-3 py-2">
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <span className="text-sm text-slate-100">{k.name}</span>
                      <span className="chip bg-ink-750 text-slate-400">{k.type}</span>
                    </div>
                    <div className="truncate font-mono text-[11px] text-slate-500">{k.pub}</div>
                  </div>
                  <button className="btn-ghost text-xs" onClick={() => copy(k.pub, k.name)}>
                    {copied === k.name ? 'copied!' : 'copy'}
                  </button>
                </div>
              ))}
            </div>

            <div className="mt-3 flex gap-2">
              <input
                value={genName}
                onChange={(e) => setGenName(e.target.value)}
                placeholder="key file name"
                className="w-40 rounded-md border border-ink-700 bg-ink-950 px-3 py-1.5 text-sm outline-none focus:border-accent select-text"
              />
              <input
                value={genComment}
                onChange={(e) => setGenComment(e.target.value)}
                placeholder="comment (email)"
                className="flex-1 rounded-md border border-ink-700 bg-ink-950 px-3 py-1.5 text-sm outline-none focus:border-accent select-text"
              />
              <button className="btn-soft text-sm" disabled={busy || !genName.trim()} onClick={generate}>
                Generate ed25519
              </button>
            </div>
            <div className="mt-1 text-[11px] text-slate-600">
              Creates a passphrase-less ed25519 key in ~/.ssh and copies the public key. Needs ssh-keygen.
            </div>
          </div>

          {/* GitHub security posture */}
          {overview?.supported && (
            <div className="mt-5 border-t border-ink-800 pt-4">
              <div className="mb-2 text-sm font-semibold text-white">GitHub security</div>
              <div className="space-y-1.5">
                {(
                  [
                    ['Dependabot alerts', overview.dependabot],
                    ['Code scanning', overview.codeScanning],
                    ['Secret scanning', overview.secretScanning]
                  ] as const
                ).map(([label, f]) => {
                  const v = featureLabel(f)
                  return (
                    <div key={label} className="flex items-center justify-between rounded-lg border border-ink-800 bg-ink-900 px-3 py-2">
                      <span className="text-sm text-slate-200">{label}</span>
                      <span className={`chip ${v.cls}`}>{v.text}</span>
                    </div>
                  )
                })}
                <div className="flex items-center justify-between rounded-lg border border-ink-800 bg-ink-900 px-3 py-2">
                  <span className="text-sm text-slate-200">Push protection (GitHub side)</span>
                  <span
                    className={`chip ${
                      overview.pushProtection === 'enabled'
                        ? 'bg-good/20 text-good'
                        : overview.pushProtection === 'disabled'
                          ? 'bg-warn/15 text-warn'
                          : 'bg-ink-750 text-slate-400'
                    }`}
                  >
                    {overview.pushProtection === 'unknown' ? 'not visible to this token' : overview.pushProtection}
                  </span>
                </div>
              </div>
              <div className="mt-2 text-[11px] text-slate-600">
                Alert access needs a token with the security_events scope; some features need GitHub
                Advanced Security. Hydrodam's own local scan (Settings &gt; Scan pushes for secrets)
                works everywhere, on any plan.
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
