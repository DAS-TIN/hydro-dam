import React, { useEffect, useMemo, useState } from 'react'
import { api, ConflictFile, ConflictSegment, basename } from '../api'
import { IconClose, IconCheck } from "./Icons"

type Choice = 'ours' | 'theirs' | 'both' | 'base'

function reconstruct(file: ConflictFile, choices: Record<number, Choice>): string {
  const out: string[] = []
  file.segments.forEach((seg, idx) => {
    if (seg.type === 'text') {
      out.push(...(seg.lines ?? []))
    } else {
      const ch = choices[idx] ?? 'ours'
      if (ch === 'ours') out.push(...(seg.ours ?? []))
      else if (ch === 'theirs') out.push(...(seg.theirs ?? []))
      else if (ch === 'base') out.push(...(seg.base ?? []))
      else {
        out.push(...(seg.ours ?? []))
        out.push(...(seg.theirs ?? []))
      }
    }
  })
  return out.join('\n')
}

// What each delete/modify porcelain code means, from this repo's point of view.
const DELETE_INFO: Record<string, { text: string; keeps: string }> = {
  DU: { text: 'Deleted on your side; modified on theirs.', keeps: 'their modified version' },
  UD: { text: 'Modified on your side; deleted on theirs.', keeps: 'your modified version' },
  AU: { text: 'Added on your side; missing on theirs.', keeps: 'your new file' },
  UA: { text: 'Added on their side; missing on yours.', keeps: 'their new file' }
}

function Side({ label, lines, tone }: { label: string; lines?: string[]; tone: string }) {
  return (
    <div className="min-w-0 flex-1">
      <div className={`mb-1 text-[10px] font-semibold uppercase tracking-wide ${tone}`}>{label}</div>
      <pre className="max-h-48 overflow-auto rounded-md border border-ink-800 bg-ink-950 px-2 py-1.5 font-mono text-[12px] leading-[1.5] text-slate-300 select-text">
        {(lines ?? []).join('\n') || ' '}
      </pre>
    </div>
  )
}

