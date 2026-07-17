import React, { useEffect, useRef } from 'react'
import { EditorView, keymap } from '@codemirror/view'
import { EditorState, Compartment, Extension } from '@codemirror/state'
import { indentWithTab } from '@codemirror/commands'
import { basicSetup } from 'codemirror'
import { oneDark } from '@codemirror/theme-one-dark'
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
  '.cm-scroller': { fontFamily: "'JetBrains Mono', ui-monospace, monospace" }
})

/**
 * A CodeMirror 6 editor with the same props the old textarea version exposed, so
 * callers don't change. Language is chosen from the file extension; the LSP
 * client will hook diagnostics and completion into this instance later.
 */
export default function CodeEditor({
  value,
  onChange,
  path,
  onSave
}: {
  value: string
  onChange: (v: string) => void
  path: string
  onSave?: () => void
}) {
  const host = useRef<HTMLDivElement>(null)
  const view = useRef<EditorView | null>(null)
  const language = useRef(new Compartment())
  // Keep the latest callbacks reachable from CodeMirror without rebuilding it.
  const cb = useRef({ onChange, onSave })
  cb.current = { onChange, onSave }

  useEffect(() => {
    if (!host.current) return
    const state = EditorState.create({
      doc: value,
      extensions: [
        basicSetup,
        keymap.of([
          indentWithTab,
          {
            key: 'Mod-s',
            run: () => {
              cb.current.onSave?.()
              return true
            }
          }
        ]),
        language.current.of(langForPath(path)),
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

  return <div ref={host} className="h-full min-h-0 overflow-auto" />
}
