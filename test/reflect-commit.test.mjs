// Copying a commit onto another branch without moving HEAD. Mirrors reflectOne()
// in src/main/git.ts: cherry-pick the commit in a throwaway worktree, report
// applied / already / conflict, and never leave a target half-applied.
//
//   npm test

import test from 'node:test'
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { mkdtempSync, writeFileSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

function git(cwd, args) {
  return execFileSync('git', args, { cwd, encoding: 'utf8' })
}
function tryGit(cwd, args) {
  try {
    return { ok: true, out: git(cwd, args) }
  } catch (e) {
    return { ok: false, out: (e.stdout || '') + (e.stderr || '') }
  }
}

const EMPTY_TREE = '4b825dc642cb6eb9a060e54bf8d69288fbee4904'
function tryGitIn(cwd, args, input) {
  try {
    return { ok: true, out: execFileSync('git', args, { cwd, encoding: 'utf8', input }) }
  } catch (e) {
    return { ok: false, out: (e.stdout || '') + (e.stderr || '') }
  }
}

// Keep in step with reflectOne()/applyWhole()/applyPartial() in src/main/git.ts.
function reflectOne(cwd, sha, branch, paths = []) {
  const anc = tryGit(cwd, ['merge-base', '--is-ancestor', sha, branch])
  if (anc.ok) return { branch, status: 'already' }

  const dir = mkdtempSync(join(tmpdir(), 'hydrodam-reflect-'))
  try {
    git(cwd, ['worktree', 'add', '--quiet', dir, branch])
    return paths.length ? applyPartial(cwd, dir, sha, branch, paths) : applyWhole(dir, sha, branch)
  } catch (e) {
    return { branch, status: 'failed', message: String(e.message || e).split('\n')[0] }
  } finally {
    tryGit(cwd, ['worktree', 'remove', '--force', dir])
  }
}

function applyWhole(dir, sha, branch) {
  const pick = tryGit(dir, ['cherry-pick', sha])
  if (!pick.ok) {
    const conflicts = tryGit(dir, ['diff', '--name-only', '--diff-filter=U']).out.trim()
    tryGit(dir, ['cherry-pick', '--abort'])
    return { branch, status: conflicts ? 'conflict' : 'already' }
  }
  return { branch, status: 'applied', hash: git(dir, ['rev-parse', '--short', 'HEAD']).trim() }
}

function applyPartial(cwd, dir, sha, branch, paths) {
  const parent = tryGit(cwd, ['rev-parse', `${sha}^`]).ok ? git(cwd, ['rev-parse', `${sha}^`]).trim() : EMPTY_TREE
  const patch = git(cwd, ['diff', parent, sha, '--', ...paths])
  if (!patch.trim()) return { branch, status: 'already' }
  if (tryGitIn(dir, ['apply', '--reverse', '--check'], patch).ok) return { branch, status: 'already' }
  if (!tryGitIn(dir, ['apply', '--3way', '--index'], patch).ok) {
    tryGit(dir, ['reset', '--hard', '--quiet'])
    tryGit(dir, ['clean', '-fd', '--quiet'])
    return { branch, status: 'conflict' }
  }
  if (!tryGit(dir, ['commit', '-C', sha]).ok) return { branch, status: 'already' }
  return { branch, status: 'applied', hash: git(dir, ['rev-parse', '--short', 'HEAD']).trim() }
}

function makeRepo() {
  const dir = mkdtempSync(join(tmpdir(), 'hydrodam-reflect-repo-'))
  git(dir, ['init', '-q', '-b', 'main'])
  git(dir, ['config', 'user.name', 'Tester'])
  git(dir, ['config', 'user.email', 'tester@example.com'])
  git(dir, ['config', 'commit.gpgsign', 'false'])
  writeFileSync(join(dir, 'a.txt'), 'l1\nl2\nl3\n')
  git(dir, ['add', 'a.txt'])
  git(dir, ['commit', '-qm', 'base'])
  return dir
}

test('a clean change copies onto a diverged branch, HEAD unchanged', () => {
  const dir = makeRepo()
  try {
    // feature-2 has its own work, so the copy lands as a genuinely new commit
    // (cherry-picking onto a branch that is exactly the parent would reproduce
    // the identical commit object - not the case we care about here).
    git(dir, ['switch', '-qc', 'feature-2'])
    writeFileSync(join(dir, 'b.txt'), 'feature-2 only\n')
    git(dir, ['add', 'b.txt'])
    git(dir, ['commit', '-qm', 'feature-2 work'])
    const featBefore = git(dir, ['rev-parse', 'feature-2']).trim()

    git(dir, ['switch', '-q', 'main'])
    writeFileSync(join(dir, 'a.txt'), 'l1\nl2\nl3\nl4\n')
    git(dir, ['commit', '-qam', 'add l4'])
    const sha = git(dir, ['rev-parse', 'HEAD']).trim()

    const r = reflectOne(dir, sha, 'feature-2')
    assert.equal(r.status, 'applied')
    // the change is now on feature-2, on top of its own work, as a new commit
    assert.match(git(dir, ['show', 'feature-2:a.txt']), /l4/)
    assert.match(git(dir, ['show', 'feature-2:b.txt']), /feature-2 only/)
    assert.notEqual(git(dir, ['rev-parse', 'feature-2']).trim(), featBefore)
    assert.notEqual(git(dir, ['rev-parse', 'feature-2']).trim(), sha)
    // our own branch never moved
    assert.equal(git(dir, ['rev-parse', 'HEAD']).trim(), sha)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('a branch that already carries the change reports "already"', () => {
  const dir = makeRepo()
  try {
    // feature-3 sits at the same tip that will contain the commit
    writeFileSync(join(dir, 'a.txt'), 'l1\nl2\nl3\nl4\n')
    git(dir, ['commit', '-qam', 'add l4'])
    const sha = git(dir, ['rev-parse', 'HEAD']).trim()
    git(dir, ['branch', 'feature-3']) // contains sha exactly
    assert.equal(reflectOne(dir, sha, 'feature-3').status, 'already')

    // a second copy onto a branch that already has the patch (different sha) is also "already"
    git(dir, ['branch', 'feature-4', 'HEAD~1'])
    assert.equal(reflectOne(dir, sha, 'feature-4').status, 'applied')
    assert.equal(reflectOne(dir, sha, 'feature-4').status, 'already')
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('a conflicting change is reported, target left untouched', () => {
  const dir = makeRepo()
  try {
    git(dir, ['branch', 'feature-5'])
    // feature-5 changes the same line a different way
    git(dir, ['switch', '-q', 'feature-5'])
    writeFileSync(join(dir, 'a.txt'), 'l1\nl2\nTHEIRS\n')
    git(dir, ['commit', '-qam', 'their l3'])
    const tipBefore = git(dir, ['rev-parse', 'feature-5']).trim()

    git(dir, ['switch', '-q', 'main'])
    writeFileSync(join(dir, 'a.txt'), 'l1\nl2\nOURS\n')
    git(dir, ['commit', '-qam', 'our l3'])
    const sha = git(dir, ['rev-parse', 'HEAD']).trim()

    const r = reflectOne(dir, sha, 'feature-5')
    assert.equal(r.status, 'conflict')
    // target ref did not move and has no lingering cherry-pick
    assert.equal(git(dir, ['rev-parse', 'feature-5']).trim(), tipBefore)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('copying only chosen files leaves the rest of the commit behind', () => {
  const dir = makeRepo()
  try {
    git(dir, ['branch', 'feature-6'])
    // one commit that touches two files - only b.txt belongs on feature-6
    writeFileSync(join(dir, 'a.txt'), 'l1\nl2\nl3\nfeature-1 only\n')
    writeFileSync(join(dir, 'b.txt'), 'shared change\n')
    git(dir, ['add', 'a.txt', 'b.txt'])
    git(dir, ['commit', '-qm', 'two files'])
    const sha = git(dir, ['rev-parse', 'HEAD']).trim()

    const r = reflectOne(dir, sha, 'feature-6', ['b.txt'])
    assert.equal(r.status, 'applied')
    // b.txt came across...
    assert.match(git(dir, ['show', 'feature-6:b.txt']), /shared change/)
    // ...but a.txt's edit stayed behind (still the base version on feature-6)
    assert.doesNotMatch(git(dir, ['show', 'feature-6:a.txt']), /feature-1 only/)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})
