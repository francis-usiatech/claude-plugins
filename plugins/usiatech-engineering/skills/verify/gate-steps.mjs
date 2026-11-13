// Runs the gate's steps for gate.mjs: one command at a time, each with its own log file, its summary line and its
// expectNoDiff check. Kept apart from gate.mjs, which runs whenever it is loaded, so tests can drive a run directly
// (for example with an interrupt that has already landed). Node built-ins only.
import { execFileSync } from 'node:child_process'
import { readFileSync, openSync, closeSync, writeSync, fstatSync, readSync } from 'node:fs'
import { createHash } from 'node:crypto'
import path from 'node:path'
import { runCommand } from '../mutation-test/mutation-runner.mjs'
import { hasControlChar } from '../../templates/github/scripts/governance-rules.mjs'

const TAIL_LINES = 40
// A failing step's output is read only this far back, so a huge log isn't read into memory.
const TAIL_BYTES = 65536

// A file name or an argument can hold a line break, and a summary line is one line. JSON.stringify isn't enough: it
// leaves U+2028, U+2029, NEL and DEL as they are.
export const printable = (text) => [...text].map((c) => (hasControlChar(c) ? `\\u{${c.codePointAt(0).toString(16)}}` : c)).join('')

// The lines of a step's log, or only those in its last `maxBytes`, so a huge log isn't read into memory.
const readTail = (file, maxBytes = Infinity) => {
  const fd = openSync(file, 'r')
  try {
    const size = fstatSync(fd).size
    const from = Math.max(0, size - maxBytes)
    if (size <= from) return []
    const buf = Buffer.alloc(size - from)
    readSync(fd, buf, 0, size - from, from)
    return buf.toString('utf8').split(/\r?\n/).filter((l) => l !== '')
  } finally {
    closeSync(fd)
  }
}

// How a finished command reads in its summary line.
export const resultOf = (r, timeoutMs) => {
  // ESP-58: the tree was stopped only in part, and a process left behind can hold a port or a file the next run needs.
  const left = r.leftRunning ? `, part of the process tree may still be running (${r.leftRunning.replace(/\s+/g, ' ').trim()})` : ''
  if (r.startError) return `could not start: ${r.startError}`
  if (r.outcome === 'timeout') return `timed out after ${timeoutMs} ms${left}`
  if (r.outcome === 'aborted') return `interrupted${left}`
  if (r.signal) return `killed by ${r.signal}`
  // What is left of 'error': the process tree could not be stopped, and the reason names its process id.
  // It holds taskkill's own output, line breaks included, and a summary line is one line.
  if (r.outcome === 'error') return r.stderr.replace(/\s+/g, ' ').trim()
  return `exit ${r.code}`
}

/**
 * Runs one command with its output appended to the log: a shell command, or a program without a shell when `args`
 * is given. It is stopped, with every process it started, at `timeoutMs` or when `signal` aborts.
 * @returns {Promise<{ ok: boolean, result: string, seconds: number, output: () => string[] }>}
 */
export const runStep = async (log, name, command, { args = null, cwd, timeoutMs, signal }) => {
  log.steps += 1
  const stepName = `step-${String(log.steps).padStart(2, '0')}.log`
  const stepFile = path.join(log.dir, stepName)
  writeSync(log.fd, `\n=== ${name}: ${[command, ...(args ?? [])].join(' ')} (output in ${stepName})\n`)
  const stepFd = openSync(stepFile, 'wx', 0o600)
  const started = Date.now()
  let r
  try {
    r = await runCommand(command, { root: cwd, args, timeoutMs, signal, output: stepFd })
  } finally {
    closeSync(stepFd)
  }
  const seconds = Math.round((Date.now() - started) / 1000)
  const result = resultOf(r, timeoutMs)
  writeSync(log.fd, `=== ${name}: ${result}\n`)
  return { ok: r.outcome === 'pass', result, seconds, output: (maxBytes) => readTail(stepFile, maxBytes) }
}

