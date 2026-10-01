import { describe, it, after } from 'node:test'
import assert from 'node:assert/strict'
import { existsSync } from 'node:fs'
import path from 'node:path'
import { makeRepo, makeGovTree, runNode, writeFiles, git, cleanupTempDirs } from './helpers.mjs'
import { runGovernanceChecks } from '../templates/github/scripts/governance-checks.mjs'

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

describe('governance-checks: workflow content (R12, R15; AC8, AC10, AC12)', () => {
  const WF = '.github/workflows/ci.yml'
  const injection = 'on: issues\njobs:\n  a:\n    steps:\n      - run: echo "${{ github.event.issue.title }}"\n'
  const unpinned = 'on: push\njobs:\n  a:\n    steps:\n      - uses: some-org/action@v1\n'
  const noAsk = { governance: { askPaths: [] } }

  it('should fail on a high-risk workflow finding even when askPaths does not cover the file', async () => {
    const repo = makeRepo({ headFiles: { [WF]: injection } })
    const r = await runChecks({ repo, config: noAsk })
    assert.equal(r.code, 1, r.stdout)
    assert.match(r.stdout, /\[wf-untrusted-input, high\] \.github\/workflows\/ci\.yml:5/)
  })

  it('should pass a warning-only change outside askPaths and list the warning', async () => {
    const repo = makeRepo({ headFiles: { [WF]: unpinned } })
    const r = await runChecks({ repo, config: noAsk })
    assert.equal(r.code, 0, r.stdout)
    assert.match(r.summary, /⚠️ \[wf-unpinned-action, warning\]/)
  })

  it('should turn a high-risk failure into a pass with the approval label', async () => {
    const repo = makeRepo({ headFiles: { [WF]: injection } })
    const r = await runChecks({ repo, config: noAsk, labels: ['governance-approved'] })
    assert.equal(r.code, 0, r.stdout)
    assert.match(r.stdout, /high-risk.*Accepted via label "governance-approved"/)
  })

  it('should keep the existing label requirement for workflow files under the default askPaths', async () => {
    const repo = makeRepo({ headFiles: { [WF]: unpinned } })
    const r = await runChecks({ repo })
    assert.equal(r.code, 1)
    assert.match(r.stdout, /Governance\/CI\/dependency files changed: \.github\/workflows\/ci\.yml/)
    assert.match(r.stdout, /wf-unpinned-action/)
  })

  it('should compare permissions with the base-branch version of the file', async () => {
    const base = 'on: push\njobs:\n  a:\n    permissions:\n      contents: read\n    steps:\n      - run: echo ok\n'
    const repo = makeRepo({ baseFiles: { [WF]: base }, headFiles: { [WF]: base.replace('contents: read', 'contents: write') } })
    const r = await runChecks({ repo, config: noAsk })
    assert.equal(r.code, 0, r.stdout)
    assert.match(r.stdout, /wf-permissions-widened, warning.*contents: read → write/)
  })

  it('should mark allowlisted findings suppressed and not fail on them', async () => {
    const repo = makeRepo({ headFiles: { [WF]: injection } })
    const r = await runChecks({ repo, config: { governance: { askPaths: [], allowlist: [{ rule: 'wf-untrusted-input', path: WF }] } } })
    assert.equal(r.code, 0, r.stdout)
    assert.match(r.stdout, /\[wf-untrusted-input, high, suppressed\]/)
  })

  it('should ignore an allowlist entry that does not match', async () => {
    const repo = makeRepo({ headFiles: { [WF]: injection } })
    const r = await runChecks({ repo, config: { governance: { askPaths: [], allowlist: [{ rule: 'wf-untrusted-input', path: '.github/workflows/other.yml' }] } } })
    assert.equal(r.code, 1, r.stdout)
  })

  it('should fail with a readable reason for an invalid allowlist', async () => {
    const repo = makeRepo({ headFiles: { 'src/a.ts': 'x' } })
    const r = await runChecks({ repo, config: { governance: { allowlist: [{ rule: 'wf-write-all' }] } } })
    assert.equal(r.code, 1)
    assert.match(r.stdout, /"governance\.allowlist\[0\]"/)
  })

  it('should not check a deleted workflow', async () => {
    const repo = makeRepo({ baseFiles: { [WF]: injection }, headFiles: { [WF]: null, 'src/a.ts': 'x' } })
    const r = await runChecks({ repo, config: noAsk })
    assert.equal(r.code, 0, r.stdout)
    assert.doesNotMatch(r.stdout, /wf-/)
  })

  it('should check a workflow with a non-ASCII file name and apply the label check to it', async () => {
    const wf = '.github/workflows/é.yml'
    const repo = makeRepo({ headFiles: { [wf]: injection } })
    const r = await runChecks({ repo })
    assert.equal(r.code, 1, r.stdout)
    assert.match(r.stdout, /\[wf-untrusted-input, high\] \.github\/workflows\/é\.yml:5/)
    assert.match(r.stdout, /Governance\/CI\/dependency files changed: \.github\/workflows\/é\.yml/)
  })

  it('should check a renamed workflow against its old base version', async () => {
    const base = 'on: push\npermissions:\n  contents: read\njobs:\n  a:\n    steps:\n      - run: echo ok\n'
    const repo = makeRepo({
      baseFiles: { '.github/workflows/old.yml': base },
      headFiles: { '.github/workflows/old.yml': null, '.github/workflows/new.yml': base.replace('contents: read', 'contents: write') },
    })
    const r = await runChecks({ repo, config: noAsk })
    assert.match(r.stdout, /wf-permissions-widened/)
  })
})

