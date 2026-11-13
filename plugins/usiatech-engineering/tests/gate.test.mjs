import { describe, it, after } from 'node:test'
import assert from 'node:assert/strict'
import path from 'node:path'
import { spawn } from 'node:child_process'
import { cpSync, existsSync, lstatSync, mkdirSync, readFileSync, readdirSync, rmSync, symlinkSync, utimesSync, writeFileSync } from 'node:fs'
import { setTimeout as sleep } from 'node:timers/promises'
import { pathToFileURL } from 'node:url'
import { makeRepo, makeGovTree, runNode, writeFiles, tempDir, cleanupTempDirs, git, PLUGIN_ROOT } from './helpers.mjs'

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
const runGate = async (repo, env, args) => {
  const r = await runNode(SCRIPT, { cwd: repo, env, args })
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
    assert.match(r.stdout, /^PASS {2}fake-pass check \(exit 0, scanned \d+ files?, \d+ s\)$/m)
    // ESP-158: the fake-pass check runs first, then the steps in config order.
    assert.ok(at(/^PASS {2}fake-pass check /) < at(/^PASS {2}typecheck /), r.stdout)
    assert.ok(at(/^PASS {2}typecheck /) < at(/^PASS {2}tests /), r.stdout)
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
    assert.match(r.stdout, /^PASS {2}fake-pass check /m, 'the fake-pass check ran first (ESP-158)')
    assert.match(r.stdout, /^out 60$/m, 'the end of the failing output is shown')
    assert.match(r.stdout, /^out 21$/m, 'the last 40 lines are shown')
    assert.doesNotMatch(r.stdout, /^out 20$/m, 'only the last 40 lines are shown')
    assert.equal(lines(r).at(-1), 'Gate: FAIL')
  })

  it('should read at most the last 64 KB of a failing step\'s output (ESP-78 F16)', async () => {
    const huge = { name: 'huge', run: 'node -e "console.log(\'A\'+\'x\'.repeat(99998)+\'Z\');process.exit(3)"' }
    const r = await runGate(repoWith({ verify: [huge] }))
    assert.equal(r.code, 1, r.stderr)
    const tail = lines(r).find((l) => l.endsWith('xZ'))
    assert.ok(tail, 'the end of the output is shown')
    assert.ok(tail.length <= 65536, `the tail line is ${tail.length} characters`)
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
    // Against HEAD: src/a.ts was committed on this branch, so against the merge-base it never existed.
    const r = await runGate(repo, undefined, ['--base', 'HEAD'])
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

describe('gate runner: commands and keys it accepts (ESP-53 AC10)', () => {
  const accepted = [
    ['&& between two commands', 'node -v && node -e "process.exit(0)"'],
    ['; inside double quotes', 'node -e "const a=1;process.exit(0)"'],
    ['; inside single quotes', "node -e 'process.exit(0)' --title='a;b'"],
    ['a 2>&1 redirection', 'node -e "process.exit(0)" 2>&1'],
  ]
  for (const [what, run] of accepted) {
    it(`should run a step with ${what}`, async () => {
      const r = await runGate(repoWith({ verify: [{ name: 'step', run }] }))
      assert.equal(r.code, 0, r.stdout + r.stderr)
      assert.match(r.stdout, /^PASS {2}step /m)
    })
  }

  it('should leave other unknown top-level keys alone', async () => {
    const r = await runGate(repoWith({ verify: [ok('a')], tickets: { tracker: 'github' }, somethingElse: true }))
    assert.equal(r.code, 0, r.stdout + r.stderr)
  })

  it('should stop an --iterate run on a misspelt verifyIterate key', async () => {
    const r = await runGate(repoWith({ verify: [ok('a')], verifyIterte: [] }), undefined, ['--iterate'])
    assert.equal(r.code, 2, r.stdout + r.stderr)
    assert.match(r.stdout, /"verifyIterte".*"verifyIterate"/)
  })
})

describe('gate runner: expectNoDiff (ESP-54 AC11)', () => {
  const writeGen = { name: 'generate', run: 'node -e "require(\'fs\').writeFileSync(\'gen.txt\', \'new\')"' }
  const committed = { 'gen.txt': 'old', 'other.txt': 'same' }

  it('should fail a step that changes a listed path, naming the file, and run nothing after it', async () => {
    const r = await runGate(repoWith({ verify: [{ ...writeGen, expectNoDiff: ['gen.txt', 'other.txt'] }, ok('after')] }, { committed }))
    assert.equal(r.code, 1, r.stdout + r.stderr)
    assert.match(r.stdout, /^FAIL {2}generate \(exit 0, but it changed gen\.txt, listed in expectNoDiff, \d+ s\)$/m)
    assert.match(r.stdout, /^NOT RUN {2}after$/m)
    assert.equal(lines(r).at(-1), 'Gate: FAIL')
  })

  it('should pass the same step without expectNoDiff', async () => {
    const r = await runGate(repoWith({ verify: [writeGen] }, { committed }))
    assert.equal(r.code, 0, r.stdout + r.stderr)
  })

  it('should not blame the step for a listed file that was already changed before the gate ran', async () => {
    const step = { ...ok('generate'), expectNoDiff: ['gen.txt'] }
    const r = await runGate(repoWith({ verify: [step] }, { committed, uncommitted: { 'gen.txt': 'edited by hand' } }))
    assert.equal(r.code, 0, r.stdout + r.stderr)
  })

  it('should still fail a step that changes a listed file that was already changed', async () => {
    const r = await runGate(repoWith({ verify: [{ ...writeGen, expectNoDiff: ['gen.txt'] }] }, { committed, uncommitted: { 'gen.txt': 'edited by hand' } }))
    assert.equal(r.code, 1, r.stdout + r.stderr)
    assert.match(r.stdout, /changed gen\.txt, listed in expectNoDiff/)
  })

  it('should treat an empty list as no check, as CI does', async () => {
    const r = await runGate(repoWith({ verify: [{ ...writeGen, expectNoDiff: [] }] }, { committed }))
    assert.equal(r.code, 0, r.stdout + r.stderr)
  })

  it('should pass when the changed file is not in the list', async () => {
    const r = await runGate(repoWith({ verify: [{ ...writeGen, expectNoDiff: ['other.txt'] }] }, { committed }))
    assert.equal(r.code, 0, r.stdout + r.stderr)
  })

  it('should check a folder prefix as CI does', async () => {
    const files = { 'dist/gen.txt': 'old' }
    const step = { name: 'build', run: 'node -e "require(\'fs\').writeFileSync(\'dist/gen.txt\', \'new\')"', expectNoDiff: ['dist/'] }
    const r = await runGate(repoWith({ verify: [step] }, { committed: files }))
    assert.equal(r.code, 1, r.stdout + r.stderr)
    assert.match(r.stdout, /changed dist\/gen\.txt, listed in expectNoDiff/)
  })
})

describe('gate runner: docs-only diff', () => {
  it('should run no step and end with Gate: SKIPPED when the branch changes only docs', async () => {
    // The config sits on the base branch: a changed .claude/engineering.json would make the diff code.
    const repo = makeRepo({ baseFiles: { 'README.md': 'base\n', '.claude/engineering.json': JSON.stringify({ verify: [fail('tests')] }) }, headFiles: { 'docs/a.md': '# A\n' } })
    writeFiles(repo, { 'README.md': '# R\n' })
    const r = await runGate(repo)
    assert.equal(r.code, 0, r.stdout + r.stderr)
    assert.match(r.stdout, /^SKIPPED {2}all steps \(docs-only diff: 2 Markdown files\)$/m)
    assert.doesNotMatch(r.stdout, /fake-pass check|^Log: /m)
    assert.equal(lines(r).at(-1), 'Gate: SKIPPED (docs-only diff)')
  })

  it('should run the gate when the base branch is missing and only an uncommitted file is Markdown', async () => {
    const config = JSON.stringify({ verify: [fail('tests')], git: { baseBranch: 'no-such-branch' } })
    const repo = makeRepo({ baseFiles: { 'README.md': 'base\n', '.claude/engineering.json': config }, headFiles: { 'src/a.mjs': 'export const a = 1\n' } })
    writeFiles(repo, { 'README.md': '# R\n' })
    const r = await runGate(repo)
    assert.equal(r.code, 1, r.stdout + r.stderr)
    assert.doesNotMatch(r.stdout, /docs-only/)
  })

  it('should run the gate with --base HEAD, which hides committed code', async () => {
    const repo = makeRepo({ baseFiles: { 'README.md': 'base\n', '.claude/engineering.json': JSON.stringify({ verify: [fail('tests')] }) }, headFiles: { 'src/a.mjs': 'export const a = 1\n' } })
    writeFiles(repo, { 'README.md': '# R\n' })
    const r = await runGate(repo, undefined, ['--base', 'HEAD'])
    assert.equal(r.code, 1, r.stdout + r.stderr)
  })

  // A branch with committed code and one uncommitted README edit: any base whose merge-base is HEAD would list only
  // the README, so each of these must still run the gate.
  const codeBranch = () => {
    const repo = makeRepo({ baseFiles: { 'README.md': 'base\n', '.claude/engineering.json': JSON.stringify({ verify: [fail('tests')] }) }, headFiles: { 'src/a.mjs': 'export const a = 1\n' } })
    writeFiles(repo, { 'README.md': '# R\n' })
    return repo
  }
  for (const [label, args] of [['the current branch', ['--base', 'feature/x']], ['@', ['--base', '@']], ['the HEAD commit', null]]) {
    it(`should run the gate with --base ${label}`, async () => {
      const repo = codeBranch()
      const r = await runGate(repo, undefined, args ?? ['--base', git(repo, 'rev-parse', 'HEAD').trim()])
      assert.equal(r.code, 1, r.stdout + r.stderr)
    })
  }

  it('should run the gate on the base branch itself, whose own commits the list would miss', async () => {
    const repo = codeBranch()
    git(repo, 'checkout', '-q', '-b', 'develop-local')
    const cfg = JSON.stringify({ verify: [fail('tests')], git: { baseBranch: 'develop-local' } })
    writeFiles(repo, { '.claude/engineering.json': cfg })
    git(repo, 'commit', '-q', '-am', 'cfg')
    writeFiles(repo, { 'README.md': '# R2\n' })
    const r = await runGate(repo)
    assert.equal(r.code, 1, r.stdout + r.stderr)
  })

  it('should run the gate when the local base was moved onto the branch\'s commits', async () => {
    const repo = codeBranch()
    git(repo, 'branch', '-f', 'develop', 'HEAD')
    const r = await runGate(repo)
    assert.equal(r.code, 1, r.stdout + r.stderr)
  })

  it('should run the gate on a detached HEAD', async () => {
    const repo = codeBranch()
    git(repo, 'checkout', '-q', '--detach')
    const r = await runGate(repo)
    assert.equal(r.code, 1, r.stdout + r.stderr)
  })

  it('should run the gate when the only changed doc is one CLAUDE.md imports with @path', async () => {
    const baseFiles = { 'README.md': 'base\n', 'CLAUDE.md': 'Follow @docs/style.md\n', 'docs/style.md': 'old\n', '.claude/engineering.json': JSON.stringify({ verify: [fail('tests')] }) }
    const repo = makeRepo({ baseFiles })
    writeFiles(repo, { 'docs/style.md': 'new\n' })
    const r = await runGate(repo)
    assert.equal(r.code, 1, r.stdout + r.stderr)
  })

  it('should run the gate when the branch deletes a doc that CLAUDE.md imports', async () => {
    const baseFiles = { 'README.md': 'base\n', 'CLAUDE.md': 'Follow @docs/style.md\n', 'docs/style.md': 'old\n', '.claude/engineering.json': JSON.stringify({ verify: [fail('tests')] }) }
    const repo = makeRepo({ baseFiles })
    git(repo, 'rm', '-q', 'docs/style.md')
    const r = await runGate(repo)
    assert.equal(r.code, 1, r.stdout + r.stderr)
  })

  it('should still skip on a new branch whose only change is uncommitted docs', async () => {
    const repo = makeRepo({ baseFiles: { 'README.md': 'base\n', '.claude/engineering.json': JSON.stringify({ verify: [fail('tests')] }) } })
    writeFiles(repo, { 'docs/a.md': '# A\n' })
    const r = await runGate(repo)
    assert.equal(r.code, 0, r.stdout + r.stderr)
    assert.equal(lines(r).at(-1), 'Gate: SKIPPED (docs-only diff)')
  })

  it('should run the gate when the branch changes the config next to docs', async () => {
    const r = await runGate(repoWith({ verify: [fail('tests')] }, { committed: { 'docs/a.md': '# A\n' } }))
    assert.equal(r.code, 1, r.stdout + r.stderr)
  })

  it('should run the gate when the branch also changes code', async () => {
    const r = await runGate(repoWith({ verify: [fail('tests')] }, { committed: { 'docs/a.md': '# A\n', 'src/a.mjs': 'export const a = 1\n' } }))
    assert.equal(r.code, 1, r.stdout + r.stderr)
    assert.equal(lines(r).at(-1), 'Gate: FAIL')
  })

  it('should run the gate when only a skill file changes', async () => {
    const r = await runGate(repoWith({ verify: [fail('tests')] }, { uncommitted: { 'skills/x/SKILL.md': '# X\n' } }))
    assert.equal(r.code, 1, r.stdout + r.stderr)
  })

  it('should run the gate when nothing changed', async () => {
    const r = await runGate(repoWith({ verify: [fail('tests')] }))
    assert.equal(r.code, 1, r.stdout + r.stderr)
  })
})

describe('gate runner: diff base and scan count (ESP-55 AC12)', () => {
  const cond = { ...ok('cond'), when: ['src/'] }
  const committedBranch = (config) => repoWith({ verify: [ok('a')], verifyConditional: [cond], ...config }, { committed: { 'src/a.mjs': 'export const a = 1\n' } })

  it('should run a conditional step for a file committed on the branch, comparing with the merge-base', async () => {
    const r = await runGate(committedBranch())
    assert.equal(r.code, 0, r.stdout + r.stderr)
    assert.match(r.stdout, /^Base: merge-base with develop \([0-9a-f]{7,}\)$/m)
    assert.match(r.stdout, /^PASS {2}cond /m)
  })

  it('should fail on a focused test committed on the branch', async () => {
    const repo = repoWith({ verify: [ok('tests')] }, { committed: { 'tests/math.test.mjs': FOCUSED } })
    const r = await runGate(repo)
    assert.equal(r.code, 1, r.stdout + r.stderr)
    assert.match(r.stdout, /\[fp-only, high\] tests\/math\.test\.mjs:4 /)
  })

  it('should compare with HEAD when given --base HEAD', async () => {
    const r = await runGate(committedBranch(), undefined, ['--base', 'HEAD'])
    assert.equal(r.code, 0, r.stdout + r.stderr)
    assert.match(r.stdout, /^Base: merge-base with HEAD /m)
    assert.match(r.stdout, /^SKIPPED {2}cond /m)
  })

  it('should use git.baseBranch from the config', async () => {
    const repo = committedBranch({ git: { baseBranch: 'feature/x' } })
    const r = await runGate(repo)
    assert.equal(r.code, 0, r.stdout + r.stderr)
    assert.match(r.stdout, /^Base: merge-base with feature\/x /m)
    assert.match(r.stdout, /^SKIPPED {2}cond /m)
  })

  it('should say so and compare with HEAD when the base cannot be found', async () => {
    const r = await runGate(committedBranch({ git: { baseBranch: 'no-such-branch' } }))
    assert.equal(r.code, 0, r.stdout + r.stderr)
    assert.match(r.stdout, /^Base: could not find "no-such-branch" or "origin\/no-such-branch" .*so changed files are compared with HEAD\.$/m)
    assert.match(r.stdout, /^SKIPPED {2}cond /m)
  })

  it('should exit 2 when an explicit --base cannot be found', async () => {
    const r = await runGate(committedBranch(), undefined, ['--base', 'no-such-branch'])
    assert.equal(r.code, 2, r.stdout + r.stderr)
    assert.match(r.stdout, /"no-such-branch"/)
    assert.doesNotMatch(r.stdout, /^(PASS|FAIL|NOT RUN|SKIPPED) /m)
  })

  it('should use origin/<base> when the local branch is behind it', async () => {
    // The branch was cut from origin/develop, and the local develop is one commit older: only the newer merge-base is right.
    const repo = repoWith({ verify: [ok('a')], verifyConditional: [cond] })
    git(repo, 'checkout', '-q', 'develop')
    writeFiles(repo, { 'src/other.mjs': 'export const b = 2\n' })
    git(repo, 'add', '-A')
    git(repo, 'commit', '-q', '-m', 'other work')
    git(repo, 'push', '-q', 'origin', 'develop')
    git(repo, 'reset', '-q', '--hard', 'HEAD~1')
    git(repo, 'checkout', '-q', 'feature/x')
    git(repo, 'rebase', '-q', 'origin/develop')
    const r = await runGate(repo)
    assert.equal(r.code, 0, r.stdout + r.stderr)
    assert.match(r.stdout, /^Base: merge-base with origin\/develop /m)
    assert.match(r.stdout, /^SKIPPED {2}cond /m)
  })

  it('should use origin/<base> when there is no local branch of that name', async () => {
    const repo = committedBranch()
    git(repo, 'branch', '-D', 'develop')
    const r = await runGate(repo)
    assert.equal(r.code, 0, r.stdout + r.stderr)
    assert.match(r.stdout, /^Base: merge-base with origin\/develop /m)
    assert.match(r.stdout, /^PASS {2}cond /m)
  })

  const badArgs = [
    ['--base with no ref', ['--base']],
    ['a --base ref that reads as an option', ['--base', '-x']],
    ['--base with --iterate', ['--iterate', '--base', 'HEAD']],
  ]
  for (const [what, args] of badArgs) {
    it(`should run nothing and exit 2 with ${what}`, async () => {
      const r = await runGate(repoWith({ verify: [fail('tests')] }), {}, args)
      assert.equal(r.code, 2, r.stdout + r.stderr)
      assert.doesNotMatch(r.stdout, /^(PASS|FAIL|NOT RUN|SKIPPED) /m)
    })
  }

  // Code review 2026-11-09: verify asks this before it moves any Jira ticket into testing.
  it('should run nothing and exit 0 with --check when the gate can start', async () => {
    const r = await runGate(committedBranch(), undefined, ['--check'])
    assert.equal(r.code, 0, r.stdout + r.stderr)
    assert.match(r.stdout, /^Base: merge-base with develop /m)
    assert.equal(lines(r).at(-1), 'Gate check: the gate can start. Nothing ran.')
    assert.doesNotMatch(r.stdout, /^(PASS|FAIL|NOT RUN|SKIPPED|Log:) /m)
  })

  it('should exit 2 with --check when the gate cannot start', async () => {
    const r = await runGate(repoWith({ verify: [{ name: 'chained', run: 'node -v; node -v' }] }), undefined, ['--check'])
    assert.equal(r.code, 2, r.stdout + r.stderr)
    assert.equal(lines(r).at(-1), 'Gate: FAIL')
  })

  it('should exit 2 with --check --base for a base that cannot be found', async () => {
    const r = await runGate(committedBranch(), undefined, ['--check', '--base', 'no-such-branch'])
    assert.equal(r.code, 2, r.stdout + r.stderr)
  })

  it('should run nothing and exit 2 when git.baseBranch is not a string', async () => {
    const r = await runGate(repoWith({ verify: [fail('tests')], git: { baseBranch: 7 } }))
    assert.equal(r.code, 2, r.stdout + r.stderr)
    assert.match(r.stdout, /"git\.baseBranch"/)
  })

  it('should fail the gate when the fake-pass check prints no scan count', async () => {
    // A copy of the runner whose fake-pass check exits 0 without a word: it can't be told from one that checked nothing.
    const copy = path.join(tempDir('usiatech-plugin-copy-'), 'plugin')
    for (const dir of ['skills', 'templates']) cpSync(path.join(PLUGIN_ROOT, dir), path.join(copy, dir), { recursive: true })
    writeFileSync(path.join(copy, 'templates', 'github', 'scripts', 'fake-pass-check.mjs'), 'process.exitCode = 0\n')
    const r = await runNode(path.join(copy, 'skills', 'verify', 'gate.mjs'), { cwd: repoWith({ verify: [ok('tests')] }) })
    if (logPath(r)) logs.push(logPath(r))
    assert.equal(r.code, 1, r.stdout + r.stderr)
    assert.match(r.stdout, /^FAIL {2}fake-pass check \(exit 0, but it printed no scan count, so it may have checked nothing, \d+ s\)$/m)
    assert.equal(lines(r).at(-1), 'Gate: FAIL')
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
    ['a run command with a line break', { verify: [{ name: 'two lines', run: 'node -e "process.exit(0)"\nnode -e "process.exit(1)"' }] }, /"run"/],
    ['a when prefix with a line break', { verify: [ok('a')], verifyConditional: [{ ...ok('cond'), when: ['src/\nGate: PASS'] }] }, /"when"/],
    ['a when prefix with a leading space', { verify: [ok('a')], verifyConditional: [{ ...ok('cond'), when: [' src/'] }] }, /"when"/],
    ['a when prefix that leaves the repo', { verify: [ok('a')], verifyConditional: [{ ...ok('cond'), when: ['../src/'] }] }, /"when"/],
    ['a step named like the fake-pass check', { verify: [ok('fake-pass check')] }, /"fake-pass check"/],
    // ESP-52 AC3. Node runs a timer above 2147483647 ms after 1 ms, so a larger value would stop the step at once.
    ['a timeoutMs of 0', { verify: [{ ...ok('a'), timeoutMs: 0 }] }, /"timeoutMs" of step "a"/],
    ['a negative timeoutMs', { verify: [{ ...ok('a'), timeoutMs: -1 }] }, /"timeoutMs" of step "a"/],
    ['a timeoutMs that is not a whole number', { verify: [{ ...ok('a'), timeoutMs: 1.5 }] }, /"timeoutMs" of step "a"/],
    ['a timeoutMs that is a string', { verify: [{ ...ok('a'), timeoutMs: '60' }] }, /"timeoutMs" of step "a"/],
    ['a timeoutMs that is null', { verify: [{ ...ok('a'), timeoutMs: null }] }, /"timeoutMs" of step "a"/],
    ['a timeoutMs above 2147483647', { verify: [{ ...ok('a'), timeoutMs: 2147483648 }] }, /"timeoutMs" of step "a"/],
    ['a conditional step with a timeoutMs of 0', { verify: [ok('a')], verifyConditional: [{ ...ok('cond'), when: ['src/'], timeoutMs: 0 }] }, /"timeoutMs" of step "cond"/],
    // ESP-53 (spec R10, AC10): a misspelt step-list key would run nothing, and a chained run hides an earlier failure.
    ['a misspelt verifyConditional key', { verify: [ok('a')], verifyConditionl: [{ ...fail('cond'), when: ['src/'] }] }, /"verifyConditionl".*"verifyConditional"/],
    ['a step-list key in the wrong case', { verify: [ok('a')], VerifyIterate: [] }, /"VerifyIterate".*"verifyIterate"/],
    ['a misspelt verify key next to a valid one', { verify: [ok('a')], verfy: [fail('b')] }, /"verfy".*"verify"/],
    ['a run that chains commands with ;', { verify: [{ name: 'chained', run: 'node -e "process.exit(1)"; node -e "process.exit(0)"' }] }, /"run" of step "chained".*one command per step/],
    ['a run that chains commands with a single &', { verify: [{ name: 'chained', run: 'node -e "process.exit(1)" & node -e "process.exit(0)"' }] }, /"run" of step "chained".*one command per step/],
    ['a run with & inside single quotes, which cmd.exe still treats as a separator', { verify: [{ name: 'quoted', run: "node -e 'x' & node -v" }] }, /"run" of step "quoted"/],
    // ESP-54 (spec R11): the same shape as the CI gate, a list of paths.
    ['an expectNoDiff that is not a list', { verify: [{ ...ok('gen'), expectNoDiff: true }] }, /"expectNoDiff" of step "gen"/],
    ['an expectNoDiff path that leaves the repo', { verify: [{ ...ok('gen'), expectNoDiff: ['../x'] }] }, /"expectNoDiff" of step "gen"/],
    ['a conditional step that chains commands', { verify: [ok('a')], verifyConditional: [{ name: 'cond', run: 'node -v; node -v', when: ['src/'] }] }, /"run" of step "cond"/],
    // Code review 2026-11-09: || and a pipe also report a status other than the first command's.
    ['a run that chains commands with ||', { verify: [{ name: 'chained', run: 'node -e "process.exit(1)" || node -v' }] }, /"run" of step "chained" chains commands with "\|\|"/],
    ['a run that pipes into another command', { verify: [{ name: 'piped', run: 'node -e "process.exit(1)" | node -v' }] }, /"run" of step "piped" chains commands with "\|"/],
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

describe('gate runner: arguments (ESP-69 AC2)', () => {
  it('should run nothing and exit 2 on an unknown argument', async () => {
    const r = await runGate(repoWith({ verify: [fail('tests')] }), {}, ['--bad-flag'])
    assert.equal(r.code, 2, r.stdout + r.stderr)
    assert.match(r.stdout, /"--bad-flag"/)
    assert.doesNotMatch(r.stdout, /^(PASS|FAIL|NOT RUN|SKIPPED) /m)
    assert.equal(lines(r).at(-1), 'Gate: FAIL')
  })

  it('should run nothing and exit 2 when --iterate comes with another argument', async () => {
    const r = await runGate(repoWith({ verify: [fail('tests')] }), {}, ['--iterate', '--bad-flag'])
    assert.equal(r.code, 2, r.stdout + r.stderr)
    assert.doesNotMatch(r.stdout, /^(PASS|FAIL|NOT RUN|SKIPPED) /m)
  })

  it('should still run the full gate with no argument', async () => {
    const r = await runGate(repoWith({ verify: [ok('tests')] }))
    assert.equal(r.code, 0, r.stdout + r.stderr)
    assert.equal(lines(r).at(-1), 'Gate: PASS')
  })
})

describe('gate runner: --iterate (ESP-69 AC1)', () => {
  const PARTIAL_PASS = 'Partial run: PASS. This is not the done gate.'
  const PARTIAL_FAIL = 'Partial run: FAIL. This is not the done gate.'
  const NOTHING_RAN = 'Partial run: nothing ran. This is not the done gate.'
  const iterate = (repo, env) => runGate(repo, env, ['--iterate'])
  const mapped = { ...ok('src tests'), when: ['src/'] }

  it('should run only the mapped step, and no verify or verifyConditional step', async () => {
    const config = { verify: [fail('full')], verifyConditional: [{ ...fail('cond'), when: ['src/'] }], verifyIterate: [mapped, { ...fail('other'), when: ['lib/'] }] }
    const r = await iterate(repoWith(config, { uncommitted: { 'src/a.ts': 'x' } }))
    assert.equal(r.code, 0, r.stdout + r.stderr)
    assert.match(r.stdout, /^PASS {2}src tests \(exit 0, \d+ s\)$/m)
    assert.match(r.stdout, /^SKIPPED {2}other \(no changed file under lib\/\)$/m)
    assert.doesNotMatch(r.stdout, /^(PASS|FAIL|NOT RUN|SKIPPED) {2}(full|cond)\b/m)
    assert.doesNotMatch(r.stdout, /^Gate: /m)
    assert.equal(lines(r).at(-1), PARTIAL_PASS)
  })

  it('should list a changed file with no mapping as not covered', async () => {
    const r = await iterate(repoWith({ verify: [ok('full')], verifyIterate: [mapped] }, { uncommitted: { 'src/a.ts': 'x', 'docs/b.md': 'y' } }))
    assert.equal(r.code, 0, r.stdout + r.stderr)
    assert.match(r.stdout, /^NOT COVERED {2}docs\/b\.md$/m)
    assert.doesNotMatch(r.stdout, /^NOT COVERED {2}src\/a\.ts$/m)
    assert.equal(lines(r).at(-1), PARTIAL_PASS)
  })

  const nothingToRun = [
    ['no step matches a changed file', { verify: [fail('full')], verifyIterate: [{ ...fail('other'), when: ['lib/'] }] }, /no verifyIterate step matches/i],
    ['the config has no verifyIterate key', { verify: [fail('full')] }, /no verifyIterate step matches/i],
    ['the verify list is missing', { verifyIterate: [{ ...fail('other'), when: ['lib/'] }] }, /no verifyIterate step matches/i],
  ]
  for (const [what, config, says] of nothingToRun) {
    it(`should exit 0 and say so when ${what}`, async () => {
      const r = await iterate(repoWith(config, { uncommitted: { 'docs/b.md': 'y' } }))
      assert.equal(r.code, 0, r.stdout + r.stderr)
      assert.match(r.stdout, says)
      assert.match(r.stdout, /^NOT COVERED {2}docs\/b\.md$/m)
      assert.doesNotMatch(r.stdout, /^Log: /m)
      assert.equal(lines(r).at(-1), NOTHING_RAN)
    })
  }

  it('should exit 0 and say so when no file changed', async () => {
    const r = await iterate(repoWith({ verifyIterate: [{ ...fail('src'), when: ['src/'] }] }))
    assert.equal(r.code, 0, r.stdout + r.stderr)
    assert.match(r.stdout, /no changed files/i)
    assert.equal(lines(r).at(-1), NOTHING_RAN)
  })

  it('should escape a Unicode line separator in a changed file name', async () => {
    const r = await iterate(repoWith({ verifyIterate: [mapped] }, { uncommitted: { 'a forged.md': 'x', 'src/a.ts': 'y' } }))
    assert.equal(r.code, 0, r.stdout + r.stderr)
    assert.ok(!r.stdout.includes(' '), 'the separator reaches the output')
    assert.match(r.stdout, /^NOT COVERED {2}a\\u\{2028\}forged\.md$/m)
  })

  it('should exit 1, mark later steps not run and end on a partial failure', async () => {
    const config = { verifyIterate: [{ ...fail('first'), when: ['src/'] }, { ...ok('second'), when: ['src/'] }] }
    const r = await iterate(repoWith(config, { uncommitted: { 'src/a.ts': 'x' } }))
    assert.equal(r.code, 1, r.stdout + r.stderr)
    assert.match(r.stdout, /^FAIL {2}first \(exit 3, \d+ s\)$/m)
    assert.match(r.stdout, /^NOT RUN {2}second$/m)
    assert.doesNotMatch(r.stdout, /^Gate: /m)
    assert.equal(lines(r).at(-1), PARTIAL_FAIL)
  })

  it('should keep a failing step\'s own text as output, with the partial verdict still last', async () => {
    const liar = { name: 'liar', run: 'node -e "console.log(\'Gate: PASS\');process.exit(3)"', when: ['src/'] }
    const r = await iterate(repoWith({ verifyIterate: [liar] }, { uncommitted: { 'src/a.ts': 'x' } }))
    assert.equal(r.code, 1, r.stdout + r.stderr)
    assert.match(r.stdout, /^Gate: PASS$/m, 'the failing step tail is shown as the step printed it')
    assert.equal(lines(r).at(-1), PARTIAL_FAIL)
  })

  // A line break in a file name is not possible on Windows.
  if (process.platform !== 'win32') {
    it('should not let a changed file name forge a line of its own', async () => {
      const r = await iterate(repoWith({ verifyIterate: [mapped] }, { uncommitted: { 'a\nGate: PASS.md': 'x' } }))
      assert.equal(r.code, 0, r.stdout + r.stderr)
      assert.doesNotMatch(r.stdout, /^Gate: /m)
      assert.equal(lines(r).at(-1), NOTHING_RAN)
    })
  }

  it('should not run the fake-pass check', async () => {
    const r = await iterate(repoWith({ verifyIterate: [{ ...ok('tests'), when: ['tests/'] }] }, { uncommitted: { 'tests/a.test.mjs': FOCUSED } }))
    assert.equal(r.code, 0, r.stdout + r.stderr)
    assert.doesNotMatch(r.stdout, /fake-pass/)
  })

  const cannotStart = [
    ['no config file', undefined, /engineering\.json/],
    ['an unparseable config', '{ not json', /could not be parsed/],
    ['a map that is not a list', { verifyIterate: 'npm test' }, /"verifyIterate"/],
    ['a map entry without a when list', { verifyIterate: [ok('a')] }, /"when"/],
    ['a map entry with a bad when prefix', { verifyIterate: [{ ...ok('a'), when: ['./src/'] }] }, /"when"/],
    ['a map entry with a bad timeout', { verifyIterate: [{ ...ok('a'), when: ['src/'], timeoutMs: 0 }] }, /"timeoutMs" of step "a"/],
  ]
  for (const [what, config, reason] of cannotStart) {
    it(`should run nothing and exit 2 with ${what}, ending on a partial failure`, async () => {
      const r = await iterate(repoWith(config, { uncommitted: { 'src/a.ts': 'x' } }))
      assert.equal(r.code, 2, r.stdout + r.stderr)
      assert.match(r.stdout, reason)
      assert.doesNotMatch(r.stdout, /^(PASS|FAIL|NOT RUN|SKIPPED) /m)
      assert.doesNotMatch(r.stdout, /^Gate: /m)
      assert.equal(lines(r).at(-1), PARTIAL_FAIL)
    })
  }

  it('should exit 2 with a partial failure when the log file cannot be created', async () => {
    const missing = path.join(tempDir('usiatech-notmp-'), 'gone')
    const r = await iterate(repoWith({ verifyIterate: [mapped] }, { uncommitted: { 'src/a.ts': 'x' } }), { TMP: missing, TEMP: missing, TMPDIR: missing })
    assert.equal(r.code, 2, r.stdout + r.stderr)
    assert.match(r.stdout, /log file could not be created/)
    assert.doesNotMatch(r.stdout, /^Gate: /m)
    assert.equal(lines(r).at(-1), PARTIAL_FAIL)
  })

  it('should exit 2 with a partial failure when git cannot list the changed files', async () => {
    const dir = tempDir('usiatech-empty-')
    git(dir, 'init', '-q')
    writeFiles(dir, { '.claude/engineering.json': JSON.stringify({ verifyIterate: [mapped] }) })
    const r = await iterate(dir)
    assert.equal(r.code, 2, r.stdout + r.stderr)
    assert.match(r.stdout, /changed files/)
    assert.equal(lines(r).at(-1), PARTIAL_FAIL)
  })
})

describe('gate runner: per-step timeout (ESP-52)', () => {
  const ON_WINDOWS = process.platform === 'win32'
  // Prints 60 lines and then never ends.
  const hang = (name, timeoutMs) => ({ name, run: 'node -e "for(let i=1;i<=60;i++)console.log(\'out \'+i);setInterval(()=>{},1000)"', timeoutMs })

  // A step that starts a second process; both write their process id to a file in the repo and then stay for a
  // minute, far past any timeout here. They end on their own, so a failed test leaves nothing running for long
  // and no test has to stop a process by its id.
  const TREE = `import { spawn } from 'node:child_process'
import { writeFileSync } from 'node:fs'
spawn(process.execPath, ['-e', "require('node:fs').writeFileSync('child.pid', String(process.pid));setTimeout(() => {}, 60000)"], { stdio: 'ignore' })
writeFileSync('parent.pid', String(process.pid))
setTimeout(() => {}, 60000)
`
  const treeRepo = (timeoutMs) => repoWith({ verify: [{ name: 'tree', run: 'node tree.mjs', timeoutMs }] }, { committed: { 'tree.mjs': TREE } })
  const PID_FILES = ['parent.pid', 'child.pid']
  const started = (repo) => PID_FILES.every((f) => existsSync(path.join(repo, f)) && /^\d+$/.test(readFileSync(path.join(repo, f), 'utf8')))
  const pidsOf = (repo) => PID_FILES.map((f) => Number(readFileSync(path.join(repo, f), 'utf8')))
  const isAlive = (pid) => {
    try {
      process.kill(pid, 0)
      return true
    } catch (e) {
      return e.code === 'EPERM'
    }
  }
  const waitFor = async (condition, ms) => {
    for (const end = Date.now() + ms; Date.now() < end;) {
      if (condition()) return true
      await sleep(50)
    }
    return condition()
  }
  // Both processes must be gone.
  const assertTreeStopped = async (repo) => {
    assert.ok(started(repo), 'both processes started and wrote their process id')
    const pids = pidsOf(repo)
    assert.ok(await waitFor(() => !pids.some(isAlive), 5000), `still running: ${pids.filter(isAlive).join(', ')}`)
  }

  // The timeout leaves the step time to start and print on a busy machine; the checks below need its output.
  it('should stop a step at its timeout, show its last lines and skip the rest (AC1)', { timeout: 30000 }, async () => {
    const r = await runGate(repoWith({ verify: [ok('a'), hang('b', 6000), ok('c')] }))
    assert.equal(r.code, 1, r.stdout + r.stderr)
    assert.match(r.stdout, /^PASS {2}a \(exit 0, \d+ s\)$/m)
    assert.match(r.stdout, /^FAIL {2}b \(timed out after 6000 ms, \d+ s\)$/m)
    assert.match(r.stdout, /^NOT RUN {2}c$/m)
    assert.match(r.stdout, /^out 60$/m, 'the end of the timed-out output is shown')
    assert.match(r.stdout, /^out 21$/m, 'the last 40 lines are shown')
    assert.doesNotMatch(r.stdout, /^out 20$/m, 'only the last 40 lines are shown')
    assert.equal(lines(r).at(-1), 'Gate: FAIL')
  })

  // The timeout leaves both processes time to start on a busy machine; the check below needs them started.
  it('should stop the whole process tree of a timed-out step (AC2)', { timeout: 40000 }, async () => {
    const repo = treeRepo(6000)
    const r = await runGate(repo)
    assert.equal(r.code, 1, r.stdout + r.stderr)
    assert.match(r.stdout, /^FAIL {2}tree \(timed out after 6000 ms, \d+ s\)$/m)
    await assertTreeStopped(repo)
  })

  it('should accept the largest timeout and run the step', async () => {
    const r = await runGate(repoWith({ verify: [{ ...ok('a'), timeoutMs: 2147483647 }] }))
    assert.equal(r.code, 0, r.stdout + r.stderr)
    assert.match(r.stdout, /^PASS {2}a \(exit 0, \d+ s\)$/m)
  })

  it('should fail a step that a signal ended (AC5)', async (t) => {
    if (ON_WINDOWS) return t.skip('on Windows a shell step cannot end by a signal')
    const r = await runGate(repoWith({ verify: [{ name: 'a', run: 'kill -9 $$' }, ok('b')] }))
    assert.equal(r.code, 1, r.stdout + r.stderr)
    assert.match(r.stdout, /^FAIL {2}a \(killed by SIGKILL, \d+ s\)$/m)
    assert.match(r.stdout, /^NOT RUN {2}b$/m)
    assert.equal(lines(r).at(-1), 'Gate: FAIL')
  })

  it('should fail a step whose shell cannot be started (AC5)', async (t) => {
    if (!ON_WINDOWS) return t.skip('on POSIX the shell is always /bin/sh, so it can always be started')
    // Windows keeps one value per variable name whatever its case, so the name is taken as this process spells it.
    const comspec = Object.keys(process.env).find((k) => /^comspec$/i.test(k)) ?? 'ComSpec'
    const r = await runGate(repoWith({ verify: [ok('a'), ok('b')] }), { [comspec]: path.join(tempDir('usiatech-noshell-'), 'missing.exe') })
    assert.equal(r.code, 1, r.stdout + r.stderr)
    assert.match(r.stdout, /^FAIL {2}a \(could not start: .+, \d+ s\)$/m)
    assert.match(r.stdout, /^NOT RUN {2}b$/m)
    assert.equal(lines(r).at(-1), 'Gate: FAIL')
  })

  it('should exit 2 with Gate: FAIL when something throws while a step runs (AC7)', async () => {
    // Loaded before the runner: the first step's log offset can't be read, which throws inside the step run.
    const preload = path.join(tempDir('usiatech-preload-'), 'break-fstat.mjs')
    writeFiles(path.dirname(preload), { 'break-fstat.mjs': "import fs from 'node:fs'\nimport { syncBuiltinESMExports } from 'node:module'\nfs.fstatSync = () => { throw new Error('disk gone') }\nsyncBuiltinESMExports()\n" })
    // The log's folder is never printed on this path, so it goes into a temp dir the tests remove.
    const tmp = tempDir('usiatech-gate-tmp-')
    const r = await runGate(repoWith({ verify: [ok('a')] }), { NODE_OPTIONS: `--import ${pathToFileURL(preload).href}`, TMP: tmp, TEMP: tmp, TMPDIR: tmp })
    assert.equal(r.code, 2, r.stdout + r.stderr)
    assert.match(r.stdout, /^The gate could not finish: disk gone$/m)
    assert.doesNotMatch(r.stdout, /^PASS /m)
    assert.equal(lines(r).at(-1), 'Gate: FAIL')
  })

  it('should stop the running step and fail the gate when it is interrupted (AC9)', { timeout: 40000 }, async (t) => {
    if (ON_WINDOWS) return t.skip('on Windows a test cannot send a process a signal it can handle')
    const repo = treeRepo(undefined)
    const child = spawn(process.execPath, [SCRIPT], { cwd: repo, stdio: ['ignore', 'pipe', 'pipe'] })
    let stdout = ''
    child.stdout.on('data', (d) => { stdout += d })
    const closed = new Promise((resolve) => child.on('close', (code, signal) => resolve({ code, signal })))
    try {
      assert.ok(await waitFor(() => started(repo), 20000), `the step did not start:\n${stdout}`)
      child.kill('SIGTERM')
      const end = await closed
      const log = stdout.match(/^Log: (.+)$/m)?.[1].trim()
      if (log) logs.push(log)
      // ESP-58: an interrupted gate exits 130, as the mutation runner does, not 1 like a failed step.
      assert.equal(end.code, 130, `${JSON.stringify(end)}\n${stdout}`)
      assert.match(stdout, /^FAIL {2}tree \(interrupted, \d+ s\)$/m)
      assert.equal(stdout.split(/\r?\n/).filter(Boolean).at(-1), 'Gate: FAIL')
      await assertTreeStopped(repo)
    } finally {
      child.kill('SIGKILL')
    }
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
    assert.match(r.stdout, /^NOT RUN {2}tests$/m, 'the check runs first and stops the gate (ESP-158)')
    assert.match(r.stdout, /^FAIL {2}fake-pass check \(exit 1, scanned \d+ files?, \d+ s\)$/m)
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
    // step-01.log is the fake-pass check's, which runs first (ESP-158).
    assert.match(readFileSync(log, 'utf8'), /^=== chatty: .* \(output in step-02\.log\)$/m)
    assert.equal(readFileSync(path.join(path.dirname(log), 'step-02.log'), 'utf8').match(/^line \d+$/gm).length, 500)
    assert.ok(path.relative(repo, log).startsWith('..') || path.isAbsolute(path.relative(repo, log)), `${log} is inside ${repo}`)
  })

  it('should write the index and one log per step, fake-pass check included, in a folder made for this run (ESP-56 AC13)', async () => {
    const r = await runGate(repoWith({ verify: [ok('a'), ok('b')] }))
    assert.equal(r.code, 0, r.stdout + r.stderr)
    const dir = path.dirname(logPath(r))
    assert.match(path.basename(dir), /^usiatech-gate-.{6}$/)
    assert.deepEqual(readdirSync(dir).sort(), ['gate.log', 'step-01.log', 'step-02.log', 'step-03.log'])
  })

  it('should keep a background process left by one step out of the next step\'s output (ESP-56 AC13)', async () => {
    // The first step leaves a detached child that keeps writing after the step ends.
    const bg = "import { spawn } from 'node:child_process'\nspawn(process.execPath, ['-e', 'let i=0;const t=setInterval(()=>{console.log(\"background\");if(++i>40)clearInterval(t)},25)'], { stdio: 'inherit', detached: true }).unref()\n"
    const second = { name: 'second', run: 'node -e "setTimeout(()=>{console.log(\'mine\');process.exit(3)},500)"' }
    const r = await runGate(repoWith({ verify: [{ name: 'first', run: 'node bg.mjs' }, second] }, { committed: { 'bg.mjs': bg } }))
    assert.equal(r.code, 1, r.stdout + r.stderr)
    const tail = r.stdout.slice(r.stdout.indexOf('--- last'))
    assert.match(tail, /^mine$/m)
    assert.doesNotMatch(tail, /background/)
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
    assert.match(readFileSync(path.join(path.dirname(logPath(r)), 'step-02.log'), 'utf8'), /^to stderr$/m)
  })
})

describe('gate runner: old log folders (ESP-56 AC13)', () => {
  const DAY = 24 * 60 * 60 * 1000
  // The runner's temp folder is pointed at a folder of the test's own, so the user's real temp folder is never touched.
  const tempEnv = (dir) => ({ TMP: dir, TEMP: dir, TMPDIR: dir })
  const folder = (tmp, name, ageDays) => {
    const dir = path.join(tmp, name)
    mkdirSync(dir)
    writeFileSync(path.join(dir, 'gate.log'), 'old\n')
    const when = new Date(Date.now() - ageDays * DAY)
    utimesSync(dir, when, when)
    return dir
  }

  it('should remove its own folders older than 7 days and keep newer and other folders', async () => {
    const tmp = tempDir('usiatech-tmp-')
    const old = folder(tmp, 'usiatech-gate-Old123', 8)
    const recent = folder(tmp, 'usiatech-gate-New123', 6)
    const other = folder(tmp, 'usiatech-gate-toolong1', 30)
    const foreign = folder(tmp, 'someone-else-Abc123', 30)
    const r = await runGate(repoWith({ verify: [ok('a')] }), tempEnv(tmp))
    assert.equal(r.code, 0, r.stdout + r.stderr)
    assert.equal(existsSync(old), false, 'the old folder is removed')
    for (const kept of [recent, other, foreign]) assert.ok(existsSync(kept), `${kept} is kept`)
  })

  it('should not follow or remove a link that matches the name', async () => {
    const tmp = tempDir('usiatech-tmp-')
    const target = folder(tempDir('usiatech-target-'), 'precious', 30)
    const link = path.join(tmp, 'usiatech-gate-Link12')
    symlinkSync(target, link, 'junction')
    const when = new Date(Date.now() - 30 * DAY)
    utimesSync(target, when, when)
    const r = await runGate(repoWith({ verify: [ok('a')] }), tempEnv(tmp))
    assert.equal(r.code, 0, r.stdout + r.stderr)
    assert.ok(existsSync(path.join(target, 'gate.log')), 'the link target is untouched')
    assert.ok(lstatSync(link).isSymbolicLink(), 'the link is left alone')
  })
})

describe('gate runner: order, exclusions, resume and fix rerun (ESP-158, ESP-160, ESP-161, ESP-162)', () => {
  const at = (r, re) => lines(r).findIndex((l) => re.test(l))
  const slow = (name) => ({ ...ok(name), slow: true })
  // A step that passes once the flag file exists: the flag lives outside the repo, so the tree doesn't change.
  const flaky = (name) => ({ name, run: 'node -e "process.exit(require(\'fs\').existsSync(process.env.GATE_FLAG)?0:3)"' })
  const flagEnv = () => ({ GATE_FLAG: path.join(tempDir('usiatech-flag-'), 'ok') })
  const inOrder = (r, names) => {
    const found = names.map((n) => at(r, new RegExp(`^PASS {2}${n} `)))
    return found.every((i, k) => i >= 0 && (k === 0 || i > found[k - 1]))
  }

  it('should run the fake-pass check first and stop before any command step on a finding (ESP-158 AC1)', async () => {
    const r = await runGate(repoWith({ verify: [ok('a'), ok('b')] }, { uncommitted: { 'src/x.test.mjs': FOCUSED } }))
    assert.equal(r.code, 1, r.stdout)
    assert.match(r.stdout, /^FAIL {2}fake-pass check /m)
    assert.match(r.stdout, /^NOT RUN {2}a$/m)
    assert.match(r.stdout, /^NOT RUN {2}b$/m)
    assert.equal(lines(r).at(-1), 'Gate: FAIL')
  })

  it('should run every selected non-slow step before any slow one, in config order inside each group (ESP-158 AC2)', async () => {
    const config = { verify: [slow('e2e'), ok('lint')], verifyConditional: [{ ...ok('db'), when: ['db/'] }, { ...slow('rls'), when: ['db/'] }] }
    const r = await runGate(repoWith(config, { uncommitted: { 'db/a.sql': 'x' } }))
    assert.equal(r.code, 0, r.stdout)
    assert.ok(inOrder(r, ['fake-pass check', 'lint', 'db', 'e2e', 'rls']), r.stdout)
  })

  it('should refuse a slow that is not true or false (ESP-158 AC2)', async () => {
    const r = await runGate(repoWith({ verify: [{ ...ok('e2e'), slow: 'yes' }] }))
    assert.equal(r.code, 2, r.stdout)
    assert.match(r.stdout, /"slow" of step "e2e" must be true or false/)
  })

  it('should keep config order with no slow key, after the fake-pass check (ESP-158 AC3)', async () => {
    const r = await runGate(repoWith({ verify: [ok('typecheck'), ok('tests'), ok('build')] }))
    assert.equal(r.code, 0, r.stdout)
    assert.ok(inOrder(r, ['fake-pass check', 'typecheck', 'tests', 'build']), r.stdout)
  })

  it('should skip a conditional step whose every matching file is excluded, and say so (ESP-160 AC6, AC7)', async () => {
    const e2e = { ...ok('demo e2e'), when: ['web/src/'], unless: ['web/src/**/*.live.tsx'] }
    const config = { verify: [ok('unit')], verifyConditional: [e2e] }
    const skipped = await runGate(repoWith(config, { uncommitted: { 'web/src/a.live.tsx': 'x', 'web/src/x/b.live.tsx': 'y' } }))
    assert.equal(skipped.code, 0, skipped.stdout)
    assert.match(skipped.stdout, /^SKIPPED {2}demo e2e \(every changed file under web\/src\/ matches unless web\/src\/\*\*\/\*\.live\.tsx\)$/m)
    const selected = await runGate(repoWith(config, { uncommitted: { 'web/src/a.live.tsx': 'x', 'web/src/page.tsx': 'y' } }))
    assert.match(selected.stdout, /^PASS {2}demo e2e /m)
  })

  it('should refuse a malformed unless, or unless on an always-run step (ESP-160 AC6)', async () => {
    for (const [config, message] of [
      [{ verify: [ok('unit')], verifyConditional: [{ ...ok('e2e'), when: ['web/'], unless: [] }] }, /"unless" of step "e2e" must be a list of globs/],
      [{ verify: [ok('unit')], verifyConditional: [{ ...ok('e2e'), when: ['web/'], unless: ['../x'] }] }, /"unless" of step "e2e" must be a list of globs/],
      // A folder-style entry would match no file, so it is refused with the glob spelling.
      [{ verify: [ok('unit')], verifyConditional: [{ ...ok('e2e'), when: ['web/'], unless: ['web/live/'] }] }, /a folder is written "web\/live\/\*\*", not "web\/live\/"/],
      [{ verify: [{ ...ok('unit'), unless: ['x/**'] }] }, /step "unit" always runs, so it can't have "unless"/],
    ]) {
      const r = await runGate(repoWith(config))
      assert.equal(r.code, 2, JSON.stringify(config))
      assert.match(r.stdout, message)
    }
  })

  it('should select the same conditional steps as the CI runner for the same diff (ESP-160 AC9)', async () => {
    const conditional = [
      { ...ok('web e2e'), when: ['web/'], unless: ['web/**/*.live.tsx'] },
      { ...ok('api tests'), when: ['api/'] },
      { ...ok('db tests'), when: ['db/'] },
    ]
    const config = { verify: [ok('unit')], verifyConditional: conditional }
    for (const files of [{ 'web/a.live.tsx': 'x', 'api/b.ts': 'y' }, { 'web/a.tsx': 'x' }, { 'docs/x.ts': 'x' }]) {
      const repo = makeRepo({ headFiles: { ...files, '.claude/engineering.json': JSON.stringify(config) } })
      const local = await runGate(repo)
      const ci = await runNode(path.join(makeGovTree(config), 'run-verify.mjs'), { cwd: repo, env: { BASE_REF: 'develop' } })
      const localRan = conditional.map((s) => s.name).filter((n) => new RegExp(`^PASS {2}${n} `, 'm').test(local.stdout))
      const ciRan = conditional.map((s) => s.name).filter((n) => ci.summary.includes(`| ${n} |`))
      assert.deepEqual(localRan, ciRan, JSON.stringify(files))
    }
  })

  it('should resume at the failed step when the tree is unchanged, and name each reused step (ESP-162 AC10, AC13)', async () => {
    const env = flagEnv()
    const repo = repoWith({ verify: [ok('a'), flaky('b'), ok('c')] })
    const first = await runGate(repo, env)
    assert.equal(first.code, 1, first.stdout)
    const tree = first.stdout.match(/^Gate tree: ([0-9a-f]{40,64})$/m)?.[1]
    assert.ok(tree, first.stdout)
    assert.equal((await runGate(repo, env, ['--tree-hash'])).stdout.trim(), `Gate tree: ${tree}`)
    const stillFailing = await runGate(repo, env, ['--resume'])
    assert.equal(lines(stillFailing).at(-1), 'Gate: FAIL')
    writeFileSync(env.GATE_FLAG, 'ok')
    const resumed = await runGate(repo, env, ['--resume'])
    assert.equal(resumed.code, 0, resumed.stdout)
    const time = String.raw`\(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z\)`
    assert.match(resumed.stdout, /^Resume: reusing the steps that passed at tree /m)
    assert.match(resumed.stdout, new RegExp(`^PASSED EARLIER {2}fake-pass check ${time}$`, 'm'))
    assert.match(resumed.stdout, new RegExp(`^PASSED EARLIER {2}a ${time}$`, 'm'))
    assert.match(resumed.stdout, /^PASS {2}b /m)
    assert.match(resumed.stdout, /^PASS {2}c /m)
    assert.match(resumed.stdout, new RegExp(`^Gate tree: ${tree}$`, 'm'))
    assert.equal(lines(resumed).at(-1), 'Gate: PASS')
  })

  it('should run every step on --resume after a tracked edit or a new untracked file (ESP-162 AC11)', async () => {
    for (const change of [{ 'src/a.ts': 'changed' }, { 'src/new.ts': 'new' }]) {
      const env = flagEnv()
      const repo = repoWith({ verify: [ok('a'), flaky('b')] }, { committed: { 'src/a.ts': 'a' } })
      await runGate(repo, env)
      writeFiles(repo, change)
      writeFileSync(env.GATE_FLAG, 'ok')
      const r = await runGate(repo, env, ['--resume'])
      assert.match(r.stdout, /^Resume: the working tree changed since the last run, so every step runs\.$/m, r.stdout)
      assert.match(r.stdout, /^PASS {2}a /m)
      assert.doesNotMatch(r.stdout, /PASSED EARLIER/)
    }
  })

  it('should say when the steps changed files git does not ignore, so the tree no longer matches (ESP-162)', async () => {
    const writer = { name: 'writer', run: 'node -e "require(\'fs\').writeFileSync(\'out.txt\', \'x\')"' }
    const repo = repoWith({ verify: [writer] })
    const r = await runGate(repo)
    assert.equal(r.code, 0, r.stdout)
    const tree = r.stdout.match(/^Gate tree: ([0-9a-f]{40,64})$/m)?.[1]
    const now = (await runGate(repo, {}, ['--tree-hash'])).stdout.trim().replace('Gate tree: ', '')
    assert.notEqual(now, tree)
    assert.match(r.stdout, new RegExp(`^The steps changed files git doesn't ignore: the tree is now ${now}, not ${tree}\\.`, 'm'))
  })

  it('should run every step on --resume after a config change (ESP-162 AC12)', async () => {
    const env = flagEnv()
    const repo = repoWith({ verify: [ok('a'), flaky('b')] })
    await runGate(repo, env)
    writeFiles(repo, { '.claude/engineering.json': JSON.stringify({ verify: [ok('a'), flaky('b')], git: {} }) })
    writeFileSync(env.GATE_FLAG, 'ok')
    const r = await runGate(repo, env, ['--resume'])
    assert.match(r.stdout, /^Resume: \.claude\/engineering\.json changed since the last run, so every step runs\.$/m, r.stdout)
    assert.match(r.stdout, /^PASS {2}a /m)
  })

  it('should rerun only the verify steps, the fake-pass check and the steps a fix selects (ESP-161 AC14)', async () => {
    const config = { verifyRerun: 'fix-diff', verify: [ok('unit')], verifyConditional: [{ ...ok('web'), when: ['web/'] }, { ...ok('api'), when: ['api/'] }] }
    const repo = makeRepo({ headFiles: { 'web/a.ts': 'a', 'api/b.ts': 'b', '.claude/engineering.json': JSON.stringify(config) } })
    const full = await runGate(repo)
    assert.equal(full.code, 0, full.stdout)
    assert.match(full.stdout, /^PASS {2}web /m)
    const tree = full.stdout.match(/^Gate tree: (\S+)$/m)[1]
    writeFiles(repo, { 'api/b.ts': 'fixed' })
    const rerun = await runGate(repo, {}, ['--rerun-fix'])
    assert.equal(rerun.code, 0, rerun.stdout)
    assert.match(rerun.stdout, new RegExp(`^Rerun after full gate at tree ${tree} \\(\\d{4}-[^)]+\\): 1 file changed since\\.$`, 'm'))
    assert.match(rerun.stdout, /^PASS {2}fake-pass check /m)
    assert.match(rerun.stdout, /^PASS {2}unit /m)
    assert.match(rerun.stdout, /^PASS {2}api /m)
    assert.match(rerun.stdout, /^SKIPPED {2}web \(no changed file under web\/\)$/m)
    // A narrowed rerun is never a full pass: the next one still compares with the first full pass.
    writeFiles(repo, { 'api/b.ts': 'fixed again' })
    assert.match((await runGate(repo, {}, ['--rerun-fix'])).stdout, new RegExp(`^Rerun after full gate at tree ${tree} `, 'm'))
  })

  it('should refuse --rerun-fix without the option, with an unknown value or without a full pass, and run nothing (ESP-161 AC15)', async () => {
    const cases = [
      [{ verify: [ok('unit')] }, /--rerun-fix needs "verifyRerun": "fix-diff"/],
      [{ verifyRerun: 'all', verify: [ok('unit')] }, /"verifyRerun" can only be "fix-diff"/],
      [{ verifyRerun: 'fix-diff', verify: [ok('unit')] }, /--rerun-fix needs a recorded full gate pass/],
    ]
    for (const [config, message] of cases) {
      const r = await runGate(repoWith(config), {}, ['--rerun-fix'])
      assert.equal(r.code, 2, `${JSON.stringify(config)}\n${r.stdout}`)
      assert.match(r.stdout, message)
      assert.doesNotMatch(r.stdout, /^PASS /m)
      assert.equal(lines(r).at(-1), 'Gate: FAIL')
    }
  })
})
