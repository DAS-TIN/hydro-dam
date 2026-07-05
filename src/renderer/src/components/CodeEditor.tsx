import React, { useMemo } from 'react'
import CodeView from './CodeView'

/**
 * Editable code view. A transparent textarea sits exactly on top of the
 * highlighted CodeView, so the caret and selection are live while the colours
 * and line numbers show through from underneath. The two stay aligned because
 * they share the same mono font, leading, and gutter metrics.
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
  // Same line count and gutter formula as CodeView (it drops one trailing
  // empty line), otherwise the digit width drifts and the caret misaligns.
  const lineCount = useMemo(() => {
    const ls = value.split('\n')
    if (ls.length > 0 && ls[ls.length - 1] === '') ls.pop()
    return ls.length
  }, [value])
  const gutterCh = Math.max(3, String(lineCount).length) + 2

  return (
    <div className="relative min-w-max">
      {/* One reserved blank line so a new line has room before CodeView re-renders. */}
      <CodeView text={value} path={path} padLines={1} />
      <textarea
        value={value}
        onChange={(e) => onChange(e.target.value)}
        onKeyDown={(e) => {
          if ((e.ctrlKey || e.metaKey) && e.key === 's') {
            e.preventDefault()
            onSave?.()
          } else if (e.key === 'Tab') {
            e.preventDefault()
            const el = e.currentTarget
            el.setRangeText('  ', el.selectionStart, el.selectionEnd, 'end')
            onChange(el.value)
          }
        }}
        spellCheck={false}
        autoFocus
        wrap="off"
        className="absolute inset-0 resize-none overflow-hidden whitespace-pre bg-transparent py-2 font-mono text-[12.5px] leading-[1.55] text-transparent caret-slate-100 outline-none select-text"
        style={{ paddingLeft: `calc(${gutterCh}ch + 13px)`, paddingRight: 24 }}
      />
    </div>
  )
}
