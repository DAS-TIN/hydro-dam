import React, { useEffect, useRef } from 'react'
import { EditorView, keymap, hoverTooltip } from '@codemirror/view'
import { EditorState, Compartment, Extension } from '@codemirror/state'
import { autocompletion, CompletionContext, Completion } from '@codemirror/autocomplete'
import { indentWithTab } from '@codemirror/commands'
import { lintGutter, setDiagnostics, Diagnostic } from '@codemirror/lint'
import { basicSetup } from 'codemirror'
import { oneDark } from '@codemirror/theme-one-dark'
import { api, LspDiagnostic, LspHover, LspCompletionItem } from '../api'
import { inlineSuggestion } from './inlineSuggest'
import { javascript } from '@codemirror/lang-javascript'
import { python } from '@codemirror/lang-python'
import { css } from '@codemirror/lang-css'
import { html } from '@codemirror/lang-html'
import { json } from '@codemirror/lang-json'
import { markdown } from '@codemirror/lang-markdown'
import { rust } from '@codemirror/lang-rust'
import { cpp } from '@codemirror/lang-cpp'
import { go } from '@codemirror/lang-go'
import { java } from '@codemirror/lang-java'
import { sql } from '@codemirror/lang-sql'
import { yaml } from '@codemirror/lang-yaml'
import { xml } from '@codemirror/lang-xml'

// Pick the CodeMirror language for a path's extension. Unknown types get plain
// text - still fully editable, just without grammar-aware highlighting.
function langForPath(path: string): Extension[] {
  const ext = path.split('.').pop()?.toLowerCase() || ''
  switch (ext) {
    case 'js':
    case 'jsx':
    case 'mjs':
    case 'cjs':
      return [javascript({ jsx: true })]
    case 'ts':
      return [javascript({ typescript: true })]
    case 'tsx':
      return [javascript({ typescript: true, jsx: true })]
    case 'py':
      return [python()]
    case 'css':
    case 'scss':
    case 'less':
      return [css()]
    case 'html':
    case 'htm':
      return [html()]
    case 'json':
      return [json()]
    case 'md':
    case 'markdown':
      return [markdown()]
    case 'rs':
      return [rust()]
    case 'c':
    case 'h':
    case 'cc':
    case 'cpp':
    case 'cxx':
    case 'hpp':
      return [cpp()]
    case 'go':
      return [go()]
    case 'java':
      return [java()]
    case 'sql':
      return [sql()]
    case 'yml':
    case 'yaml':
      return [yaml()]
    case 'xml':
      return [xml()]
    default:
      return []
  }
}

const appTheme = EditorView.theme({
  '&': { fontSize: '12.5px', height: '100%' },
  '.cm-scroller': { fontFamily: "'JetBrains Mono', ui-monospace, monospace" },
  // Center the fold chevrons in the gutter so they line up with the digits, and
  // keep them quiet until hovered.
  '.cm-foldGutter .cm-gutterElement': {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    width: '14px',
    color: '#4a5170',
    cursor: 'pointer'
  },
  '.cm-foldGutter .cm-gutterElement:hover': { color: '#9aa4c4' },
  // The collapsed section reads as a small pill on the line instead of raw dots.
  '.cm-foldPlaceholder': {
    background: '#2a2f45',
    border: '1px solid #3a4160',
    color: '#9aa4c4',
    borderRadius: '5px',
    padding: '0 6px',
    margin: '0 3px',
    fontSize: '11px'
  }
})

const SEVERITY: Record<number, Diagnostic['severity']> = { 1: 'error', 2: 'warning', 3: 'info', 4: 'hint' }

// LSP CompletionItemKind -> a CodeMirror completion type (drives the little icon).
const CMPL_KIND: Record<number, string> = {
  2: 'method', 3: 'function', 4: 'function', 5: 'property', 6: 'variable', 7: 'class',
  8: 'interface', 9: 'namespace', 10: 'property', 13: 'enum', 14: 'keyword', 21: 'constant'
}

