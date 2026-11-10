import { describe, it, after } from 'node:test'
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { planDocVersions, validateDocVersions } from '../scripts/doc-versions.mjs'
import { PLUGIN_ROOT, tempDir, cleanupTempDirs, git } from './helpers.mjs'

after(cleanupTempDirs)

const SCRIPT = path.join(PLUGIN_ROOT, 'scripts', 'doc-versions.mjs')
const ENTRY = {
  changelog: 'intent/CHANGELOG.md',
  format: 'major.minor',
  unreleased: 'Unreleased',
  versionFiles: [{ path: 'intent/README.md', pattern: 'Draft v(\\d+\\.\\d+)' }],
  after: 'python3 tools/build_intent_html.py',
}
const CHANGELOG = [
  '# Intent changelog',
  '',
  '| Date | Version | Change | By |',
  '|---|---|---|---|',
  '| 2026-11-05 | 0.9 | Ninth | Francis |',
  '| 2026-11-06 | 0.78 | Older pipes \\| kept | Francis |',
  '| 2026-11-09 | Unreleased | First new | Francis |',
  '| 2026-11-10 | Unreleased | Second new | Francis |',
  '',
].join('\n')
const README = '# Intent\n\n> **Status:** Draft v0.78 · 2026-11-06\n'
const files = (extra = {}) => ({ 'intent/CHANGELOG.md': CHANGELOG, 'intent/README.md': README, ...extra })
const plan = (texts, entry = ENTRY) => planDocVersions(entry, (p) => {
  if (!(p in texts)) throw new Error(`no ${p}`)
  return texts[p]
}, '2026-11-20')

describe('planDocVersions (ESP-153; AC6)', () => {
  it('should give two Unreleased rows after 0.78 the versions 0.79 and 0.80, in table order, dated today', () => {
    const r = plan(files())
    assert.deepEqual(r.assigned, ['0.79', '0.80'])
    assert.equal(r.version, '0.80')
    const log = r.changes['intent/CHANGELOG.md']
    assert.match(log, /\| 2026-11-20 \| 0\.79 \| First new \| Francis \|/)
    assert.match(log, /\| 2026-11-20 \| 0\.80 \| Second new \| Francis \|/)
    assert.match(log, /\| 2026-11-06 \| 0\.78 \| Older pipes \\\| kept \| Francis \|/)
    assert.equal(r.changes['intent/README.md'], '# Intent\n\n> **Status:** Draft v0.80 · 2026-11-06\n')
    assert.equal(r.after, ENTRY.after)
  })

  it('should compare versions as numbers, so 0.10 follows 0.9', () => {
    const r = plan(files({ 'intent/CHANGELOG.md': CHANGELOG.replace('0.78', '0.8').replace(/Unreleased \| Second.*\n/, '0.10 | Second | F |\n'), 'intent/README.md': README.replace('0.78', '0.10') }))
    assert.deepEqual(r.assigned, ['0.11'])
  })

  it('should keep CRLF line endings', () => {
    const r = plan(files({ 'intent/CHANGELOG.md': CHANGELOG.replace(/\n/g, '\r\n') }))
    assert.match(r.changes['intent/CHANGELOG.md'], /\| 2026-11-20 \| 0\.79 \| First new \| Francis \|\r\n/)
  })

  it('should find the version table after another table, and set every version in a version file', () => {
    const legend = '| Term | Meaning |\n|---|---|\n| HEI | institution |\n\n'
    const r = plan(files({
      'intent/CHANGELOG.md': CHANGELOG.replace('# Intent changelog\n\n', `# Intent changelog\n\n${legend}`),
      'intent/README.md': `${README}\nFooter: Draft v0.78\n`,
    }))
    assert.deepEqual(r.assigned, ['0.79', '0.80'])
    assert.equal(r.changes['intent/README.md'], '# Intent\n\n> **Status:** Draft v0.80 · 2026-11-06\n\nFooter: Draft v0.80\n')
  })

  it('should refuse a version table with no separator row', () => {
    assert.throws(() => plan(files({ 'intent/CHANGELOG.md': CHANGELOG.replace('|---|---|---|---|\n', '') })), /separator/)
  })

  it('should change nothing when there is no Unreleased row', () => {
    const r = plan(files({ 'intent/CHANGELOG.md': CHANGELOG.replace(/^.*Unreleased.*\n/gm, '') }))
    assert.deepEqual(r, { changelog: ENTRY.changelog, assigned: [], version: null, changes: {}, after: null })
  })

  for (const [why, texts, message] of [
    ['a version file that is behind the changelog', files({ 'intent/README.md': README.replace('0.78', '0.77') }), /0\.77.*0\.78/],
    ['a version file the pattern does not match', files({ 'intent/README.md': '# no version\n' }), /does not match/],
    ['a table with no Version column', files({ 'intent/CHANGELOG.md': CHANGELOG.replace('| Version |', '| Ver |') }), /Version/],
    ['a table with no released version', files({ 'intent/CHANGELOG.md': CHANGELOG.replace(/\| 0\.(9|78) \|/g, '| Unreleased |') }), /no released version/],
    ['a missing changelog', { 'intent/README.md': README }, /no intent\/CHANGELOG\.md/],
  ]) {
    it(`should refuse ${why}`, () => assert.throws(() => plan(texts), message))
  }
})

