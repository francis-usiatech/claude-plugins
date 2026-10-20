import { describe, it, after } from 'node:test'
import assert from 'node:assert/strict'
import path from 'node:path'
import { writeFileSync } from 'node:fs'
import { makeRepo, makeGovTree, runNode, git, cleanupTempDirs } from './helpers.mjs'

after(cleanupTempDirs)

const ok = (name) => ({ name, run: 'node -e "process.exit(0)"' })
const fail = (name) => ({ name, run: 'node -e "process.exit(3)"' })

const runVerify = ({ repo, config, base = 'develop' }) =>
  runNode(path.join(makeGovTree(config), 'run-verify.mjs'), { cwd: repo, env: { BASE_REF: base } })

describe('run-verify', () => {
  it('should run every step and report PASS', async () => {
    const repo = makeRepo({ headFiles: { 'src/a.ts': 'x' } })
    const r = await runVerify({ repo, config: { verify: [ok('typecheck'), ok('tests')] } })
    assert.equal(r.code, 0, r.stdout + r.stderr)
    assert.match(r.summary, /\| typecheck \| .* \| ✅ pass \|/)
    assert.match(r.summary, /\*\*Gate: PASS\*\*/)
  })

  it('should stop at the first failure and mark later steps as not run', async () => {
    const repo = makeRepo()
    const r = await runVerify({ repo, config: { verify: [ok('a'), fail('b'), ok('c')] } })
    assert.equal(r.code, 1)
    assert.match(r.summary, /\| b \| .* \| ❌ exit 3 \|/)
    assert.match(r.summary, /\| c \| .* \| ⏭️ not run \|/)
    assert.match(r.summary, /\*\*Gate: FAIL\*\*/)
  })

  it('should fail when the config is missing or has no steps', async () => {
    const repo = makeRepo()
    for (const config of [undefined, {}, { verify: [] }]) {
      const r = await runVerify({ repo, config })
      assert.equal(r.code, 1, JSON.stringify(config))
      assert.match(r.stderr, /No verify steps found/)
    }
  })

  it('should run conditional steps only when a changed file matches a prefix', async () => {
    const config = { verify: [ok('base')], verifyConditional: [{ ...fail('rls'), when: ['packages/db/'] }] }
    const untouched = makeRepo({ headFiles: { 'apps/web/page.tsx': 'x' } })
    assert.equal((await runVerify({ repo: untouched, config })).code, 0)
    const touched = makeRepo({ headFiles: { 'packages/db/schema.sql': 'x' } })
    const r = await runVerify({ repo: touched, config })
    assert.equal(r.code, 1)
    assert.match(r.summary, /\| rls \|/)
  })

  it('should run a conditional step for a changed non-ASCII path (F6)', async () => {
    const config = { verify: [ok('base')], verifyConditional: [{ ...fail('tools'), when: ['tools/'] }] }
    const r = await runVerify({ repo: makeRepo({ headFiles: { 'tools/café.py': 'x' } }), config })
    assert.equal(r.code, 1)
    assert.match(r.summary, /\| tools \|/)
    // git quotes a name with a double quote even with core.quotePath=false; only -z gives it raw. Staged directly,
    // since Windows can't create such a file (and core.protectNTFS refuses it there by default).
    const quoted = makeRepo()
    git(quoted, '-c', 'core.protectNTFS=false', 'update-index', '--add', '--cacheinfo', `100644,${git(quoted, 'hash-object', '-w', 'README.md')},tools/a"b.py`)
    git(quoted, 'commit', '-q', '-m', 'quoted name')
    const q = await runVerify({ repo: quoted, config })
    assert.equal(q.code, 1)
    assert.match(q.summary, /\| tools \|/)
  })

  it('should skip package-manager steps when the repo has no package.json yet', async () => {
    const repo = makeRepo()
    const r = await runVerify({ repo, config: { verify: [{ name: 'tests', run: 'pnpm test' }] } })
    assert.equal(r.code, 0)
    assert.match(r.summary, /skipped \(no package\.json yet\)/)
  })

  it('should not skip package-manager steps when the PR deletes the base branch package.json (R6)', async () => {
    const repo = makeRepo()
    const scripts = makeGovTree({ verify: [{ name: 'tests', run: 'npm test' }] })
    writeFileSync(path.join(scripts, '../../package.json'), '{}')
    const r = await runNode(path.join(scripts, 'run-verify.mjs'), { cwd: repo, env: { BASE_REF: 'develop' } })
    assert.equal(r.code, 1, r.stdout + r.stderr)
    assert.doesNotMatch(r.summary, /no package\.json yet/)
  })

  it('should fail when expectNoDiff paths change after the step runs', async () => {
    const repo = makeRepo({ baseFiles: { 'docs/out.html': 'old' } })
    const step = { name: 'build docs', run: `node -e "require('fs').writeFileSync('docs/out.html','new')"`, expectNoDiff: ['docs/out.html'] }
    const r = await runVerify({ repo, config: { verify: [step] } })
    assert.equal(r.code, 1)
    assert.match(r.summary, /docs\/out\.html out of date/)
  })

  it('should read the step list from the base-branch copy, not the PR working tree', async () => {
    // The PR empties its own verify list; the base-branch list still runs and fails.
    const repo = makeRepo({ headFiles: { '.claude/engineering.json': JSON.stringify({ verify: [ok('noop')] }) } })
    const r = await runVerify({ repo, config: { verify: [fail('real tests')] } })
    assert.equal(r.code, 1)
    assert.match(r.summary, /real tests/)
  })
})
