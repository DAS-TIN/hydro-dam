// Live blame: uncommitted line ranges keep the author who actually typed
// them, survive unrelated edits, and disappear once committed.

import test from 'node:test'
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { parseNewRanges, mergeSegments, updateLiveBlame } from '../src/main/rtc/liveblame.mjs'

const ALEX = 'human:alex'
const DASTIN = 'human:dastin'

function git(cwd, args) {
  return execFileSync('git', args, { cwd, encoding: 'utf8' })
}

function makeRepo() {
  const dir = mkdtempSync(join(tmpdir(), 'rtc-blame-'))
  git(dir, ['init', '-qb', 'main'])
  git(dir, ['config', 'user.name', 'Tester'])
  git(dir, ['config', 'user.email', 'tester@example.com'])
  git(dir, ['config', 'commit.gpgsign', 'false'])
  writeFileSync(join(dir, 'app.txt'), 'one\ntwo\nthree\nfour\nfive\n')
  git(dir, ['add', '-A'])
  git(dir, ['commit', '-qm', 'init'])
  return dir
}

test('parseNewRanges reads hunk headers, skipping pure deletions', () => {
  const diff = [
    '@@ -2 +2 @@',            // single line, count omitted
    ' context',
    '@@ -4,0 +5,2 @@',        // two inserted lines
    '@@ -9,2 +11,0 @@',       // pure deletion: nothing survives
    '@@ -20,3 +21,4 @@'
  ].join('\n')
  assert.deepEqual(parseNewRanges(diff), [
    { startLine: 2, endLine: 2 },
    { startLine: 5, endLine: 6 },
    { startLine: 21, endLine: 24 }
  ])
})

test('mergeSegments keeps untouched ranges and re-attributes changed ones', () => {
  const lines = ['one', 'TWO', 'three', 'FOUR', 'five']
  const segments = []
  mergeSegments(segments, 'app.txt', [{ startLine: 2, endLine: 2 }], lines, ALEX, 1000)
  assert.equal(segments[0].actorId, ALEX)

  // Dastin edits line 4; Alex's line 2 range is byte-identical and survives
  mergeSegments(
    segments,
    'app.txt',
    [{ startLine: 2, endLine: 2 }, { startLine: 4, endLine: 4 }],
    lines,
    DASTIN,
    2000
  )
  const byStart = Object.fromEntries(segments.map((s) => [s.startLine, s]))
  assert.equal(byStart[2].actorId, ALEX)
  assert.equal(byStart[2].at, 1000)
  assert.equal(byStart[4].actorId, DASTIN)

  // Dastin rewrites line 2: same range, new content, so it changes hands
  const edited = ['one', 'TWO again', 'three', 'FOUR', 'five']
  mergeSegments(
    segments,
    'app.txt',
    [{ startLine: 2, endLine: 2 }, { startLine: 4, endLine: 4 }],
    edited,
    DASTIN,
    3000
  )
  assert.equal(segments.find((s) => s.startLine === 2).actorId, DASTIN)

  // other paths are never disturbed
  segments.push({ path: 'other.txt', startLine: 1, endLine: 1, actorId: ALEX, at: 1, hash: 'x' })
  mergeSegments(segments, 'app.txt', [], edited, DASTIN, 4000)
  assert.deepEqual(segments.map((s) => s.path), ['other.txt'])
})

test('updateLiveBlame tracks edits against HEAD and clears after commit', async () => {
  const dir = makeRepo()
  try {
    const segments = []
    writeFileSync(join(dir, 'app.txt'), 'one\ntwo EDITED\nthree\nfour\nfive\n')
    await updateLiveBlame(dir, segments, [{ path: 'app.txt', kind: 'edit' }], ALEX)
    assert.equal(segments.length, 1)
    assert.deepEqual(
      { actorId: segments[0].actorId, startLine: segments[0].startLine, endLine: segments[0].endLine },
      { actorId: ALEX, startLine: 2, endLine: 2 }
    )

    // a second author touches a different line: both attributions stand
    writeFileSync(join(dir, 'app.txt'), 'one\ntwo EDITED\nthree\nfour\nfive EDITED\n')
    await updateLiveBlame(dir, segments, [{ path: 'app.txt', kind: 'edit' }], DASTIN)
    const owners = Object.fromEntries(segments.map((s) => [s.startLine, s.actorId]))
    assert.equal(owners[2], ALEX)
    assert.equal(owners[5], DASTIN)

    // brand-new files are live from top to bottom
    writeFileSync(join(dir, 'new.txt'), 'a\nb\n')
    await updateLiveBlame(dir, segments, [{ path: 'new.txt', kind: 'create' }], DASTIN)
    const created = segments.find((s) => s.path === 'new.txt')
    assert.equal(created.startLine, 1)
    assert.ok(created.endLine >= 2)

    // committing folds everything into git blame; segments go away
    git(dir, ['add', '-A'])
    git(dir, ['commit', '-qm', 'work'])
    await updateLiveBlame(dir, segments, [{ path: 'app.txt', kind: 'edit' }, { path: 'new.txt', kind: 'edit' }], DASTIN)
    assert.equal(segments.length, 0)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('deleted files drop their segments', async () => {
  const dir = makeRepo()
  try {
    const segments = [
      { path: 'app.txt', startLine: 1, endLine: 1, actorId: ALEX, at: 1, hash: 'x' },
      { path: 'other.txt', startLine: 1, endLine: 1, actorId: ALEX, at: 1, hash: 'x' }
    ]
    await updateLiveBlame(dir, segments, [{ path: 'app.txt', kind: 'delete' }], DASTIN)
    assert.deepEqual(segments.map((s) => s.path), ['other.txt'])
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})
