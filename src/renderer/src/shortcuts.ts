// One binding table drives both the key dispatcher in App.tsx and the "?"
// cheat sheet, so the sheet can never drift from the behaviour. Rows marked
// `menu` are handled by application-menu accelerators in src/main/index.ts
// (they fire before the page sees the key); keep those two places in step.

export type Region = 'topbar' | 'rail' | 'files' | 'commit' | 'main'
export type Scope = Region | 'global'

export const REGION_LABELS: Record<Region, string> = {
  topbar: 'Top bar',
  rail: 'Sidebar',
  files: 'File list',
  commit: 'Commit box',
  main: 'Diff view'
}

export interface Shortcut {
  id: string
  scope: Scope
  /** Normalized combos as produced by comboOf(). Empty = documentation only. */
  combos: string[]
  display: string
  label: string
  /** Compact wording for the focus hint strip; label is used when absent. */
  short?: string
  menu?: boolean
}

export const SHORTCUTS: Shortcut[] = [
  // globals handled by menu accelerators in the main process
  { id: 'commit', scope: 'global', combos: ['ctrl+enter'], display: 'Ctrl+Enter', label: 'Commit staged changes', menu: true },
  { id: 'push', scope: 'global', combos: ['ctrl+p'], display: 'Ctrl+P', label: 'Push', menu: true },
  { id: 'pull', scope: 'global', combos: ['ctrl+shift+l'], display: 'Ctrl+Shift+L', label: 'Pull', menu: true },
  { id: 'fetch', scope: 'global', combos: ['ctrl+f'], display: 'Ctrl+F', label: 'Fetch', menu: true },
  { id: 'open', scope: 'global', combos: ['ctrl+o'], display: 'Ctrl+O', label: 'Open repository', menu: true },
  { id: 'stashes', scope: 'global', combos: ['ctrl+shift+s'], display: 'Ctrl+Shift+S', label: 'Stashes', menu: true },
  { id: 'settings', scope: 'global', combos: ['ctrl+,'], display: 'Ctrl+,', label: 'Settings', menu: true },

  // globals handled by the dispatcher
  { id: 'palette', scope: 'global', combos: ['ctrl+k', 'ctrl+shift+p'], display: 'Ctrl+K', label: 'Command palette' },
  { id: 'region.cycle', scope: 'global', combos: ['tab', 'shift+tab'], display: 'Tab / Shift+Tab', label: 'Move focus between areas' },
  {
    id: 'panel.jump',
    scope: 'global',
    combos: ['ctrl+1', 'ctrl+2', 'ctrl+3', 'ctrl+4', 'ctrl+5', 'ctrl+6', 'ctrl+7', 'ctrl+8', 'ctrl+9'],
    display: 'Ctrl+1..9',
    label: 'Jump to a sidebar panel'
  },
  { id: 'focus.lock', scope: 'global', combos: ['ctrl+tab'], display: 'Ctrl+Tab', label: 'Lock Tab to the focused area (press again to unlock)' },
  { id: 'focus.ultra', scope: 'global', combos: ['ctrl+shift+tab'], display: 'Ctrl+Shift+Tab', label: 'Ultra focus: the focused area takes the whole window' },
  { id: 'ultra.switch', scope: 'global', combos: [], display: 'Shift+Left/Right', label: 'In ultra focus: switch to the next view (Tab moves inside)' },
  { id: 'undo', scope: 'global', combos: ['z'], display: 'z', label: 'Undo the last stage / unstage / hide' },
  { id: 'redo', scope: 'global', combos: ['shift+z'], display: 'Shift+Z', label: 'Redo the last undone operation' },
  { id: 'cheatsheet', scope: 'global', combos: ['?'], display: '?', label: 'This cheat sheet' },
  { id: 'back', scope: 'global', combos: ['escape'], display: 'Esc', label: 'Close dialog / back out one step' },

  // top bar
  { id: 'topbar.move', scope: 'topbar', combos: ['arrowleft', 'arrowright', 'arrowup', 'arrowdown'], display: 'Arrows', label: 'Move between actions', short: 'choose' },
  { id: 'topbar.open', scope: 'topbar', combos: [], display: 'Enter', label: 'Press the highlighted action', short: 'press' },

  // file list
  { id: 'files.move', scope: 'files', combos: ['arrowup', 'arrowdown'], display: 'Up / Down', label: 'Move selection', short: 'select' },
  { id: 'files.mode', scope: 'files', combos: ['arrowleft', 'arrowright'], display: 'Left / Right', label: 'Switch between the Changes and Files views', short: 'view' },
  { id: 'files.toggle', scope: 'files', combos: ['space', 's'], display: 'Space / s', label: 'Stage or unstage the selected file', short: 'stage' },
  { id: 'files.stageAll', scope: 'files', combos: ['a'], display: 'a', label: 'Stage everything', short: 'stage all' },
  { id: 'files.unstageAll', scope: 'files', combos: ['u'], display: 'u', label: 'Unstage everything', short: 'unstage all' },
  { id: 'files.open', scope: 'files', combos: ['enter'], display: 'Enter', label: 'Open the diff for the selected file', short: 'diff' },
  { id: 'files.discard', scope: 'files', combos: ['ctrl+d'], display: 'Ctrl+D', label: 'Discard the selected file (asks first)', short: 'discard' },
  { id: 'files.commitBox', scope: 'files', combos: ['c'], display: 'c', label: 'Jump to the commit message', short: 'message' },

  // commit box
  { id: 'commit.commit', scope: 'commit', combos: [], display: 'Ctrl+Enter', label: 'Commit staged changes', short: 'commit' },
  { id: 'commit.controls', scope: 'commit', combos: ['arrowup', 'arrowdown'], display: 'Up / Down', label: 'Move between the commit controls (Esc leaves the message first)', short: 'controls' },
  { id: 'commit.back', scope: 'commit', combos: [], display: 'Esc', label: 'Message to controls, then back to the file list', short: 'back' },

  // main view
  { id: 'main.scroll', scope: 'main', combos: ['arrowup', 'arrowdown'], display: 'Up / Down', label: 'Scroll the diff', short: 'scroll' },
  { id: 'main.tabs', scope: 'main', combos: ['arrowleft', 'arrowright'], display: 'Left / Right', label: 'Switch the Changes / Graph tabs', short: 'tabs' },
  { id: 'main.view', scope: 'main', combos: ['d', 'f', 'p'], display: 'd / f / p', label: 'Show the diff, the file, or the markdown preview', short: 'view' },
  { id: 'main.toggle', scope: 'main', combos: ['s', 'space'], display: 'Space / s', label: 'Stage or unstage this file', short: 'stage' },
  { id: 'main.blame', scope: 'main', combos: ['b'], display: 'b', label: 'Blame this file', short: 'blame' },
  { id: 'main.history', scope: 'main', combos: ['h'], display: 'h', label: 'History of this file', short: 'history' },
  { id: 'main.graph', scope: 'main', combos: ['g'], display: 'g', label: 'Commit graph for this file', short: 'graph' },
  { id: 'main.difftool', scope: 'main', combos: ['shift+d'], display: 'Shift+D', label: 'Open in the external difftool', short: 'difftool' },
  { id: 'main.reveal', scope: 'main', combos: ['r'], display: 'r', label: 'Reveal in the file manager', short: 'reveal' },
  { id: 'main.open', scope: 'main', combos: ['o'], display: 'o', label: 'Open with the default app', short: 'open' },
  { id: 'main.diffmode', scope: 'main', combos: ['t'], display: 't', label: 'Toggle unified / split diff', short: 'split' },

  // sidebar rail
  { id: 'rail.move', scope: 'rail', combos: ['arrowup', 'arrowdown'], display: 'Up / Down', label: 'Move between panels', short: 'choose' },
  { id: 'rail.open', scope: 'rail', combos: [], display: 'Enter', label: 'Open the highlighted panel', short: 'open' }
]