describe('validateDocVersions (ESP-153; AC6)', () => {
  it('should accept the documented entry and default the marker and format', () => {
    const [entry] = validateDocVersions([{ changelog: 'CHANGELOG.md', versionFiles: [] }])
    assert.equal(entry.unreleased, 'Unreleased')
    assert.equal(entry.format, 'major.minor')
    assert.deepEqual(validateDocVersions([ENTRY]), [ENTRY])
  })
  for (const [why, list] of [
    ['a list that is not an array', { changelog: 'x' }],
    ['a changelog outside the repo', [{ changelog: '../x.md' }]],
    ['an absolute changelog', [{ changelog: '/x.md' }]],
    ['an unknown format', [{ changelog: 'x.md', format: 'semver' }]],
    ['a pattern with no capture group', [{ changelog: 'x.md', versionFiles: [{ path: 'r.md', pattern: 'v\\d+' }] }]],
    ['a pattern that does not compile', [{ changelog: 'x.md', versionFiles: [{ path: 'r.md', pattern: '(' }] }]],
    ['a non-string after', [{ changelog: 'x.md', after: ['a'] }]],
    ['an empty marker', [{ changelog: 'x.md', unreleased: '' }]],
  ]) {
    it(`should refuse ${why}`, () => assert.throws(() => validateDocVersions(list)))
  }
})

describe('doc-versions.mjs as a script (ESP-153; AC6)', () => {
  const makeRepo = (config) => {
    const repo = tempDir('usiatech-doc-versions-')
    git(repo, 'init', '-q', '-b', 'develop')
    git(repo, 'config', 'user.email', 'test@example.com')
    git(repo, 'config', 'user.name', 'Test')
    for (const [file, text] of Object.entries({ '.claude/engineering.json': JSON.stringify(config), ...files() })) {
      mkdirSync(path.dirname(path.join(repo, file)), { recursive: true })
      writeFileSync(path.join(repo, file), text)
    }
    git(repo, 'add', '-A')
    git(repo, 'commit', '-q', '-m', 'chore: start')
    return repo
  }
  const run = (repo, args = []) => spawnSync(process.execPath, [SCRIPT, ...args], { cwd: repo, encoding: 'utf8' })

  it('should write the versions and print what it did', () => {
    const repo = makeRepo({ docVersions: [ENTRY] })
    const r = run(repo, ['--date', '2026-11-20'])
    assert.equal(r.status, 0, r.stderr)
    const out = JSON.parse(r.stdout)
    assert.equal(out.enabled, true)
    assert.deepEqual(out.sets.map((s) => [s.assigned, s.version, s.after]), [[['0.79', '0.80'], '0.80', ENTRY.after]])
    assert.deepEqual(out.changedFiles, ['intent/CHANGELOG.md', 'intent/README.md'])
    assert.match(readFileSync(path.join(repo, 'intent/README.md'), 'utf8'), /Draft v0\.80/)
  })

  it('should keep both sets\' edits when two sets share a version file', () => {
    const second = { changelog: 'specs/CHANGELOG.md', versionFiles: [{ path: 'intent/README.md', pattern: 'Specs v(\\d+\\.\\d+)' }] }
    const repo = makeRepo({ docVersions: [ENTRY, second] })
    writeFileSync(path.join(repo, 'intent/README.md'), `${README}Specs v1.2\n`)
    mkdirSync(path.join(repo, 'specs'))
    writeFileSync(path.join(repo, 'specs/CHANGELOG.md'), '| Date | Version | Change |\n|---|---|---|\n| 2026-01-01 | 1.2 | a |\n| x | Unreleased | b |\n')
    const r = run(repo, ['--date', '2026-11-20'])
    assert.equal(r.status, 0, r.stderr)
    const readme = readFileSync(path.join(repo, 'intent/README.md'), 'utf8')
    assert.match(readme, /Draft v0\.80/)
    assert.match(readme, /Specs v1\.3/)
  })

  it('should report not enabled when the config has no docVersions', () => {
    const r = run(makeRepo({}))
    assert.equal(r.status, 0, r.stderr)
    assert.deepEqual(JSON.parse(r.stdout), { enabled: false })
  })

  it('should exit 2 with nothing written on a bad config or a bad date', () => {
    const repo = makeRepo({ docVersions: [{ changelog: '../x.md' }] })
    const r = run(repo)
    assert.equal(r.status, 2)
    assert.equal(r.stdout, '')
    assert.equal(run(makeRepo({ docVersions: [ENTRY] }), ['--date', '20-11-2026']).status, 2)
  })
})
