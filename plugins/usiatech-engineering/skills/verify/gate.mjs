#!/usr/bin/env node
// Runs the repo's verification gate for the local `verify` skill (ESP-44): the `verify` steps of
// .claude/engineering.json, the `verifyConditional` steps whose `when` prefixes match a changed file, then the
// fake-pass check. Prints one line per step with its real exit code and ends with `Gate: PASS` or `Gate: FAIL`.
// Each step's full output goes to a log file in a private folder under the OS temp folder, so nothing has to be
// piped or filtered.
// A step that runs past its timeout is stopped with every process it started and fails the gate (ESP-52): its own
// `timeoutMs` from the config, or 10 minutes.
// Exits 0 when the gate passed, 1 when a step or the fake-pass check failed, and 2 when the gate could not start or
// finish (no usable config, git can't list the changed files, the log can't be written): a gate that ran nothing
// fails closed rather than pass.
// This file is an entry point only and runs whenever it is loaded. It has no "am I the main module" check, because
// that check fails without a word when the plugin is reached through a link.
import { execFileSync } from 'node:child_process'
import { readFileSync, existsSync, mkdtempSync, openSync, closeSync, writeSync, fstatSync, readSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { runCommand, handleInterrupts } from '../mutation-test/mutation-runner.mjs'
import { hasControlChar, isPathPrefix } from '../../templates/github/scripts/governance-rules.mjs'

const FAKE_PASS_SCRIPT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../templates/github/scripts/fake-pass-check.mjs')
const FAKE_PASS_NAME = 'fake-pass check'
const TAIL_LINES = 40
const DEFAULT_STEP_TIMEOUT_MS = 600000
// Node runs a timer with a longer delay after 1 ms, which would stop the step at once.
const MAX_STEP_TIMEOUT_MS = 2147483647

const isPlainObject = (v) => v !== null && typeof v === 'object' && !Array.isArray(v)
const isText = (v) => typeof v === 'string' && v.trim() !== ''

// The two helpers below repeat what templates/github/scripts/fake-pass-check.mjs does. That file is a CI template
// repos copy, and it keeps these two to itself, so the list is rebuilt here rather than imported.
// -z keeps non-ASCII and unusual paths unquoted.
const gitList = (cwd, args) => execFileSync('git', [...args, '-z'], { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], maxBuffer: 64 * 1024 * 1024 })
  .split('\0').filter(Boolean)

// The files `verify` treats as changed: the diff against HEAD plus untracked files, relative to the repo root.
// A rename is listed as its old and its new path, so a file moved out of a folder still counts as a change there.
const changedFiles = (root) => [...gitList(root, ['diff', '--name-only', '--no-renames', 'HEAD']), ...gitList(root, ['ls-files', '--others', '--exclude-standard'])]

const checkSteps = (steps, key, needsWhen) => {
  if (!Array.isArray(steps)) throw new Error(`.claude/engineering.json "${key}" is not a list.`)
  for (const s of steps) {
    if (!isPlainObject(s) || !isText(s.name) || !isText(s.run)) throw new Error(`.claude/engineering.json "${key}": every step needs a "name" and "run" string.`)
    if (hasControlChar(s.name) || s.name.trim() === FAKE_PASS_NAME) throw new Error(`.claude/engineering.json "${key}": a step "name" can't hold control characters or be "${FAKE_PASS_NAME}".`)
    // cmd.exe runs only the first line of a command, so a second line would pass without running.
    if (hasControlChar(s.run)) throw new Error(`.claude/engineering.json "${key}": the "run" of step "${s.name}" can't hold line breaks or other control characters. Use one command per step.`)
    if (s.timeoutMs !== undefined && !(Number.isInteger(s.timeoutMs) && s.timeoutMs >= 1 && s.timeoutMs <= MAX_STEP_TIMEOUT_MS)) {
      throw new Error(`.claude/engineering.json "${key}": the "timeoutMs" of step "${s.name}" must be a whole number of milliseconds from 1 to ${MAX_STEP_TIMEOUT_MS}.`)
    }
    if (needsWhen && !(Array.isArray(s.when) && s.when.length && s.when.every(isPathPrefix))) {
      throw new Error(`.claude/engineering.json "${key}": step "${s.name}" needs a "when" list of path prefixes, relative to the repo root with forward slashes (for example "src/").`)
    }
  }
  // Only the keys the runner reads are kept, so no other key in the config can pass for the runner's own `skipped`.
  return steps.map(({ name, run, when, timeoutMs = DEFAULT_STEP_TIMEOUT_MS }) => (needsWhen ? { name, run, when, timeoutMs } : { name, run, timeoutMs }))
}

/**
 * The steps for this repo, in order; throws on a config the gate can't be built from.
 * @returns {{ name: string, run: string, timeoutMs: number, skipped?: string }[]} skipped holds the reason a conditional step isn't run
 */
const loadSteps = (root) => {
  const configPath = path.join(root, '.claude/engineering.json')
  if (!existsSync(configPath)) throw new Error('.claude/engineering.json was not found, so there are no gate steps to run.')
  let cfg
  try {
    cfg = JSON.parse(readFileSync(configPath, 'utf8'))
  } catch (e) {
    throw new Error(`.claude/engineering.json could not be parsed: ${e.message}`)
  }
  if (!isPlainObject(cfg)) throw new Error('.claude/engineering.json is not a JSON object.')
  const always = checkSteps(cfg.verify ?? null, 'verify', false)
  if (!always.length) throw new Error('.claude/engineering.json "verify" is empty, so there are no gate steps to run.')
  const conditional = checkSteps(cfg.verifyConditional ?? [], 'verifyConditional', true)
  // Listed even with no conditional step: the fake-pass check needs the same list, so a repo git can't diff stops here.
  let changed
  try {
    changed = changedFiles(root)
  } catch (e) {
    throw new Error(`git could not list the changed files (${(e.stderr || e.message).trim()}).`)
  }
  // The match is exact, as in the CI gate: case matters.
  const matches = (s) => s.when.some((prefix) => changed.some((file) => file.startsWith(prefix)))
  return [...always, ...conditional.map((s) => (matches(s) ? s : { ...s, skipped: `no changed file under ${s.when.join(', ')}` }))]
}

