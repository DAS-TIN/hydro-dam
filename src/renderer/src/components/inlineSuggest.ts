import { StateField, StateEffect, Prec, Extension } from '@codemirror/state'
import { EditorView, Decoration, DecorationSet, WidgetType, ViewPlugin, ViewUpdate, keymap } from '@codemirror/view'

// A minimal Copilot-style ghost text: grey suggestion after the cursor, accepted
// with Tab, dismissed with Escape or any edit. The suggestion text is fetched by
// a caller-supplied async function (here, an AI completion).

const setSuggestion = StateEffect.define<{ text: string; from: number } | null>()

class GhostWidget extends WidgetType {
  constructor(readonly text: string) {
    super()
  }
  eq(other: GhostWidget): boolean {
    return other.text === this.text
  }
  toDOM(): HTMLElement {
    const wrap = document.createElement('span')
    wrap.style.opacity = '0.4'
    // Render only the first line inline; the rest sits under it so multi-line
    // suggestions still read naturally.
    wrap.textContent = this.text
    return wrap
  }
}

const suggestionField = StateField.define<{ text: string; from: number } | null>({
  create: () => null,
  update(val, tr) {
    for (const e of tr.effects) if (e.is(setSuggestion)) return e.value
    // Any edit or cursor move invalidates a pending suggestion.
    if (val && (tr.docChanged || tr.selection)) return null
    return val
  },
  provide: (f) =>
    EditorView.decorations.from(f, (v): DecorationSet => {
      if (!v || !v.text) return Decoration.none
      return Decoration.set([Decoration.widget({ widget: new GhostWidget(v.text), side: 1 }).range(v.from)])
    })
})

function accept(view: EditorView): boolean {
  const s = view.state.field(suggestionField, false)
  if (!s) return false
  view.dispatch({
    changes: { from: s.from, insert: s.text },
    selection: { anchor: s.from + s.text.length },
    effects: setSuggestion.of(null)
  })
  return true
}

const acceptKeymap = Prec.highest(
  keymap.of([
    { key: 'Tab', run: accept },
    { key: 'Escape', run: (view) => (view.dispatch({ effects: setSuggestion.of(null) }), true) }
  ])
)

// Debounced fetcher: after the user pauses, ask for a suggestion at the cursor.
function fetcher(fetch: (prefix: string, suffix: string) => Promise<string>): Extension {
  return ViewPlugin.fromClass(
    class {
      timer: ReturnType<typeof setTimeout> | undefined
      update(u: ViewUpdate): void {
        if (!u.docChanged && !u.selectionSet) return
        clearTimeout(this.timer)
        this.timer = setTimeout(() => this.request(u.view), 600)
      }
      async request(view: EditorView): Promise<void> {
        const sel = view.state.selection.main
        if (!sel.empty) return
        const pos = sel.head
        const doc = view.state.doc
        const prefix = doc.sliceString(Math.max(0, pos - 4000), pos)
        const suffix = doc.sliceString(pos, Math.min(doc.length, pos + 1000))
        let text = ''
        try {
          text = await fetch(prefix, suffix)
        } catch {
          return
        }
        // Bail if the cursor moved or text changed while we waited.
        if (!text.trim() || view.state.selection.main.head !== pos) return
        view.dispatch({ effects: setSuggestion.of({ text, from: pos }) })
      }
      destroy(): void {
        clearTimeout(this.timer)
      }
    }
  )
}

export function inlineSuggestion(fetch: (prefix: string, suffix: string) => Promise<string>): Extension {
  return [suggestionField, acceptKeymap, fetcher(fetch)]
}