export default function ConflictPanel({
  cwd,
  aiAvailable,
  autoAi,
  onResolved,
  onAi,
  onClose,
  toast
}: {
  cwd: string
  aiAvailable: boolean
  /** Ask the AI for a resolution of the first file as soon as the panel opens. */
  autoAi?: boolean
  onResolved: () => void
  onAi?: (title: string, run: () => Promise<string>) => void
  onClose: () => void
  toast: (kind: 'ok' | 'err', text: string) => void
}) {
  const [files, setFiles] = useState<ConflictFile[]>([])
  const [sel, setSel] = useState(0)
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)
  const [choices, setChoices] = useState<Record<string, Record<number, Choice>>>({})
  const [manual, setManual] = useState<string | null>(null) // non-null = manual edit mode
  const [threeWay, setThreeWay] = useState<{ base: string; ours: string; theirs: string } | null>(null)

  const reload = () => {
    setLoading(true)
    api()
      .conflictsList(cwd)
      .then((f) => {
        setFiles(f)
        setSel((s) => Math.min(s, Math.max(0, f.length - 1)))
      })
      .catch((e) => toast('err', e.message))
      .finally(() => setLoading(false))
  }
  useEffect(reload, [cwd])

  const file = files[sel]
  const fileChoices = file ? choices[file.path] ?? {} : {}
  // Delete/modify and both-deleted conflicts have no markers to merge; they
  // resolve by keeping or deleting the file, so most content UI is hidden.
  const deletish = !!file && (file.kind === 'delete' || file.kind === 'both-deleted')

  //Default every region to "ours" the first time a file is shown.
  useEffect(() => {
    if (!file || choices[file.path]) return
    const init: Record<number, Choice> = {}
    file.segments.forEach((s, i) => {
      if (s.type === 'conflict') init[i] = 'ours'
    })
    setChoices((c) => ({ ...c, [file.path]: init }))
    setManual(null)
  }, [file?.path])

  // Reset the 3-way view when switching files.
  useEffect(() => setThreeWay(null), [file?.path])

  // "Resolve with AI" from the conflict prompt: kick off the first suggestion.
  const [autoRan, setAutoRan] = useState(false)
  useEffect(() => {
    if (!autoAi || autoRan || loading || !file || file.binary || deletish) return
    setAutoRan(true)
    askAi()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [autoAi, autoRan, loading, file?.path])

  const toggleThreeWay = async () => {
    if (threeWay) {
      setThreeWay(null)
      return
    }
    if (!file) return
    try {
      setThreeWay(await api().conflictStages(cwd, file.path))
    } catch (e: any) {
      toast('err', e.message)
    }
  }

  const reconstructed = useMemo(
    () => (file ? reconstruct(file, fileChoices) : ''),
    [file, fileChoices]
  )

  function setChoice(idx: number, ch: Choice) {
    if (!file) return
    setChoices((c) => ({ ...c, [file.path]: { ...(c[file.path] ?? {}), [idx]: ch } }))
  }

  async function act(fn: () => Promise<any>, ok: string) {
    setBusy(true)
    try {
      await fn()
      toast('ok', ok)
      onResolved()
      reload()
      setManual(null)
    } catch (e: any) {
      toast('err', e.message)
    } finally {
      setBusy(false)
    }
  }

  async function askAi() {
    if (!file) return
    setBusy(true)
    try {
      const suggestion = await api().aiResolveConflict(cwd, file.path)
      setManual(suggestion)
      toast('ok', 'AI suggested a resolution - review it, then save.')
    } catch (e: any) {
      toast('err', e.message)
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm">
      <div className="card flex h-[86vh] w-[1040px] overflow-hidden shadow-2xl">
        {/* file list */}
        <div className="flex w-64 shrink-0 flex-col border-r border-ink-700/60">
          <div className="flex items-center justify-between border-b border-ink-700/60 px-4 py-3">
            <div className="text-sm font-semibold text-white">Conflicts</div>
            <span className="chip bg-bad/20 text-bad">{files.length}</span>
          </div>
          <div className="flex-1 overflow-auto">
            {loading && <div className="p-4 text-sm text-slate-500">Loading...</div>}
            {!loading && files.length === 0 && (
              <div className="flex flex-col items-center gap-1 p-6 text-center">
                <IconCheck className="w-6 h-6 text-good" />
                <div className="text-sm text-slate-300">No conflicts left</div>
                <div className="text-xs text-slate-600">All merges resolved.</div>
              </div>
            )}
            {files.map((f, i) => (
              <button
                key={f.path}
                onClick={() => setSel(i)}
                className={`block w-full border-b border-ink-800 px-4 py-2.5 text-left ${
                  i === sel ? 'bg-ink-750' : 'hover:bg-ink-850'
                }`}
              >
                <div className="truncate text-sm text-slate-100">{basename(f.path)}</div>
                <div className="truncate text-[11px] text-slate-500">{f.path}</div>
                <div className="mt-0.5 text-[10px] text-bad">
                  {f.kind === 'delete'
                    ? 'deleted on one side'
                    : f.kind === 'both-deleted'
                      ? 'deleted on both sides'
                      : f.binary
                        ? 'binary'
                        : `${f.conflictCount} conflict${f.conflictCount === 1 ? '' : 's'}`}
                </div>
              </button>
            ))}
          </div>
        </div>

        {/* resolver */}
        <div className="flex min-w-0 flex-1 flex-col">
          <div className="flex items-center gap-2 border-b border-ink-700/60 px-4 py-2.5">
            <span className="truncate text-sm font-medium text-slate-100">{file?.path ?? "-"}</span>
            <div className="flex-1" />
            {aiAvailable && file && !file.binary && !deletish && onAi && (
              <button
                className="btn-ghost text-xs"
                onClick={() => onAi(`Explain conflict - ${basename(file.path)}`, () => api().aiExplainConflict(cwd, file.path))}
                title="Explain this conflict with AI"
              >
                Explain
              </button>
            )}
            {aiAvailable && file && !file.binary && !deletish && (
              <button className="btn-soft text-xs" disabled={busy} onClick={askAi}>
                Ask AI
              </button>
            )}
            <button className="btn-ghost px-2" onClick={onClose}>
              <IconClose className="w-4 h-4" />
            </button>
          </div>

          {/* quick whole-file actions */}
          {file && !deletish && (
            <div className="flex items-center gap-2 border-b border-ink-800 bg-ink-900/60 px-4 py-2 text-xs">
              <span className="text-slate-500">Whole file:</span>
              <button
                className="btn-ghost text-xs"
                disabled={busy}
                onClick={() => act(() => api().conflictOurs(cwd, file.path), 'Kept ours.')}
              >
                Keep ours
              </button>
              <button
                className="btn-ghost text-xs"
                disabled={busy}
                onClick={() => act(() => api().conflictTheirs(cwd, file.path), 'Kept theirs.')}
              >
                Keep theirs
              </button>
              <div className="flex-1" />
              <button className="btn-ghost text-xs" disabled={busy} onClick={toggleThreeWay}>
                {threeWay ? 'Hide 3-way' : '3-way view'}
              </button>
              <button
                className="btn-ghost text-xs"
                onClick={() => setManual((m) => (m === null ? reconstructed : null))}
              >
                {manual === null ? 'Edit manually' : 'Back to regions'}
              </button>
            </div>
          )}

          <div className="min-h-0 flex-1 overflow-auto px-4 py-3">
            {file?.binary && (
              <div className="text-sm text-slate-400">
                Binary file - resolve with "Keep ours / Keep theirs".
              </div>
            )}

            {/* delete/modify: the file exists on one side only */}
            {file && file.kind === 'delete' && (
              <div className="flex h-full flex-col items-center justify-center gap-4 text-center">
                <div>
                  <div className="text-sm font-medium text-slate-100">
                    {DELETE_INFO[file.xy ?? '']?.text ?? 'One side deleted this file.'}
                  </div>
                  <div className="mt-1 text-xs text-slate-500">
                    Keeping it stages {DELETE_INFO[file.xy ?? '']?.keeps ?? 'the surviving version'} from the
                    working tree.
                  </div>
                </div>
                <div className="flex gap-2">
                  <button
                    className="btn-accent"
                    disabled={busy}
                    onClick={() => act(() => api().conflictKeepFile(cwd, file.path), `Kept ${basename(file.path)}.`)}
                  >
                    Keep file
                  </button>
                  <button
                    className="btn bg-bad/20 text-bad hover:bg-bad/30"
                    disabled={busy}
                    onClick={() =>
                      act(() => api().conflictDeleteFile(cwd, file.path), `Deleted ${basename(file.path)}.`)
                    }
                  >
                    Delete file
                  </button>
                </div>
              </div>
            )}

            {/* both sides deleted: just confirm */}
            {file && file.kind === 'both-deleted' && (
              <div className="flex h-full flex-col items-center justify-center gap-4 text-center">
                <div className="text-sm text-slate-100">Both sides deleted this file.</div>
                <button
                  className="btn-accent"
                  disabled={busy}
                  onClick={() =>
                    act(() => api().conflictDeleteFile(cwd, file.path), `Confirmed deletion of ${basename(file.path)}.`)
                  }
                >
                  Confirm deletion
                </button>
              </div>
            )}

            {/* manual edit mode */}
            {file && manual !== null && (
              <textarea
                value={manual}
                onChange={(e) => setManual(e.target.value)}
                spellCheck={false}
                className="h-full min-h-[300px] w-full resize-none rounded-lg border border-ink-700 bg-ink-950 p-3 font-mono text-[12.5px] leading-[1.55] text-slate-200 outline-none focus:border-accent select-text"
              />
            )}

            {/* full 3-way view: base | ours | theirs */}
            {file && manual === null && threeWay && !file.binary && (
              <div className="grid h-full grid-cols-3 gap-2">
                {([
                  ['Base', threeWay.base, 'text-slate-500'],
                  ['Ours', threeWay.ours, 'text-good'],
                  ['Theirs', threeWay.theirs, 'text-info']
                ] as const).map(([label, text, tone]) => (
                  <div key={label} className="flex min-h-0 flex-col">
                    <div className={`mb-1 text-[10px] font-semibold uppercase tracking-wide ${tone}`}>{label}</div>
                    <pre className="min-h-0 flex-1 overflow-auto rounded-md border border-ink-800 bg-ink-950 px-2 py-1.5 font-mono text-[11.5px] leading-[1.5] text-slate-300 select-text">
                      {text || ' '}
                    </pre>
                  </div>
                ))}
              </div>
            )}

            {/* region-by-region mode */}
            {file &&
              manual === null &&
              !threeWay &&
              !file.binary &&
              file.segments.map((seg: ConflictSegment, idx) =>
                seg.type === 'text' ? (
                  (seg.lines ?? []).join('').trim() ? (
                    <pre
                      key={idx}
                      className="my-1 whitespace-pre-wrap px-1 font-mono text-[12px] leading-[1.5] text-slate-500"
                    >
                      {(seg.lines ?? []).join('\n')}
                    </pre>
                  ) : null
                ) : (
                  <div key={idx} className="my-2 rounded-lg border border-ink-700/60 bg-ink-900 p-2.5">
                    <div className="mb-2 flex items-center gap-1 rounded-md bg-ink-950 p-0.5 text-xs">
                      {(['ours', 'theirs', 'both', ...(seg.hasBase ? (['base'] as Choice[]) : [])] as Choice[]).map(
                        (c) => (
                          <button
                            key={c}
                            onClick={() => setChoice(idx, c)}
                            className={`rounded px-2 py-0.5 font-medium capitalize ${
                              (fileChoices[idx] ?? 'ours') === c
                                ? 'bg-accent text-white'
                                : 'text-slate-400 hover:text-slate-200'
                            }`}
                          >
                            {c === 'both' ? 'keep both' : c}
                          </button>
                        )
                      )}
                    </div>
                    <div className="flex gap-3">
                      <Side label={`ours ${seg.oursLabel ?? ''}`} lines={seg.ours} tone="text-good" />
                      {seg.hasBase && <Side label="base" lines={seg.base} tone="text-slate-500" />}
                      <Side label={`theirs ${seg.theirsLabel ?? ''}`} lines={seg.theirs} tone="text-info" />
                    </div>
                  </div>
                )
              )}
          </div>

          {/* apply */}
          {file && !file.binary && !deletish && (
            <div className="flex items-center gap-2 border-t border-ink-700/60 bg-ink-900 px-4 py-3">
              <div className="flex-1 text-[11px] text-slate-500">
                {manual === null
                  ? 'Pick a side per region, then save.'
                  : 'Editing the merged file directly.'}
              </div>
              <button
                className="btn-accent"
                disabled={busy}
                onClick={() =>
                  act(
                    () =>
                      api().conflictResolve(
                        cwd,
                        file.path,
                        manual !== null ? manual : reconstructed
                      ),
                    `Resolved ${basename(file.path)}.`
                  )
                }
              >
                Save resolved &amp; stage
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