// ESP-54: the files under a step's `expectNoDiff` paths that differ from the index, the same rule as the CI gate's
// `git diff --quiet -- <paths>`. A step that regenerates a committed file and finds it out of date fails here.
const changedUnder = (root, paths) => execFileSync('git', ['-c', 'core.quotePath=false', 'diff', '--name-only', '-z', '--', ...paths], { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], maxBuffer: 64 * 1024 * 1024 })
  .split('\0').filter(Boolean)

// The content hash of a file in the working tree, or null when it is gone.
const fileHash = (root, file) => {
  try {
    return createHash('sha256').update(readFileSync(path.join(root, file))).digest('hex')
  } catch (e) {
    if (e.code === 'ENOENT') return null
    throw e
  }
}

// The listed files that already differ from the index before the step runs, with their content hashes, so the step is
// blamed only for what it changed itself (code review 2026-11-09). A failure is kept, and fails the step afterwards.
const snapshotNoDiff = (root, paths) => {
  if (!paths.length) return { files: new Map() }
  try {
    return { files: new Map(changedUnder(root, paths).map((f) => [f, fileHash(root, f)])) }
  } catch (e) {
    return { error: e }
  }
}

// A passing step's result with its expectNoDiff check applied; a git failure fails the step rather than pass it.
const checkNoDiff = (root, s, step, before) => {
  if (!step.ok || !s.expectNoDiff.length) return step
  let changed
  try {
    if (before.error) throw before.error
    changed = changedUnder(root, s.expectNoDiff).filter((f) => !before.files.has(f) || before.files.get(f) !== fileHash(root, f))
  } catch (e) {
    return { ...step, ok: false, result: `${step.result}, but git could not check its expectNoDiff paths (${(e.stderr || e.message).replace(/\s+/g, ' ').trim()})` }
  }
  if (!changed.length) return step
  return { ...step, ok: false, result: `${step.result}, but it changed ${changed.map(printable).join(', ')}, listed in expectNoDiff` }
}

export const stepLine = (ok, name, step) => `${ok ? 'PASS' : 'FAIL'}  ${name} (${step.result}, ${step.seconds} s)`

// The UTC time a step passed, as the gate prints its run time.
export const utcNow = () => new Date().toISOString().replace(/\.\d+Z$/, 'Z')

// How the run record names a step (ESP-162): its name and command, so an edited command is never reused.
const stepKey = (s) => `${s.name}\u0000${s.run}`

/**
 * Runs the selected steps in the order given. A step in `earlier` (step key → UTC time, from the run record at the
 * same tree) isn't run again: it is shown as `PASSED EARLIER` with that time (ESP-162).
 * @returns {Promise<{ failed: boolean, lines: string[], passed: Record<string, string> }>} passed holds every step key
 *   that passed in this run or earlier, with its time, for the next run record
 */
export const runSelected = async (root, steps, log, signal, earlier = {}) => {
  const lines = []
  const passed = {}
  let failed = false
  for (const s of steps) {
    if (s.skipped) { lines.push(`SKIPPED  ${s.name} (${s.skipped})`); continue }
    // An interrupt that lands between two steps stops the gate before the next one starts (ESP-58).
    if (failed || signal?.aborted) { lines.push(`NOT RUN  ${s.name}`); failed = true; continue }
    const at = Object.hasOwn(earlier, stepKey(s)) ? earlier[stepKey(s)] : null
    if (at) {
      lines.push(`PASSED EARLIER  ${s.name} (${at})`)
      passed[stepKey(s)] = at
      continue
    }
    const before = snapshotNoDiff(root, s.expectNoDiff)
    const step = checkNoDiff(root, s, await runStep(log, s.name, s.run, { cwd: root, timeoutMs: s.timeoutMs, signal }), before)
    lines.push(stepLine(step.ok, s.name, step))
    if (step.ok) passed[stepKey(s)] = utcNow()
    else {
      failed = true
      lines.push(`--- last ${TAIL_LINES} lines of "${s.name}"`, ...step.output(TAIL_BYTES).slice(-TAIL_LINES), '---')
    }
  }
  return { failed, lines, passed }
}
