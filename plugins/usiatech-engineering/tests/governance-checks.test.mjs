import { describe, it, after } from 'node:test'
import assert from 'node:assert/strict'
import { existsSync } from 'node:fs'
import path from 'node:path'
import { makeRepo, makeGovTree, runNode, writeFiles, cleanupTempDirs } from './helpers.mjs'

after(cleanupTempDirs)

const GOOD_BODY = '## Summary\nx\n\n## Requirement references\n- FR-01\n'

const runChecks = ({ repo, config = {}, body = GOOD_BODY, labels = [], base = 'develop', head = 'feature/x' }) =>
  runNode(path.join(makeGovTree(config), 'governance-checks.mjs'), {
    cwd: repo,
    env: { PR_BODY: body, PR_LABELS: JSON.stringify(labels), BASE_REF: base, HEAD_REF: head },
  })

describe('governance-checks', () => {
  it('should pass a referenced PR from a feature branch that changes ordinary files', async () => {
    const repo = makeRepo({ headFiles: { 'src/a.ts': 'export {}\n' } })
    const r = await runChecks({ repo })
    assert.equal(r.code, 0, r.stdout)
    assert.match(r.stdout, /All deterministic governance checks passed/)
    assert.match(r.summary, /Files changed: 1/)
  })

  describe('requirement references', () => {
    it('should fail without a reference under the heading', async () => {
      const repo = makeRepo({ headFiles: { 'src/a.ts': 'x' } })
      const r = await runChecks({ repo, body: '## Summary\nFixes FR-01\n\n## Requirement references\n- none\n' })
      assert.equal(r.code, 1)
      assert.match(r.stdout, /no requirement reference/)
    })

    it('should ignore references hidden in HTML comments', async () => {
      const repo = makeRepo({ headFiles: { 'src/a.ts': 'x' } })
      const r = await runChecks({ repo, body: '## Requirement references\n<!-- e.g. FR-01 -->\n' })
      assert.equal(r.code, 1)
    })

    it('should accept each default reference style', async () => {
      const repo = makeRepo({ headFiles: { 'src/a.ts': 'x' } })
      for (const ref of ['C3', 'FR-12', 'AC-01', 'ADR-0007', 'D4', '§ 2', '#123']) {
        const r = await runChecks({ repo, body: `## Requirement references\n- ${ref}\n` })
        assert.equal(r.code, 0, ref)
      }
    })

    it('should use requirementRefPattern from the base-branch config', async () => {
      const repo = makeRepo({ headFiles: { 'src/a.ts': 'x' } })
      const config = { governance: { requirementRefPattern: String.raw`\bJIRA-\d+\b` } }
      assert.equal((await runChecks({ repo, config, body: '## Requirement references\n- JIRA-42\n' })).code, 0)
      assert.equal((await runChecks({ repo, config })).code, 1, 'FR-01 no longer matches')
    })
  })

  describe('branch flow', () => {
    it('should reject PRs into main from a feature branch', async () => {
      const repo = makeRepo({ base: 'main', headFiles: { 'src/a.ts': 'x' } })
      const r = await runChecks({ repo, base: 'main', head: 'feature/x' })
      assert.equal(r.code, 1)
      assert.match(r.stdout, /must come from "develop"/)
    })

    it('should accept PRs into main from develop or hotfix/*', async () => {
      const repo = makeRepo({ base: 'main', headFiles: { 'src/a.ts': 'x' } })
      assert.equal((await runChecks({ repo, base: 'main', head: 'develop' })).code, 0)
      assert.equal((await runChecks({ repo, base: 'main', head: 'hotfix/urgent' })).code, 0)
    })

    it('should honour a configured base branch', async () => {
      const repo = makeRepo({ base: 'main', headFiles: { 'src/a.ts': 'x' } })
      const config = { git: { baseBranch: 'dev' } }
      assert.equal((await runChecks({ repo, config, base: 'main', head: 'dev' })).code, 0)
      assert.equal((await runChecks({ repo, config, base: 'main', head: 'develop' })).code, 1)
    })
  })

  describe('changed files', () => {
    it('should reject committed env files but allow .env.example', async () => {
      const bad = makeRepo({ headFiles: { 'apps/web/.env.local': 'SECRET=1' } })
      const r = await runChecks({ repo: bad })
      assert.equal(r.code, 1)
      assert.match(r.stdout, /Env file committed: apps\/web\/\.env\.local/)
      const ok = makeRepo({ headFiles: { '.env.example': 'SECRET=' } })
      assert.equal((await runChecks({ repo: ok })).code, 0)
    })

    it('should allow deleting an env file', async () => {
      const repo = makeRepo({ baseFiles: { '.env': 'x' }, headFiles: { '.env': null } })
      assert.equal((await runChecks({ repo })).code, 0)
    })

    it('should reject changes to committed immutable files', async () => {
      const repo = makeRepo({ baseFiles: { 'migrations/001.sql': 'a' }, headFiles: { 'migrations/001.sql': 'b' } })
      const r = await runChecks({ repo, config: { immutableWhenCommitted: ['migrations/*.sql'] } })
      assert.equal(r.code, 1)
      assert.match(r.stdout, /Committed immutable file changed \(M\): migrations\/001\.sql/)
    })

    it('should allow adding a new file that matches an immutable glob', async () => {
      const repo = makeRepo({ baseFiles: { 'migrations/001.sql': 'a' }, headFiles: { 'migrations/002.sql': 'b' } })
      assert.equal((await runChecks({ repo, config: { immutableWhenCommitted: ['migrations/*.sql'] } })).code, 0)
    })

    it('should require the approval label for governance, CI and dependency files', async () => {
      const repo = makeRepo({ headFiles: { 'REVIEW.md': 'x', '.github/workflows/ci.yml': 'y' } })
      const r = await runChecks({ repo })
      assert.equal(r.code, 1)
      assert.match(r.stdout, /Governance\/CI\/dependency files changed: .*REVIEW\.md/)
      const labelled = await runChecks({ repo, labels: ['governance-approved'] })
      assert.equal(labelled.code, 0)
      assert.match(labelled.stdout, /Accepted via label "governance-approved"/)
    })

    it('should use a custom approval label from the config', async () => {
      const repo = makeRepo({ headFiles: { 'package.json': '{}' } })
      const config = { governance: { approvalLabel: 'owner-ok' } }
      assert.equal((await runChecks({ repo, config, labels: ['governance-approved'] })).code, 1)
      assert.equal((await runChecks({ repo, config, labels: ['owner-ok'] })).code, 0)
    })
  })

  it('should read rules from the base-branch copy, not the PR working tree', async () => {
    // The PR tries to loosen the reference pattern in its own engineering.json.
    const repo = makeRepo({ headFiles: { '.claude/engineering.json': JSON.stringify({ governance: { requirementRefPattern: '.*' } }) } })
    const r = await runChecks({ repo, body: '## Requirement references\n- trust me\n', labels: ['governance-approved'] })
    assert.equal(r.code, 1)
    assert.match(r.stdout, /no requirement reference/)
  })

  it('should not run shell syntax embedded in the base ref', async () => {
    const repo = makeRepo({ headFiles: { 'src/a.ts': 'x' } })
    const r = await runChecks({ repo, base: 'develop$(touch pwned)' })
    assert.notEqual(r.code, 0, 'unknown ref must fail')
    assert.equal(existsSync(path.join(repo, 'pwned')), false)
  })
})

