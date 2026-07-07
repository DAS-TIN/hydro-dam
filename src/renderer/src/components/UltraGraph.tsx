import React, { useState } from 'react'
import { TrackerView } from '../api'
import CommitsPanel from './CommitsPanel'
import TrelloBoardView from './TrelloBoardView'

// The graph, full window. Changes already owns the main pane so this is the
// view that gains the most from the space; Trello gets a tab when connected.
export default function UltraGraph({
  cwd,
  currentBranch,
  trelloTracker,
  aiAvailable,
  toast,
  onChanged,
  onInteractiveRebase,
  onAi,
  onBranchCreated
}: {
  cwd: string
  currentBranch: string
  trelloTracker: TrackerView | null
  aiAvailable: boolean
  toast: (kind: 'ok' | 'err' | 'info', text: string) => void
  onChanged: () => void
  onInteractiveRebase: (base: string) => void
  onAi: (title: string, run: () => Promise<string>) => void
  onBranchCreated: () => void
}) {
  const [tab, setTab] = useState<'graph' | 'trello'>('graph')

  return (
    <div
      data-ultra
      className="fixed inset-0 z-40 flex flex-col bg-gradient-to-br from-ink-950 via-ink-900 to-ink-850 px-6 pb-12 pt-4"
    >
      {trelloTracker && (
        <div className="mb-3 flex justify-center gap-1">
          {(
            [
              ['graph', 'Graph'],
              ['trello', trelloTracker.label || 'Trello']
            ] as const
          ).map(([id, label]) => (
            <button
              key={id}
              onClick={() => setTab(id)}
              className={`rounded-md px-4 py-1.5 text-xs font-medium ${
                tab === id ? 'bg-accent/20 text-accent' : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              {label}
            </button>
          ))}
        </div>
      )}
      <div className="card flex min-h-0 flex-1 overflow-hidden">
        {tab === 'graph' ? (
          <CommitsPanel
            embedded
            cwd={cwd}
            currentBranch={currentBranch}
            toast={toast}
            onChanged={onChanged}
            onInteractiveRebase={onInteractiveRebase}
            aiAvailable={aiAvailable}
            onAi={onAi}
          />
        ) : (
          trelloTracker && (
            <TrelloBoardView
              tracker={trelloTracker}
              cwd={cwd}
              toast={toast}
              onBranchCreated={onBranchCreated}
            />
          )
        )}
      </div>
    </div>
  )
}