/**
 * Normalize a key event to a combo string: 'ctrl+shift+l', 'arrowdown', '?'.
 * Cmd counts as Ctrl on macOS. Shift is named for letters ('shift+z') and
 * non-printable keys; symbols already carry it in the character ('?' not
 * 'shift+/').
 */
export function comboOf(e: KeyboardEvent): string {
  const key = e.key === ' ' ? 'space' : e.key.toLowerCase()
  const parts: string[] = []
  if (e.ctrlKey || e.metaKey) parts.push('ctrl')
  if (e.altKey) parts.push('alt')
  if (e.shiftKey && (key.length > 1 || /^[a-z]$/.test(key))) parts.push('shift')
  parts.push(key)
  return parts.join('+')
}

/** Region binding wins over a global one with the same combo. */
export function findShortcut(region: Region, combo: string): Shortcut | null {
  return (
    SHORTCUTS.find((s) => !s.menu && s.scope === region && s.combos.includes(combo)) ??
    SHORTCUTS.find((s) => !s.menu && s.scope === 'global' && s.combos.includes(combo)) ??
    null
  )
}

// Controls the arrow keys can land on while roving inside a container.
// data-rove-skip marks minor controls that plain arrow cycling jumps over;
// locked focus mode (Ctrl+Tab) includes them.
export function focusables(root: HTMLElement | null, all = false): HTMLElement[] {
  return [
    ...(root?.querySelectorAll<HTMLElement>('button, input, select, textarea, [href]') ?? [])
  ].filter(
    (el) =>
      !el.hasAttribute('disabled') &&
      el.offsetParent !== null &&
      (all || !el.hasAttribute('data-rove-skip'))
  )
}

export function moveFocusWithin(
  root: HTMLElement | null,
  dir: 1 | -1,
  opts: { wrap?: boolean; all?: boolean } = {}
) {
  const els = focusables(root, opts.all)
  if (els.length === 0) return
  const at = els.indexOf(document.activeElement as HTMLElement)
  let to: HTMLElement | undefined
  if (at === -1) to = dir === 1 ? els[0] : els[els.length - 1]
  else if (opts.wrap) to = els[(at + dir + els.length) % els.length]
  else to = els[at + dir]
  to?.focus()
}

/** True while the user is typing somewhere; single-letter keys must stay dead. */
export function isTextTarget(t: EventTarget | null): boolean {
  if (!(t instanceof HTMLElement)) return false
  if (t.tagName === 'TEXTAREA' || t.isContentEditable) return true
  if (t.tagName !== 'INPUT') return false
  // Checkboxes and friends act like buttons, not typing surfaces.
  return !['checkbox', 'radio', 'button', 'submit', 'range', 'file'].includes(
    (t as HTMLInputElement).type
  )
}
