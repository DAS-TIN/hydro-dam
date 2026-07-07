import React from 'react'
import { SHORTCUTS, Scope } from '../shortcuts'

const SECTIONS: { scope: Scope; title: string }[] = [
  { scope: 'global', title: 'Everywhere' },
  { scope: 'files', title: 'File list' },
  { scope: 'topbar', title: 'Top bar' },
  { scope: 'rail', title: 'Sidebar' },
  { scope: 'commit', title: 'Commit box' },
  { scope: 'main', title: 'Diff view' }
]

/** The "?" overlay. Rendered straight from the binding table in shortcuts.ts. */
export default function ShortcutSheet({ onClose }: { onClose: () => void }) {
  return (
    <div
      className="fixed inset-0 z-[65] flex items-center justify-center bg-black/60 backdrop-blur-sm"
      onClick={onClose}
    >
      <div
        className="card max-h-[85vh] w-[620px] overflow-y-auto shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center border-b border-ink-700/60 px-5 py-3.5">
          <h2 className="text-sm font-semibold text-white">Keyboard shortcuts</h2>
          <span className="ml-auto text-[11px] text-slate-500">? or Esc closes</span>
        </div>
        <div className="columns-2 gap-8 px-5 py-4">
          {SECTIONS.map(({ scope, title }) => (
            <div key={scope} className="mb-4 break-inside-avoid">
              <div className="mb-1 text-[11px] font-semibold uppercase tracking-wide text-slate-500">
                {title}
              </div>
              {SHORTCUTS.filter((s) => s.scope === scope).map((s) => (
                <div key={s.id} className="flex items-baseline gap-3 py-0.5 text-[13px]">
                  <span className="text-slate-300">{s.label}</span>
                  <span className="ml-auto shrink-0 whitespace-nowrap font-mono text-[11px] text-accent">
                    {s.display}
                  </span>
                </div>
              ))}
            </div>
          ))}
        </div>
        <div className="border-t border-ink-700/60 px-5 py-2.5 text-[11px] text-slate-500">
          Single letters only work while a list has focus, never while you type.
        </div>
      </div>
    </div>
  )
}
