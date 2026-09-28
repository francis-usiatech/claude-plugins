import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import {
  globToRegExp, matchAny, isSecretEnvFile, DENY_COMMANDS, ASK_COMMANDS,
  DEFAULT_ASK_PATHS, DEFAULT_PROTECTED_PATHS,
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
