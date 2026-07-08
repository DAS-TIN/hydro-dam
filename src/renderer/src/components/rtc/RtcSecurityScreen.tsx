import React from 'react'
import { api, humanSize } from '../../api'
import { RtcState } from '../../rtc'
import { Section } from './bits'
import Toggle from '../Toggle'

/** Session safety switches. Everything risky ships off. */
export default function RtcSecurityScreen({
  cwd,
  state,
  refresh,
  toast
}: {
  cwd: string
  state: RtcState
  refresh: () => void
  toast: (kind: 'ok' | 'err', text: string) => void
}) {
  const s = state.settings
  const set = (patch: any) => api().rtcSettingsSet(cwd, patch).then(refresh).catch((e) => toast('err', e.message))

  const rows: { key: keyof typeof s; label: string; detail: string; danger?: boolean }[] = [
    {
      key: 'includeUntracked',
      label: 'Include untracked files',
      detail: 'Untracked files join the manifest on the next rescan. Ignored files and secrets stay out either way.'
    },
    {
      key: 'terminalAccess',
      label: 'Terminal access for this session',
      detail: 'Allow opening a terminal from the session UI. Off by default; downloaded code deserves suspicion.',
      danger: true
    },
    {
      key: 'autoApplyRemote',
      label: 'Auto-apply remote patches',
      detail: 'Apply incoming accepted patches without a per-patch confirmation. Leave this off unless you fully trust every participant.',
      danger: true
    },
    {
      key: 'allowRunCommands',
      label: 'Allow running project commands',
      detail: 'Permit install/build/test runs started from the session UI. Never automatic - this only unlocks the buttons.',
      danger: true
    }
  ]

  return (
    <div className="mx-auto max-w-2xl">
      <Section title="Security">
        <ul className="space-y-1.5">
          {rows.map((r) => (
            <li key={r.key as string} className="flex items-center gap-3 rounded-lg border border-ink-700/50 bg-ink-800 px-3 py-2.5">
              <div className="min-w-0 flex-1">
                <div className={`text-sm font-medium ${r.danger && s[r.key] ? 'text-amber-300' : 'text-slate-100'}`}>{r.label}</div>
                <div className="text-[11px] text-slate-500">{r.detail}</div>
              </div>
              <Toggle on={!!s[r.key]} onClick={() => set({ [r.key]: !s[r.key] })} />
            </li>
          ))}
        </ul>
      </Section>

      <Section title="Always on">
        <ul className="space-y-1 rounded-lg border border-ink-700/50 bg-ink-800 px-4 py-3 text-xs text-slate-400">
          <li>- .git is never shared in snapshots</li>
          <li>- .env files, keys and other secret patterns are excluded from every manifest</li>
          <li>- symlinks are dropped; snapshot paths are checked against traversal</li>
          <li>- applying patches, staging and committing always ask first</li>
          <li>- nothing from a downloaded snapshot ever runs automatically</li>
          <li>- files over {humanSize(s.maxFileSize)} are lock-only, not live</li>
        </ul>
      </Section>

      <Section title="Excluded patterns">
        <div className="flex flex-wrap gap-1.5">
          {state.session.excludedPatterns.map((p) => (
            <span key={p} className="chip bg-ink-750 font-mono text-[10px] text-slate-400">
              {p}
            </span>
          ))}
        </div>
        <p className="mt-2 text-[11px] text-slate-500">
          Add project-specific exclusions in a .rtcignore file at the repo root (same syntax as .gitignore).
        </p>
      </Section>
    </div>
  )
}
