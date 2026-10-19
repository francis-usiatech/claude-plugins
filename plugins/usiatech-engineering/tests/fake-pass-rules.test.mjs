import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { checkFakePasses, isTestFile, isJsTsFile, TIER } from '../templates/github/scripts/fake-pass-rules.mjs'

// Fixtures are .txt so `node --test` never runs their focused or skipped tests; each is checked under a test-file path.
const FIXTURES = path.join(path.dirname(fileURLToPath(import.meta.url)), 'fixtures', 'fake-pass')
const fixture = (name) => readFileSync(path.join(FIXTURES, `${name}.txt`), 'utf8')
const check = (content, file = 'tests/math.test.mjs', status = 'modified') => checkFakePasses({ file, content, status })
const rules = (findings) => findings.map((f) => `${f.rule}:${f.tier}`).sort()
// Wraps one test call in a file that is otherwise clean.
const inFile = (body) => `import { it, describe, test } from 'node:test'\nimport assert from 'node:assert/strict'\n\n${body}\n`
// Placeholder markers built from pieces, so this file's own test data doesn't trip fp-placeholder (#26).
const todoMarker = 'TO' + 'DO'
const fixmeMarker = 'FIX' + 'ME'
const xxxMarker = 'X' + 'XX'
const notImplementedMarker = 'not ' + 'implemented'

describe('isTestFile / isJsTsFile', () => {
  it('should treat *.test.*, *.spec.*, __tests__/, test/ and tests/ JS/TS files as test files', () => {
    for (const f of ['a.test.mjs', 'src/a.spec.ts', 'src/__tests__/x.js', 'test/x.cjs', 'tests/unit/x.tsx', 'pkg/a.test.mts', 'a.spec.cts', 'a.test.jsx']) {
      assert.equal(isTestFile(f), true, f)
    }
  })

  it('should not treat source, non-JS/TS or look-alike paths as test files', () => {
    for (const f of ['src/x.js', 'src/testing.ts', 'tests/x.py', 'docs/a.test.md', 'contest/x.js', 'a.test.txt']) {
      assert.equal(isTestFile(f), false, f)
    }
    assert.equal(isJsTsFile('src/x.js'), true)
    assert.equal(isJsTsFile('README.md'), false)
  })
})

describe('checkFakePasses: file scope (AC1)', () => {
  it('should give no findings for a clean test file', () => {
    assert.deepEqual(check(fixture('clean')), [])
  })

  it('should run every rule on a changed test file under each naming pattern', () => {
    for (const file of ['tests/a.test.mjs', 'src/a.spec.ts', 'src/__tests__/x.js']) {
      assert.deepEqual(rules(check(fixture('focused'), file)), ['fp-only:high'], file)
    }
  })

  it('should run only the placeholder rule on a changed source file', () => {
    assert.deepEqual(rules(check(fixture('focused'), 'src/x.js')), [])
    assert.deepEqual(rules(check(fixture('placeholder'), 'src/x.js')), ['fp-placeholder:warning'])
  })

  it('should skip deleted files and non-JS/TS files', () => {
    assert.deepEqual(check(fixture('focused'), 'tests/a.test.mjs', 'deleted'), [])
    assert.deepEqual(check(fixture('focused'), 'tests/a.py'), [])
    assert.deepEqual(check(`${todoMarker}: write docs`, 'docs/readme.md'), [])
  })

  it('should report file, 1-based line and a detail on each finding', () => {
    const [f] = check(fixture('focused'))
    assert.equal(f.file, 'tests/math.test.mjs')
    assert.equal(f.line, 5)
    assert.equal(f.tier, TIER.HIGH)
    assert.match(f.detail, /only/)
  })
})

