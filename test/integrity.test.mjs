// Tests the commit-guard change-detection fingerprint.
//
// This mirrors `integrity()` in src/main/git.ts: a SHA-1 over
//   porcelain status  +  working diff  +  staged diff
// so that ANY change between reviewing and committing flips the value.
//
// Run with:  npm test

import test from 'node:test'
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createHash } from 'node:crypto'

function git(cwd, args, opts = {}) {
  return execFileSync('git', args, { cwd, encoding: 'utf8', ...opts })
}

// Keep this identical to src/main/git.ts -> integrity()
function integrity(cwd) {
  const porcelain = git(cwd, ['status', '--porcelain=v1', '-z', '--untracked-files=all'])
  const work = git(cwd, ['diff', '--no-color'])
  const cached = git(cwd, ['diff', '--cached', '--no-color'])
  return createHash('sha1').update(porcelain).update('\0').update(work).update('\0').update(cached).digest('hex')
}

function makeRepo() {
  const dir = mkdtempSync(join(tmpdir(), 'hydrodam-guard-'))
  git(dir, ['init', '-q'])
  git(dir, ['config', 'user.name', 'Tester'])
  git(dir, ['config', 'user.email', 'tester@example.com'])
  git(dir, ['config', 'commit.gpgsign', 'false'])
  writeFileSync(join(dir, 'a.txt'), 'first\nsecond\n')
  git(dir, ['add', 'a.txt'])
  git(dir, ['commit', '-qm', 'init'])
  return dir
}

test('fingerprint is stable when nothing changes', () => {
  const dir = makeRepo()
  try {
    assert.equal(integrity(dir), integrity(dir))
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('detects a NEW untracked file appearing before commit', () => {
  const dir = makeRepo()
  try {
    const before = integrity(dir)
    writeFileSync(join(dir, 'injected.txt'), 'surprise!\n')
    assert.notEqual(integrity(dir), before, 'new file should change the fingerprint')
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('detects an edit to an already-staged file (same status letter, different content)', () => {
  const dir = makeRepo()
  try {
    writeFileSync(join(dir, 'a.txt'), 'first\nsecond\nthird\n')
    git(dir, ['add', 'a.txt'])
    const reviewed = integrity(dir) // what the user reviewed

    // Something silently changes the staged content further - still status "M"
    writeFileSync(join(dir, 'a.txt'), 'first\nsecond\nMALICIOUS\n')
    git(dir, ['add', 'a.txt'])

    assert.notEqual(integrity(dir), reviewed, 'changed staged content must be caught')
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('detects a working-tree edit that was not staged for commit', () => {
  const dir = makeRepo()
  try {
    const before = integrity(dir)
    writeFileSync(join(dir, 'a.txt'), 'first\nMODIFIED\n')
    assert.notEqual(integrity(dir), before, 'working-tree edit should change the fingerprint')
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})
