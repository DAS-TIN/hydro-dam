// File selection: git-tracked discovery, default exclusions, .rtcignore,
// binary/large classification and symlink rejection.

import test from 'node:test'
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { mkdtempSync, writeFileSync, mkdirSync, rmSync, symlinkSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { buildManifest, isExcluded, parseIgnoreFile, compileMatcher } from '../src/main/rtc/fileselect.mjs'

function git(cwd, args) {
  return execFileSync('git', args, { cwd, encoding: 'utf8' })
}

function makeRepo() {
  const dir = mkdtempSync(join(tmpdir(), 'rtc-files-'))
  git(dir, ['init', '-q'])
  git(dir, ['config', 'user.name', 'Tester'])
  git(dir, ['config', 'user.email', 'tester@example.com'])
  git(dir, ['config', 'commit.gpgsign', 'false'])
  return dir
}

test('default exclusions catch dependencies, build output and secrets', () => {
  assert.equal(isExcluded('node_modules/react/index.js'), true)
  assert.equal(isExcluded('dist/bundle.js'), true)
  assert.equal(isExcluded('.git/config'), true)
  assert.equal(isExcluded('.rtc/session.json'), true)
  assert.equal(isExcluded('.env'), true)
  assert.equal(isExcluded('.env.production'), true)
  assert.equal(isExcluded('certs/server.pem'), true)
  assert.equal(isExcluded('keys/deploy.key'), true)
  assert.equal(isExcluded('src/index.ts'), false)
  assert.equal(isExcluded('README.md'), false)
  // .env only matches the file, not a directory that merely contains "env"
  assert.equal(isExcluded('src/environment.ts'), false)
})

test('.rtcignore patterns work like gitignore', () => {
  const patterns = parseIgnoreFile('# comment\n\nsecret-stuff/\n*.tmp\n/top-only.txt\n')
  assert.deepEqual(patterns, ['secret-stuff/', '*.tmp', '/top-only.txt'])
  const m = compileMatcher(patterns)
  assert.equal(m('secret-stuff/inner.txt'), true)
  assert.equal(m('deep/secret-stuff/inner.txt'), true)
  assert.equal(m('scratch.tmp'), true)
  assert.equal(m('a/b/scratch.tmp'), true)
  assert.equal(m('top-only.txt'), true)
  assert.equal(m('sub/top-only.txt'), false)
  assert.equal(m('src/keep.ts'), false)
})

test('manifest prefers git-tracked files and flags untracked ones', async () => {
  const dir = makeRepo()
  try {
    writeFileSync(join(dir, 'tracked.txt'), 'hello\n')
    git(dir, ['add', 'tracked.txt'])
    git(dir, ['commit', '-qm', 'init'])
    writeFileSync(join(dir, 'untracked.txt'), 'later\n')

    const trackedOnly = await buildManifest(dir)
    assert.deepEqual(trackedOnly.entries.map((e) => e.path), ['tracked.txt'])
    assert.equal(trackedOnly.entries[0].gitTracked, true)
    assert.ok(trackedOnly.manifestHash.length === 64)

    const withUntracked = await buildManifest(dir, { includeUntracked: true })
    const paths = withUntracked.entries.map((e) => e.path)
    assert.ok(paths.includes('untracked.txt'))
    assert.equal(withUntracked.entries.find((e) => e.path === 'untracked.txt').gitTracked, false)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('tracked secrets and .rtcignore files still stay out of the manifest', async () => {
  const dir = makeRepo()
  try {
    writeFileSync(join(dir, 'app.js'), 'ok\n')
    writeFileSync(join(dir, '.env'), 'SECRET=1\n')
    mkdirSync(join(dir, 'private'))
    writeFileSync(join(dir, 'private', 'notes.txt'), 'x\n')
    writeFileSync(join(dir, '.rtcignore'), 'private/\n')
    git(dir, ['add', '-f', 'app.js', '.env', 'private/notes.txt'])
    git(dir, ['commit', '-qm', 'init'])

    const m = await buildManifest(dir)
    assert.deepEqual(m.entries.map((e) => e.path), ['app.js'])
    const reasons = Object.fromEntries(m.skipped.map((s) => [s.path, s.reason]))
    assert.equal(reasons['.env'], 'excluded')
    assert.equal(reasons['private/notes.txt'], 'excluded')
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('binary and large files are lock-only, never live', async () => {
  const dir = makeRepo()
  try {
    writeFileSync(join(dir, 'img.bin'), Buffer.from([0, 1, 2, 0, 255]))
    writeFileSync(join(dir, 'big.txt'), 'x'.repeat(500))
    writeFileSync(join(dir, 'small.txt'), 'fine\n')
    git(dir, ['add', '-A'])
    git(dir, ['commit', '-qm', 'init'])

    const m = await buildManifest(dir, { maxFileSize: 100 })
    const by = Object.fromEntries(m.entries.map((e) => [e.path, e]))
    assert.equal(by['img.bin'].binary, true)
    assert.equal(by['img.bin'].collaborativeMode, 'locked')
    assert.equal(by['big.txt'].largeFile, true)
    assert.equal(by['big.txt'].collaborativeMode, 'locked')
    assert.equal(by['small.txt'].collaborativeMode, 'live')
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('symlinks are rejected from the manifest', async (t) => {
  const dir = makeRepo()
  try {
    writeFileSync(join(dir, 'real.txt'), 'target\n')
    try {
      symlinkSync(join(dir, 'real.txt'), join(dir, 'link.txt'))
    } catch (err) {
      // Windows needs an extra privilege for symlinks; skip when unavailable.
      t.skip(`cannot create symlinks here: ${err.code}`)
      return
    }
    git(dir, ['add', '-A'])
    git(dir, ['commit', '-qm', 'init'])

    const m = await buildManifest(dir)
    assert.deepEqual(m.entries.map((e) => e.path), ['real.txt'])
    assert.ok(m.skipped.some((s) => s.path === 'link.txt' && s.reason === 'symlink'))
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})
