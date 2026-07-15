import React, { useEffect, useState } from 'react'
import { api, Settings, McpInfo, ACCENTS } from '../api'
import Toggle from './Toggle'
import { IconClose } from "./Icons"

const AI_MODELS: { id: string; label: string; hint: string }[] = [
  { id: 'claude-opus-4-8', label: 'Claude Opus 4.8', hint: 'most capable (recommended)' },
  { id: 'claude-sonnet-4-6', label: 'Claude Sonnet 4.6', hint: 'fast and smart' },
  { id: 'claude-haiku-4-5', label: 'Claude Haiku 4.5', hint: 'fastest, cheapest' }
]

const ZOOMS = [90, 100, 110, 125, 140]

const ROWS: { key: keyof Settings; label: string; hint: string }[] = [
  { key: 'showLegend', label: 'Show colour key', hint: 'The legend of status colours under the file list.' },
  { key: 'treeView', label: 'Folder tree view', hint: 'Group changed files by folder instead of a flat list.' },
  { key: 'showOpStatus', label: 'Show last fetch / pull / push', hint: 'A status strip with the time of your last remote operations.' },
  { key: 'showIgnored', label: 'Show ignored files', hint: 'List .gitignore-matched files in their own section.' },
  { key: 'verifyAuthorOnCommit', label: 'Verify author before committing', hint: "Warn when the commit identity isn't one of your saved profiles." },
  { key: 'autoPushOnCommit', label: 'Auto-push after commit', hint: 'Push to the remote automatically each time you commit.' },
  { key: 'tuckUntracked', label: 'Tuck away untracked files', hint: 'Collapse already-seen untracked files to the bottom; only newly appeared ones stay in view.' }
]

