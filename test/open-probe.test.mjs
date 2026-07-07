// Tests the "open a folder" probe that decides which dialog Hydrodam shows when you
// open a directory from the Open Repository picker:
//
//   * not a git repo         -> "This isn't a git repository. Initialize it?"
//   * a repository's own root -> just open it, no dialog
//   * a folder INSIDE a repo  -> "It's inside <repo>. Open that, or git init here?"
//
// This mirrors probeOpen() + samePath() in src/main/git.ts. The probe is what
// drives the renderer's dialog choice in App.tsx -> doOpen().
//
// Run with:  npm test

import test from 'node:test'
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { mkdtempSync, mkdirSync, realpathSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'

// mirror of src/main/git.ts (keep in sync)

function repoRoot(cwd) {
  try {
    return execFileSync('git', ['rev-parse', '--show-toplevel'], {
      cwd,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'] // swallow git's "fatal: not a repo" noise
    }).trim()
  } catch {
    return null
  }
}

function canonPath(p) {
  try {
    return realpathSync.native(p)
  } catch {
    return resolve(p)
  }
}

function samePath(a, b) {
  const x = canonPath(a)
  const y = canonPath(b)
  return process.platform === 'win32' ? x.toLowerCase() === y.toLowerCase() : x === y
}

function probeOpen(path) {
  const root = repoRoot(path)
  if (!root) return { root: null, path, nested: false }
  return { root, path, nested: !samePath(root, path) }
}

// helpers

// realpath so the path matches what `git rev-parse --show-toplevel` reports
// (temp dirs are symlinks on some platforms, e.g. macOS /var -> /private/var).
function tempDir(prefix) {
  return realpathSync(mkdtempSync(join(tmpdir(), prefix)))
}

function initRepo(dir) {
  execFileSync('git', ['init', '-q'], { cwd: dir })
}


test('non-git folder -> root null (offer to initialize a new repo)', () => {
  const dir = tempDir('hydrodam-open-plain-')
  try {
    const p = probeOpen(dir)
    assert.equal(p.root, null, 'a plain folder is not inside any repo')
    assert.equal(p.nested, false)
    // App.tsx: root === null  ==>  confirm "Initialise it as a new repository?"
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test("a repository's own root -> opens directly, no dialog", () => {
  const dir = tempDir('hydrodam-open-root-')
  try {
    initRepo(dir) // unborn repo (no commits) - toplevel is known immediately
    const p = probeOpen(dir)
    assert.ok(p.root, 'should resolve a repo root')
    assert.ok(samePath(p.root, dir), 'root is the folder itself')
    assert.equal(p.nested, false)
    // App.tsx: root && !nested  ==>  openRepo(root)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('child folder inside a repo -> nested (offer parent repo OR git init here)', () => {
  const dir = tempDir('hydrodam-open-nested-')
  try {
    initRepo(dir)
    const child = join(dir, 'src', 'feature')
    mkdirSync(child, { recursive: true })
    const p = probeOpen(child)
    assert.ok(p.root, 'should resolve the enclosing repo')
    assert.ok(samePath(p.root, dir), 'root is the enclosing repo, not the child')
    assert.equal(p.nested, true)
    // App.tsx: nested  ==>  confirm "open <root>, or initialise this folder?"
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('samePath treats equivalent paths as the same folder', () => {
  const dir = tempDir('hydrodam-samepath-')
  try {
    const sep = process.platform === 'win32' ? '\\' : '/'
    assert.ok(samePath(dir, dir), 'identical')
    assert.ok(samePath(dir, dir + sep), 'trailing separator is ignored')
    assert.ok(!samePath(dir, join(dir, 'sub')), 'a subfolder is not the same path')
    if (process.platform === 'win32') {
      assert.ok(samePath(dir.toUpperCase(), dir.toLowerCase()), 'case-insensitive on Windows')
    }
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})
