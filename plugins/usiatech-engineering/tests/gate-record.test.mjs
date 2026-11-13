import { describe, it, after } from 'node:test'
import assert from 'node:assert/strict'
import path from 'node:path'
import { writeFileSync, mkdirSync } from 'node:fs'
import { makeRepo, writeFiles, cleanupTempDirs, git } from './helpers.mjs'
import { treeHash, configHash, changedBetween, readRecord, writeRecord, LAST_RUN } from '../skills/verify/gate-record.mjs'

after(cleanupTempDirs)

describe('gate-record: tree hash (ESP-162 R7)', () => {
  it('should give the same hash for an unchanged tree and leave the real index alone', () => {
    const repo = makeRepo({ headFiles: { 'src/a.ts': 'a' } })
    writeFiles(repo, { 'src/b.ts': 'b' })
    const before = git(repo, 'status', '--porcelain')
    assert.equal(treeHash(repo), treeHash(repo))
    assert.equal(git(repo, 'status', '--porcelain'), before, 'nothing was staged')
  })

  it('should change when a tracked file changes or an untracked file appears (AC11)', () => {
    const repo = makeRepo({ headFiles: { 'src/a.ts': 'a' } })
    const start = treeHash(repo)
    writeFiles(repo, { 'src/a.ts': 'changed' })
    const edited = treeHash(repo)
    assert.notEqual(edited, start)
    writeFiles(repo, { 'src/new.ts': 'n' })
    assert.notEqual(treeHash(repo), edited)
  })

  it('should not change for a file git ignores', () => {
    const repo = makeRepo({ headFiles: { '.gitignore': 'dist/\n', 'src/a.ts': 'a' } })
    const start = treeHash(repo)
    mkdirSync(path.join(repo, 'dist'), { recursive: true })
    writeFileSync(path.join(repo, 'dist', 'out.js'), 'x')
    assert.equal(treeHash(repo), start)
  })

  it('should list the files that differ between two trees', () => {
    const repo = makeRepo({ headFiles: { 'src/a.ts': 'a', 'lib/b.ts': 'b' } })
    const start = treeHash(repo)
    writeFiles(repo, { 'lib/b.ts': 'changed', 'lib/c.ts': 'c' })
    assert.deepEqual(changedBetween(repo, start, treeHash(repo)).sort(), ['lib/b.ts', 'lib/c.ts'])
  })
})

describe('gate-record: config hash and record files (ESP-162 R7)', () => {
  it('should change the config hash when engineering.json changes', () => {
    const repo = makeRepo({ headFiles: { '.claude/engineering.json': '{"verify":[]}' } })
    const start = configHash(repo)
    writeFiles(repo, { '.claude/engineering.json': '{"verify":[1]}' })
    assert.notEqual(configHash(repo), start)
  })

  it('should read back what it wrote, inside the git folder, out of the working tree', () => {
    const repo = makeRepo()
    const record = { tree: treeHash(repo), config: configHash(repo), base: 'abc', steps: { 'tests\u0000npm test': '2026-11-13T10:00:00Z' } }
    writeRecord(repo, LAST_RUN, record)
    assert.deepEqual(readRecord(repo, LAST_RUN), { record, note: null })
    assert.equal(git(repo, 'status', '--porcelain'), '', 'the record is not in the working tree')
  })

  it('should read a missing record as none, and a malformed one as none with a note', () => {
    const repo = makeRepo()
    assert.deepEqual(readRecord(repo, LAST_RUN), { record: null, note: null })
    writeRecord(repo, LAST_RUN, { tree: 'not a hash', config: 'x', base: 'y', steps: {} })
    const { record, note } = readRecord(repo, LAST_RUN)
    assert.equal(record, null)
    assert.match(note, /malformed/)
  })
})
