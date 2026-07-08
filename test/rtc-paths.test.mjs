// Path traversal prevention for snapshot manifests and patch file lists.

import test from 'node:test'
import assert from 'node:assert/strict'
import { tmpdir } from 'node:os'
import { isSafeRelPath, insideRoot } from '../src/main/rtc/paths.mjs'

test('plain repo-relative paths are safe', () => {
  assert.equal(isSafeRelPath('src/main/index.ts'), true)
  assert.equal(isSafeRelPath('README.md'), true)
  assert.equal(isSafeRelPath('a/b/c.d-e_f.txt'), true)
})

test('traversal and absolute paths are rejected', () => {
  assert.equal(isSafeRelPath('../evil.txt'), false)
  assert.equal(isSafeRelPath('a/../../evil.txt'), false)
  assert.equal(isSafeRelPath('..'), false)
  assert.equal(isSafeRelPath('/etc/passwd'), false)
  assert.equal(isSafeRelPath('C:\\Windows\\system32'), false)
  assert.equal(isSafeRelPath('c:/x'), false)
  assert.equal(isSafeRelPath('..\\up.txt'), false)
  assert.equal(isSafeRelPath('a\\..\\..\\up.txt'), false)
})

test('degenerate paths are rejected', () => {
  assert.equal(isSafeRelPath(''), false)
  assert.equal(isSafeRelPath('a//b'), false)
  assert.equal(isSafeRelPath('./a'), false)
  assert.equal(isSafeRelPath('a/./b'), false)
  assert.equal(isSafeRelPath('a\0b'), false)
  assert.equal(isSafeRelPath(null), false)
})

test('insideRoot resolves safe paths and blocks escapes', () => {
  const root = tmpdir()
  assert.ok(insideRoot(root, 'sub/file.txt'))
  assert.equal(insideRoot(root, '../outside.txt'), null)
  assert.equal(insideRoot(root, 'ok/../../outside.txt'), null)
})