describe('governance-checks: invalid base-branch config', () => {
  it('should fail with a readable reason when the config is not valid JSON', async () => {
    const repo = makeRepo({ headFiles: { 'src/a.ts': 'x' } })
    const scripts = makeGovTree()
    writeFiles(path.resolve(scripts, '../..'), { '.claude/engineering.json': '{ "governance": ' })
    const r = await runNode(path.join(scripts, 'governance-checks.mjs'), {
      cwd: repo,
      env: { PR_BODY: GOOD_BODY, PR_LABELS: '[]', BASE_REF: 'develop', HEAD_REF: 'feature/x' },
    })
    assert.equal(r.code, 1)
    assert.match(r.stdout, /Base-branch \.claude\/engineering\.json: could not be parsed/)
  })

  const cases = [
    ['config as an array', [], /not a JSON object/],
    ['governance as a string', { governance: 'x' }, /"governance" must be an object/],
    ['releaseBranch as a number', { git: { releaseBranch: 42 } }, /"git\.releaseBranch" must be a non-empty string/],
    ['askPaths as a string', { governance: { askPaths: 'AGENTS.md' } }, /"governance\.askPaths" must be an array of strings/],
    ['immutableWhenCommitted as a string', { immutableWhenCommitted: 'x/*.sql' }, /"immutableWhenCommitted" must be an array of strings/],
    ['an invalid requirementRefPattern', { governance: { requirementRefPattern: '(' } }, /"governance\.requirementRefPattern" is not a valid regex/],
  ]
  for (const [name, config, re] of cases) {
    it(`should fail and name the problem for ${name}`, async () => {
      const repo = makeRepo({ headFiles: { 'src/a.ts': 'x' } })
      const r = await runChecks({ repo, config })
      assert.equal(r.code, 1, r.stderr)
      assert.match(r.stdout, re)
    })
  }

  it('should still apply the default rules when a key is invalid', async () => {
    const repo = makeRepo({ headFiles: { 'AGENTS.md': 'x' } })
    const r = await runChecks({ repo, config: { governance: { askPaths: 'nope' } } })
    assert.match(r.stdout, /Governance\/CI\/dependency files changed: AGENTS\.md/)
  })
})

describe('governance-checks: case and .env.example', () => {
  it('should catch env and governance files regardless of case', async () => {
    const repo = makeRepo({ headFiles: { '.ENV': 'x', 'Agents.MD': 'y' } })
    const r = await runChecks({ repo })
    assert.equal(r.code, 1)
    assert.match(r.stdout, /Env file committed: \.ENV/)
    assert.match(r.stdout, /Governance\/CI\/dependency files changed: .*Agents\.MD/)
  })

  it('should reject .env.example when the base config sets allowEnvExample to false', async () => {
    const repo = makeRepo({ headFiles: { '.env.example': 'X=' } })
    assert.equal((await runChecks({ repo, config: { allowEnvExample: false } })).code, 1)
  })
})
