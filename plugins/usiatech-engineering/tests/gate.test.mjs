import { describe, it, after } from 'node:test'
import assert from 'node:assert/strict'
import path from 'node:path'
import { existsSync, readFileSync, readdirSync, rmSync, symlinkSync } from 'node:fs'
import { makeRepo, runNode, writeFiles, tempDir, cleanupTempDirs, git, PLUGIN_ROOT } from './helpers.mjs'

// The runner makes a temp folder of its own for each run's log, outside the test's temp dirs.
const logs = []
after(() => {
  for (const log of logs.splice(0)) rmSync(path.dirname(log), { recursive: true, force: true })
  cleanupTempDirs()
})

const SCRIPT = path.join(PLUGIN_ROOT, 'skills', 'verify', 'gate.mjs')

const ok = (name) => ({ name, run: 'node -e "process.exit(0)"' })
const fail = (name) => ({ name, run: 'node -e "process.exit(3)"' })

// A repo with the config committed and the given files left uncommitted, as `verify` sees it before a commit.
// A string config is written as is, for the unparseable case; undefined commits no config.
const repoWith = (config, { committed = {}, uncommitted = {} } = {}) => {
  const headFiles = { ...committed }
  if (config !== undefined) headFiles['.claude/engineering.json'] = typeof config === 'string' ? config : JSON.stringify(config)
  const repo = makeRepo({ headFiles })
  writeFiles(repo, uncommitted)
  return repo
}

const logPath = (r) => r.stdout.match(/^Log: (.+)$/m)?.[1].trim()
const runGate = async (repo, env) => {
  const r = await runNode(SCRIPT, { cwd: repo, env })
  if (logPath(r)) logs.push(logPath(r))
  return r
}
const lines = (r) => r.stdout.split(/\r?\n/).filter(Boolean)

const FOCUSED = "import { it } from 'node:test'\nimport assert from 'node:assert/strict'\n\nit.only('should add', () => {\n  assert.equal(1 + 1, 2)\n})\n"

describe('gate runner: steps and verdict (ESP-44)', () => {
  it('should print one line per step in order, then the fake-pass line, a UTC timestamp and PASS (AC1)', async () => {
    const r = await runGate(repoWith({ verify: [ok('typecheck'), ok('tests')] }))
    assert.equal(r.code, 0, r.stdout + r.stderr)
    const out = lines(r)
    const at = (re) => out.findIndex((l) => re.test(l))
    assert.match(r.stdout, /^PASS {2}typecheck \(exit 0, \d+ s\)$/m)
    assert.match(r.stdout, /^PASS {2}tests \(exit 0, \d+ s\)$/m)
    assert.match(r.stdout, /^PASS {2}fake-pass check \(exit 0, \d+ s\)$/m)
    assert.ok(at(/^PASS {2}typecheck /) < at(/^PASS {2}tests /), r.stdout)
    assert.ok(at(/^PASS {2}tests /) < at(/^PASS {2}fake-pass check /), r.stdout)
    assert.match(r.stdout, /^Gate run: \d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/m)
    assert.equal(out.at(-1), 'Gate: PASS')
  })

  it('should stop at the first failure, show its exit code and output, and skip the rest (AC2)', async () => {
    const noisy = { name: 'b', run: 'node -e "for(let i=1;i<=60;i++)console.log(\'out \'+i);process.exit(3)"' }
    const r = await runGate(repoWith({ verify: [ok('a'), noisy, ok('c')] }))
    assert.equal(r.code, 1, r.stdout + r.stderr)
    assert.match(r.stdout, /^PASS {2}a \(exit 0, \d+ s\)$/m)
    assert.match(r.stdout, /^FAIL {2}b \(exit 3, \d+ s\)$/m)
    assert.match(r.stdout, /^NOT RUN {2}c$/m)
    assert.match(r.stdout, /^NOT RUN {2}fake-pass check$/m)
    assert.match(r.stdout, /^out 60$/m, 'the end of the failing output is shown')
    assert.match(r.stdout, /^out 21$/m, 'the last 40 lines are shown')
    assert.doesNotMatch(r.stdout, /^out 20$/m, 'only the last 40 lines are shown')
    assert.equal(lines(r).at(-1), 'Gate: FAIL')
  })

  it('should run the same way when the plugin is reached through a link', async () => {
    const link = path.join(tempDir('usiatech-link-'), 'plugin')
    symlinkSync(PLUGIN_ROOT, link, 'junction')
    const repo = repoWith({ verify: [ok('tests')] }, { uncommitted: { 'src/math.mjs': '// TODO: handle overflow\nexport const add = (a, b) => a + b\n' } })
    const r = await runNode(path.join(link, 'skills', 'verify', 'gate.mjs'), { cwd: repo })
    if (logPath(r)) logs.push(logPath(r))
    assert.equal(r.code, 0, r.stdout + r.stderr)
    assert.match(r.stdout, /^PASS {2}tests /m)
    assert.match(r.stdout, /^PASS {2}fake-pass check /m)
    assert.match(r.stdout, /\[fp-placeholder, warning\] src\/math\.mjs:1 /, 'the fake-pass check really ran')
    assert.equal(lines(r).at(-1), 'Gate: PASS')
  })

  it('should fail a step whose command is unknown, with its non-zero exit code (AC2)', async () => {
    const r = await runGate(repoWith({ verify: [{ name: 'missing', run: 'usiatech-no-such-command-xyz' }] }))
    assert.equal(r.code, 1, r.stdout + r.stderr)
    assert.match(r.stdout, /^FAIL {2}missing \(exit [1-9]\d*, \d+ s\)$/m)
    assert.equal(lines(r).at(-1), 'Gate: FAIL')
  })
})