describe('checkFakePasses: focused and skipped tests (AC2)', () => {
  const body = "('x', () => { assert.ok(true) })"
  const cases = [
    ['fp-only', `it.only${body}`], ['fp-only', `describe.only('s', () => { it${body} })`], ['fp-only', `test.only${body}`],
    ['fp-only', `fit${body}`], ['fp-only', `fdescribe('s', () => { it${body} })`],
    ['fp-skip', `it.skip${body}`], ['fp-skip', `describe.skip('s', () => { it${body} })`], ['fp-skip', `xit${body}`],
    ['fp-skip', `xdescribe('s', () => { it${body} })`], ['fp-skip', `xtest${body}`], ['fp-skip', `it.todo('later')`],
    ['fp-skip', `test.todo('later')`], ['fp-skip', `test.fixme${body}`],
    ['fp-skip', "it('x', { skip: true }, () => { assert.ok(true) })"],
    ['fp-skip', "it('x', { skip: 'flaky on CI' }, () => { assert.ok(true) })"],
    ['fp-skip', "test('x', { todo: true }, () => { assert.ok(true) })"],
    // F8: modifier chains
    ['fp-only', `it.only.each([[1]])${body}`], ['fp-only', `test.concurrent.only${body}`],
    ['fp-only', `describe.only.each([[1]])('s', () => { it${body} })`],
    ['fp-skip', `it.skip.each([[1]])${body}`], ['fp-skip', `test.concurrent.skip${body}`],
    ['fp-skip', `it.todo.each([[1]])('later')`], ['fp-skip', `test.concurrent.fixme${body}`],
    ['fp-only', `test.only.failing${body}`], ['fp-skip', `test.skip.failing${body}`],
    ['fp-only', 'it.only.each`a\n${1}`' + body],
  ]
  for (const [rule, code] of cases) {
    it(`should give one ${rule} high finding for ${code.slice(0, 40)}`, () => {
      assert.deepEqual(rules(check(inFile(code))), [`${rule}:high`])
    })
  }

  it('should use the skipped fixture end to end', () => {
    assert.deepEqual(rules(check(fixture('skipped'))), ['fp-skip:high'])
  })

  it('should not flag skip or only inside strings, comments or unrelated identifiers', () => {
    const code = [
      "it('should skip nothing and run .only once', () => {",
      '  // it.skip and it.only in a comment',
      '  /* xit( fdescribe( */',
      "  const msg = `it.only(${1})`",
      '  const skipped = onlyOnce(skipList)',
      '  assert.ok(msg && skipped)',
      '})',
    ].join('\n')
    assert.deepEqual(check(inFile(code)), [])
  })

  it('should not flag run-modifier chains without only or skip (F8)', () => {
    const code = "it.each([[1]])('x', (n) => { assert.ok(n) })\ntest.concurrent('y', () => { assert.ok(1) })\nobj.only(1)\n"
    assert.deepEqual(check(inFile(code)), [])
  })
})

describe('checkFakePasses: empty tests (AC3)', () => {
  it('should flag an empty body and a comment-only body', () => {
    assert.deepEqual(rules(check(inFile("it('x', () => {})"))), ['fp-empty-test:high'])
    assert.deepEqual(rules(check(fixture('empty'))), ['fp-empty-test:high'])
  })

  it('should flag an empty async or function-expression body', () => {
    assert.deepEqual(rules(check(inFile("test('x', async () => {\n})"))), ['fp-empty-test:high'])
    assert.deepEqual(rules(check(inFile("it('x', function () { /* later */ })"))), ['fp-empty-test:high'])
  })

  it('should not flag a body with a statement', () => {
    assert.deepEqual(check(inFile("it('x', () => { assert.equal(1, 1) })")), [])
  })
})

describe('checkFakePasses: tests without an assertion (AC4)', () => {
  it('should flag a body with no recognised assertion', () => {
    assert.deepEqual(rules(check(fixture('no-assert'))), ['fp-no-assert:high'])
  })

  for (const stmt of ['assert.equal(a, 1)', 'assert(a)', 'expect(a).toBe(1)', 'await expect(page).toHaveTitle(/x/)', 't.assert.ok(a)', 'a.should.equal(1)', 't.plan(1)']) {
    it(`should accept ${stmt}`, () => {
      assert.deepEqual(check(inFile(`it('x', async (t) => {\n  const a = 1\n  ${stmt}\n})`)), [])
    })
  }

  it('should not count an assertion word inside a string', () => {
    assert.deepEqual(rules(check(inFile("it('x', () => {\n  console.log('assert(a) expect(b)')\n})"))), ['fp-no-assert:high'])
  })

  it('should judge each test in a file separately', () => {
    const code = "it('a', () => { assert.ok(1) })\nit('b', () => { run() })"
    const findings = check(inFile(code))
    assert.deepEqual(rules(findings), ['fp-no-assert:high'])
    assert.equal(findings[0].line, 5)
  })

  it('should not treat describe blocks or hooks as tests', () => {
    assert.deepEqual(check(inFile("describe('s', () => {\n  beforeEach(() => { setup() })\n  it('x', () => { assert.ok(1) })\n})")), [])
  })
})

