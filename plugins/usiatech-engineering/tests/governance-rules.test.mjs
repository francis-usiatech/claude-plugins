import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import {
  globToRegExp, matchAny, isSecretEnvFile, findSecret, DENY_COMMANDS, ASK_COMMANDS,
  DEFAULT_ASK_PATHS, DEFAULT_PROTECTED_PATHS, parseAllowlist, applyAllowlist, allowlistWarnings, blockingFindings, formatFinding,
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

describe('allowlist: workflow entries need one literal path (R8; AC8)', () => {
  const WF = '.github/workflows/ci.yml'
  const ignored = [
    { rule: 'wf-unpinned-action', path: '.github/workflows/*' },
    { rule: 'wf-unpinned-action', path: '**/*.yml' },
    { rule: 'wf-unparsed', path: WF },
  ]
  const findingFor = (rule) => ({ rule, tier: rule === 'wf-unparsed' ? 'high' : 'warning', file: WF, line: 3, detail: 'x' })

  it('should not suppress a workflow finding through a glob path or a wf-unparsed entry', () => {
    for (const e of ignored) {
      const { entries } = parseAllowlist([e])
      assert.equal(applyAllowlist([findingFor(e.rule)], entries)[0].suppressed, false, JSON.stringify(e))
    }
  })

  it('should treat a path with ?, [ or { as a glob', () => {
    for (const p of ['.github/workflows/c?.yml', '.github/workflows/[c]i.yml', '.github/workflows/{ci,x}.yml']) {
      const list = [{ rule: 'wf-unpinned-action', path: p }]
      assert.equal(applyAllowlist([findingFor('wf-unpinned-action')], parseAllowlist(list).entries)[0].suppressed, false, p)
      assert.equal(allowlistWarnings(list).length, 1, p)
    }
  })

  it('should give one wf-allowlist-ignored warning per ignored entry, naming it by index, rule and path', () => {
    const list = [{ rule: 'wf-write-all' }, ...ignored, { rule: 'wf-unpinned-action', path: WF }]
    const warnings = allowlistWarnings(list)
    assert.equal(warnings.length, 3)
    warnings.forEach((w, i) => {
      const e = ignored[i]
      assert.deepEqual({ ...w, detail: undefined }, { rule: 'wf-allowlist-ignored', tier: 'warning', file: '.claude/engineering.json', line: 1, suppressed: false, detail: undefined })
      assert.ok(w.detail.includes(`governance.allowlist[${i + 1}]`), w.detail)
      assert.ok(w.detail.includes(e.rule) && w.detail.includes(e.path), w.detail)
    })
  })

  it('should keep the config valid: the ignored entries are not config problems', () => {
    assert.deepEqual(parseAllowlist(ignored).problems, [])
  })

  it('should still suppress a literal-path workflow entry, also when matched case-insensitively, with no warning', () => {
    const list = [{ rule: 'wf-unpinned-action', path: '.GitHub/Workflows/CI.yml' }]
    assert.equal(applyAllowlist([findingFor('wf-unpinned-action')], parseAllowlist(list).entries, true)[0].suppressed, true)
    assert.deepEqual(allowlistWarnings(list), [])
  })

  it('should give no warning for sc-* or fp-* globs, a non-workflow package-only entry or a missing allowlist', () => {
    assert.deepEqual(allowlistWarnings([{ rule: 'fp-no-assert', path: 'tests/*.test.mjs' }, { rule: 'sc-resolved', path: '**/package-lock.json' }, { rule: 'npm-install-script', package: 'x' }]), [])
    assert.deepEqual(allowlistWarnings(undefined), [])
  })

  it('should warn on a package-only workflow entry, since workflow findings have no package to match', () => {
    const list = [{ rule: 'wf-unpinned-action', package: 'actions/checkout' }]
    assert.equal(applyAllowlist([findingFor('wf-unpinned-action')], parseAllowlist(list).entries)[0].suppressed, false)
    const [w, ...rest] = allowlistWarnings(list)
    assert.deepEqual(rest, [])
    assert.equal(w?.rule, 'wf-allowlist-ignored')
    assert.match(w.detail, /governance\.allowlist\[0\].*wf-unpinned-action.*package "actions\/checkout".*must name one file in "path"/)
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

  it('should mark a finding suppressed when rule and path both match', () => {
    const { entries } = parseAllowlist([{ rule: 'wf-unpinned-action', path: '.github/workflows/ci.yml' }])
    assert.equal(applyAllowlist([finding], entries)[0].suppressed, true)
  })

  it('should still let a path glob suppress a finding of a non-workflow rule', () => {
    const { entries } = parseAllowlist([{ rule: 'fp-no-assert', path: 'tests/*.test.mjs' }])
    assert.equal(applyAllowlist([{ ...finding, rule: 'fp-no-assert', file: 'tests/a.test.mjs' }], entries)[0].suppressed, true)
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

  it('should keep the entry reason on a suppressed finding and show it when formatted', () => {
    const fp = { rule: 'fp-no-assert', tier: 'high', file: 'tests/a.test.mjs', line: 3, detail: 'no assertion' }
    const { entries } = parseAllowlist([{ rule: 'fp-no-assert', path: 'tests/a.test.mjs', reason: 'asserts through checkRow()' }])
    const [f] = applyAllowlist([fp], entries)
    assert.equal(f.suppressed, true)
    assert.equal(f.reason, 'asserts through checkRow()')
    assert.deepEqual(blockingFindings([f]), [])
    assert.equal(formatFinding(f), '[fp-no-assert, high, suppressed: asserts through checkRow()] tests/a.test.mjs:3 no assertion')
  })

  it('should leave an unmatched finding without a reason', () => {
    const { entries } = parseAllowlist([{ rule: 'fp-skip', path: 'tests/a.test.mjs', reason: 'r' }])
    const [f] = applyAllowlist([finding], entries)
    assert.equal(f.suppressed, false)
    assert.equal(Object.hasOwn(f, 'reason'), false)
  })

  it('should re-export the workflow rules so guard and CI share one module', () => {
    assert.equal(typeof checkWorkflow, 'function')
    assert.ok(isWorkflowPath('.github/workflows/ci.yml'))
  })
})

describe('formatFinding output safety (fix set 1, E)', () => {
  it('should keep a finding on one line and cap long detail and reason text', () => {
    const f = { rule: 'fp-placeholder', tier: 'warning', file: 'a.js', line: 1, detail: 'a\r\n::error::x\u0007' + 'y'.repeat(500), suppressed: true, reason: 'r\n::warning::z' }
    const out = formatFinding(f)
    assert.equal(/[\r\n\u0000-\u001f]/.test(out), false, out)
    assert.ok(out.length < 600, String(out.length))
    assert.match(out, /suppressed: r ::warning::z\]/)
  })
})