describe('gate runner: conditional steps (ESP-44 AC3)', () => {
  const config = { verify: [ok('always')], verifyConditional: [{ ...ok('cond'), when: ['src/'] }] }

  it('should run a conditional step when a tracked changed file matches a prefix', async () => {
    const r = await runGate(repoWith(config, { committed: { 'src/a.ts': 'x' }, uncommitted: { 'src/a.ts': 'y' } }))
    assert.equal(r.code, 0, r.stdout + r.stderr)
    assert.match(r.stdout, /^PASS {2}cond \(exit 0, \d+ s\)$/m)
  })

  it('should run a conditional step when an untracked file matches a prefix', async () => {
    const r = await runGate(repoWith(config, { uncommitted: { 'src/new.ts': 'x' } }))
    assert.equal(r.code, 0, r.stdout + r.stderr)
    assert.match(r.stdout, /^PASS {2}cond \(exit 0, \d+ s\)$/m)
  })

  it('should show a conditional step as skipped, with its prefixes, when no changed file matches', async () => {
    const r = await runGate(repoWith(config, { uncommitted: { 'docs/x.md': 'x' } }))
    assert.equal(r.code, 0, r.stdout + r.stderr)
    assert.match(r.stdout, /^PASS {2}always /m)
    assert.match(r.stdout, /^SKIPPED {2}cond \(no changed file under src\/\)$/m)
    assert.doesNotMatch(r.stdout, /^(PASS|FAIL|NOT RUN) {2}cond/m)
  })

  it('should run a conditional step when a file was moved out of its prefix', async () => {
    const repo = repoWith(config, { committed: { 'src/a.ts': 'x' }, uncommitted: { 'lib/keep.txt': 'k' } })
    git(repo, 'mv', 'src/a.ts', 'lib/a.ts')
    const r = await runGate(repo)
    assert.equal(r.code, 0, r.stdout + r.stderr)
    assert.match(r.stdout, /^PASS {2}cond \(exit 0, \d+ s\)$/m)
  })

  it('should run a step whatever other keys its config entry holds, "skipped" included', async () => {
    const skipped = 'x)\nPASS  cond (exit 0, 1 s'
    const always = await runGate(repoWith({ verify: [{ ...fail('tests'), skipped }] }))
    assert.equal(always.code, 1, always.stdout + always.stderr)
    assert.match(always.stdout, /^FAIL {2}tests \(exit 3, \d+ s\)$/m)
    const matching = await runGate(repoWith({ verify: [ok('always')], verifyConditional: [{ ...fail('cond'), when: ['src/'], skipped }] }, { uncommitted: { 'src/new.ts': 'x' } }))
    assert.equal(matching.code, 1, matching.stdout + matching.stderr)
    assert.match(matching.stdout, /^FAIL {2}cond \(exit 3, \d+ s\)$/m)
    assert.doesNotMatch(matching.stdout, /^(PASS|SKIPPED) {2}cond/m)
  })

  it('should match prefixes exactly, case included', async () => {
    const r = await runGate(repoWith(config, { uncommitted: { 'Src/new.ts': 'x' } }))
    assert.equal(r.code, 0, r.stdout + r.stderr)
    assert.match(r.stdout, /^SKIPPED {2}cond /m)
  })
})

