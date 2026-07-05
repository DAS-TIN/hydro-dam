import React, { useEffect, useState } from 'react'
import { api } from '../api'

function Pane({ label, src, missing }: { label: string; src: string | null; missing: string }) {
  return (
    <div className="flex min-w-0 flex-1 flex-col items-center gap-2 p-4">
      <div className="text-[11px] uppercase tracking-wide text-slate-500">{label}</div>
      {src ? (
        <img
          src={src}
          className="max-h-[60vh] max-w-full rounded border border-ink-700 bg-[repeating-conic-gradient(#1a1f29_0%_25%,#141821_0%_50%)] bg-[length:18px_18px] object-contain"
        />
      ) : (
        <div className="flex h-40 w-full items-center justify-center rounded border border-dashed border-ink-700 text-sm text-slate-500">
          {missing}
        </div>
      )}
    </div>
  )
}

// Side-by-side image diff: the version at HEAD (or index) vs the working/staged file.
export default function ImageDiff({
  cwd,
  path,
  staged,
  untracked
}: {
  cwd: string
  path: string
  staged: boolean
  untracked: boolean
}) {
  const [before, setBefore] = useState<string | null>(null)
  const [after, setAfter] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    setLoading(true)
    const oldSrc = untracked ? null : api().imageAt(cwd, 'HEAD', path)
    const newSrc = staged
      ? api().imageAt(cwd, ':' + path, path)
      : api()
          .readFile(cwd, path)
          .then((f) => f.dataUrl ?? null)
          .catch(() => null)
    Promise.all([oldSrc, newSrc])
      .then(([b, a]) => {
        setBefore(b)
        setAfter(a)
      })
      .finally(() => setLoading(false))
  }, [cwd, path, staged, untracked])

  if (loading) {
    return <div className="flex h-full items-center justify-center text-sm text-slate-500">Loading image...</div>
  }

  return (
    <div className="flex h-full items-stretch overflow-auto bg-ink-900">
      <Pane label="Before (HEAD)" src={before} missing={untracked || !before ? 'new file' : 'none'} />
      <div className="w-px bg-ink-700" />
      <Pane label={staged ? 'After (staged)' : 'After (working)'} src={after} missing="deleted" />
    </div>
  )
}
