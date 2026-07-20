import React, { useEffect, useState } from 'react'
import { api, FilePreview as Preview, humanSize } from '../api'
import { isMarkdown } from '../highlight'
import FileContent from './FileContent'

export default function FilePreview({
  cwd,
  path,
  toast,
  savedDraft,
  onDraftChange
}: {
  cwd: string
  path: string
  toast: (kind: 'ok' | 'err', text: string) => void
  savedDraft?: string
  onDraftChange?: (path: string, value: string | null) => void
}) {
  const md = isMarkdown(path)
  const [view, setView] = useState<'code' | 'preview'>(md ? 'preview' : 'code')
  const [info, setInfo] = useState<Preview | null>(null)
  const [dirty, setDirty] = useState(false)

  useEffect(() => setView(isMarkdown(path) ? 'preview' : 'code'), [path])

  const open = () => api().openFile(cwd, path).catch((e) => toast('err', e.message))
  const reveal = () => api().revealFile(cwd, path).catch((e) => toast('err', e.message))

  return (
    <>
      <div className="flex items-center gap-3 border-b border-ink-800 px-4 py-2.5">
        <span className="truncate text-sm font-medium text-slate-100">{path}</span>
        {dirty && (
          <span className="flex shrink-0 items-center gap-1 text-[11px] text-slate-400" title="Ctrl+S to save">
            <span className="h-2 w-2 rounded-full bg-slate-100" />
            unsaved
          </span>
        )}
        {info && <span className="text-[11px] text-slate-500">{humanSize(info.size)}</span>}
        {md && (
          <div className="flex shrink-0 gap-0.5 rounded-md bg-ink-950 p-0.5">
            {(['preview', 'code'] as const).map((v) => (
              <button
                key={v}
                onClick={() => setView(v)}
                className={`rounded px-2 py-0.5 text-[11px] font-medium ${
                  view === v ? 'bg-ink-750 text-white' : 'text-slate-400 hover:text-slate-200'
                }`}
              >
                {v === 'preview' ? 'Preview' : 'Code'}
              </button>
            ))}
          </div>
        )}
        <div className="flex-1" />
        <button className="btn-ghost text-xs" onClick={reveal}>
          Reveal
        </button>
        <button className="btn-soft text-xs" onClick={open}>
          Open externally
        </button>
      </div>
      <div className="min-h-0 flex-1 overflow-auto bg-ink-900">
        <FileContent
          cwd={cwd}
          path={path}
          view={view}
          editable
          toast={toast}
          onLoaded={setInfo}
          onDirtyChange={setDirty}
          savedDraft={savedDraft}
          onDraftChange={onDraftChange}
        />
      </div>
    </>
  )
}
