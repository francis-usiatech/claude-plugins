// AC10 (R11): the local check (fake-pass-check.mjs, run by `verify`) and the CI gate (governance-checks.mjs) give
// the same fp-* rule IDs and tiers for the same file, because both call checkFakePasses from the shared module.
import { describe, it, after } from 'node:test'
import assert from 'node:assert/strict'
import { readdirSync, readFileSync } from 'node:fs'
import path from 'node:path'
import { makeRepo, makeGovTree, runNode, writeFiles, cleanupTempDirs, PLUGIN_ROOT, CI_SCRIPTS } from './helpers.mjs'

after(cleanupTempDirs)

const FIXTURES = path.join(PLUGIN_ROOT, 'tests', 'fixtures', 'fake-pass')
const RULES = ['fp-only', 'fp-skip', 'fp-empty-test', 'fp-no-assert', 'fp-placeholder', 'fp-unreadable']
const config = { governance: { askPaths: [] } }
const env = { PR_BODY: '## Requirement references\n- FR-01\n', PR_LABELS: '[]', BASE_REF: 'develop', HEAD_REF: 'feature/x' }
const read = (name) => readFileSync(path.join(FIXTURES, name), 'utf8')
const tiers = (output) => [...output.matchAll(/\[(fp-[a-z-]+), (high|warning)(?:, suppressed[^\]]*)?\]/g)].map((m) => `${m[1]}:${m[2]}`).sort().join(' ')

// The file left uncommitted, as `verify` sees it before a commit.
const localTiers = async (file, content) => {
  const repo = makeRepo()
  writeFiles(repo, { [file]: content })
  const r = await runNode(path.join(CI_SCRIPTS, 'fake-pass-check.mjs'), { cwd: repo })
  assert.equal(r.stderr, '', `local check could not run for ${file}`)
  return tiers(r.stdout)
}

// The file committed on the PR branch, judged by the base-branch copy of the CI entry point.
const ciTiers = async (file, content) => {
  const r = await runNode(path.join(makeGovTree(config), 'governance-checks.mjs'), { cwd: makeRepo({ headFiles: { [file]: content } }), env })
  // A CI run that crashed would print no findings and match an empty local result.
  assert.match(r.stdout, /^## Governance checks/m, `CI checks did not report for ${file}: ${r.stderr}`)
  return tiers(r.stdout)
}

describe('fake-pass rules: local and CI parity (AC10)', () => {
  // Every fixture as a test file, plus the placeholder fixture as non-test source, which gets only fp-placeholder.
  const cases = [
    ...readdirSync(FIXTURES).filter((f) => f.endsWith('.txt')).map((name) => ({ name, file: `tests/${name.replace(/\.txt$/, '')}.test.mjs` })),
    { name: 'placeholder.txt', file: 'src/placeholder.mjs' },
  ]
  const seen = []

  for (const { name, file } of cases) {
    it(`should give the same rules and tiers for ${name} as ${file}`, async () => {
      const local = await localTiers(file, read(name))
      assert.equal(await ciTiers(file, read(name)), local)
      seen.push(local)
    })
  }

  it('should cover every fp-* rule, so parity is not trivially empty', () => {
    const rules = new Set(seen.join(' ').split(' ').filter(Boolean).map((t) => t.split(':')[0]))
    assert.deepEqual([...rules].sort(), [...RULES].sort())
  })
})