// Flatten an LSP hover payload (string / MarkupContent / MarkedString[]) to plain
// text, dropping code fences so the tooltip stays readable.
function hoverText(h: LspHover | null): string {
  if (!h) return ''
  const one = (x: unknown): string => (typeof x === 'string' ? x : ((x as { value?: string })?.value ?? ''))
  const raw = Array.isArray(h.contents) ? h.contents.map(one).join('\n\n') : one(h.contents)
  return raw.replace(/```[\w-]*\n?/g, '').trim()
}

// Turn LSP diagnostics (line/character ranges) into CodeMirror ones (document
// offsets), clamping anything that points past the current text.
function toCmDiagnostics(view: EditorView, diags: LspDiagnostic[]): Diagnostic[] {
  const doc = view.state.doc
  const offset = (line: number, ch: number): number => {
    const l = doc.line(Math.min(Math.max(line, 0), doc.lines - 1) + 1)
    return Math.min(l.from + Math.max(ch, 0), l.to)
  }
  return diags.map((d) => {
    const from = offset(d.range.start.line, d.range.start.character)
    const to = Math.max(from, offset(d.range.end.line, d.range.end.character))
    return {
      from,
      to,
      severity: SEVERITY[d.severity ?? 1] ?? 'error',
      message: d.source ? `${d.message} (${d.source})` : d.message
    }
  })
}

/**
 * A CodeMirror 6 editor with the same props the old textarea version exposed, so
 * callers don't change. Language is chosen from the file extension; the LSP
 * client will hook diagnostics and completion into this instance later.
 */
export default function CodeEditor({
  value,
  onChange,
  path,
  cwd,
  onSave,
  onDefinition,
  diagnostics
}: {
  value: string
  onChange: (v: string) => void
  path: string
  cwd?: string
  onSave?: () => void
  onDefinition?: (loc: { uri: string; path: string; line: number }) => void
  diagnostics?: LspDiagnostic[]
}) {
  const host = useRef<HTMLDivElement>(null)
  const view = useRef<EditorView | null>(null)
  const language = useRef(new Compartment())
  // Keep the latest callbacks + file identity reachable from CodeMirror without
  // rebuilding the editor.
  const cb = useRef({ onChange, onSave, onDefinition })
  cb.current = { onChange, onSave, onDefinition }
  const meta = useRef({ cwd: cwd ?? '', path })
  meta.current = { cwd: cwd ?? '', path }
  // Only fetch AI ghost-text once we know a provider is configured.
  const aiOk = useRef(false)
  useEffect(() => {
    api().aiAvailable().then((v) => (aiOk.current = v)).catch(() => {})
  }, [])

  useEffect(() => {
    if (!host.current) return

    const lspHover = hoverTooltip(async (v, pos) => {
      const { cwd, path } = meta.current
      if (!cwd) return null
      const line = v.state.doc.lineAt(pos)
      const h = await api().lspHover(cwd, path, line.number - 1, pos - line.from).catch(() => null)
      const text = hoverText(h)
      if (!text) return null
      return {
        pos,
        above: true,
        create: () => {
          const dom = document.createElement('div')
          dom.textContent = text
          dom.style.cssText = 'padding:4px 8px;max-width:480px;white-space:pre-wrap;font-size:12px'
          return { dom }
        }
      }
    })

    const lspComplete = autocompletion({
      override: [
        async (ctx: CompletionContext) => {
          const { cwd, path } = meta.current
          if (!cwd) return null
          const word = ctx.matchBefore(/[\w$]+/)
          if (!ctx.explicit && !word) return null
          const line = ctx.state.doc.lineAt(ctx.pos)
          const res = await api().lspCompletion(cwd, path, line.number - 1, ctx.pos - line.from).catch(() => null)
          const items: LspCompletionItem[] = Array.isArray(res) ? res : (res?.items ?? [])
          if (!items.length) return null
          const options: Completion[] = items.slice(0, 200).map((it) => ({
            label: it.label,
            detail: it.detail,
            type: it.kind ? CMPL_KIND[it.kind] : undefined,
            apply: it.insertText || it.label
          }))
          return { from: word ? word.from : ctx.pos, options }
        }
      ]
    })

    const goToDefinition = async (v: EditorView): Promise<void> => {
      const { cwd, path } = meta.current
      if (!cwd) return
      const pos = v.state.selection.main.head
      const line = v.state.doc.lineAt(pos)
      const res = await api().lspDefinition(cwd, path, line.number - 1, pos - line.from).catch(() => null)
      const loc = Array.isArray(res) ? res[0] : res
      if (!loc) return
      const target = decodeURIComponent(loc.uri)
        .replace(/^file:\/\//, '')
        .replace(/^\/([A-Za-z]:)/, '$1')
      const here = `${cwd}/${path}`.replace(/\\/g, '/')
      if (target === here || target.replace(/\\/g, '/').endsWith(path)) {
        const l = v.state.doc.line(Math.min(loc.range.start.line + 1, v.state.doc.lines))
        v.dispatch({ selection: { anchor: l.from + loc.range.start.character }, scrollIntoView: true })
        v.focus()
      } else {
        cb.current.onDefinition?.({ uri: loc.uri, path: target, line: loc.range.start.line })
      }
    }

    const state = EditorState.create({
      doc: value,
      extensions: [
        basicSetup,
        keymap.of([
          indentWithTab,
          { key: 'Mod-s', run: () => (cb.current.onSave?.(), true) },
          { key: 'F12', run: (v) => (goToDefinition(v), true) }
        ]),
        language.current.of(langForPath(path)),
        lspHover,
        lspComplete,
        inlineSuggestion(async (prefix, suffix) => {
          if (!aiOk.current) return ''
          const lang = meta.current.path.split('.').pop()?.toLowerCase() || 'text'
          return api().aiInlineComplete(prefix, suffix, lang).catch(() => '')
        }),
        lintGutter(),
        oneDark,
        appTheme,
        EditorView.updateListener.of((u) => {
          if (u.docChanged) cb.current.onChange(u.state.doc.toString())
        })
      ]
    })
    const v = new EditorView({ state, parent: host.current })
    view.current = v
    v.focus()
    return () => {
      v.destroy()
      view.current = null
    }
    // Build once; path/value changes are handled by the effects below.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Reconfigure the grammar when the open file's type changes.
  useEffect(() => {
    view.current?.dispatch({ effects: language.current.reconfigure(langForPath(path)) })
  }, [path])

  // Push external value changes in without clobbering local edits.
  useEffect(() => {
    const v = view.current
    if (v && value !== v.state.doc.toString()) {
      v.dispatch({ changes: { from: 0, to: v.state.doc.length, insert: value } })
    }
  }, [value])

  // Paint the latest diagnostics from the language server.
  useEffect(() => {
    const v = view.current
    if (v) v.dispatch(setDiagnostics(v.state, toCmDiagnostics(v, diagnostics ?? [])))
  }, [diagnostics])

  return <div ref={host} className="h-full min-h-0 overflow-auto" />
}
