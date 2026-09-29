import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import {
  globToRegExp, matchAny, isSecretEnvFile, findSecret, DENY_COMMANDS, ASK_COMMANDS,
  DEFAULT_ASK_PATHS, DEFAULT_PROTECTED_PATHS, parseAllowlist, applyAllowlist, blockingFindings, formatFinding,
  checkWorkflow, isWorkflowPath,
} from '../templates/github/scripts/governance-rules.mjs'

describe('globToRegExp', () => {
  it('should match nested paths with a leading **/', () => {
    assert.ok(globToRegExp('**/generated/**').test('generated/client.ts'))
    assert.ok(globToRegExp('**/generated/**').test('packages/db/generated/client.ts'))
  })

  it('should keep a single * within one path segment', () => {
    assert.ok(globToRegExp('*.md').test('README.md'))
    assert.ok(!globToRegExp('*.md').test('docs/README.md'))
  })

  it('should treat ? as exactly one non-slash character', () => {
    assert.ok(globToRegExp('v?.txt').test('v1.txt'))
    assert.ok(!globToRegExp('v?.txt').test('v10.txt'))
  })

  it('should escape regex metacharacters in literal parts', () => {
    assert.ok(globToRegExp('a+b(c).json').test('a+b(c).json'))
    assert.ok(!globToRegExp('a.json').test('abjson'))
  })

  it('should anchor the whole path', () => {
    assert.ok(!globToRegExp('src/**').test('lib/src/a.ts'))
  })
})

describe('matchAny', () => {
  it('should return the first matching glob', () => {
    assert.equal(matchAny('.github/workflows/ci.yml', DEFAULT_ASK_PATHS), '.github/**')
  })

  it('should return undefined when nothing matches or the list is empty', () => {
    assert.equal(matchAny('src/app.ts', DEFAULT_ASK_PATHS), undefined)
    assert.equal(matchAny('src/app.ts', []), undefined)
  })
})

describe('isSecretEnvFile', () => {
  it('should flag .env and its variants', () => {
    for (const f of ['.env', '.env.local', '.env.production']) assert.ok(isSecretEnvFile(f), f)
  })

  it('should allow .env.example by default and block it when the repo opts out', () => {
    assert.ok(!isSecretEnvFile('.env.example'))
    assert.ok(isSecretEnvFile('.env.example', false))
  })

  it('should not flag similarly named files', () => {
    for (const f of ['env.ts', '.envrc', 'my.env', '.environment']) assert.ok(!isSecretEnvFile(f), f)
  })
})

describe('rule tables', () => {
  it('should contain only valid, case-insensitive regexes with a reason', () => {
    for (const [reason, re] of [...DENY_COMMANDS, ...ASK_COMMANDS]) {
      assert.ok(reason.length > 0)
      assert.doesNotThrow(() => new RegExp(re, 'i'), reason)
    }
  })

  it('should include REVIEW.md and all of .github in the default ask paths', () => {
    assert.ok(DEFAULT_ASK_PATHS.includes('REVIEW.md'))
    assert.ok(DEFAULT_ASK_PATHS.includes('.github/**'))
    assert.deepEqual(DEFAULT_PROTECTED_PATHS, ['generated/**', '**/generated/**'])
  })
})

describe('findSecret', () => {
  // Built at runtime so this file never holds a secret-shaped literal (the guard would block writing it).
  const deny = {
    'private key': '-----BEGIN ' + 'RSA PRIVATE KEY-----\nMIIE' + 'q7Zb'.repeat(20),
    'AWS access key': 'key = ' + 'AKIA' + 'Q'.repeat(16),
    'GitHub token': 'ghp_' + 'a'.repeat(36),
    'Anthropic API key': 'sk-ant-api03-' + 'b'.repeat(40),
    'OpenAI API key': 'sk-proj-' + 'c'.repeat(40),
    'Stripe live key': 'sk_' + 'live_' + 'd'.repeat(24),
    'Google API key': 'AIza' + 'e'.repeat(35),
    'Slack token': 'xoxb-' + '1'.repeat(12) + '-' + 'A1b2'.repeat(4),
  }
  for (const [why, text] of Object.entries(deny)) {
    it(`should deny a ${why}`, () => {
      assert.deepEqual(findSecret(text), { decision: 'deny', why })
    })
  }

  it('should ask on a hard-coded credential assignment', () => {
    assert.deepEqual(findSecret('const apiKey = "' + 'f'.repeat(16) + '"'), { decision: 'ask', why: 'hard-coded credential' })
    assert.equal(findSecret("password: '" + 'g'.repeat(14) + "'").decision, 'ask')
  })

  it('should ignore placeholders and documented examples', () => {
    for (const t of [
      'AKIA' + 'IOSFODNN7EXAMPLE',
      'sk-ant-' + 'x'.repeat(30),
      'password = "' + 'your-password-here' + '"',
      'api_key: "' + 'placeholder-value-1' + '"',
      'xoxb-' + 'token-goes-here',
      'xoxb-' + '123456789012-...',
    ]) assert.equal(findSecret(t), null, t)
  })

  it('should ignore a PEM header without key material', () => {
    assert.equal(findSecret("if (pem.includes('-----BEGIN " + "PRIVATE KEY-----')) parse(pem)"), null)
    assert.equal(findSecret('A key starts with `-----BEGIN ' + 'OPENSSH PRIVATE KEY-----`.'), null)
  })

  it('should ignore env lookups, short values and ordinary code', () => {
    assert.equal(findSecret('const password = process.env.DB_PASSWORD'), null)
    assert.equal(findSecret('password = "hunter2"'), null)
    assert.equal(findSecret('export const add = (a, b) => a + b'), null)
    assert.equal(findSecret(''), null)
  })

  it('should still deny a key followed directly by more characters', () => {
    assert.equal(findSecret('AKIA' + 'Q'.repeat(16) + 'z').decision, 'deny')
    assert.equal(findSecret('AIza' + 'e'.repeat(35) + 'Z9').decision, 'deny')
  })

  it('should find a secret after an earlier placeholder match', () => {
    assert.equal(findSecret('AKIA' + 'IOSFODNN7EXAMPLE and ' + 'AKIA' + 'R'.repeat(16)).decision, 'deny')
  })
})

