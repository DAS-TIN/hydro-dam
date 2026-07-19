import React, { useEffect, useState } from 'react'
import { api, FilePreview as Preview, LspDiagnostic, humanSize } from '../api'
import { isMarkdown } from '../highlight'
import CodeView from './CodeView'
import CodeEditor from './CodeEditor'
import Markdown from './Markdown'

/**
 * Loads a working-tree file and renders it as highlighted code or, for
 * markdown in preview mode, as a rendered document. With `editable` it can
 * flip into a plain-text editor and save back to disk. Parent provides the
 * scroll container.
 */
export default function FileContent({
  cwd,
  path,
  view,
  editable,
  toast,
  onSaved,
  onLoaded,
  onDirtyChange
}: {
  cwd: string
  path: string
  view: 'code' | 'preview'
  editable?: boolean
  toast?: (kind: 'ok' | 'err', text: string) => void
  onSaved?: () => void
  onLoaded?: (p: Preview) => void
  onDirtyChange?: (dirty: boolean) => void
}) {
  const [data, setData] = useState<Preview | null>(null)
  const [error, setError] = useState('')
  const [draft, setDraft] = useState('')
  const [saving, setSaving] = useState(false)
  const [diagnostics, setDiagnostics] = useState<LspDiagnostic[]>([])

  const active = !!editable && data?.kind === 'text'
  const dirty = active && draft !== (data?.text ?? '')

  useEffect(() => onDirtyChange?.(dirty), [dirty, onDirtyChange])

  // While a file is open for editing, hand it to the language server and listen
  // for the diagnostics it publishes back for this exact file.
  useEffect(() => {
    if (!active) return
    let live = true
    api().lspOpen(cwd, path, draft).catch(() => {})
    const off = api().onLspDiagnostics((p) => {
      if (live && p.cwd === cwd && p.path === path) setDiagnostics(p.diagnostics)
    })
    return () => {
      live = false
      off()
      api().lspClose(cwd, path).catch(() => {})
      setDiagnostics([])
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active, cwd, path])

  // Debounced didChange so the server re-lints as you type, not every keystroke.
  useEffect(() => {
    if (!active) return
    const t = setTimeout(() => api().lspChange(cwd, path, draft).catch(() => {}), 400)
    return () => clearTimeout(t)
  }, [draft, active, cwd, path])

  useEffect(() => {
    let live = true
    setData(null)
    setError('')
    api()
      .readFile(cwd, path)
      .then((p) => {
        if (!live) return
        setData(p)
        setDraft(p.text ?? '')
        onLoaded?.(p)
      })
      .catch((e) => live && setError(e.message))
    return () => {
      live = false
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cwd, path])

  const save = async () => {
    if (saving || !dirty) return
    setSaving(true)
    try {
      await api().writeFile(cwd, path, draft)
      const fresh = await api().readFile(cwd, path)
      setData(fresh)
      onSaved?.()
    } catch (e: any) {
      toast?.('err', e?.message || String(e))
    } finally {
      setSaving(false)
    }
  }

  if (error) return <div className="p-4 text-sm text-bad">{error}</div>
  if (!data) return <div className="p-4 text-sm text-slate-500">Loading...</div>

  if (data.kind === 'text') {
    const md = isMarkdown(path)

    // Not editable: read-only view, rendered markdown in preview mode.
    if (!editable) {
      return view === 'preview' && md ? (
        <Markdown text={data.text ?? ''} />
      ) : (
        <CodeView text={data.text ?? ''} path={path} />
      )
    }

    // Editable: markdown in preview mode renders the (unsaved) draft; everything
    // else is the live editor. Ctrl+S saves; the dirty dot lives in the header.
    if (md && view === 'preview') {
      return (
        <div className="min-h-0 flex-1 overflow-auto">
          <Markdown text={draft} />
        </div>
      )
    }
    return (
      <div className="h-full min-h-0">
        <CodeEditor
          value={draft}
          onChange={setDraft}
          path={path}
          cwd={cwd}
          onSave={save}
          diagnostics={diagnostics}
          onDefinition={(loc) => toast?.('ok', `Definition: ${loc.path}:${loc.line + 1}`)}
        />
      </div>
    )
  }

  if (data.kind === 'image') {
    return (
      <div className="flex h-full items-center justify-center p-6">
        <img
          src={data.dataUrl}
          alt={path}
          className="max-h-full max-w-full rounded-lg border border-ink-800 object-contain shadow-xl"
        />
      </div>
    )
  }

  return (
    <div className="flex h-full flex-col items-center justify-center gap-3 text-center">
      <div className="text-sm text-slate-400">
        {data.kind === 'binary' && "This looks like a binary file - can't preview it here."}
        {data.kind === 'too-large' && `Too large to preview (${humanSize(data.size)}).`}
        {data.kind === 'missing' && 'File not found on disk.'}
      </div>
      {data.kind !== 'missing' && (
        <button className="btn-accent" onClick={() => api().openFile(cwd, path).catch(() => {})}>
          Open in default app
        </button>
      )}
    </div>
  )
}
