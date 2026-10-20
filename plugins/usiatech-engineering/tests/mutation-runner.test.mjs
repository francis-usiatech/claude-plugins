import { describe, it, after } from 'node:test'
import assert from 'node:assert/strict'
import { execFile, execFileSync } from 'node:child_process'
import { EventEmitter } from 'node:events'
import { chmodSync, closeSync, existsSync, mkdirSync, openSync, readFileSync, statSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import { makeRepo, git, tempDir, cleanupTempDirs, PLUGIN_ROOT } from './helpers.mjs'

after(cleanupTempDirs)

const RUNNER = path.join(PLUGIN_ROOT, 'skills', 'mutation-test', 'mutation-runner.mjs')

// Fixture modules are written with exact bytes (makeRepo turns core.autocrlf off), one LF and one CRLF.
const GUARD_LF = "export const classify = (n) => {\n  if (n < 0) return 'negative'\n  // keep zero positive\n  return 'positive'\n}\n"
const GUARD_CRLF = GUARD_LF.replace(/\n/g, '\r\n')

// The fixture's test script. A "SLEEP" marker in a module makes it hang (and touch the file named in
// argv[2] first, so a test can wait for it); a "CRASH" marker makes it throw. Otherwise it exits 0 only
// when both guards still classify -1 as negative.
const CHECK = `import { readFileSync, writeFileSync } from 'node:fs'
import { classify as lf } from './guard-lf.mjs'
import { classify as crlf } from './guard-crlf.mjs'
const src = readFileSync(new URL('./guard-lf.mjs', import.meta.url), 'utf8') + readFileSync(new URL('./guard-crlf.mjs', import.meta.url), 'utf8')
if (src.includes('SLEEP')) {
  if (process.argv[2]) writeFileSync(process.argv[2], 'started')
  setTimeout(() => {}, 60000)
} else if (src.includes('CRASH')) {
  throw new Error('boom')
} else {
  process.exit(lf(-1) === 'negative' && crlf(-1) === 'negative' ? 0 : 1)
}
`

// Makes guard-lf.mjs read-only once a "LOCK" mutation is applied, so the runner's restore write fails.
const LOCK = `import { readFileSync, chmodSync } from 'node:fs'
if (readFileSync('guard-lf.mjs', 'utf8').includes('LOCK')) chmodSync('guard-lf.mjs', 0o444)
`

// Stands in for an IDE autosave during the run: once a "MUTATED" mutation is applied, rewrites
// guard-lf.mjs, or deletes it when given "delete". Unmutated (the baseline) it does nothing.
const REWRITE = `import { readFileSync, unlinkSync, writeFileSync } from 'node:fs'
if (readFileSync('guard-lf.mjs', 'utf8').includes('MUTATED')) {
  if (process.argv[2] === 'delete') unlinkSync('guard-lf.mjs')
  else writeFileSync('guard-lf.mjs', 'USER EDIT\\n')
}
`

const NODE = `"${process.execPath}"`
const CMD = `${NODE} check.mjs`

const fixtureRepo = () => makeRepo({ headFiles: { 'guard-lf.mjs': GUARD_LF, 'guard-crlf.mjs': GUARD_CRLF, 'check.mjs': CHECK, 'lock.mjs': LOCK, 'rewrite.mjs': REWRITE } })
const importRunner = () => import(pathToFileURL(RUNNER).href)

const snapshot = (repo) => ({
  lf: readFileSync(path.join(repo, 'guard-lf.mjs')),
  crlf: readFileSync(path.join(repo, 'guard-crlf.mjs')),
  status: git(repo, 'status', '--porcelain'),
})

const assertUnchanged = (repo, before) => {
  const now = snapshot(repo)
  assert.ok(now.lf.equals(before.lf), 'guard-lf.mjs changed')
  assert.ok(now.crlf.equals(before.crlf), 'guard-crlf.mjs changed')
  assert.equal(now.status, before.status)
}

// Writes the list outside the repo, so the list file itself never shows in git status.
const writeList = (list) => {
  const file = path.join(tempDir('usiatech-mutations-'), 'mutations.json')
  writeFileSync(file, typeof list === 'string' ? list : JSON.stringify(list))
  return file
}

const runRunner = (cwd, listFile) => new Promise((resolve) => {
  const started = Date.now()
  execFile(process.execPath, [RUNNER, '--list', listFile], { cwd, encoding: 'utf8' }, (err, stdout, stderr) => {
    resolve({ code: err ? (typeof err.code === 'number' ? err.code : 1) : 0, stdout, stderr, ms: Date.now() - started })
  })
})

const HANG = `${NODE} -e "setTimeout(() => {}, 60000)"`

// Kills a command's process tree; a tree that is already (partly) gone is only logged, so cleanup never
// replaces a test's own failure.
const killForReal = (child) => {
  try {
    if (process.platform === 'win32') execFileSync('taskkill', ['/pid', String(child.pid), '/T', '/F'], { stdio: 'pipe' })
    else process.kill(-child.pid, 'SIGKILL')
  } catch (e) {
    console.error(`test cleanup: could not kill process tree ${child.pid}: ${e.message}`)
  }
}

const mutation = (over) => ({ label: 'm', file: 'guard-lf.mjs', find: "  if (n < 0) return 'negative'\n", replace: '', command: CMD, ...over })

describe('mutation-runner baseline (AC11, R13)', () => {
  it('should stop with "baseline failed" and touch nothing when a command fails unmutated', async () => {
    const repo = fixtureRepo()
    const before = snapshot(repo)
    const broken = `${NODE} -e "process.exit(3)"`
    const list = writeList({ mutations: [mutation({ label: 'guard' }), mutation({ label: 'broken', command: broken })] })
    const r = await runRunner(repo, list)
    assert.equal(r.code, 1, r.stdout + r.stderr)
    assert.match(r.stdout + r.stderr, /baseline failed/)
    // Every distinct command is shown before any of them runs, so none runs unseen.
    const shown = r.stderr.indexOf('Commands to run')
    assert.ok(shown !== -1 && shown < r.stderr.indexOf('baseline failed'), r.stderr)
    assert.ok(r.stderr.includes(CMD) && r.stderr.includes(broken), r.stderr)
    assert.doesNotMatch(r.stdout, /CAUGHT|SURVIVED/)
    assertUnchanged(repo, before)
  })
})

describe('mutation-runner statuses (AC12, R14)', () => {
  it('should report CAUGHT, SURVIVED, NOT-FOUND, TIMEOUT and ERROR, exit 0 and restore every file', async () => {
    const repo = fixtureRepo()
    const before = snapshot(repo)
    const list = writeList({
      mutations: [
        mutation({ label: 'remove negative guard' }),
        mutation({ label: 'comment only', find: '// keep zero positive', replace: '// keep zero positive!' }),
        mutation({ label: 'absent', find: 'no such text' }),
        mutation({ label: 'twice', find: 'return' }),
        mutation({ label: 'hangs', find: '// keep zero positive', replace: '// SLEEP', timeoutMs: 1500 }),
        mutation({ label: 'missing file', file: 'missing.mjs' }),
      ],
    })
    const r = await runRunner(repo, list)
    assert.equal(r.code, 0, r.stdout + r.stderr)
    assert.match(r.stdout, /CAUGHT\s+remove negative guard/)
    assert.match(r.stdout, /SURVIVED\s+comment only/)
    assert.match(r.stdout, /NOT-FOUND\s+absent .*0 matches/)
    assert.match(r.stdout, /NOT-FOUND\s+twice .*2 matches/)
    assert.match(r.stdout, /TIMEOUT\s+hangs/)
    assert.match(r.stdout, /ERROR\s+missing file/)
    // The hanging command sleeps 60 s; finishing well before that shows its process tree was killed.
    assert.ok(r.ms < 45000, `runner took ${r.ms} ms`)
    assertUnchanged(repo, before)
  })

  it('should reject an invalid list with exit 2 before running or touching anything', async () => {
    const repo = fixtureRepo()
    const before = snapshot(repo)
    const marker = path.join(tempDir('usiatech-marker-'), 'ran')
    const ran = `${NODE} -e "require('fs').writeFileSync(process.argv[1], 'x')" "${marker}"`
    const cases = {
      'bad JSON': '{ not json',
      'no mutations': { mutations: [] },
      'missing find': { mutations: [mutation({ find: undefined, command: ran })] },
      'absolute path': { mutations: [mutation({ file: path.join(repo, 'guard-lf.mjs'), command: ran })] },
      'parent path': { mutations: [mutation({ file: '../guard-lf.mjs', command: ran })] },
      'nested parent path': { mutations: [mutation({ file: 'a/../../guard-lf.mjs', command: ran })] },
      'drive-relative path': { mutations: [mutation({ file: 'C:guard-lf.mjs', command: ran })] },
      'UNC path': { mutations: [mutation({ file: '\\\\srv\\share\\guard-lf.mjs', command: ran })] },
      'repo root': { mutations: [mutation({ file: '.', command: ran })] },
      'git internals': { mutations: [mutation({ file: '.git/config', command: ran })] },
      'bad timeout': { mutations: [mutation({ timeoutMs: -1, command: ran })] },
    }
    for (const [what, list] of Object.entries(cases)) {
      const r = await runRunner(repo, writeList(list))
      assert.equal(r.code, 2, `${what}: ${r.stdout}${r.stderr}`)
      assert.match(r.stderr, /mutation list/i, what)
    }
    assert.equal(existsSync(marker), false, 'a command ran for an invalid list')
    assertUnchanged(repo, before)
  })
})

describe('mutation-runner restore (AC13, R15)', () => {
  it('should leave CRLF and LF files byte-identical after mutations, including one whose command crashes', async () => {
    const repo = fixtureRepo()
    const before = snapshot(repo)
    const list = writeList({
      mutations: [
        mutation({ label: 'lf guard' }),
        mutation({ label: 'crlf guard', file: 'guard-crlf.mjs', find: "if (n < 0) return 'negative'", replace: "if (n < -1) return 'negative'" }),
        mutation({ label: 'crlf crash', file: 'guard-crlf.mjs', find: '// keep zero positive', replace: '// CRASH' }),
      ],
    })
    const r = await runRunner(repo, list)
    assert.equal(r.code, 0, r.stdout + r.stderr)
    assert.match(r.stdout, /CAUGHT\s+lf guard/)
    assert.match(r.stdout, /CAUGHT\s+crlf guard/)
    assert.match(r.stdout, /CAUGHT\s+crlf crash/)
    assertUnchanged(repo, before)
  })

  it('should restore the mutated file and stop when the run is aborted mid-mutation', async () => {
    const { runMutations } = await importRunner()
    const repo = fixtureRepo()
    const before = snapshot(repo)
    const marker = path.join(tempDir('usiatech-marker-'), 'started')
    const controller = new AbortController()
    const run = runMutations({
      root: repo,
      mutations: [
        mutation({ label: 'hangs', file: 'guard-crlf.mjs', find: '// keep zero positive', replace: '// SLEEP', command: `${CMD} "${marker}"` }),
        mutation({ label: 'never runs' }),
      ],
      signal: controller.signal,
    })
    let result
    try {
      const deadline = Date.now() + 30000
      while (!existsSync(marker) && Date.now() < deadline) await new Promise((r) => setTimeout(r, 50))
      assert.ok(existsSync(marker), 'mutated command never started')
      assert.notEqual(readFileSync(path.join(repo, 'guard-crlf.mjs'), 'utf8'), GUARD_CRLF, 'mutation was not applied')
    } finally {
      // Abort even when an assertion fails, so the 60 s sleeper is killed and the file restored.
      controller.abort()
      result = await run
    }
    assert.equal(result.interrupted, true)
    assert.deepEqual(result.results.map((m) => [m.label, m.status, m.detail]), [['hangs', 'ERROR', 'interrupted']])
    assertUnchanged(repo, before)
  })

  it('should name the file and exit 3 with the report so far when a restore fails', async () => {
    const repo = fixtureRepo()
    const file = path.join(repo, 'guard-lf.mjs')
    const list = writeList({
      mutations: [
        mutation({ label: 'comment only', find: '// keep zero positive', replace: '// keep zero positive!' }),
        mutation({ label: 'locks the file', find: '// keep zero positive', replace: '// LOCK', command: `${NODE} lock.mjs` }),
        mutation({ label: 'never runs' }),
      ],
    })
    try {
      const r = await runRunner(repo, list)
      assert.equal(r.code, 3, r.stdout + r.stderr)
      assert.match(r.stderr, /guard-lf\.mjs[^\n]*left mutated/)
      assert.match(r.stdout, /SURVIVED\s+comment only/)
      assert.doesNotMatch(r.stdout, /never runs/)
    } finally {
      chmodSync(file, 0o644)
    }
  })
})

describe('mutation-runner hardening (stage-2 fix set)', () => {
  it('should reject a path that reaches outside the repo through a symlink or junction', async () => {
    const repo = fixtureRepo()
    const outside = tempDir('usiatech-outside-')
    writeFileSync(path.join(outside, 'x.mjs'), 'export const x = 1\n')
    // A junction needs no admin rights on Windows; elsewhere the type is ignored and a symlink is made.
    symlinkSync(outside, path.join(repo, 'linked'), 'junction')
    const r = await runRunner(repo, writeList({ mutations: [mutation({ file: 'linked/x.mjs', find: 'x = 1', replace: 'x = 2' })] }))
    assert.equal(r.code, 2, r.stdout + r.stderr)
    assert.match(r.stderr, /mutation list[^\n]*inside the repo/i)
    assert.equal(readFileSync(path.join(outside, 'x.mjs'), 'utf8'), 'export const x = 1\n')
  })

  it('should reject a path that reaches into .git through a symlink or junction', async () => {
    const repo = fixtureRepo()
    mkdirSync(path.join(repo, 'sub', '.git'), { recursive: true })
    writeFileSync(path.join(repo, 'sub', '.git', 'HEAD'), 'ref: refs/heads/main\n')
    symlinkSync(path.join(repo, '.git'), path.join(repo, 'gitlink'), 'junction')
    symlinkSync(path.join(repo, 'sub', '.git'), path.join(repo, 'sublink'), 'junction')
    const config = readFileSync(path.join(repo, '.git', 'config'))
    for (const file of ['gitlink/config', 'sublink/HEAD']) {
      const r = await runRunner(repo, writeList({ mutations: [mutation({ file, find: 'no-such-text', replace: 'x' })] }))
      assert.equal(r.code, 2, `${file}: ${r.stdout}${r.stderr}`)
      assert.match(r.stderr, /mutation list[^\n]*inside \.git/i, file)
    }
    assert.ok(readFileSync(path.join(repo, '.git', 'config')).equals(config), '.git/config changed')
  })

  it('should resolve as error, not hang, when the process tree cannot be killed', { timeout: 15000 }, async () => {
    const { runCommand } = await importRunner()
    let leaked = null
    const failingKill = (child) => {
      leaked = child
      return 'Access is denied.'
    }
    try {
      const r = await runCommand(HANG, { root: tempDir('usiatech-kill-'), timeoutMs: 200, kill: failingKill })
      assert.equal(r.outcome, 'error')
      assert.match(r.stderr, /could not stop[^\n]*Access is denied/)
    } finally {
      // The injected kill left the command running; stop it for real so the test process can exit.
      if (leaked) killForReal(leaked)
    }
  })

  it('should keep the timeout outcome when the kill reports a failure but the command still ends', { timeout: 15000 }, async () => {
    const { runCommand } = await importRunner()
    // Like taskkill when part of the tree has already exited: the tree is gone, but the kill reports an error.
    const partialKill = (child) => {
      killForReal(child)
      return 'There is no running instance of the task.'
    }
    const r = await runCommand(HANG, { root: tempDir('usiatech-kill-'), timeoutMs: 200, kill: partialKill })
    assert.equal(r.outcome, 'timeout')
  })

  it('should keep handling repeat interrupts, so a second Ctrl+C or a closed terminal cannot skip the restore', async () => {
    const { handleInterrupts } = await importRunner()
    const target = new EventEmitter()
    const controller = new AbortController()
    const notices = []
    const remove = handleInterrupts(controller, (msg) => notices.push(msg), target)
    target.emit('SIGINT')
    target.emit('SIGINT')
    target.emit('SIGHUP')
    assert.equal(controller.signal.aborted, true)
    assert.equal(notices.length, 1)
    assert.match(notices[0], /restoring/i)
    for (const s of ['SIGINT', 'SIGTERM', 'SIGHUP']) assert.equal(target.listenerCount(s), 1, s)
    remove()
    for (const s of ['SIGINT', 'SIGTERM', 'SIGHUP']) assert.equal(target.listenerCount(s), 0, s)
  })

  it('should map how a command ended to an outcome: abort and timeout win, a signal kill is an error', async () => {
    const { outcomeOf } = await importRunner()
    assert.equal(outcomeOf({ code: 0 }), 'pass')
    assert.equal(outcomeOf({ code: 1 }), 'fail')
    assert.equal(outcomeOf({ code: null, signal: 'SIGKILL' }), 'error')
    assert.equal(outcomeOf({ code: 1, ended: 'timeout' }), 'timeout')
    assert.equal(outcomeOf({ code: 0, aborted: true }), 'aborted')
    assert.equal(outcomeOf({ code: 1, aborted: true }), 'aborted')
  })
})

// The gate runner runs its steps through runCommand (ESP-52), with their output in its log file.
describe('mutation-runner runCommand for the gate runner (ESP-52 AC6)', () => {
  // Runs `run` with a file opened for the command's output and returns what the command wrote there.
  const withOutputFile = async (run) => {
    const file = path.join(tempDir('usiatech-output-'), 'out.log')
    const fd = openSync(file, 'wx+')
    try {
      return { result: await run(fd), written: () => readFileSync(file, 'utf8') }
    } finally {
      closeSync(fd)
    }
  }

  it('should send stdout and stderr to the given file', async () => {
    const { runCommand } = await importRunner()
    const command = `${NODE} -e "console.log('to stdout');console.error('to stderr')"`
    const { result, written } = await withOutputFile((output) => runCommand(command, { root: tempDir('usiatech-out-'), timeoutMs: 15000, output }))
    assert.equal(result.outcome, 'pass', JSON.stringify(result))
    assert.match(written(), /^to stdout$/m)
    assert.match(written(), /^to stderr$/m)
  })

  it('should run a program with arguments without a shell', async () => {
    const { runCommand } = await importRunner()
    // A shell would split this argument at "&&"; without one it arrives whole. Exit 7 shows the script itself ran.
    const args = ['-e', "process.exit(process.argv[1] === 'a && b' ? 7 : 4)", 'a && b']
    const r = await runCommand(process.execPath, { root: tempDir('usiatech-args-'), timeoutMs: 15000, args })
    assert.equal(r.code, 7, JSON.stringify(r))
    assert.equal(r.outcome, 'fail')
  })

  it('should resolve as error, not hang, when the tree cannot be killed and the output goes to a file', { timeout: 15000 }, async () => {
    const { runCommand } = await importRunner()
    let leaked = null
    const failingKill = (child) => {
      leaked = child
      return 'Access is denied.'
    }
    try {
      const { result } = await withOutputFile((output) => runCommand(HANG, { root: tempDir('usiatech-kill-'), timeoutMs: 200, kill: failingKill, output }))
      assert.equal(result.outcome, 'error')
      assert.match(result.stderr, /could not stop[^\n]*Access is denied/)
    } finally {
      if (leaked) killForReal(leaked)
    }
  })

  it('should report a program that cannot be started as a start error, with no signal', async () => {
    const { runCommand } = await importRunner()
    const root = tempDir('usiatech-nostart-')
    const r = await runCommand(path.join(root, 'no-such-program'), { root, timeoutMs: 15000, args: [] })
    assert.equal(r.outcome, 'error')
    assert.match(r.startError, /ENOENT/)
    assert.equal(r.signal ?? null, null)
  })

  it('should report the signal that ended a command, and no start error', { timeout: 15000 }, async () => {
    const { runCommand } = await importRunner()
    // Node reports a signal for a child it killed itself, on Windows too.
    const signalKill = (child) => {
      child.kill('SIGKILL')
      return null
    }
    const args = ['-e', 'setTimeout(() => {}, 60000)']
    const r = await runCommand(process.execPath, { root: tempDir('usiatech-signal-'), timeoutMs: 200, kill: signalKill, args })
    assert.equal(r.outcome, 'timeout')
    assert.equal(r.signal, 'SIGKILL')
    assert.equal(r.startError, undefined)
  })
})

describe('mutation-runner audit fixes (ESP-78)', () => {
  it('should reject a timeoutMs of 2 ** 31 or more, which Node would run after 1 ms (F12)', async () => {
    const { validateList, ListError } = await importRunner()
    const repo = fixtureRepo()
    assert.throws(() => validateList({ timeoutMs: 2 ** 31, mutations: [mutation()] }, repo), (e) => e instanceof ListError && /2147483647/.test(e.message))
    assert.throws(() => validateList({ mutations: [mutation({ timeoutMs: 2 ** 31 })] }, repo), (e) => e instanceof ListError && /2147483647/.test(e.message))
    assert.equal(validateList({ timeoutMs: 2147483647, mutations: [mutation()] }, repo)[0].timeoutMs, 2147483647)
  })

  it('should keep a non-UTF-8 byte intact while the mutation runs, and replace literally (F18)', async () => {
    const { runMutations } = await importRunner()
    // The check passes only while the Latin-1 byte 0xE9 is intact and any MARK is followed by a literal "$&".
    const check = "import { readFileSync } from 'node:fs'\nconst b = readFileSync('latin1.txt')\nconst s = b.toString('latin1')\nprocess.exit(b.includes(0xe9) && (!s.includes('MARK') || s.includes('MARK$&')) ? 0 : 1)\n"
    const repo = makeRepo({ headFiles: { 'check-latin1.mjs': check } })
    const original = Buffer.from([0x63, 0x61, 0x66, 0xe9, 0x0a, 0x61, 0x61, 0x61, 0x0a])
    writeFileSync(path.join(repo, 'latin1.txt'), original)
    const out = await runMutations({ root: repo, mutations: [{ label: 'latin1', file: 'latin1.txt', find: 'aaa', replace: 'MARK$&', command: `${NODE} check-latin1.mjs` }] })
    assert.equal(out.results[0]?.status, 'SURVIVED', JSON.stringify(out))
    assert.ok(readFileSync(path.join(repo, 'latin1.txt')).equals(original), 'latin1.txt was not restored byte for byte')
  })

  it('should count matches without overlap, as before the byte matching (F18)', async () => {
    const { runMutations } = await importRunner()
    const repo = makeRepo({ headFiles: { 'triple.txt': 'aaa\n' } })
    const out = await runMutations({ root: repo, mutations: [{ label: 'aa', file: 'triple.txt', find: 'aa', replace: 'b', command: `${NODE} -e "process.exit(0)"` }] })
    assert.equal(out.results[0]?.status, 'SURVIVED', JSON.stringify(out))
  })
})

describe('mutation-runner re-audit fixes (ESP-108)', () => {
  it('should not overwrite a file changed during the run, and save its current and original bytes (R7)', async () => {
    const repo = fixtureRepo()
    const list = writeList({
      mutations: [
        mutation({ label: 'edited during run', find: '// keep zero positive', replace: '// MUTATED', command: `${NODE} rewrite.mjs` }),
        mutation({ label: 'never runs' }),
      ],
    })
    const r = await runRunner(repo, list)
    assert.equal(r.code, 3, r.stdout + r.stderr)
    assert.equal(readFileSync(path.join(repo, 'guard-lf.mjs'), 'utf8'), 'USER EDIT\n', 'the edit made during the run was overwritten')
    assert.match(r.stderr, /guard-lf\.mjs changed while its command ran/)
    const current = r.stderr.match(/current bytes are saved at (.+?)\. Its original/)?.[1]
    const original = r.stderr.match(/original bytes are saved at (.+?)\. Check it/)?.[1]
    assert.ok(current && original, r.stderr)
    assert.equal(readFileSync(current, 'utf8'), 'USER EDIT\n')
    // Each backup sits in its own private temp folder, so no one can plant a link at a guessable name.
    assert.notEqual(path.dirname(current), tmpdir())
    if (process.platform !== 'win32') assert.equal(statSync(current).mode & 0o777, 0o600)
    assert.equal(readFileSync(original, 'utf8'), GUARD_LF)
    assert.doesNotMatch(r.stdout, /never runs/)
  })

  it('should write the original back when the file was deleted during the run (R7)', async () => {
    const repo = fixtureRepo()
    const r = await runRunner(repo, writeList({ mutations: [mutation({ label: 'deleted', find: '// keep zero positive', replace: '// MUTATED', command: `${NODE} rewrite.mjs delete` })] }))
    assert.equal(r.code, 0, r.stdout + r.stderr)
    assert.equal(readFileSync(path.join(repo, 'guard-lf.mjs'), 'utf8'), GUARD_LF)
    assert.match(r.stderr, /guard-lf\.mjs was deleted while its command ran/)
  })

  it('should go on without a restore error when the file is back to its original bytes (R7)', async () => {
    const repo = fixtureRepo()
    const list = writeList({
      mutations: [
        mutation({ label: 'checked out', find: '// keep zero positive', replace: '// MUTATED', command: 'git checkout -- guard-lf.mjs' }),
        mutation({ label: 'runs next' }),
      ],
    })
    const r = await runRunner(repo, list)
    assert.equal(r.code, 0, r.stdout + r.stderr)
    assert.match(r.stdout, /CAUGHT\s+runs next/)
    assert.equal(readFileSync(path.join(repo, 'guard-lf.mjs'), 'utf8'), GUARD_LF)
  })

  it('should run a shared baseline with the largest timeoutMs of its entries, and give no exit code for a timeout (R9)', async () => {
    const repo = fixtureRepo()
    const slow = `${NODE} -e "setTimeout(() => {}, 1500)"`
    const both = writeList({
      mutations: [
        mutation({ label: 'slow suite', find: '// keep zero positive', replace: '// a', command: slow, timeoutMs: 60000 }),
        mutation({ label: 'may loop', find: '// keep zero positive', replace: '// b', command: slow, timeoutMs: 500 }),
      ],
    })
    const r = await runRunner(repo, both)
    assert.equal(r.code, 0, r.stdout + r.stderr)
    assert.match(r.stdout, /SURVIVED\s+slow suite/)
    // A timeout shorter than the unmutated run is certain, so it must not read as a catch.
    assert.match(r.stdout, /TIMEOUT\s+may loop[^\n]*the unmutated run took \d+ ms/)
    assert.doesNotMatch(r.stdout, /slow suite[^\n]*unmutated run took/)
    const short = await runRunner(repo, writeList({ mutations: [mutation({ command: slow, timeoutMs: 500 })] }))
    assert.equal(short.code, 1, short.stdout + short.stderr)
    assert.match(short.stderr, /baseline failed \(timeout\):/)
  })

  it('should accept a repo folder whose name starts with ".." (R15)', async () => {
    const repo = fixtureRepo()
    mkdirSync(path.join(repo, '..cache'))
    writeFileSync(path.join(repo, '..cache', 'b.txt'), 'b\n')
    const r = await runRunner(repo, writeList({ mutations: [mutation({ file: '..cache/b.txt', find: 'b', replace: 'c' })] }))
    assert.equal(r.code, 0, r.stdout + r.stderr)
    assert.match(r.stdout, /SURVIVED/)
    assert.equal(readFileSync(path.join(repo, '..cache', 'b.txt'), 'utf8'), 'b\n')
  })
})

describe('mutation-runner timeout detail (ESP-108 review)', () => {
  it('should mark a timeout within 1.5 times the unmutated run as maybe not a catch', async () => {
    const { timeoutDetail } = await importRunner()
    assert.match(timeoutDetail(1000, 700), /the unmutated run took 700 ms, so this may not be a catch/)
    assert.match(timeoutDetail(1000, 1200), /may not be a catch/)
    assert.equal(timeoutDetail(1000, 600), 'no result after 1000 ms')
  })
})
