import React, { useEffect, useRef, useState } from 'react'
import { IconClose } from './Icons'
import { api, confirmDialog, AccountView } from '../api'

type Provider = 'github' | 'gitlab' | 'bitbucket' | 'azure'

const PROVIDERS: { id: Provider; label: string }[] = [
  { id: 'github', label: 'GitHub' },
  { id: 'gitlab', label: 'GitLab' },
  { id: 'bitbucket', label: 'Bitbucket' },
  { id: 'azure', label: 'Azure' }
]

const TOKEN_HINT: Record<Provider, string> = {
  github: 'Token with repo scope (ghp_...)',
  gitlab: 'Token with api scope (glpat-...)',
  bitbucket: 'Access token (Bearer)',
  azure: 'Personal access token (Code: Read & Write)'
}

export default function ConnectionsPanel({
  toast,
  onChanged,
  onClose
}: {
  toast: (kind: 'ok' | 'err' | 'info', text: string) => void
  onChanged?: () => void
  onClose: () => void
}) {
  const [accounts, setAccounts] = useState<AccountView[]>([])
  const [loading, setLoading] = useState(true)
  const [provider, setProvider] = useState<Provider>('github')
  const [host, setHost] = useState('')
  const [label, setLabel] = useState('')
  const [token, setToken] = useState('')
  const [busy, setBusy] = useState(false)
  const [checked, setChecked] = useState('')
  const [clientId, setClientId] = useState('')
  const [device, setDevice] = useState<{ userCode: string; verificationUri: string } | null>(null)
  const pollRef = useRef<any>(null)

  useEffect(() => () => { if (pollRef.current) clearInterval(pollRef.current) }, [])

  const load = () => {
    setLoading(true)
    api()
      .accountsList()
      .then(setAccounts)
      .catch((e) => toast('err', e?.message || String(e)))
      .finally(() => setLoading(false))
  }
  useEffect(load, [])

  const defaultHost =
    provider === 'github'
      ? 'github.com'
      : provider === 'gitlab'
        ? 'gitlab.com'
        : provider === 'bitbucket'
          ? 'bitbucket.org'
          : 'dev.azure.com'

  const test = async () => {
    if (!token.trim()) return
    setBusy(true)
    setChecked('')
    try {
      const { username } = await api().accountsValidate(provider, host, token)
      setChecked(username)
      toast('ok', `Token is valid: ${username}`)
    } catch (e: any) {
      toast('err', e?.message || String(e))
    } finally {
      setBusy(false)
    }
  }

  const connect = async () => {
    if (!token.trim()) return
    setBusy(true)
    try {
      const next = await api().accountsAdd(provider, host, label, token)
      setAccounts(next)
      setToken('')
      setLabel('')
      setHost('')
      setChecked('')
      toast('ok', 'Account connected.')
      onChanged?.()
    } catch (e: any) {
      toast('err', e?.message || String(e))
    } finally {
      setBusy(false)
    }
  }

  const startDevice = async () => {
    if (!clientId.trim()) return
    setBusy(true)
    try {
      const d = await api().oauthDeviceStart(clientId.trim())
      setDevice({ userCode: d.userCode, verificationUri: d.verificationUri })
      api().openExternal(d.verificationUri)
      const cid = clientId.trim()
      pollRef.current = setInterval(async () => {
        try {
          const r = await api().oauthDevicePoll(cid, d.deviceCode)
          if (r.token) {
            clearInterval(pollRef.current)
            pollRef.current = null
            setDevice(null)
            const next = await api().accountsAdd('github', 'github.com', label, r.token)
            setAccounts(next)
            setLabel('')
            toast('ok', 'GitHub account connected.')
            onChanged?.()
            setBusy(false)
          } else if (r.error) {
            clearInterval(pollRef.current)
            pollRef.current = null
            setDevice(null)
            setBusy(false)
            toast('err', r.error)
          }
        } catch {
          //Transient: keep polling
        }
      }, Math.max(2, d.interval) * 1000)
    } catch (e: any) {
      toast('err', e?.message || String(e))
      setBusy(false)
    }
  }

  const cancelDevice = () => {
    if (pollRef.current) clearInterval(pollRef.current)
    pollRef.current = null
    setDevice(null)
    setBusy(false)
  }

  const makeActive = async (a: AccountView) => {
    try {
      setAccounts(await api().accountsSetActive(a.provider, a.id))
      onChanged?.()
    } catch (e: any) {
      toast('err', e?.message || String(e))
    }
  }

  const remove = async (a: AccountView) => {
    const ok = await confirmDialog({
      title: 'Disconnect account',
      danger: true,
      message: `Disconnect ${a.username} (${a.host})?`,
      detail: 'Hydrodam forgets the stored token. You can reconnect any time.',
      confirmLabel: 'Disconnect'
    })
    if (!ok) return
    try {
      setAccounts(await api().accountsRemove(a.id))
      onChanged?.()
      toast('ok', 'Account disconnected.')
    } catch (e: any) {
      toast('err', e?.message || String(e))
    }
  }

  const ProvBtn = ({ p, children }: { p: Provider; children: React.ReactNode }) => (
    <button
      className={`flex-1 rounded-md py-1 text-xs font-medium ${
        provider === p ? 'bg-ink-750 text-white' : 'text-slate-400 hover:text-slate-200'
      }`}
      onClick={() => {
        setProvider(p)
        setChecked('')
      }}
    >
      {children}
    </button>
  )

  return (
    <div className="fixed inset-0 z-[55] flex items-center justify-center bg-black/60 backdrop-blur-sm">
      <div className="card flex max-h-[88vh] w-[640px] flex-col overflow-hidden shadow-2xl">
        <div className="flex items-center justify-between border-b border-ink-700/60 px-5 py-4">
          <div>
            <h2 className="text-base font-semibold text-white">GitHub / GitLab accounts</h2>
            <p className="text-xs text-slate-400">Connect with a token, then switch the active account per provider.</p>
          </div>
          <button className="btn-ghost px-2" onClick={onClose} title="Close">
            <IconClose className="w-4 h-4" />
          </button>
        </div>

        {/* add account */}
        <div className="border-b border-ink-800 bg-ink-900 px-5 py-4">
          <div className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-slate-500">
            Connect an account
          </div>
          <div className="mb-2 flex gap-1 rounded-lg bg-ink-950 p-0.5">
            {PROVIDERS.map((p) => (
              <ProvBtn key={p.id} p={p.id}>
                {p.label}
              </ProvBtn>
            ))}
          </div>
          <div className="mb-2 flex gap-2">
            <input
              value={host}
              onChange={(e) => setHost(e.target.value)}
              placeholder={provider === 'azure' ? 'Azure org (e.g. myorg)' : `Host (default ${defaultHost})`}
              className="flex-1 rounded-md border border-ink-700 bg-ink-950 px-3 py-1.5 text-sm outline-none focus:border-accent select-text"
            />
            <input
              value={label}
              onChange={(e) => setLabel(e.target.value)}
              placeholder="Label (optional)"
              className="w-40 rounded-md border border-ink-700 bg-ink-950 px-3 py-1.5 text-sm outline-none focus:border-accent select-text"
            />
          </div>
          <div className="flex gap-2">
            <input
              type="password"
              value={token}
              onChange={(e) => {
                setToken(e.target.value)
                setChecked('')
              }}
              placeholder={TOKEN_HINT[provider]}
              className="flex-1 rounded-md border border-ink-700 bg-ink-950 px-3 py-1.5 font-mono text-sm outline-none focus:border-accent select-text"
            />
            <button className="btn-ghost text-xs" disabled={busy || !token.trim()} onClick={test}>
              Test
            </button>
            <button className="btn-accent text-xs" disabled={busy || !token.trim()} onClick={connect}>
              Connect
            </button>
          </div>
          {checked && <div className="mt-2 text-xs text-good">Verified as {checked}. Click Connect to save.</div>}
          <div className="mt-2 text-[11px] text-slate-600">
            Tokens are stored locally in the main process and never shown again. GitHub: <code>repo</code>{' '}
            scope; GitLab: <code>api</code> scope. Host accepts Enterprise / self-hosted domains.
          </div>

          {/* GitHub OAuth device flow */}
          <div className="mt-3 border-t border-ink-800 pt-3">
            <div className="mb-1 text-[11px] font-semibold uppercase tracking-wide text-slate-500">
              Or sign in with GitHub (OAuth device flow)
            </div>
            {!device ? (
              <div className="flex gap-2">
                <input
                  value={clientId}
                  onChange={(e) => setClientId(e.target.value)}
                  placeholder="GitHub OAuth app client id"
                  className="flex-1 rounded-md border border-ink-700 bg-ink-950 px-3 py-1.5 font-mono text-sm outline-none focus:border-accent select-text"
                />
                <button className="btn-soft text-xs" disabled={busy || !clientId.trim()} onClick={startDevice}>
                  Sign in
                </button>
              </div>
            ) : (
              <div className="rounded-lg border border-accent/30 bg-accent/5 px-3 py-2 text-sm">
                <div className="text-slate-300">
                  Enter this code at the page that opened (or{' '}
                  <button
                    className="text-accent hover:underline"
                    onClick={() => api().openExternal('https://github.com/login/device')}
                  >
                    github.com/login/device
                  </button>
                  ):
                </div>
                <div className="my-1 font-mono text-xl tracking-widest text-white">{device.userCode}</div>
                <div className="flex items-center gap-2 text-xs text-slate-500">
                  Waiting for authorization...
                  <button className="btn-ghost text-xs" onClick={cancelDevice}>
                    Cancel
                  </button>
                </div>
              </div>
            )}
            <div className="mt-1 text-[11px] text-slate-600">
              Needs a registered GitHub OAuth app with device flow enabled (client id only - no secret).
            </div>
          </div>
        </div>

        {/* connected accounts */}
        <div className="overflow-auto px-5 py-4">
          <div className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-slate-500">
            Connected ({accounts.length})
          </div>
          {loading && <div className="text-sm text-slate-500">Loading...</div>}
          {!loading && accounts.length === 0 && (
            <div className="rounded-lg border border-dashed border-ink-700 py-6 text-center text-sm text-slate-500">
              No accounts connected yet.
            </div>
          )}
          <div className="space-y-1">
            {accounts.map((a) => (
              <div
                key={a.id}
                className={`flex items-center gap-3 rounded-lg border px-3 py-2 ${
                  a.active ? 'border-accent/40 bg-accent/5' : 'border-ink-800 bg-ink-900'
                }`}
              >
                <span className="chip bg-ink-750 text-slate-300">{a.provider}</span>
                <div className="min-w-0 flex-1">
                  <div className="truncate text-sm text-slate-100">
                    {a.username}
                    {a.label && a.label !== a.username && (
                      <span className="ml-2 text-xs text-slate-500">{a.label}</span>
                    )}
                  </div>
                  <div className="truncate text-[11px] text-slate-500">{a.host}</div>
                </div>
                {a.active ? (
                  <span className="chip bg-good/20 text-good">active</span>
                ) : (
                  <button className="btn-ghost text-xs" onClick={() => makeActive(a)}>
                    Make active
                  </button>
                )}
                <button className="btn-ghost text-xs text-bad" onClick={() => remove(a)}>
                  Disconnect
                </button>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  )
}