describe('allowlist (R15)', () => {
  const finding = { rule: 'wf-unpinned-action', tier: 'warning', file: '.github/workflows/ci.yml', line: 7, detail: 'x' }

  it('should keep valid entries and report invalid ones by index', () => {
    const { entries, problems } = parseAllowlist([
      { rule: 'wf-unpinned-action', path: '.github/workflows/ci.yml', reason: 'vendor action' },
      { rule: 'wf-write-all' },
      { path: '.github/workflows/*.yml' },
      'wf-write-all',
    ])
    assert.equal(entries.length, 1)
    assert.deepEqual(problems.map((p) => p.match(/\[(\d)\]/)[1]), ['1', '2', '3'])
  })

  it('should reject a path made only of wildcards, which would switch the rule off everywhere', () => {
    for (const p of ['**', '*', '**/*', '*/**', '/**']) {
      const { entries, problems } = parseAllowlist([{ rule: 'wf-untrusted-input', path: p }])
      assert.equal(entries.length, 0, p)
      assert.match(problems[0], /"governance\.allowlist\[0\]".*only wildcards/, p)
    }
    assert.equal(parseAllowlist([{ rule: 'wf-untrusted-input', path: '.github/workflows/*.yml' }]).entries.length, 1)
  })

  it('should report a non-array allowlist and treat a missing one as empty', () => {
    assert.match(parseAllowlist({ rule: 'x' }).problems[0], /"governance\.allowlist" must be an array/)
    assert.deepEqual(parseAllowlist(undefined), { entries: [], problems: [] })
  })

  it('should mark a finding suppressed when rule and path glob both match', () => {
    const { entries } = parseAllowlist([{ rule: 'wf-unpinned-action', path: '.github/workflows/*.yml' }])
    assert.equal(applyAllowlist([finding], entries)[0].suppressed, true)
  })

  it('should change nothing when the rule or the path does not match', () => {
    for (const e of [{ rule: 'wf-write-all', path: '.github/workflows/ci.yml' }, { rule: 'wf-unpinned-action', path: '.github/workflows/other.yml' }]) {
      const { entries } = parseAllowlist([e])
      assert.equal(applyAllowlist([finding], entries)[0].suppressed, false, JSON.stringify(e))
    }
  })

  it('should match a package entry against the finding package', () => {
    const { entries } = parseAllowlist([{ rule: 'npm-install-script', package: 'esbuild' }])
    assert.equal(applyAllowlist([{ ...finding, rule: 'npm-install-script', package: 'esbuild' }], entries)[0].suppressed, true)
    assert.equal(applyAllowlist([{ ...finding, rule: 'npm-install-script', package: 'other' }], entries)[0].suppressed, false)
  })

  it('should only count unsuppressed high findings as blocking', () => {
    const high = { ...finding, rule: 'wf-untrusted-input', tier: 'high' }
    assert.deepEqual(blockingFindings([finding, { ...high, suppressed: true }]), [])
    assert.deepEqual(blockingFindings([finding, high]), [high])
  })

  it('should format a finding with rule, tier, location and suppression', () => {
    assert.equal(formatFinding(finding), '[wf-unpinned-action, warning] .github/workflows/ci.yml:7 x')
    assert.equal(formatFinding({ ...finding, suppressed: true }), '[wf-unpinned-action, warning, suppressed] .github/workflows/ci.yml:7 x')
  })

  it('should re-export the workflow rules so guard and CI share one module', () => {
    assert.equal(typeof checkWorkflow, 'function')
    assert.ok(isWorkflowPath('.github/workflows/ci.yml'))
  })
})
