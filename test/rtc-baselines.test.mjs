// The concurrent-edit guard: an assistant claims baselines, and a check
// before writing reveals whether anyone touched the files in the meantime.

import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, writeFileSync, rmSync, unlinkSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { claimBaselines, checkBaselines, releaseBaselines } from '../src/main/rtc/baselines.mjs'

const ACTOR = 'agent:test-claude'

function makeDir() {
  const dir = mkdtempSync(join(tmpdir(), 'rtc-base-'))
  writeFileSync(join(dir, 'a.txt'), 'original\n')
  writeFileSync(join(dir, 'b.txt'), 'untouched\n')
  return dir
}

test('clean until someone edits, then flagged as changed', () => {
  const dir = makeDir()
  try {
    claimBaselines(dir, ACTOR, ['a.txt', 'b.txt'])
    assert.deepEqual(
      checkBaselines(dir, ACTOR).map((r) => r.status),
      ['clean', 'clean']
    )

    // the user edits a.txt while the assistant is thinking
    writeFileSync(join(dir, 'a.txt'), 'user edit\n')
    const byPath = Object.fromEntries(checkBaselines(dir, ACTOR).map((r) => [r.path, r.status]))
    assert.equal(byPath['a.txt'], 'changed')
    assert.equal(byPath['b.txt'], 'clean')

    // after merging, a re-claim makes the merged content the new baseline
    claimBaselines(dir, ACTOR, ['a.txt'])
    assert.equal(checkBaselines(dir, ACTOR, ['a.txt'])[0].status, 'clean')
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('planned-but-missing files flag when someone else creates them first', () => {
  const dir = makeDir()
  try {
    claimBaselines(dir, ACTOR, ['new-module.txt'])
    assert.equal(checkBaselines(dir, ACTOR)[0].status, 'clean')
    writeFileSync(join(dir, 'new-module.txt'), 'someone else got here\n')
    assert.equal(checkBaselines(dir, ACTOR)[0].status, 'appeared')
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('deletions and unclaimed paths are reported distinctly', () => {
  const dir = makeDir()
  try {
    claimBaselines(dir, ACTOR, ['a.txt'])
    unlinkSync(join(dir, 'a.txt'))
    assert.equal(checkBaselines(dir, ACTOR, ['a.txt'])[0].status, 'deleted')
    assert.equal(checkBaselines(dir, ACTOR, ['never-claimed.txt'])[0].status, 'unclaimed')
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('release clears everything and traversal paths are refused', () => {
  const dir = makeDir()
  try {
    claimBaselines(dir, ACTOR, ['a.txt'])
    releaseBaselines(dir, ACTOR)
    assert.deepEqual(checkBaselines(dir, ACTOR), [])
    assert.throws(() => claimBaselines(dir, ACTOR, ['../outside.txt']), /Unsafe path/)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})
