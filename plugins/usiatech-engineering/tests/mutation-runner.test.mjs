import { describe, it, after } from 'node:test'
import assert from 'node:assert/strict'
import { execFile } from 'node:child_process'
import { EventEmitter } from 'node:events'
import { chmodSync, existsSync, readFileSync, symlinkSync, writeFileSync } from 'node:fs'
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

const NODE = `"${process.execPath}"`
const CMD = `${NODE} check.mjs`

const fixtureRepo = () => makeRepo({ headFiles: { 'guard-lf.mjs': GUARD_LF, 'guard-crlf.mjs': GUARD_CRLF, 'check.mjs': CHECK, 'lock.mjs': LOCK } })
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
