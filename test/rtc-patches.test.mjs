// Patch generation and safe 3-way application against real repos.

import test from 'node:test'
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { mkdtempSync, writeFileSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createSession } from '../src/main/rtc/session.mjs'
import { loadState } from '../src/main/rtc/store.mjs'
import { createPatch, applyPatch, recordChanges } from '../src/main/rtc/patches.mjs'

function git(cwd, args) {
  return execFileSync('git', args, { cwd, encoding: 'utf8' })
}

function makeRepo() {
  const dir = mkdtempSync(join(tmpdir(), 'rtc-patch-'))
  git(dir, ['init', '-qb', 'main'])
  git(dir, ['config', 'user.name', 'Tester'])
  git(dir, ['config', 'user.email', 'tester@example.com'])
  git(dir, ['config', 'commit.gpgsign', 'false'])
  writeFileSync(join(dir, 'app.txt'), 'line one\nline two\nline three\n')
  writeFileSync(join(dir, 'other.txt'), 'unrelated\n')
  git(dir, ['add', '-A'])
  git(dir, ['commit', '-qm', 'init'])
  return dir
}

async function sessionWithChange(dir) {
  await createSession(dir, { hostName: 'Alice' })
  writeFileSync(join(dir, 'app.txt'), 'line one\nline two CHANGED\nline three\n')
  const state = loadState(dir)
  recordChanges(state.changes, [{ path: 'app.txt', kind: 'edit' }], state.session.hostActorId, null)
  return state
}

test('a patch captures one actor diff against the session base', async () => {
  const dir = makeRepo()
  try {
    const state = await sessionWithChange(dir)
    writeFileSync(join(dir, 'new.txt'), 'brand new\n')
    recordChanges(state.changes, [{ path: 'new.txt', kind: 'create' }], state.session.hostActorId, null)

    const patch = await createPatch(dir, state, { actorId: state.session.hostActorId })
    assert.deepEqual([...patch.filesChanged].sort(), ['app.txt', 'new.txt'])
    assert.match(patch.diff, /-line two/)
    assert.match(patch.diff, /\+line two CHANGED/)
    assert.match(patch.diff, /\+brand new/)
    assert.ok(!patch.diff.includes('other.txt'), 'untouched files stay out of the diff')
    assert.equal(patch.status, 'draft')
    assert.equal(patch.baseCommit, state.session.baseCommit)
    // the change log entries were consumed by the patch
    assert.equal(state.changes.length, 0)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('patches from two actors stay separate', async () => {
  const dir = makeRepo()
  try {
    await createSession(dir, { hostName: 'Alice' })
    writeFileSync(join(dir, 'app.txt'), 'line one\nby alice\nline three\n')
    writeFileSync(join(dir, 'other.txt'), 'by bob\n')
    const state = loadState(dir)
    recordChanges(state.changes, [{ path: 'app.txt', kind: 'edit' }], 'human:alice', 'task-1')
    recordChanges(state.changes, [{ path: 'other.txt', kind: 'edit' }], 'human:bob', 'task-2')

    const pa = await createPatch(dir, state, { actorId: 'human:alice', taskId: 'task-1' })
    const pb = await createPatch(dir, state, { actorId: 'human:bob', taskId: 'task-2' })
    assert.deepEqual(pa.filesChanged, ['app.txt'])
    assert.deepEqual(pb.filesChanged, ['other.txt'])
    assert.ok(!pa.diff.includes('other.txt'))
    assert.ok(!pb.diff.includes('app.txt'))
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('a patch applies to a clean clone via 3-way merge', async () => {
  const host = makeRepo()
  const guestParent = mkdtempSync(join(tmpdir(), 'rtc-guest-'))
  const guest = join(guestParent, 'clone')
  try {
    git(host, ['clone', '-q', host, guest])
    const state = await sessionWithChange(host)
    const patch = await createPatch(host, state, { actorId: state.session.hostActorId })

    const res = await applyPatch(guest, [patch], patch.id, {})
    assert.equal(res.ok, true)
    const applied = readFileSync(join(guest, 'app.txt'), 'utf8')
    assert.match(applied, /line two CHANGED/)
    assert.equal(patch.status, 'applied')
  } finally {
    rmSync(host, { recursive: true, force: true })
    rmSync(guestParent, { recursive: true, force: true })
  }
})

test('a conflicting patch is detected and nothing is overwritten', async () => {
  const host = makeRepo()
  const guestParent = mkdtempSync(join(tmpdir(), 'rtc-guest2-'))
  const guest = join(guestParent, 'clone')
  try {
    git(host, ['clone', '-q', host, guest])
    const state = await sessionWithChange(host)
    const patch = await createPatch(host, state, { actorId: state.session.hostActorId })

    // the guest edited the same line differently
    writeFileSync(join(guest, 'app.txt'), 'line one\nline two GUEST VERSION\nline three\n')
    const res = await applyPatch(guest, [patch], patch.id, {})
    assert.equal(res.ok, false)
    assert.equal(res.conflicted, true)
    assert.equal(patch.status, 'conflicted')
    const untouched = readFileSync(join(guest, 'app.txt'), 'utf8')
    assert.match(untouched, /GUEST VERSION/, 'the guest working tree was not clobbered')
  } finally {
    rmSync(host, { recursive: true, force: true })
    rmSync(guestParent, { recursive: true, force: true })
  }
})

test('checkOnly reports without touching the tree', async () => {
  const host = makeRepo()
  const guestParent = mkdtempSync(join(tmpdir(), 'rtc-guest3-'))
  const guest = join(guestParent, 'clone')
  try {
    git(host, ['clone', '-q', host, guest])
    const state = await sessionWithChange(host)
    const patch = await createPatch(host, state, { actorId: state.session.hostActorId })

    const res = await applyPatch(guest, [patch], patch.id, { checkOnly: true })
    assert.equal(res.ok, true)
    const content = readFileSync(join(guest, 'app.txt'), 'utf8')
    assert.ok(!content.includes('CHANGED'), 'dry run must not modify files')
    assert.equal(patch.status, 'draft')
  } finally {
    rmSync(host, { recursive: true, force: true })
    rmSync(guestParent, { recursive: true, force: true })
  }
})