describe('gate runner: a gate that cannot start (ESP-44 AC4)', () => {
  const cases = [
    ['no config file', undefined, /engineering\.json/],
    ['an unparseable config', '{ not json', /could not be parsed/],
    ['a config that is not an object', '[]', /not a JSON object/],
    ['no verify list', {}, /"verify"/],
    ['a verify that is not a list', { verify: 'npm test' }, /"verify"/],
    ['an empty verify list', { verify: [] }, /"verify"/],
    ['a step without a run command', { verify: [{ name: 'tests' }] }, /"name" and "run"/],
    ['a step with a blank name', { verify: [{ name: ' ', run: 'node -v' }] }, /"name" and "run"/],
    ['a conditional step without a when list', { verify: [ok('a')], verifyConditional: [ok('cond')] }, /"when"/],
    ['a conditional step with an empty when list', { verify: [ok('a')], verifyConditional: [{ ...ok('cond'), when: [] }] }, /"when"/],
    ['a when prefix with a backslash', { verify: [ok('a')], verifyConditional: [{ ...ok('cond'), when: ['src\\'] }] }, /"when"/],
    ['a when prefix that starts with ./', { verify: [ok('a')], verifyConditional: [{ ...ok('cond'), when: ['./src/'] }] }, /"when"/],
    ['a when prefix that starts with /', { verify: [ok('a')], verifyConditional: [{ ...ok('cond'), when: ['/src/'] }] }, /"when"/],
    ['a step name with a line break', { verify: [{ ...ok('a'), name: 'a\nGate: PASS' }] }, /control characters/],
    ['a step name with a Unicode line break', { verify: [{ ...ok('a'), name: `a${String.fromCodePoint(8232)}b` }] }, /control characters/],
    ['a step named like the fake-pass check', { verify: [ok('fake-pass check')] }, /"fake-pass check"/],
  ]
  for (const [what, config, reason] of cases) {
    it(`should run nothing and exit 2 with ${what}`, async () => {
      const r = await runGate(repoWith(config))
      assert.equal(r.code, 2, r.stdout + r.stderr)
      assert.match(r.stdout, reason)
      assert.doesNotMatch(r.stdout, /^(PASS|FAIL|NOT RUN|SKIPPED) /m)
      assert.equal(lines(r).at(-1), 'Gate: FAIL')
    })
  }

  it('should exit 2 in a repository with no commit, where git cannot list the changed files', async () => {
    const dir = tempDir('usiatech-empty-')
    git(dir, 'init', '-q')
    writeFiles(dir, { '.claude/engineering.json': JSON.stringify({ verify: [ok('a')] }) })
    const r = await runGate(dir)
    assert.equal(r.code, 2, r.stdout + r.stderr)
    assert.match(r.stdout, /changed files/)
    assert.doesNotMatch(r.stdout, /^(PASS|FAIL|NOT RUN|SKIPPED) /m)
    assert.equal(lines(r).at(-1), 'Gate: FAIL')
  })

  it('should exit 2 when the log file cannot be created', async () => {
    const missing = path.join(tempDir('usiatech-notmp-'), 'gone')
    const r = await runGate(repoWith({ verify: [ok('a')] }), { TMP: missing, TEMP: missing, TMPDIR: missing })
    assert.equal(r.code, 2, r.stdout + r.stderr)
    assert.match(r.stdout, /log file could not be created/)
    assert.doesNotMatch(r.stdout, /^(PASS|FAIL|NOT RUN|SKIPPED) /m)
    assert.equal(lines(r).at(-1), 'Gate: FAIL')
  })

  it('should exit 2 in a folder that is not a git repository', async () => {
    const dir = tempDir('usiatech-nogit-')
    writeFiles(dir, { '.claude/engineering.json': JSON.stringify({ verify: [ok('a')] }) })
    const r = await runGate(dir, { GIT_CEILING_DIRECTORIES: path.dirname(dir) })
    assert.equal(r.code, 2, r.stdout + r.stderr)
    assert.match(r.stdout, /git/)
    assert.doesNotMatch(r.stdout, /^(PASS|FAIL|NOT RUN|SKIPPED) /m)
    assert.equal(lines(r).at(-1), 'Gate: FAIL')
  })
})

