// AC14 (R17): the guard and the CI checks give the same findings for the same workflow or dependency change,
// because both call the shared rules in governance-rules.mjs and the lookups in supply-chain-lookups.mjs.
import { describe, it, after } from 'node:test'
import assert from 'node:assert/strict'
import { readdirSync, readFileSync, existsSync } from 'node:fs'
import path from 'node:path'
import { evaluate } from '../hooks/scripts/governance-policy.mjs'
import { parseWorkflowYaml } from '../templates/github/scripts/workflow-rules.mjs'
import { runGovernanceChecks } from '../templates/github/scripts/governance-checks.mjs'
import { snapshotWorkflows } from '../hooks/scripts/bash-workflow-check.mjs'
import { makeRepo, makeGovTree, runNode, tempDir, writeFiles, cleanupTempDirs, PLUGIN_ROOT, BASH_WF_SCRIPT } from './helpers.mjs'

after(cleanupTempDirs)

const FIXTURES = path.join(PLUGIN_ROOT, 'tests', 'fixtures', 'workflows')
const DEP_FIXTURES = path.join(PLUGIN_ROOT, 'tests', 'fixtures', 'deps')
// Fixtures that need a previous version of the file to compare against.
const BASES = { 'perms-widened.yml': 'perms-base.yml' }
// Fixtures the parser fails closed on (wf-unparsed): skipped by the full-parse check only, still compared guard vs CI.
const EXPECTED_UNPARSED = ['flow-seq-pair.yml', 'flow-map-colon-quote.yml']
const config = { governance: { askPaths: [] } }
const env = { PR_BODY: '## Requirement references\n- FR-01\n', PR_LABELS: '[]', BASE_REF: 'develop', HEAD_REF: 'feature/x' }
const read = (name) => readFileSync(path.join(FIXTURES, name), 'utf8')
const key = (list) => list.sort().join(' ')
const reportTiers = (report) => key([...report.matchAll(/\[((?:wf|sc)-[a-z-]+), (high|warning)(?:, suppressed)?\]/g)].map((m) => `${m[1]}:${m[2]}`))

const guardTiers = async (file, content, base, lookups) => {
  const root = tempDir()
  if (base != null) writeFiles(root, { [file]: base })
  const git = { currentBranch: () => 'feature/x', isTracked: () => false }
  const r = await evaluate({ tool_name: 'Write', tool_input: { file_path: file, content } }, { root, cfg: config, git, lookups })
  assert.equal(r?.failures, undefined, `guard lookup failures for ${file}`)
  return key((r?.findings || []).map((f) => `${f.rule}:${f.tier}`))
}

// The after-Bash hook (R6): snapshot, a shell-style write, then the hook; tiers come from its log entries.
const bashTiers = async (file, content, base) => {
  const root = tempDir()
  writeFiles(root, { '.claude/engineering.json': JSON.stringify(config), ...(base != null && { [file]: base }) })
  snapshotWorkflows(root, 'toolu_parity')
  writeFiles(root, { [file]: content })
  const r = await runNode(BASH_WF_SCRIPT, { cwd: root, env: { CLAUDE_PROJECT_DIR: root }, input: JSON.stringify({ hook_event_name: 'PostToolUse', tool_name: 'Bash', tool_input: { command: 'x' }, tool_use_id: 'toolu_parity' }) })
  assert.equal(r.code, 0, r.stderr)
  const log = path.join(root, '.claude', 'governance-log.jsonl')
  const entries = existsSync(log) ? readFileSync(log, 'utf8').trim().split('\n').map((l) => JSON.parse(l)) : []
  assert.deepEqual(entries.filter((e) => e.decision === 'error'), [], `after-Bash errors for ${file}`)
  return key(entries.filter((e) => e.decision === 'finding').map((e) => `${e.rule}:${e.tier}`))
}

const repoFor = (file, content, base) =>
  makeRepo({ baseFiles: { 'README.md': 'base\n', ...(base != null && { [file]: base }) }, headFiles: { [file]: content } })

// The shipped entry point, with the real lookups; workflow changes make no lookups.
const ciTiers = async (file, content, base) => {
  const r = await runNode(path.join(makeGovTree(config), 'governance-checks.mjs'), { cwd: repoFor(file, content, base), env })
  return reportTiers(r.stdout)
}

// The exported CI function with stub lookups (D7).
const ciDependencyTiers = async (file, content, base, lookups) => {
  const govRoot = path.resolve(makeGovTree(config), '..', '..')
  const r = await runGovernanceChecks({ env, lookups, cwd: repoFor(file, content, base), govRoot })
  assert.doesNotMatch(r.report, /lookup unavailable/, `CI lookup failures for ${file}`)
  return reportTiers(r.report)
}