describe('checkFakePasses: placeholders (AC5)', () => {
  for (const line of [`// ${todoMarker}: later`, `// ${fixmeMarker} broken`, `/* ${xxxMarker} hack */`, `throw new Error('${notImplementedMarker}')`]) {
    it(`should warn once for ${line}`, () => {
      assert.deepEqual(rules(check(`export const f = () => {\n  ${line}\n  return 1\n}\n`, 'src/f.mjs')), ['fp-placeholder:warning'])
    })
  }

  it('should not warn for words that only contain a marker', () => {
    assert.deepEqual(check("export const todos = []\nexport const xxxl = 'size'\n", 'src/f.mjs'), [])
  })
})

describe('checkFakePasses: unreadable files (AC6)', () => {
  it('should give one fp-unreadable high finding when a test file has no content', () => {
    assert.deepEqual(rules(checkFakePasses({ file: 'tests/a.test.mjs', content: null, status: 'modified' })), ['fp-unreadable:high'])
  })

  it('should not flag an unreadable non-test file as unreadable test', () => {
    assert.deepEqual(rules(checkFakePasses({ file: 'src/a.mjs', content: null, status: 'modified' })), [])
  })
})

describe('checkFakePasses: review fix set 1', () => {
  // A: test-call variants the first version missed (silent-failure review SF1, SF4).
  for (const [code, want] of [
    ["test.concurrent('y', () => {})", 'fp-empty-test:high'],
    ["test.serial('z', async () => {})", 'fp-empty-test:high'],
    ["it.each([1])('x', () => {})", 'fp-empty-test:high'],
    ["it.each([[1, 2]])('x %i', (a) => { run(a) })", 'fp-no-assert:high'],
    ["it<Foo>('a', () => {})", 'fp-empty-test:high'],
    ['it(name, { skip: true }, () => { assert.ok(1) })', 'fp-skip:high'],
  ]) {
    it(`should flag ${code}`, () => {
      assert.deepEqual(rules(check(inFile(code))), [want])
    })
  }

  // B: parens inside function parameters (SF3).
  it('should find a function callback whose parameters contain parentheses', () => {
    assert.deepEqual(rules(check(inFile("it('b', function (x = f()) { run() })"))), ['fp-no-assert:high'])
    assert.deepEqual(rules(check(inFile("it('b', function (x = f()) {})"))), ['fp-empty-test:high'])
  })

  // C: regex literals must not blank the rest of the file (SF2).
  it('should keep checking after a regex literal that contains a backtick or a comment opener', () => {
    assert.deepEqual(rules(check(inFile("it('a', () => { assert.ok(/`/.test(x)) })\nit.only('b', () => { assert.ok(1) })"))), ['fp-only:high'])
    assert.deepEqual(rules(check(inFile("const re = /src\/*.js/\nit.only('b', () => { assert.ok(1) })\nit('c', () => {})"))), ['fp-empty-test:high', 'fp-only:high'])
  })

  it('should still read division as division', () => {
    assert.deepEqual(rules(check(inFile("const half = a / 2 / b\nit.only('b', () => { assert.ok(half) })"))), ['fp-only:high'])
  })

  it('should fail closed when a comment or template never closes', () => {
    assert.deepEqual(rules(check(inFile("it('a', () => { assert.ok(1) })\n/* never closed\nit.only('b', () => {})"))), ['fp-unreadable:high'])
    assert.deepEqual(rules(check(inFile("const s = `open\nit.only('b', () => {})"))), ['fp-unreadable:high'])
  })

  // D: bounded work on large or crafted files (security review).
  it('should fail closed on a test file over 1 MB', () => {
    const [f] = check('x'.repeat(1_000_001))
    assert.equal(f.rule, 'fp-unreadable')
    assert.equal(f.line, 1)
  })

  it('should report an unreadable file on line 1', () => {
    assert.equal(checkFakePasses({ file: 'tests/a.test.mjs', content: null }).at(0).line, 1)
  })

  for (const [label, content] of [
    ['20k unclosed test calls', 'it(\n'.repeat(20000)],
    ['20k valid one-line tests', "it('x', () => { assert.ok(1) })\n".repeat(20000)],
    ['20k unclosed option objects', "it('', {\n".repeat(20000)],
    // A long modifier chain with no call after it must not backtrack (round-2 ReDoS).
    ['a 320 KB .it.only chain', '.it.only'.repeat(40000)],
    ['a 320 KB .it.skip chain', '.it.skip'.repeat(40000)],
    ['one it with 20k .only segments', 'it' + '.only'.repeat(20000) + ' x'],
  ]) {
    it(`should check ${label} in under 2 s`, () => {
      const start = performance.now()
      check(content)
      assert.ok(performance.now() - start < 2000, `${label} took ${Math.round(performance.now() - start)} ms`)
    })
  }
})
