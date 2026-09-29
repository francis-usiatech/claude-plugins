// AC14 (R17): the guard and the CI checks give the same findings for the same workflow change,
// because both call the shared rules in governance-rules.mjs.
import { describe, it, after } from 'node:test'
import assert from 'node:assert/strict'
import { readdirSync, readFileSync } from 'node:fs'
import path from 'node:path'
import { evaluate } from '../hooks/scripts/governance-policy.mjs'
import { parseWorkflowYaml } from '../templates/github/scripts/workflow-rules.mjs'
import { makeRepo, makeGovTree, runNode, tempDir, writeFiles, cleanupTempDirs, PLUGIN_ROOT } from './helpers.mjs'

after(cleanupTempDirs)

const FIXTURES = path.join(PLUGIN_ROOT, 'tests', 'fixtures', 'workflows')
// Fixtures that need a previous version of the file to compare against.
const BASES = { 'perms-widened.yml': 'perms-base.yml' }
const config = { governance: { askPaths: [] } }
const read = (name) => readFileSync(path.join(FIXTURES, name), 'utf8')
const key = (list) => list.sort().join(' ')

const guardTiers = (file, content, base) => {
  const root = tempDir()
  if (base != null) writeFiles(root, { [file]: base })
  const git = { currentBranch: () => 'feature/x', isTracked: () => false }
  const r = evaluate({ tool_name: 'Write', tool_input: { file_path: file, content } }, { root, cfg: config, git })
  return key((r?.findings || []).map((f) => `${f.rule}:${f.tier}`))
}

const ciTiers = async (file, content, base) => {
  const repo = makeRepo({ baseFiles: { 'README.md': 'base\n', ...(base != null && { [file]: base }) }, headFiles: { [file]: content } })
  const r = await runNode(path.join(makeGovTree(config), 'governance-checks.mjs'), {
    cwd: repo,
    env: { PR_BODY: '## Requirement references\n- FR-01\n', PR_LABELS: '[]', BASE_REF: 'develop', HEAD_REF: 'feature/x' },
  })
  return key([...r.stdout.matchAll(/\[(wf-[a-z-]+), (high|warning)(?:, suppressed)?\]/g)].map((m) => `${m[1]}:${m[2]}`))
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
      assert.equal(await ciTiers(file, read(name), base), guardTiers(file, read(name), base))
    })
  }

  it('should parse every fixture fully, so an empty result on both sides is not a shared parse failure', () => {
    for (const name of fixtures) {
      const { doc, problems } = parseWorkflowYaml(read(name))
      assert.deepEqual(problems, [], name)
      const jobs = Object.values(doc.jobs ?? {})
      assert.ok(jobs.length > 0 && jobs.every((j) => Array.isArray(j.steps) && j.steps.length > 0), `${name}: jobs or steps not parsed`)
    }
  })

  it('should find high-risk issues in the high-risk fixtures, so parity is not trivially empty', () => {
    for (const name of ['prt-checkout-head.yml', 'prt-checkout-secrets.yml', 'run-injection.yml', 'ai-prompt-injection.yml']) {
      assert.match(guardTiers(`.github/workflows/${name}`, read(name), null), /:high/, name)
    }
    assert.match(guardTiers('.github/workflows/perms-widened.yml', read('perms-widened.yml'), read('perms-base.yml')), /wf-permissions-widened:warning/)
  })
})