export default function SettingsPanel({
  settings,
  onChange,
  onManageAccounts,
  onReloaded,
  onClose
}: {
  settings: Settings
  onChange: (patch: Partial<Settings>) => void
  onManageAccounts: () => void
  onReloaded: () => void
  onClose: () => void
}) {
  const [fetchMin, setFetchMin] = useState(String(settings.autoFetchMinutes))
  useEffect(() => setFetchMin(String(settings.autoFetchMinutes)), [settings.autoFetchMinutes])
  const [mcp, setMcp] = useState<McpInfo | null>(null)
  const [port, setPort] = useState(String(settings.mcpPort))
  const [copied, setCopied] = useState(false)
  const [apiKey, setApiKey] = useState(settings.anthropicApiKey)
  const [showKey, setShowKey] = useState(false)
  const [aiNotes, setAiNotes] = useState(settings.aiInstructions)
  useEffect(() => setAiNotes(settings.aiInstructions), [settings.aiInstructions])

  useEffect(() => {
    const tick = () => api().mcpStatus().then(setMcp).catch(() => {})
    tick()
    const t = setInterval(tick, 1500)
    return () => clearInterval(t)
  }, [])

  useEffect(() => setPort(String(settings.mcpPort)), [settings.mcpPort])
  useEffect(() => setApiKey(settings.anthropicApiKey), [settings.anthropicApiKey])

  const applyPort = () => {
    const n = parseInt(port, 10)
    if (n >= 1024 && n <= 65535 && n !== settings.mcpPort) onChange({ mcpPort: n })
    else setPort(String(settings.mcpPort))
  }

  const copyUrl = () => {
    if (mcp?.url) {
      navigator.clipboard.writeText(mcp.url)
      setCopied(true)
      setTimeout(() => setCopied(false), 1500)
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm" onClick={onClose}>
      <div className="card flex max-h-[88vh] w-[520px] flex-col overflow-hidden shadow-2xl" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between border-b border-ink-700/60 px-5 py-4">
          <h2 className="text-base font-semibold text-white">Settings</h2>
          <button className="btn-ghost px-2" onClick={onClose}>
            <IconClose className="w-4 h-4" />
          </button>
        </div>

        <div className="overflow-auto">
          {/* display toggles */}
          <div className="divide-y divide-ink-800">
            {ROWS.map((r) => {
              const on = settings[r.key] as boolean
              return (
                <label
                  key={r.key}
                  className="flex cursor-pointer items-center gap-3 px-5 py-3.5 hover:bg-ink-850"
                >
                  <div className="min-w-0 flex-1">
                    <div className="text-sm font-medium text-slate-100">{r.label}</div>
                    <div className="text-xs text-slate-500">{r.hint}</div>
                  </div>
                  <Toggle
                    on={on}
                    onClick={(e) => {
                      e.preventDefault()
                      onChange({ [r.key]: !on } as Partial<Settings>)
                    }}
                  />
                </label>
              )
            })}
          </div>

          {/* MCP server */}
          <div className="border-t border-ink-700/60 bg-ink-900/40 px-5 py-4">
            <div className="mb-1 flex items-center gap-2">
              <span className="text-sm font-semibold text-white">MCP server</span>
              <span
                className={`chip ${
                  mcp?.running ? 'bg-good/20 text-good' : 'bg-ink-750 text-slate-400'
                }`}
              >
                {mcp?.running ? 'running' : 'stopped'}
              </span>
            </div>
            <p className="mb-3 text-xs text-slate-500">
              Lets an MCP-capable AI client connect over a local port and call tools like{' '}
              <code className="text-accent">preview_commit</code>, <code className="text-accent">diff</code>,{' '}
              <code className="text-accent">log_stat</code>. Loopback-only.
            </p>

            <div className="flex items-center justify-between py-2">
              <div className="text-sm text-slate-200">Enable server</div>
              <Toggle on={settings.mcpEnabled} onClick={() => onChange({ mcpEnabled: !settings.mcpEnabled })} />
            </div>

            <div className="flex items-center justify-between py-2">
              <div className="text-sm text-slate-200">Port</div>
              <input
                value={port}
                onChange={(e) => setPort(e.target.value.replace(/[^0-9]/g, ''))}
                onBlur={applyPort}
                onKeyDown={(e) => e.key === 'Enter' && applyPort()}
                className="w-24 rounded-md border border-ink-700 bg-ink-950 px-2 py-1 text-right text-sm outline-none focus:border-accent"
              />
            </div>

            <div className="mt-1 flex items-center justify-between rounded-lg border border-bad/30 bg-bad/5 px-3 py-2">
              <div className="min-w-0">
                <div className="text-sm font-medium text-bad">Dangerous mode</div>
                <div className="text-xs text-slate-500">
                  Also expose write tools: <b>stage, unstage, commit, stash, push, pull, fetch,
                  checkout, create branch, uncommit, resolve conflict</b>. Off = read-only.
                </div>
              </div>
              <Toggle
                on={settings.mcpDangerous}
                onClick={() => onChange({ mcpDangerous: !settings.mcpDangerous })}
              />
            </div>

            {mcp?.running && mcp.url && (
              <div className="mt-3 flex items-center gap-2 rounded-lg bg-ink-950 px-3 py-2">
                <code className="flex-1 truncate text-xs text-slate-300">{mcp.url}</code>
                <button className="btn-soft text-xs" onClick={copyUrl}>
                  {copied ? 'copied!' : 'copy'}
                </button>
              </div>
            )}
            {mcp?.error && <div className="mt-2 text-xs text-bad">Server error: {mcp.error}</div>}
            {mcp?.running && (
              <div className="mt-1 text-[11px] text-slate-500">
                Tools: read-only{mcp.dangerous ? ' + write (dangerous)' : ''}.
              </div>
            )}
          </div>

          {/* AI assist (optional) */}
          <div className="border-t border-ink-700/60 px-5 py-4">
            <div className="mb-1 flex items-center gap-2">
              <span className="text-sm font-semibold text-white">AI assist</span>
              <span
                className={`chip ${apiKey.trim() ? 'bg-good/20 text-good' : 'bg-ink-750 text-slate-400'}`}
              >
                {apiKey.trim() ? 'enabled' : 'off'}
              </span>
            </div>
            <p className="mb-3 text-xs text-slate-500">
              Optional. With an Anthropic API key, Hydrodam can draft commit messages, review and
              explain changes, group files into commits, and propose conflict resolutions - always
              shown for your review before anything is saved. Everything else works without this.
            </p>
            <div className="flex gap-2">
              <input
                type={showKey ? 'text' : 'password'}
                value={apiKey}
                onChange={(e) => setApiKey(e.target.value)}
                onBlur={() => apiKey !== settings.anthropicApiKey && onChange({ anthropicApiKey: apiKey.trim() })}
                placeholder="sk-ant-..."
                className="flex-1 rounded-md border border-ink-700 bg-ink-950 px-3 py-1.5 font-mono text-sm outline-none focus:border-accent"
              />
              <button className="btn-ghost text-xs" onClick={() => setShowKey((v) => !v)}>
                {showKey ? 'hide' : 'show'}
              </button>
              <button
                className="btn-soft text-xs"
                onClick={() => onChange({ anthropicApiKey: apiKey.trim() })}
              >
                Save
              </button>
            </div>
            <div className="mt-2 text-[11px] text-slate-600">
              Stored locally in Hydrodam's settings file (plain text). Clear the field to disable.
            </div>

            <div className="mt-3 flex items-center justify-between py-1">
              <div className="min-w-0">
                <div className="text-sm text-slate-200">Model</div>
                <div className="text-xs text-slate-500">
                  Used for commit drafts, reviews, explanations, and conflict resolutions.
                </div>
              </div>
              <select
                value={settings.aiModel}
                onChange={(e) => onChange({ aiModel: e.target.value })}
                className="rounded-md border border-ink-700 bg-ink-950 px-2 py-1.5 text-sm outline-none focus:border-accent"
              >
                {AI_MODELS.map((m) => (
                  <option key={m.id} value={m.id}>
                    {m.label} - {m.hint}
                  </option>
                ))}
              </select>
            </div>

            <div className="mt-2">
              <div className="text-sm text-slate-200">Your instructions</div>
              <div className="mb-1.5 text-xs text-slate-500">
                Added to every AI request. E.g. "Commit messages follow Conventional Commits" or
                "Answer in German".
              </div>
              <textarea
                value={aiNotes}
                onChange={(e) => setAiNotes(e.target.value)}
                onBlur={() => aiNotes !== settings.aiInstructions && onChange({ aiInstructions: aiNotes })}
                rows={3}
                placeholder="Optional style or context instructions for the AI..."
                className="w-full resize-none rounded-md border border-ink-700 bg-ink-950 px-3 py-2 text-sm outline-none focus:border-accent select-text"
              />
            </div>
          </div>

          {/* Theme & workflow */}
          <div className="border-t border-ink-700/60 px-5 py-4">
            <div className="mb-2 text-sm font-semibold text-white">Theme</div>
            <div className="mb-4 flex gap-2">
              {ACCENTS.map((a) => (
                <button
                  key={a.id}
                  onClick={() => onChange({ accent: a.id })}
                  title={a.label}
                  className={`h-7 w-7 rounded-full border-2 ${
                    settings.accent === a.id ? 'border-white' : 'border-transparent'
                  }`}
                  style={{ background: `rgb(${a.rgb})` }}
                />
              ))}
            </div>

            <div className="flex items-center justify-between py-2">
              <div className="min-w-0">
                <div className="text-sm text-slate-200">Text size</div>
                <div className="text-xs text-slate-500">Scales the whole interface.</div>
              </div>
              <div className="flex gap-1 rounded-md bg-ink-950 p-0.5">
                {ZOOMS.map((z) => (
                  <button
                    key={z}
                    onClick={() => onChange({ uiZoom: z })}
                    className={`rounded px-2 py-1 text-xs font-medium ${
                      (settings.uiZoom || 100) === z ? 'bg-ink-750 text-white' : 'text-slate-400 hover:text-slate-200'
                    }`}
                  >
                    {z}%
                  </button>
                ))}
              </div>
            </div>

            <div className="flex items-center justify-between py-2">
              <div className="min-w-0">
                <div className="text-sm text-slate-200">Auto-fetch every</div>
                <div className="text-xs text-slate-500">Minutes between background fetches (0 = off).</div>
              </div>
              <input
                value={fetchMin}
                onChange={(e) => setFetchMin(e.target.value.replace(/[^0-9]/g, ''))}
                onBlur={() => onChange({ autoFetchMinutes: parseInt(fetchMin, 10) || 0 })}
                onKeyDown={(e) => e.key === 'Enter' && onChange({ autoFetchMinutes: parseInt(fetchMin, 10) || 0 })}
                className="w-20 rounded-md border border-ink-700 bg-ink-950 px-2 py-1 text-right text-sm outline-none focus:border-accent"
              />
            </div>
            <div className="flex items-center justify-between py-2">
              <div className="min-w-0">
                <div className="text-sm text-slate-200">Desktop notifications</div>
                <div className="text-xs text-slate-500">Notify when a fetch finds new upstream commits.</div>
              </div>
              <Toggle on={settings.notifyOnUpdates} onClick={() => onChange({ notifyOnUpdates: !settings.notifyOnUpdates })} />
            </div>
            <div className="flex items-center justify-between py-2">
              <div className="min-w-0">
                <div className="text-sm text-slate-200">Scan pushes for secrets</div>
                <div className="text-xs text-slate-500">
                  Before pushing, check outgoing commits for key-shaped strings (GitHub/AWS/API keys)
                  and warn. Local, no network.
                </div>
              </div>
              <Toggle on={settings.secretScanOnPush} onClick={() => onChange({ secretScanOnPush: !settings.secretScanOnPush })} />
            </div>

            <div className="mt-2 flex items-center gap-2">
              <button className="btn-soft text-xs" onClick={() => api().settingsExport()}>
                Export settings...
              </button>
              <button
                className="btn-soft text-xs"
                onClick={async () => {
                  if (await api().settingsImport()) onReloaded()
                }}
              >
                Import settings...
              </button>
              <span className="text-[11px] text-slate-600">Portable preferences (no tokens) - your own "sync".</span>
            </div>
          </div>

          {/* GitHub / GitLab accounts */}
          <div className="border-t border-ink-700/60 px-5 py-4">
            <div className="mb-1 text-sm font-semibold text-white">GitHub / GitLab</div>
            <p className="mb-3 text-xs text-slate-500">
              Connect accounts with a personal access token to list and create pull / merge requests, and
              switch the active account per provider. Supports Enterprise / self-hosted hosts.
            </p>
            <button className="btn-soft text-sm" onClick={onManageAccounts}>
              Manage accounts...
            </button>
          </div>
        </div>

        <div className="border-t border-ink-700/60 px-5 py-3 text-[11px] text-slate-500">
          Settings are saved automatically and apply to every window.
        </div>
      </div>
    </div>
  )
}