describe('gate runner: fake-pass check (ESP-44 AC5)', () => {
  it('should print every finding, however many there are', async () => {
    const notes = Array.from({ length: 45 }, (_, i) => `// TODO: case ${i + 1}`).join('\n')
    const r = await runGate(repoWith({ verify: [ok('tests')] }, { uncommitted: { 'src/notes.mjs': `${notes}\nexport const n = 45\n` } }))
    assert.equal(r.code, 0, r.stdout + r.stderr)
    assert.equal(r.stdout.match(/^\[fp-placeholder, warning\] src\/notes\.mjs:\d+ /gm)?.length, 45, r.stdout)
    assert.match(r.stdout, /^\[fp-placeholder, warning\] src\/notes\.mjs:1 /m)
  })

  it('should fail the gate on a focused test in a changed file and print the finding', async () => {
    const r = await runGate(repoWith({ verify: [ok('tests')] }, { uncommitted: { 'tests/math.test.mjs': FOCUSED } }))
    assert.equal(r.code, 1, r.stdout + r.stderr)
    assert.match(r.stdout, /^PASS {2}tests /m)
    assert.match(r.stdout, /^FAIL {2}fake-pass check \(exit 1, \d+ s\)$/m)
    assert.match(r.stdout, /\[fp-only, high\] tests\/math\.test\.mjs:4 /)
    assert.equal(lines(r).at(-1), 'Gate: FAIL')
  })

  it('should print warnings and still pass', async () => {
    const r = await runGate(repoWith({ verify: [ok('tests')] }, { uncommitted: { 'src/math.mjs': '// TODO: handle overflow\nexport const add = (a, b) => a + b\n' } }))
    assert.equal(r.code, 0, r.stdout + r.stderr)
    assert.match(r.stdout, /\[fp-placeholder, warning\] src\/math\.mjs:1 /)
    assert.equal(lines(r).at(-1), 'Gate: PASS')
  })

  it('should fail the gate with exit 1 when the check cannot run and exits 2', async () => {
    const config = { verify: [ok('tests')], governance: { allowlist: [{ rule: 'fp-only', path: '**' }] } }
    const r = await runGate(repoWith(config))
    assert.equal(r.code, 1, r.stdout + r.stderr)
    assert.match(r.stdout, /^FAIL {2}fake-pass check \(exit 2, \d+ s\)$/m)
    assert.match(r.stdout, /fake-pass check could not run/)
    assert.equal(lines(r).at(-1), 'Gate: FAIL')
  })
})

describe('gate runner: log file (ESP-44 AC6)', () => {
  it('should keep a long passing output out of its own output and in a log outside the repo', async () => {
    const chatty = { name: 'chatty', run: 'node -e "for(let i=1;i<=500;i++)console.log(\'line \'+i)"' }
    const repo = repoWith({ verify: [chatty] })
    const r = await runGate(repo)
    assert.equal(r.code, 0, r.stdout + r.stderr)
    assert.ok(lines(r).length <= 12, `${lines(r).length} lines:\n${r.stdout}`)
    const log = logPath(r)
    assert.ok(log && existsSync(log), `no log at ${log}`)
    assert.equal(readFileSync(log, 'utf8').match(/^line \d+$/gm).length, 500)
    assert.ok(path.relative(repo, log).startsWith('..') || path.isAbsolute(path.relative(repo, log)), `${log} is inside ${repo}`)
  })

  it('should write the log alone in a folder made for this run', async () => {
    const r = await runGate(repoWith({ verify: [ok('a')] }))
    assert.equal(r.code, 0, r.stdout + r.stderr)
    const dir = path.dirname(logPath(r))
    assert.match(path.basename(dir), /^usiatech-gate-.{6}$/)
    assert.deepEqual(readdirSync(dir), ['gate.log'])
  })

  it('should show a failing step\'s own lines that look like the log markers', async () => {
    const r = await runGate(repoWith({ verify: [{ name: 'runner', run: 'node -e "console.log(\'=== 3 failed ===\');process.exit(1)"' }] }))
    assert.equal(r.code, 1, r.stdout + r.stderr)
    assert.match(r.stdout, /^=== 3 failed ===$/m)
    assert.doesNotMatch(r.stdout, /^=== runner: /m)
  })

  it('should put what a step writes to stderr in the log too', async () => {
    const r = await runGate(repoWith({ verify: [{ name: 'warns', run: 'node -e "console.error(\'to stderr\')"' }] }))
    assert.equal(r.code, 0, r.stdout + r.stderr)
    assert.match(readFileSync(logPath(r), 'utf8'), /^to stderr$/m)
  })
})
