#!/usr/bin/env node
// Targeted mutation runner for the mutation-test skill (spec R13–R15, D9). Built-ins only.
// Usage: node mutation-runner.mjs --list <mutations.json>
// Applies each mutation in turn, runs its test command and reports CAUGHT, SURVIVED, NOT-FOUND,
// TIMEOUT or ERROR. Every file is restored byte for byte after each mutation, on error and on
// interrupt, unless something else changed it while the command ran (then it is left alone and the
// run stops with exit 3). It never stages or commits anything.
// Exit codes: 0 run complete (survivors never block, D10), 1 baseline failed, 2 invalid list or repo,
// 3 restore failed or the file changed while its command ran (a file may be left mutated), 130 interrupted.
import { execFileSync, spawn } from 'node:child_process'
import { mkdtempSync, readFileSync, realpathSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { isMainModule } from '../../templates/github/scripts/main-module.mjs'

const DEFAULT_TIMEOUT_MS = 120000
// Node runs a timer with a longer delay after 1 ms, which would stop the command at once.
export const MAX_TIMEOUT_MS = 2147483647
const STDERR_TAIL = 2000
const KILL_GRACE_MS = 2000
const SIGNALS = ['SIGINT', 'SIGTERM', 'SIGHUP']

export class ListError extends Error {}
class RestoreError extends Error {}

const isText = (v) => typeof v === 'string' && v.length > 0
const isTimeout = (v) => v === undefined || (Number.isInteger(v) && v > 0 && v <= MAX_TIMEOUT_MS)

// Real path of the file, or of its folder when the file doesn't exist (reading it then reports ERROR).
const realPathOf = (resolved, where) => {
  for (const p of [resolved, path.dirname(resolved)]) {
    try {
      return path.join(realpathSync.native(p), p === resolved ? '' : path.basename(resolved))
    } catch (e) {
      if (e.code !== 'ENOENT') throw new ListError(`${where}: cannot resolve "file": ${e.message}`)
    }
  }
  return resolved
}

// Only relative paths that stay inside the repo root, also after symlinks and junctions are followed;
// the runner must never write outside the repo or into .git.
const checkFile = (file, root, where) => {
  if (!isText(file)) throw new ListError(`${where}: "file" must be a non-empty string`)
  if (path.isAbsolute(file) || /^[a-zA-Z]:/.test(file) || /^[\\/]/.test(file)) throw new ListError(`${where}: "file" must be relative to the repo root: ${file}`)
  const segments = file.split(/[\\/]/)
  const resolved = path.resolve(root, file)
  if (segments.includes('..') || resolved === path.resolve(root)) throw new ListError(`${where}: "file" must stay inside the repo root: ${file}`)
  const inGit = (parts) => parts.some((s) => s.toLowerCase() === '.git')
  if (inGit(segments)) throw new ListError(`${where}: "file" must not be inside .git: ${file}`)
  const rel = path.relative(realpathSync.native(root), realPathOf(resolved, where))
  if (rel === '' || rel === '..' || rel.startsWith(`..${path.sep}`) || path.isAbsolute(rel)) throw new ListError(`${where}: "file" must stay inside the repo root (it links outside): ${file}`)
  if (inGit(rel.split(path.sep))) throw new ListError(`${where}: "file" must not be inside .git (it links there): ${file}`)
  return resolved
}

/**
 * Validates a parsed mutation list ({ timeoutMs?, mutations: [...] }) and resolves each file under root.
 * Throws ListError naming the first problem.
 */
export const validateList = (list, root) => {
  if (!list || typeof list !== 'object' || !Array.isArray(list.mutations)) throw new ListError('mutation list must be an object with a "mutations" array')
  if (list.mutations.length === 0) throw new ListError('mutation list has no mutations')
  if (!isTimeout(list.timeoutMs)) throw new ListError(`mutation list "timeoutMs" must be a whole number from 1 to ${MAX_TIMEOUT_MS}`)
  return list.mutations.map((m, i) => {
    const where = `mutation list entry ${i + 1}`
    if (!m || typeof m !== 'object') throw new ListError(`${where} must be an object`)
    for (const key of ['label', 'find', 'command']) {
      if (!isText(m[key])) throw new ListError(`${where}: "${key}" must be a non-empty string`)
    }
    if (typeof m.replace !== 'string') throw new ListError(`${where}: "replace" must be a string`)
    if (!isTimeout(m.timeoutMs)) throw new ListError(`${where}: "timeoutMs" must be a whole number from 1 to ${MAX_TIMEOUT_MS}`)
    return { ...m, path: checkFile(m.file, root, where), timeoutMs: m.timeoutMs ?? list.timeoutMs ?? DEFAULT_TIMEOUT_MS }
  })
}

// Kills the shell and everything it started; killing only the shell would leave the test process running.
// Returns null once the tree is gone, or the reason it could not be killed.
const killTree = (child) => {
  try {
    if (process.platform === 'win32') execFileSync('taskkill', ['/pid', String(child.pid), '/T', '/F'], { stdio: 'pipe' })
    else process.kill(-child.pid, 'SIGKILL')
  } catch (e) {
    // Already gone: ESRCH on POSIX, taskkill exit 128 on Windows. Anything else is a failure.
    if (e.code === 'ESRCH' || e.status === 128) return null
    return e.message
  }
  return null
}

/**
 * How a finished command counts. An abort or a timeout wins over the exit code (the kill causes the exit);
 * a process killed by a signal it didn't ask for is an error, not a test failure.
 */
export const outcomeOf = ({ code, signal, ended, aborted }) => {
  if (aborted) return 'aborted'
  if (ended) return ended
  if (code === null && signal) return 'error'
  return code === 0 ? 'pass' : 'fail'
}

/**
 * Runs a shell command in root. Resolves { outcome: 'pass' | 'fail' | 'timeout' | 'aborted' | 'error', code, stderr },
 * plus `signal` when a signal ended the command and `startError` when it could not be started.
 * `kill` stops the process tree on a timeout or abort (tests inject a failing one).
 * The gate runner passes two more options (ESP-52): `args` runs `command` as a program with those arguments and no
 * shell, and `output` is a file descriptor that takes stdout and stderr, so `stderr` in the result stays empty.
 */
export const runCommand = (command, { root, timeoutMs, signal, kill = killTree, args = null, output = null }) => new Promise((resolve) => {
  if (signal?.aborted) return resolve({ outcome: 'aborted' })
  let stderr = ''
  let ended = null
  let grace = null
  const options = { cwd: root, detached: process.platform !== 'win32', stdio: output === null ? ['ignore', 'ignore', 'pipe'] : ['ignore', output, output], windowsHide: true }
  const child = args ? spawn(command, args, options) : spawn(command, { ...options, shell: true })
  child.stderr?.on('data', (d) => { stderr = (stderr + d).slice(-STDERR_TAIL) })
  const stop = (why) => {
    if (ended || child.exitCode !== null || child.signalCode !== null) return
    ended = why
    const failure = kill(child)
    if (!failure) return
    // taskkill also fails when part of the tree has already exited, so give the command a moment to close.
    // If it doesn't, stop waiting and let go of it so it can't hold this process open.
    grace = setTimeout(() => {
      child.stderr?.destroy()
      child.unref()
      finish({ outcome: 'error', stderr: `could not stop the command after ${why} (process ${child.pid} may still be running): ${failure}` })
    }, KILL_GRACE_MS)
  }
  const timer = setTimeout(() => stop('timeout'), timeoutMs)
  const onAbort = () => stop('aborted')
  signal?.addEventListener('abort', onAbort, { once: true })
  const finish = (result) => {
    clearTimeout(timer)
    clearTimeout(grace)
    signal?.removeEventListener('abort', onAbort)
    resolve(result)
  }
  // Nothing here sends the child a message or a signal through Node, so an error event means it never started.
  child.on('error', (e) => finish({ outcome: 'error', stderr: e.message, startError: e.message }))
  child.on('close', (code, sig) => finish({
    outcome: outcomeOf({ code, signal: sig, ended, aborted: signal?.aborted }),
    code,
    ...(sig ? { signal: sig } : {}),
    stderr: code === null && sig ? `killed by ${sig}` : stderr.trim(),
  }))
})

// Non-overlapping matches, counted on bytes so a file that isn't UTF-8 is never re-encoded.
const countMatches = (buf, find) => {
  let n = 0
  for (let i = buf.indexOf(find); i !== -1; i = buf.indexOf(find, i + find.length)) n++
  return n
}

// Saves bytes of the file to a temp copy and says where, for a RestoreError message. The copy goes in a
// new private folder (wx, 0600), so on a shared /tmp no one can plant a link at a guessable name or read it.
const saveCopy = (m, bytes, kind) => {
  try {
    const copy = path.join(mkdtempSync(path.join(tmpdir(), 'mutation-runner-')), `${kind}-${path.basename(m.path)}`)
    writeFileSync(copy, bytes, { flag: 'wx', mode: 0o600 })
    return ` Its ${kind} bytes are saved at ${copy}.`
  } catch (e) {
    return ` Saving its ${kind} bytes also failed: ${e.message}.`
  }
}

// Called when the original bytes can't be written back: keep a copy and say exactly what was left.
const restoreFailed = (m, original, e, step = 'restoring it') =>
  new RestoreError(`${m.file} was left mutated: ${step} failed (${e.message}).${saveCopy(m, original, 'original')} Check it with git diff -- ${m.file}.`)

// Writes the original bytes back, unless something else (an IDE autosave, another session) changed the
// file while the command ran: then the file is left as it is and both versions are saved (R7).
const restore = (m, original, mutated) => {
  let current = null
  try {
    current = readFileSync(m.path)
  } catch (e) {
    if (e.code !== 'ENOENT') throw restoreFailed(m, original, e, 'reading it before the restore')
    // A deleted file holds no edit to lose, so it is written back, with a notice.
    console.error(`mutation-runner: ${m.file} was deleted while its command ran; its original bytes were written back.`)
  }
  // A file already back to its original bytes holds no other edit, so it isn't reported.
  if (current && mutated && !current.equals(mutated) && !current.equals(original)) {
    throw new RestoreError(`${m.file} changed while its command ran, so it was not restored and the mutation may still be in it.${saveCopy(m, current, 'current')}${saveCopy(m, original, 'original')} Check it with git diff -- ${m.file}.`)
  }
  // shortcut: an edit landing between the read above and this write is still overwritten; add a lock if that window ever bites.
  try {
    writeFileSync(m.path, original)
  } catch (e) {
    throw restoreFailed(m, original, e)
  }
}

/**
 * The TIMEOUT detail. A timeout close to or below the unmutated run's time is likely slowness, not something
 * the mutation caused, so it is marked as maybe not a catch.
 */
export const timeoutDetail = (timeoutMs, baselineMs) =>
  `no result after ${timeoutMs} ms${baselineMs * 1.5 >= timeoutMs ? ` (the unmutated run took ${baselineMs} ms, so this may not be a catch: raise timeoutMs)` : ''}`

/**
 * Applies one mutation, runs its command and restores the file from the original bytes in `finally`.
 * Returns { label, file, status, detail }; throws RestoreError when the restore itself fails.
 */
const runOne = async (m, { root, signal, baselineMs }) => {
  const base = { label: m.label, file: m.file }
  let original
  try {
    original = readFileSync(m.path)
  } catch (e) {
    return { ...base, status: 'ERROR', detail: `cannot read file: ${e.message}` }
  }
  const find = Buffer.from(m.find)
  const matches = countMatches(original, find)
  if (matches !== 1) return { ...base, status: 'NOT-FOUND', detail: `${matches} matches (needs exactly 1)` }
  // Stays null until the mutated bytes are fully written, so a failed write is restored without the R7 check.
  let mutated = null
  try {
    const at = original.indexOf(find)
    const bytes = Buffer.concat([original.subarray(0, at), Buffer.from(m.replace), original.subarray(at + find.length)])
    writeFileSync(m.path, bytes)
    mutated = bytes
    const r = await runCommand(m.command, { root, timeoutMs: m.timeoutMs, signal })
    if (r.outcome === 'pass') return { ...base, status: 'SURVIVED', detail: 'tests passed with the mutation applied' }
    if (r.outcome === 'fail') return { ...base, status: 'CAUGHT', detail: `exit ${r.code}` }
    if (r.outcome === 'timeout') return { ...base, status: 'TIMEOUT', detail: timeoutDetail(m.timeoutMs, baselineMs) }
    if (r.outcome === 'aborted') return { ...base, status: 'ERROR', detail: 'interrupted' }
    return { ...base, status: 'ERROR', detail: r.stderr }
  } catch (e) {
    return { ...base, status: 'ERROR', detail: e.message }
  } finally {
    // Throws from finally on purpose: a RestoreError replaces the result, because the tree is no longer clean.
    restore(m, original, mutated)
  }
}

/**
 * Validates the mutations (throws ListError), runs the baseline (each distinct command once, unmutated),
 * then every mutation in order.
 * Returns { baselineFailure?, restoreFailure?, interrupted, results }. A failing baseline mutates nothing;
 * a failed restore stops the run.
 */
export const runMutations = async ({ root, mutations: input, signal }) => {
  const mutations = validateList({ mutations: input }, root)
  // Each distinct command runs once, with the largest timeoutMs of its entries (R9).
  const baselines = new Map()
  for (const m of mutations) baselines.set(m.command, Math.max(baselines.get(m.command) ?? 0, m.timeoutMs))
  const baselineMs = new Map()
  for (const [command, timeoutMs] of baselines) {
    const started = Date.now()
    const r = await runCommand(command, { root, timeoutMs, signal })
    baselineMs.set(command, Date.now() - started)
    if (r.outcome === 'aborted') return { interrupted: true, results: [] }
    if (r.outcome !== 'pass') return { baselineFailure: { command, ...r }, interrupted: false, results: [] }
  }
  const results = []
  for (const m of mutations) {
    if (signal?.aborted) return { interrupted: true, results }
    try {
      results.push(await runOne(m, { root, signal, baselineMs: baselineMs.get(m.command) }))
    } catch (e) {
      if (!(e instanceof RestoreError)) throw e
      return { restoreFailure: e.message, interrupted: Boolean(signal?.aborted), results }
    }
    if (signal?.aborted) return { interrupted: true, results }
  }
  return { interrupted: false, results }
}

/**
 * Turns SIGINT, SIGTERM and SIGHUP into an abort. The listeners stay for the whole run, so a second
 * Ctrl+C can't fall through to Node's default exit and skip the restore. Returns a function that removes them.
 * The gate runner uses it too (ESP-52), with a silent `notify`, to stop the running step.
 */
export const handleInterrupts = (controller, notify = (msg) => console.error(msg), target = process) => {
  const onSignal = () => {
    if (controller.signal.aborted) return
    notify('mutation-runner: interrupted, restoring files...')
    controller.abort()
  }
  for (const s of SIGNALS) target.on(s, onSignal)
  return () => { for (const s of SIGNALS) target.off(s, onSignal) }
}

const STATUSES = ['CAUGHT', 'SURVIVED', 'NOT-FOUND', 'TIMEOUT', 'ERROR']

const formatReport = ({ results, interrupted }) => {
  const lines = results.map((r) => `${r.status.padEnd(9)} ${r.label} (${r.file}): ${r.detail}`)
  const counts = STATUSES.map((s) => `${results.filter((r) => r.status === s).length} ${s}`).join(', ')
  lines.push(`${interrupted ? 'Interrupted after' : 'Ran'} ${results.length} mutation(s): ${counts}`)
  return lines.join('\n')
}

const readList = (argv, root) => {
  const i = argv.indexOf('--list')
  if (i === -1 || !argv[i + 1]) throw new ListError('usage: mutation-runner.mjs --list <mutations.json> (mutation list path missing)')
  let raw
  try {
    raw = readFileSync(argv[i + 1], 'utf8')
  } catch (e) {
    throw new ListError(`cannot read mutation list ${argv[i + 1]}: ${e.message}`)
  }
  let parsed
  try {
    parsed = JSON.parse(raw)
  } catch (e) {
    throw new ListError(`mutation list ${argv[i + 1]} is not valid JSON: ${e.message}`)
  }
  return validateList(parsed, root)
}

const main = async () => {
  let root
  try {
    root = execFileSync('git', ['rev-parse', '--show-toplevel'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim()
  } catch (e) {
    console.error(`mutation-runner: not inside a git repository: ${(e.stderr || e.message).toString().trim()}`)
    return 2
  }
  let mutations
  try {
    mutations = readList(process.argv.slice(2), root)
  } catch (e) {
    if (!(e instanceof ListError)) throw e
    console.error(`mutation-runner: ${e.message}`)
    return 2
  }
  // Every command runs through the shell; show them all before any runs.
  const commands = [...new Set(mutations.map((m) => m.command))]
  console.error(`Commands to run (from ${root}, through the shell):\n${commands.map((c) => `  ${c}`).join('\n')}`)
  const controller = new AbortController()
  const removeHandlers = handleInterrupts(controller)
  try {
    const outcome = await runMutations({ root, mutations, signal: controller.signal })
    if (outcome.baselineFailure) {
      const f = outcome.baselineFailure
      console.error(`mutation-runner: baseline failed (${f.outcome}${f.code == null || f.outcome === 'timeout' ? '' : `, exit ${f.code}`}): ${f.command}${f.stderr ? `\n${f.stderr}` : ''}`)
      console.error('No mutation was applied. Fix the tests so they pass unmutated, then run again.')
      return 1
    }
    console.log(formatReport(outcome))
    if (outcome.restoreFailure) {
      console.error(`mutation-runner: ${outcome.restoreFailure} The run stopped there.`)
      return 3
    }
    return outcome.interrupted ? 130 : 0
  } finally {
    removeHandlers()
  }
}

if (isMainModule(import.meta.url)) {
  main().then((code) => { process.exitCode = code }, (e) => {
    console.error(`mutation-runner: ${e.stack || e.message}`)
    process.exitCode = 2
  })
}