describe('governance-checks: test content (R10; AC9, D12)', () => {
  const focused = "import { it } from 'node:test'\nimport assert from 'node:assert/strict'\n\nit.only('should add', () => {\n  assert.equal(1 + 1, 2)\n})\n"
  const TEST = 'tests/math.test.mjs'

  it('should fail on a high fake-pass finding and name the file, line and rule', async () => {
    const repo = makeRepo({ headFiles: { [TEST]: focused } })
    const r = await runChecks({ repo })
    assert.equal(r.code, 1, r.stdout)
    assert.match(r.stdout, /Test changes have 1 high-risk finding\(s\): \[fp-only, high\] tests\/math\.test\.mjs:4 /)
  })

  it('should pass a change whose only fake-pass findings are warnings, and list them', async () => {
    const repo = makeRepo({ headFiles: { 'src/math.mjs': '// TODO: handle overflow\nexport const add = (a, b) => a + b\n' } })
    const r = await runChecks({ repo })
    assert.equal(r.code, 0, r.stdout)
    assert.match(r.summary, /⚠️ \[fp-placeholder, warning\] src\/math\.mjs:1 /)
  })

  it('should turn a fake-pass failure into a pass with the approval label and still report it', async () => {
    const repo = makeRepo({ headFiles: { [TEST]: focused } })
    const r = await runChecks({ repo, labels: ['governance-approved'] })
    assert.equal(r.code, 0, r.stdout)
    assert.match(r.stdout, /\[fp-only, high\].*Accepted via label "governance-approved"/)
  })

  it('should load the fake-pass rules from the base-branch copy, not the PR checkout', async () => {
    // The PR rewrites its own copy of the rule module to find nothing.
    const repo = makeRepo({ headFiles: { [TEST]: focused, '.github/scripts/fake-pass-rules.mjs': 'export const checkFakePasses = () => []\n' } })
    const r = await runChecks({ repo, config: { governance: { askPaths: [] } } })
    assert.equal(r.code, 1, r.stdout)
    assert.match(r.stdout, /\[fp-only, high\] tests\/math\.test\.mjs:4 /)
  })

  it('should report a test file git cannot read as fp-unreadable, which the label can accept', async () => {
    // A gitlink named like a test file: `git show HEAD:<path>` fails on it.
    const repo = makeRepo()
    git(repo, 'update-index', '--add', '--cacheinfo', `160000,${'1'.repeat(40)},${TEST}`)
    git(repo, 'commit', '-q', '-m', 'gitlink')
    const r = await runChecks({ repo })
    assert.equal(r.code, 1, r.stdout)
    assert.match(r.stdout, /\[fp-unreadable, high\] tests\/math\.test\.mjs:1 changed test file could not be read, so it was not checked \(git: (?:fatal|error)/)
    assert.equal((await runChecks({ repo, labels: ['governance-approved'] })).code, 0)
  })

  it('should check a test file over 1 MiB of multibyte text the same way as locally, not as unreadable', async () => {
    const big = `${focused}// ${'é'.repeat(600_000)}\n`
    const repo = makeRepo({ headFiles: { [TEST]: big } })
    const r = await runChecks({ repo })
    assert.doesNotMatch(r.stdout, /fp-unreadable/)
    assert.match(r.stdout, /\[fp-only, high\] tests\/math\.test\.mjs:4 /)
  })

  it('should keep control characters in a file name out of the report, so it cannot start a workflow command', async () => {
    const { formatFinding } = await import('../templates/github/scripts/governance-rules.mjs')
    const line = formatFinding({ rule: 'fp-only', tier: 'high', file: 'a\n::error file=x::spoof\nb.test.js', line: 1, detail: 'd' })
    assert.doesNotMatch(line, /[\u0000-\u001f\u007f]/)
    assert.doesNotMatch(line, /^::/m)
  })
})

describe('governance-checks: dependency content with stub lookups (R1–R6, R13; AC3, D7)', () => {
  const noAsk = { governance: { askPaths: [] } }
  const env = (labels = []) => ({ PR_BODY: GOOD_BODY, PR_LABELS: JSON.stringify(labels), BASE_REF: 'develop', HEAD_REF: 'feature/x' })
  const manifest = (deps) => JSON.stringify({ name: 'app', dependencies: deps }, null, 2) + '\n'
  const lock = (pkgs) => JSON.stringify({ lockfileVersion: 3, packages: { '': {}, ...Object.fromEntries(Object.entries(pkgs).map(([n, v]) => [`node_modules/${n}`, { version: v }])) } }, null, 2)
  const current = { found: true, version: '1.0.0', deprecated: null, latestTime: new Date().toISOString(), scripts: {} }
  const stubs = (over = {}) => ({ registry: async () => current, advisories: async () => ({}), ...over })
  // runLookups turns a throwing stub into a failure record, so the stubs count their calls for the test to check.
  const untouched = () => {
    const calls = []
    const refuse = (kind) => async () => {
      calls.push(kind)
      throw new Error(`no ${kind} lookup expected`)
    }
    return { registry: refuse('registry'), advisories: refuse('advisories'), calls }
  }
  const check = ({ repo, config = noAsk, labels = [], lookups = stubs() }) =>
    runGovernanceChecks({ env: env(labels), lookups, cwd: repo, govRoot: path.resolve(makeGovTree(config), '..', '..') })

  it('should fail on a typosquat in package.json and pass it with the approval label', async () => {
    const repo = makeRepo({ baseFiles: { 'package.json': manifest({}) }, headFiles: { 'package.json': manifest({ expresss: '^4.0.0' }) } })
    const r = await check({ repo })
    assert.equal(r.exitCode, 1, r.report)
    assert.match(r.report, /Dependency changes have 1 high-risk finding\(s\): \[sc-typosquat, high\] package\.json:4/)
    assert.equal((await check({ repo, labels: ['governance-approved'] })).exitCode, 0)
  })

  it('should fail on a critical advisory and report a moderate one as a warning', async () => {
    const repo = makeRepo({ headFiles: { 'package.json': manifest({ 'left-pad': '1.3.0' }) } })
    const critical = await check({ repo, lookups: stubs({ advisories: async () => ({ 'left-pad': [{ severity: 'critical', title: 'RCE' }] }) }) })
    assert.equal(critical.exitCode, 1)
    assert.match(critical.report, /\[sc-advisory, high\]/)
    const moderate = await check({ repo, lookups: stubs({ advisories: async () => ({ 'left-pad': [{ severity: 'moderate', title: 'ReDoS' }] }) }) })
    assert.equal(moderate.exitCode, 0, moderate.report)
    assert.match(moderate.report, /⚠️ \[sc-advisory, warning\]/)
  })

  it('should fail closed with "lookup unavailable" naming the lookup, even with the approval label (AC3)', async () => {
    const repo = makeRepo({ headFiles: { 'package.json': manifest({ 'left-pad': '1.3.0' }) } })
    const lookups = stubs({ advisories: async () => { throw new Error('HTTP 503') } })
    for (const labels of [[], ['governance-approved']]) {
      const r = await check({ repo, labels, lookups })
      assert.equal(r.exitCode, 1, r.report)
      assert.match(r.report, /❌ Dependency lookup unavailable: advisories \(.*HTTP 503.*\)/)
    }
  })

  it('should fail closed when a lookup misses the deadline', { timeout: 5000 }, async () => {
    const repo = makeRepo({ headFiles: { 'package.json': manifest({ 'left-pad': '1.3.0' }) } })
    const never = () => new Promise(() => {})
    const r = await runGovernanceChecks({ env: env(), lookups: { registry: never, advisories: never }, lookupDeadlineMs: 50, cwd: repo, govRoot: path.resolve(makeGovTree(noAsk), '..', '..') })
    assert.equal(r.exitCode, 1)
    assert.match(r.report, /lookup unavailable: registry .*timed out after 50 ms/)
  })

  it('should look up the exact lockfile version when the manifest and lockfile change together, without a drift warning', async () => {
    const calls = []
    const registry = []
    const repo = makeRepo({ headFiles: { 'package.json': manifest({ express: '^4.18.0' }), 'package-lock.json': lock({ express: '4.21.2' }) } })
    const lookups = stubs({
      advisories: async (entries) => { calls.push(entries); return {} },
      registry: async (name, version) => { registry.push(`${name}@${version}`); return current },
    })
    const r = await check({ repo, lookups })
    assert.equal(r.exitCode, 0, r.report)
    assert.deepEqual(calls, [{ express: ['4.21.2'] }])
    assert.deepEqual(registry, ['express@4.21.2'], 'the added manifest dependency gets a registry lookup at the pinned version')
    assert.doesNotMatch(r.report, /sc-lockfile-drift/)
  })

  it('should warn about a lockfile-only change and a widened range (AC5)', async () => {
    const drift = makeRepo({ baseFiles: { 'package-lock.json': lock({ ms: '2.1.2' }) }, headFiles: { 'package-lock.json': lock({ ms: '2.1.3' }) } })
    assert.match((await check({ repo: drift })).report, /⚠️ \[sc-lockfile-drift, warning\]/)
    const widened = makeRepo({ baseFiles: { 'package.json': manifest({ ms: '^2.1.0' }) }, headFiles: { 'package.json': manifest({ ms: '*' }) } })
    const r = await check({ repo: widened })
    assert.equal(r.exitCode, 0, r.report)
    assert.match(r.report, /⚠️ \[sc-range-widened, warning\]/)
  })

  it('should fail on a dependency file it cannot read, without lookups', async () => {
    const repo = makeRepo({ headFiles: { 'apps/web/package.json': '{ not json' } })
    const lookups = untouched()
    const r = await check({ repo, lookups })
    assert.equal(r.exitCode, 1)
    assert.match(r.report, /\[sc-unparsed, high\] apps\/web\/package\.json:1/)
    assert.deepEqual(lookups.calls, [])
  })

  it('should not look anything up for a PR without dependency changes, or for a deleted manifest', async () => {
    const lookups = untouched()
    assert.equal((await check({ repo: makeRepo({ headFiles: { 'src/a.js': 'x\n' } }), lookups })).exitCode, 0)
    const deleted = makeRepo({ baseFiles: { 'package.json': manifest({ expresss: '1.0.0' }) }, headFiles: { 'package.json': null } })
    assert.equal((await check({ repo: deleted, lookups })).exitCode, 0)
    assert.deepEqual(lookups.calls, [])
  })

  it('should honour an allowlisted package from the base-branch config', async () => {
    const config = { governance: { askPaths: [], allowlist: [{ rule: 'sc-typosquat', package: 'expresss', reason: 'internal fork' }] } }
    const repo = makeRepo({ headFiles: { 'package.json': manifest({ expresss: '^4.0.0' }) } })
    const r = await check({ repo, config })
    assert.equal(r.exitCode, 0, r.report)
    assert.match(r.report, /\[sc-typosquat, high, suppressed: internal fork\]/)
  })

  it('should refuse to run without lookups, so a caller cannot skip them by accident', async () => {
    await assert.rejects(runGovernanceChecks({ env: env() }), /needs the dependency lookups/)
  })
})
