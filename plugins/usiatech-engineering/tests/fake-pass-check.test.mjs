import { describe, it, after } from 'node:test'
import assert from 'node:assert/strict'
import path from 'node:path'
import { makeRepo, runNode, writeFiles, cleanupTempDirs, CI_SCRIPTS } from './helpers.mjs'

after(cleanupTempDirs)

const SCRIPT = path.join(CI_SCRIPTS, 'fake-pass-check.mjs')

// A committed repo with the given files left uncommitted, as `verify` sees it before a commit.
const repoWith = (files, config) => {
  const repo = makeRepo({ headFiles: config === undefined ? {} : { '.claude/engineering.json': JSON.stringify(config) } })
  writeFiles(repo, files)
  return repo
}

const FOCUSED = "import { it } from 'node:test'\nimport assert from 'node:assert/strict'\n\nit.only('should add', () => {\n  assert.equal(1 + 1, 2)\n})\n"

describe('fake-pass-check: scan count and base (ESP-55 AC12)', () => {
  it('should end with how many files it scanned', async () => {
    const r = await runNode(SCRIPT, { cwd: repoWith({ 'src/a.mjs': 'export const a = 1\n', 'src/b.mjs': 'export const b = 2\n' }) })
    assert.equal(r.code, 0, r.stdout + r.stderr)
    assert.match(r.stdout, /^fake-pass check: scanned 2 files$/m)
  })

  it('should say it scanned 0 files when nothing changed', async () => {
    const r = await runNode(SCRIPT, { cwd: repoWith({}) })
    assert.equal(r.code, 0, r.stdout + r.stderr)
    assert.match(r.stdout, /^fake-pass check: scanned 0 files$/m)
  })

  it('should scan the files committed since --base', async () => {
    const repo = makeRepo({ headFiles: { 'tests/math.test.mjs': FOCUSED } })
    const r = await runNode(SCRIPT, { cwd: repo, args: ['--base', 'develop'] })
    assert.equal(r.code, 1, r.stdout + r.stderr)
    assert.match(r.stdout, /\[fp-only, high\] tests\/math\.test\.mjs:4 /)
    assert.match(r.stdout, /^fake-pass check: scanned 1 file$/m)
  })

  it('should exit 2 on a base git cannot resolve', async () => {
    const r = await runNode(SCRIPT, { cwd: repoWith({}), args: ['--base', 'no-such-branch'] })
    assert.equal(r.code, 2, r.stdout + r.stderr)
    assert.match(r.stderr, /fake-pass check could not run/)
  })

  it('should exit 2 on an unknown argument or a base that reads as an option', async () => {
    for (const args of [['--bad'], ['--base', '--output=x']]) {
      const r = await runNode(SCRIPT, { cwd: repoWith({}), args })
      assert.equal(r.code, 2, `${args.join(' ')}: ${r.stdout}${r.stderr}`)
    }
  })
})

describe('fake-pass-check (local entry point, AC8)', () => {
  it('should fail on a focused test in a changed file and name the file, line and rule', async () => {
    const r = await runNode(SCRIPT, { cwd: repoWith({ 'tests/math.test.mjs': FOCUSED }) })
    assert.equal(r.code, 1, r.stdout + r.stderr)
    assert.match(r.stdout, /\[fp-only, high\] tests\/math\.test\.mjs:4 /)
  })

  it('should pass with only warnings and still print them', async () => {
    const r = await runNode(SCRIPT, { cwd: repoWith({ 'src/math.mjs': '// TODO: handle overflow\nexport const add = (a, b) => a + b\n' }) })
    assert.equal(r.code, 0, r.stdout + r.stderr)
    assert.match(r.stdout, /\[fp-placeholder, warning\] src\/math\.mjs:1 /)
  })

  it('should pass on a finding the repo allowlists, and show it as suppressed with the reason', async () => {
    const config = { governance: { allowlist: [{ rule: 'fp-only', path: 'tests/math.test.mjs', reason: 'bisecting a flaky suite' }] } }
    const r = await runNode(SCRIPT, { cwd: repoWith({ 'tests/math.test.mjs': FOCUSED }, config) })
    assert.equal(r.code, 0, r.stdout + r.stderr)
    assert.match(r.stdout, /\[fp-only, high, suppressed: bisecting a flaky suite\] tests\/math\.test\.mjs:4 /)
  })

  it('should fail closed with a readable reason when the config or its allowlist is broken', async () => {
    for (const [what, content] of [['unparseable', '{ not json'], ['bad allowlist', JSON.stringify({ governance: { allowlist: [{ rule: 'fp-only', path: '**' }] } })]]) {
      const repo = repoWith({ 'src/math.mjs': 'export const add = (a, b) => a + b\n' })
      writeFiles(repo, { '.claude/engineering.json': content })
      const r = await runNode(SCRIPT, { cwd: repo })
      assert.equal(r.code, 2, what)
      assert.match(r.stderr, /\.claude\/engineering\.json/, what)
    }
  })

  it('should check every changed file from the repo root when run from a subdirectory', async () => {
    const repo = makeRepo({ headFiles: { 'tests/math.test.mjs': FOCUSED.replace('it.only', 'it'), 'sub/readme.md': 'x\n' } })
    writeFiles(repo, { 'tests/math.test.mjs': FOCUSED, 'tests/new.test.mjs': FOCUSED })
    const r = await runNode(SCRIPT, { cwd: path.join(repo, 'sub') })
    assert.equal(r.code, 1, r.stdout + r.stderr)
    assert.match(r.stdout, /\[fp-only, high\] tests\/math\.test\.mjs:4 /)
    assert.match(r.stdout, /\[fp-only, high\] tests\/new\.test\.mjs:4 /)
  })

  it('should skip a test file git reports as deleted', async () => {
    const repo = makeRepo({ headFiles: { 'tests/math.test.mjs': FOCUSED } })
    writeFiles(repo, { 'tests/math.test.mjs': null })
    const r = await runNode(SCRIPT, { cwd: repo })
    assert.equal(r.code, 0, r.stdout + r.stderr)
    // No finding, and the deleted file is not counted as scanned.
    assert.equal(r.stdout.trim(), 'fake-pass check: scanned 0 files')
  })
})
