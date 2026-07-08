// Snapshot export/import: sanitization, hash verification, tamper and
// traversal rejection, and the "RTC session base" commit.

import test from 'node:test'
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { mkdtempSync, writeFileSync, readFileSync, mkdirSync, rmSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createSession, snapshotExport, inviteExport } from '../src/main/rtc/session.mjs'
import { snapshotVerify, snapshotImport, cloneJoin } from '../src/main/rtc/join.mjs'
import { loadState } from '../src/main/rtc/store.mjs'

function git(cwd, args) {
  return execFileSync('git', args, { cwd, encoding: 'utf8' })
}

async function makeHost() {
  const dir = mkdtempSync(join(tmpdir(), 'rtc-host-'))
  git(dir, ['init', '-qb', 'main'])
  git(dir, ['config', 'user.name', 'Host'])
  git(dir, ['config', 'user.email', 'host@example.com'])
  git(dir, ['config', 'commit.gpgsign', 'false'])
  writeFileSync(join(dir, 'main.js'), 'console.log(1)\n')
  mkdirSync(join(dir, 'src'))
  writeFileSync(join(dir, 'src', 'lib.js'), 'export {}\n')
  writeFileSync(join(dir, '.env'), 'SECRET=very\n')
  git(dir, ['add', '-f', '-A'])
  git(dir, ['commit', '-qm', 'init'])
  await createSession(dir, { hostName: 'Host', joinMode: 'snapshot' })
  return dir
}

test('snapshot round trip: sanitized export, verified import, fresh base commit', async () => {
  const host = await makeHost()
  const snap = mkdtempSync(join(tmpdir(), 'rtc-snap-'))
  const destParent = mkdtempSync(join(tmpdir(), 'rtc-dest-'))
  const dest = join(destParent, 'copy')
  try {
    const out = snapshotExport(host, snap)
    assert.equal(out.copied, 2)
    assert.ok(!existsSync(join(snap, '.git')), 'snapshots never contain .git')
    assert.ok(!existsSync(join(snap, '.env')), 'secrets never leave the host')
    assert.ok(!existsSync(join(snap, '.rtc')), 'collab metadata travels in the descriptor, not as files')

    assert.equal(snapshotVerify(snap).ok, true)

    const res = await snapshotImport(snap, dest, 'Bob')
    assert.equal(readFileSync(join(dest, 'main.js'), 'utf8'), 'console.log(1)\n')
    assert.equal(git(dest, ['log', '-1', '--format=%s']).trim(), 'RTC session base')

    const state = loadState(dest)
    assert.equal(state.session.joinMode, 'snapshot')
    assert.equal(state.session.baseCommit, git(dest, ['rev-parse', 'HEAD']).trim())
    assert.ok(state.actors.some((a) => a.displayName === 'Bob'))
    assert.equal(res.guest.type, 'human')
  } finally {
    for (const d of [host, snap, destParent]) rmSync(d, { recursive: true, force: true })
  }
})

test('a tampered snapshot fails verification and import', async () => {
  const host = await makeHost()
  const snap = mkdtempSync(join(tmpdir(), 'rtc-snap2-'))
  const destParent = mkdtempSync(join(tmpdir(), 'rtc-dest2-'))
  try {
    snapshotExport(host, snap)
    writeFileSync(join(snap, 'main.js'), 'console.log("injected")\n')
    const check = snapshotVerify(snap)
    assert.equal(check.ok, false)
    assert.ok(check.problems.some((p) => p.includes('Hash mismatch')))
    await assert.rejects(
      () => snapshotImport(snap, join(destParent, 'copy'), 'Bob'),
      /failed verification/
    )
  } finally {
    for (const d of [host, snap, destParent]) rmSync(d, { recursive: true, force: true })
  }
})

test('manifest paths that escape the destination are rejected', async () => {
  const host = await makeHost()
  const snap = mkdtempSync(join(tmpdir(), 'rtc-snap3-'))
  const destParent = mkdtempSync(join(tmpdir(), 'rtc-dest3-'))
  try {
    snapshotExport(host, snap)
    const desc = JSON.parse(readFileSync(join(snap, 'rtc-snapshot.json'), 'utf8'))
    desc.manifest.entries.push({ path: '../escape.txt', size: 1, sha256: '0'.repeat(64) })
    writeFileSync(join(snap, 'rtc-snapshot.json'), JSON.stringify(desc))

    const check = snapshotVerify(snap)
    assert.equal(check.ok, false)
    assert.ok(check.problems.some((p) => p.includes('Unsafe path')))
    await assert.rejects(() => snapshotImport(snap, join(destParent, 'copy'), 'Bob'))
    assert.ok(!existsSync(join(destParent, 'escape.txt')), 'nothing was written outside the destination')
  } finally {
    for (const d of [host, snap, destParent]) rmSync(d, { recursive: true, force: true })
  }
})

test('clone join verifies the guest HEAD against the session base', async () => {
  const host = await makeHost()
  const guestParent = mkdtempSync(join(tmpdir(), 'rtc-clone-'))
  const guest = join(guestParent, 'clone')
  try {
    const invite = join(guestParent, 'rtc-invite.json')
    inviteExport(host, invite)
    git(host, ['clone', '-q', host, guest])
    git(guest, ['config', 'user.name', 'Bob'])
    git(guest, ['config', 'user.email', 'bob@example.com'])
    git(guest, ['config', 'commit.gpgsign', 'false'])

    const { state, guest: bob } = await cloneJoin(guest, invite, 'Bob')
    assert.equal(bob.type, 'human')
    assert.ok(state.actors.some((a) => a.id === bob.id))
    assert.ok(state.actors.some((a) => a.displayName === 'Host'), 'host roster came along')
    assert.equal(state.session.baseCommit, git(guest, ['rev-parse', 'HEAD']).trim())

    // a guest who moved past the base is told to check it out first
    writeFileSync(join(guest, 'extra.txt'), 'drift\n')
    git(guest, ['add', 'extra.txt'])
    git(guest, ['commit', '-qm', 'drift'])
    await assert.rejects(() => cloneJoin(guest, invite, 'Carol'), /not the session base/)
  } finally {
    for (const d of [host, guestParent]) rmSync(d, { recursive: true, force: true })
  }
})

test('import refuses a non-empty destination', async () => {
  const host = await makeHost()
  const snap = mkdtempSync(join(tmpdir(), 'rtc-snap4-'))
  const dest = mkdtempSync(join(tmpdir(), 'rtc-dest4-'))
  try {
    snapshotExport(host, snap)
    writeFileSync(join(dest, 'existing.txt'), 'already here\n')
    await assert.rejects(() => snapshotImport(snap, dest, 'Bob'), /empty destination/)
  } finally {
    for (const d of [host, snap, dest]) rmSync(d, { recursive: true, force: true })
  }
})