describe('workflow rules: guard and CI parity (AC14)', () => {
  const fixtures = readdirSync(FIXTURES).filter((f) => /\.ya?ml$/.test(f))

  it('should have fixtures to compare', () => {
    assert.ok(fixtures.length >= 10, `found ${fixtures.length}`)
  })

  for (const name of fixtures) {
    it(`should give the same tiers for ${name}`, async () => {
      const file = `.github/workflows/${name}`
      const base = BASES[name] ? read(BASES[name]) : null
      const guard = await guardTiers(file, read(name), base)
      assert.equal(await ciTiers(file, read(name), base), guard)
      assert.equal(await bashTiers(file, read(name), base), guard, 'after-Bash check (R6)')
    })
  }

  it('should parse every fixture fully, so an empty result on both sides is not a shared parse failure', () => {
    for (const name of fixtures.filter((f) => !EXPECTED_UNPARSED.includes(f))) {
      const { doc, problems } = parseWorkflowYaml(read(name))
      assert.deepEqual(problems, [], name)
      const jobs = Object.values(doc.jobs ?? {})
      // A job that calls a reusable workflow has a "uses" string and no steps of its own.
      const parsed = (j) => (Array.isArray(j.steps) && j.steps.length > 0) || (typeof j.uses === 'string' && j.steps === undefined)
      assert.ok(jobs.length > 0 && jobs.every(parsed), `${name}: jobs or steps not parsed`)
    }
  })

  it('should list only fixtures that exist as expected-unparsed, so the list cannot go stale silently', () => {
    for (const name of EXPECTED_UNPARSED) assert.ok(fixtures.includes(name), `${name} is not a fixture`)
  })

  it('should report the expected-unparsed fixtures as wf-unparsed in both guard and CI', async () => {
    for (const name of EXPECTED_UNPARSED) {
      const file = `.github/workflows/${name}`
      assert.match(await guardTiers(file, read(name), null), /wf-unparsed:high/, `guard: ${name}`)
      assert.match(await ciTiers(file, read(name), null), /wf-unparsed:high/, `CI: ${name}`)
    }
  })

  it('should find high-risk issues in the high-risk fixtures, so parity is not trivially empty', async () => {
    for (const name of ['prt-checkout-head.yml', 'prt-checkout-secrets.yml', 'run-injection.yml', 'ai-prompt-injection.yml']) {
      assert.match(await guardTiers(`.github/workflows/${name}`, read(name), null), /:high/, name)
    }
    assert.match(await guardTiers('.github/workflows/perms-widened.yml', read('perms-widened.yml'), read('perms-base.yml')), /wf-permissions-widened:warning/)
  })
})

describe('dependency rules: guard and CI parity with stub lookups (AC14)', () => {
  const readDep = (name) => readFileSync(path.join(DEP_FIXTURES, name), 'utf8')
  const targetFile = (name) =>
    name.startsWith('package-lock') ? 'package-lock.json'
      : name.startsWith('package.') ? 'package.json'
        : name.startsWith('pnpm-lock') ? 'pnpm-lock.yaml'
          : 'yarn.lock'
  // Paired as in the rules tests: X.after.* against X.before.*, other package.json variants against
  // package.before.json; the rest are added files.
  const baseOf = (name) => {
    const before = name.replace('.after.', '.before.')
    if (before !== name && existsSync(path.join(DEP_FIXTURES, before))) return before
    if (targetFile(name) === 'package.json' && name !== 'package.before.json') return 'package.before.json'
    return null
  }
  const fixtures = readdirSync(DEP_FIXTURES).filter((f) => /\.(json|ya?ml|lock)$/.test(f))
  const cases = [
    ...fixtures.map((name) => ({ name, file: targetFile(name), content: readDep(name), base: baseOf(name) && readDep(baseOf(name)) })),
    { name: 'unparseable package.json', file: 'package.json', content: '{ not json', base: readDep('package.before.json') },
  ]

  // The same answers on both sides, chosen so the lookups give findings of every kind for the fixture names.
  const ADVISORIES = { '@scope/util': 'critical', debug: 'moderate' }
  const REGISTRY = {
    react: { deprecated: 'use a newer major' },
    vitest: { latestTime: '2020-01-01T00:00:00.000Z' },
    fsevents: { scripts: { install: 'node-gyp rebuild' } },
  }
  const lookups = {
    registry: async (name) => ['expresss', 'lodahs'].includes(name)
      ? { found: false }
      : { found: true, version: '1.0.0', deprecated: null, latestTime: new Date().toISOString(), scripts: {}, ...REGISTRY[name] },
    advisories: async (entries) => Object.fromEntries(Object.keys(entries).filter((n) => ADVISORIES[n]).map((n) => [n, [{ severity: ADVISORIES[n], title: 'stub advisory' }]])),
  }

  it('should have a fixture for each lockfile format and the manifest', () => {
    assert.deepEqual([...new Set(fixtures.map(targetFile))].sort(), ['package-lock.json', 'package.json', 'pnpm-lock.yaml', 'yarn.lock'])
  })

  const seen = []
  for (const c of cases) {
    it(`should give the same tiers for ${c.name}`, async () => {
      const guard = await guardTiers(c.file, c.content, c.base, lookups)
      assert.equal(await ciDependencyTiers(c.file, c.content, c.base, lookups), guard)
      seen.push(guard)
    })
  }

  it('should cover every dependency rule and lookup finding, so parity is not trivially empty', () => {
    const rules = new Set(seen.join(' ').split(' ').filter(Boolean))
    const expected = [
      'sc-typosquat:high', 'sc-unparsed:high', 'sc-advisory:high', 'sc-advisory:warning', 'sc-lockfile-drift:warning',
      'sc-range-widened:warning', 'sc-non-registry:warning', 'sc-not-found:warning', 'sc-deprecated:warning',
      'sc-stale:warning', 'sc-install-script:warning', 'sc-resolved:high', 'sc-alias:warning',
    ]
    assert.deepEqual(expected.filter((r) => !rules.has(r)), [], `seen: ${[...rules].sort().join(' ')}`)
  })
})
