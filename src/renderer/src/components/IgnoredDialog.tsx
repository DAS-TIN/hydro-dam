import React, { useState } from 'react'
import { api, ExcludeScope, IgnoreCheck } from '../api'
import { IconClose } from './Icons'

const META: Record<'gitignore' | 'local' | 'global', { title: string; scope: ExcludeScope; hint: string }> = {
  gitignore: { title: '.gitignore', scope: 'shared', hint: 'committed and shared with the team' },
  local: { title: 'Local exclude (.git/info/exclude)', scope: 'private', hint: 'private to this clone' },
  global: { title: 'Global exclude', scope: 'global', hint: 'applies to every repo on this machine' }
}

/** The files one ignore source excludes, plus add-a-pattern and test-a-path. */
export default function IgnoredDialog({
  cwd,
  which,
  files,
  toast,
  onChanged,
  onManageRules,
  onClose
}: {
  cwd: string
  which: 'gitignore' | 'local' | 'global'
  files: string[]
  toast: (kind: 'ok' | 'err', text: string) => void
  onChanged: () => void
  onManageRules: () => void
  onClose: () => void
}) {
  const meta = META[which]
  const [pattern, setPattern] = useState('')
  const [testPath, setTestPath] = useState('')
  const [testResult, setTestResult] = useState<IgnoreCheck | null>(null)
  const [busy, setBusy] = useState(false)

  const addPattern = async () => {
    const p = pattern.trim()
    if (!p) return
    setBusy(true)
    try {
      await api().excludesAdd(cwd, meta.scope, p)
      toast('ok', `Added "${p}" to ${meta.title}.`)
      setPattern('')
      onChanged()
    } catch (e: any) {
      toast('err', e?.message || String(e))
    } finally {
      setBusy(false)
    }
  }

  const runTest = async () => {
    const p = testPath.trim()
    if (!p) return
    setBusy(true)
    try {
      setTestResult(await api().excludesCheck(cwd, p))
    } catch (e: any) {
      toast('err', e?.message || String(e))
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm" onClick={onClose}>
      <div className="card flex max-h-[76vh] w-[520px] flex-col overflow-hidden shadow-2xl" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between border-b border-ink-700/60 px-5 py-3">
          <div>
            <h2 className="text-sm font-semibold text-white">{meta.title}</h2>
            <p className="text-[11px] text-slate-500">Rules here are {meta.hint}.</p>
          </div>
          <button className="btn-ghost px-2" onClick={onClose}>
            <IconClose className="w-4 h-4" />
          </button>
        </div>

        {/* add a pattern */}
        <div className="flex gap-2 border-b border-ink-800 bg-ink-900/60 px-5 py-3">
          <input
            value={pattern}
            onChange={(e) => setPattern(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && addPattern()}
            placeholder="Add a pattern (e.g. dist/, *.log, notes/**.tmp)"
            className="flex-1 rounded-md border border-ink-700 bg-ink-950 px-3 py-1.5 font-mono text-sm outline-none focus:border-accent select-text"
          />
          <button className="btn-accent text-sm" disabled={busy || !pattern.trim()} onClick={addPattern}>
            Add
          </button>
        </div>

        {/* test a path */}
        <div className="border-b border-ink-800 px-5 py-3">
          <div className="flex gap-2">
            <input
              value={testPath}
              onChange={(e) => setTestPath(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && runTest()}
              placeholder="Test a path: would git ignore it?"
              className="flex-1 rounded-md border border-ink-700 bg-ink-950 px-3 py-1.5 font-mono text-sm outline-none focus:border-accent select-text"
            />
            <button className="btn-soft text-sm" disabled={busy || !testPath.trim()} onClick={runTest}>
              Test
            </button>
          </div>
          {testResult && (
            <div className={`mt-2 text-xs ${testResult.ignored ? 'text-warn' : 'text-good'}`}>
              {testResult.ignored
                ? `Ignored${testResult.pattern ? ` by "${testResult.pattern}"` : ''}${
                    testResult.source ? ` (${testResult.source}${testResult.line ? `:${testResult.line}` : ''})` : ''
                  }`
                : 'Not ignored - git tracks changes to this path.'}
            </div>
          )}
        </div>

        <div className="min-h-0 flex-1 overflow-auto px-5 py-3">
          <div className="mb-1.5 text-[11px] font-semibold uppercase tracking-wide text-slate-500">
            Files excluded by this source ({files.length})
          </div>
          {files.length === 0 ? (
            <div className="py-4 text-center text-sm text-slate-500">No files excluded by this rule.</div>
          ) : (
            <ul className="space-y-0.5">
              {files.map((f) => (
                <li key={f} className="truncate font-mono text-xs text-slate-300" title={f}>
                  {f}
                </li>
              ))}
            </ul>
          )}
        </div>

        <div className="flex items-center justify-between border-t border-ink-700/60 px-5 py-3">
          <button className="btn-ghost text-xs" onClick={onManageRules}>
            Manage all rules...
          </button>
          <button className="btn-ghost text-sm" onClick={onClose}>
            Close
          </button>
        </div>
      </div>
    </div>
  )
}