// A new folder only this user can read, and a log no one else could have put there: step output can hold secrets.
const openLog = () => {
  const file = path.join(mkdtempSync(path.join(tmpdir(), 'usiatech-gate-')), 'gate.log')
  return { file, fd: openSync(file, 'wx+', 0o600) }
}

// The lines of output the log gained between two offsets.
const outputBetween = (fd, from, to) => {
  if (to <= from) return []
  const buf = Buffer.alloc(to - from)
  readSync(fd, buf, 0, to - from, from)
  return buf.toString('utf8').split(/\r?\n/).filter((l) => l !== '')
}

// How a finished command reads in its summary line.
const resultOf = (r, timeoutMs) => {
  if (r.startError) return `could not start: ${r.startError}`
  if (r.outcome === 'timeout') return `timed out after ${timeoutMs} ms`
  if (r.outcome === 'aborted') return 'interrupted'
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
const runStep = async (log, name, command, { args = null, cwd, timeoutMs, signal }) => {
  writeSync(log.fd, `\n=== ${name}: ${[command, ...(args ?? [])].join(' ')}\n`)
  const from = fstatSync(log.fd).size
  const started = Date.now()
  const r = await runCommand(command, { root: cwd, args, timeoutMs, signal, output: log.fd })
  const seconds = Math.round((Date.now() - started) / 1000)
  const to = fstatSync(log.fd).size
  const result = resultOf(r, timeoutMs)
  writeSync(log.fd, `=== ${name}: ${result}\n`)
  return { ok: r.outcome === 'pass', result, seconds, output: () => outputBetween(log.fd, from, to) }
}

const stepLine = (ok, name, step) => `${ok ? 'PASS' : 'FAIL'}  ${name} (${step.result}, ${step.seconds} s)`

// Runs the selected steps and then the fake-pass check; returns the summary lines and whether anything failed.
const runSteps = async (root, steps, log, signal) => {
  const lines = []
  let failed = false
  for (const s of steps) {
    if (s.skipped) { lines.push(`SKIPPED  ${s.name} (${s.skipped})`); continue }
    if (failed) { lines.push(`NOT RUN  ${s.name}`); continue }
    const step = await runStep(log, s.name, s.run, { cwd: root, timeoutMs: s.timeoutMs, signal })
    lines.push(stepLine(step.ok, s.name, step))
    if (!step.ok) {
      failed = true
      lines.push(`--- last ${TAIL_LINES} lines of "${s.name}"`, ...step.output().slice(-TAIL_LINES), '---')
    }
  }
  if (failed) return { failed, lines: [...lines, `NOT RUN  ${FAKE_PASS_NAME}`] }
  // The check prints every finding, warnings and suppressed ones included; `verify` reports them all, so none is cut.
  const check = await runStep(log, FAKE_PASS_NAME, process.execPath, { args: [FAKE_PASS_SCRIPT], cwd: root, timeoutMs: DEFAULT_STEP_TIMEOUT_MS, signal })
  return { failed: !check.ok, lines: [...lines, stepLine(check.ok, FAKE_PASS_NAME, check), ...check.output()] }
}

/**
 * Runs the gate for the repo that contains cwd, from its root.
 * @returns {Promise<{ exitCode: number, lines: string[] }>}
 */
const runGate = async (cwd) => {
  const cannotStart = (reason) => ({ exitCode: 2, lines: [`The gate could not start: ${reason}`, 'Gate: FAIL'] })
  let root, steps, log
  try {
    root = execFileSync('git', ['rev-parse', '--show-toplevel'], { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim()
  } catch (e) {
    return cannotStart(`git could not find a repository here (${(e.stderr || e.message).trim()}).`)
  }
  try {
    steps = loadSteps(root)
  } catch (e) {
    return cannotStart(e.message)
  }
  try {
    log = openLog()
  } catch (e) {
    return cannotStart(`the log file could not be created (${e.message}).`)
  }
  // A step runs in its own process group on POSIX, so Ctrl+C doesn't reach it: an interrupt stops the running step
  // here, and the gate then fails like on any other failed step.
  const interrupt = new AbortController()
  const removeHandlers = handleInterrupts(interrupt, () => {})
  try {
    const { failed, lines } = await runSteps(root, steps, log, interrupt.signal)
    return { exitCode: failed ? 1 : 0, lines: [...lines, `Log: ${log.file}`, `Gate run: ${new Date().toISOString().replace(/\.\d+Z$/, 'Z')}`, `Gate: ${failed ? 'FAIL' : 'PASS'}`] }
  } finally {
    removeHandlers()
    closeSync(log.fd)
  }
}

// Anything unexpected, such as a log write that fails part-way, is a gate that did not finish: never a pass.
try {
  const { exitCode, lines } = await runGate(process.cwd())
  for (const l of lines) console.log(l)
  process.exitCode = exitCode
} catch (e) {
  console.log(`The gate could not finish: ${e.message}`)
  console.log('Gate: FAIL')
  process.exitCode = 2
}
