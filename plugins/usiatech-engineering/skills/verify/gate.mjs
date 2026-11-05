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
// With --iterate (ESP-69) it runs only the `verifyIterate` steps whose `when` prefixes match a changed file, lists the
// changed files no step covers, and skips the fake-pass check. That is a partial run, never the done gate: it writes
// no `Gate:` verdict, and its last line says it is partial.
// This file is an entry point only and runs whenever it is loaded. It has no "am I the main module" check, because
// that check fails without a word when the plugin is reached through a link.
import { execFileSync } from 'node:child_process'
import { readFileSync, existsSync, mkdtempSync, openSync, closeSync, writeSync, fstatSync, readSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { runCommand, handleInterrupts, MAX_TIMEOUT_MS as MAX_STEP_TIMEOUT_MS } from '../mutation-test/mutation-runner.mjs'
import { hasControlChar, isPathPrefix } from '../../templates/github/scripts/governance-rules.mjs'
import { isPlainObject, isNonEmptyString } from '../../templates/github/scripts/workflow-rules.mjs'

const FAKE_PASS_SCRIPT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../templates/github/scripts/fake-pass-check.mjs')
const FAKE_PASS_NAME = 'fake-pass check'
const TAIL_LINES = 40
// A failing step's output is read only this far back, so a huge log isn't read into memory.
const TAIL_BYTES = 65536
const DEFAULT_STEP_TIMEOUT_MS = 600000

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
    if (!isPlainObject(s) || !isNonEmptyString(s.name) || !isNonEmptyString(s.run)) throw new Error(`.claude/engineering.json "${key}": every step needs a "name" and "run" string.`)
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

const readConfig = (root) => {
  const configPath = path.join(root, '.claude/engineering.json')
  if (!existsSync(configPath)) throw new Error('.claude/engineering.json was not found, so there are no gate steps to run.')
  let cfg
  try {
    cfg = JSON.parse(readFileSync(configPath, 'utf8'))
  } catch (e) {
    throw new Error(`.claude/engineering.json could not be parsed: ${e.message}`)
  }
  if (!isPlainObject(cfg)) throw new Error('.claude/engineering.json is not a JSON object.')
  return cfg
}

const listChanged = (root) => {
  try {
    return changedFiles(root)
  } catch (e) {
    throw new Error(`git could not list the changed files (${(e.stderr || e.message).trim()}).`)
  }
}

// The match is exact, as in the CI gate: case matters.
const covers = (step, file) => step.when.some((prefix) => file.startsWith(prefix))
const selectByChanged = (steps, changed) => steps.map((s) => (changed.some((file) => covers(s, file)) ? s : { ...s, skipped: `no changed file under ${s.when.join(', ')}` }))

/**
 * The steps for this repo, in order; throws on a config the gate can't be built from.
 * @returns {{ steps: { name: string, run: string, timeoutMs: number, skipped?: string }[], notes: string[] }} skipped holds the reason a conditional step isn't run
 */
const loadGate = (root) => {
  const cfg = readConfig(root)
  const always = checkSteps(cfg.verify ?? null, 'verify', false)
  if (!always.length) throw new Error('.claude/engineering.json "verify" is empty, so there are no gate steps to run.')
  const conditional = checkSteps(cfg.verifyConditional ?? [], 'verifyConditional', true)
  // Listed even with no conditional step: the fake-pass check needs the same list, so a repo git can't diff stops here.
  return { steps: [...always, ...selectByChanged(conditional, listChanged(root))], notes: [] }
}

// A file name or an argument can hold a line break, and a summary line is one line. JSON.stringify isn't enough: it
// leaves U+2028, U+2029, NEL and DEL as they are.
const printable = (text) => [...text].map((c) => (hasControlChar(c) ? `\\u{${c.codePointAt(0).toString(16)}}` : c)).join('')

// The same shape as loadGate, for an --iterate run: `verify` isn't read, so only a bad map or config stops the run.
const loadIterate = (root) => {
  const mapped = checkSteps(readConfig(root).verifyIterate ?? [], 'verifyIterate', true)
  const changed = listChanged(root)
  const steps = selectByChanged(mapped, changed)
  const notes = changed.filter((file) => !mapped.some((s) => covers(s, file))).map((file) => `NOT COVERED  ${printable(file)}`)
  if (!changed.length) notes.push('No changed files, so there is nothing to run.')
  else if (steps.every((s) => s.skipped)) notes.push('No verifyIterate step matches a changed file, so there is nothing to run.')
  return { steps, notes }
}

// A new folder only this user can read, and a log no one else could have put there: step output can hold secrets.
const openLog = () => {
  const file = path.join(mkdtempSync(path.join(tmpdir(), 'usiatech-gate-')), 'gate.log')
  return { file, fd: openSync(file, 'wx+', 0o600) }
}

// The lines of output the log gained between two offsets, or only its last `maxBytes`.
const outputBetween = (fd, start, to, maxBytes = Infinity) => {
  const from = Math.max(start, to - maxBytes)
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
  return { ok: r.outcome === 'pass', result, seconds, output: (maxBytes) => outputBetween(log.fd, from, to, maxBytes) }
}

const stepLine = (ok, name, step) => `${ok ? 'PASS' : 'FAIL'}  ${name} (${step.result}, ${step.seconds} s)`

// Runs the selected steps; returns the summary lines and whether anything failed.
const runSelected = async (root, steps, log, signal) => {
  const lines = []
  let failed = false
  for (const s of steps) {
    if (s.skipped) { lines.push(`SKIPPED  ${s.name} (${s.skipped})`); continue }
    if (failed) { lines.push(`NOT RUN  ${s.name}`); continue }
    const step = await runStep(log, s.name, s.run, { cwd: root, timeoutMs: s.timeoutMs, signal })
    lines.push(stepLine(step.ok, s.name, step))
    if (!step.ok) {
      failed = true
      lines.push(`--- last ${TAIL_LINES} lines of "${s.name}"`, ...step.output(TAIL_BYTES).slice(-TAIL_LINES), '---')
    }
  }
  return { failed, lines }
}

// Runs the selected steps and then the fake-pass check; returns the summary lines and whether anything failed.
const runSteps = async (root, steps, log, signal) => {
  const { failed, lines } = await runSelected(root, steps, log, signal)
  if (failed) return { failed, lines: [...lines, `NOT RUN  ${FAKE_PASS_NAME}`] }
  // The check prints every finding, warnings and suppressed ones included; `verify` reports them all, so none is cut.
  const check = await runStep(log, FAKE_PASS_NAME, process.execPath, { args: [FAKE_PASS_SCRIPT], cwd: root, timeoutMs: DEFAULT_STEP_TIMEOUT_MS, signal })
  return { failed: !check.ok, lines: [...lines, stepLine(check.ok, FAKE_PASS_NAME, check), ...check.output()] }
}

// The two ways to run. `stamp` adds the run time that `verify` copies into evidence, which a partial run never gives.
const FULL = { label: 'The gate', load: loadGate, run: runSteps, stamp: true, verdict: (failed) => `Gate: ${failed ? 'FAIL' : 'PASS'}` }
const ITERATE = { label: 'The partial run', load: loadIterate, run: runSelected, stamp: false, verdict: (failed) => `Partial run: ${failed ? 'FAIL' : 'PASS'}. This is not the done gate.` }

/**
 * Runs the gate, or the partial run, for the repo that contains cwd, from its root.
 * @returns {Promise<{ exitCode: number, lines: string[] }>}
 */
const runGate = async (cwd, mode) => {
  const cannotStart = (reason) => ({ exitCode: 2, lines: [`${mode.label} could not start: ${reason}`, mode.verdict(true)] })
  let root, loaded, log
  try {
    root = execFileSync('git', ['rev-parse', '--show-toplevel'], { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim()
  } catch (e) {
    return cannotStart(`git could not find a repository here (${(e.stderr || e.message).trim()}).`)
  }
  try {
    loaded = mode.load(root)
  } catch (e) {
    return cannotStart(e.message)
  }
  const { steps, notes } = loaded
  // Only a partial run gets here: the full gate refuses an empty `verify` list. No step means no log to write, and
  // no PASS: nothing was checked.
  if (steps.every((s) => s.skipped)) {
    return { exitCode: 0, lines: [...notes, ...steps.map((s) => `SKIPPED  ${s.name} (${s.skipped})`), 'Partial run: nothing ran. This is not the done gate.'] }
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
    const { failed, lines } = await mode.run(root, steps, log, interrupt.signal)
    const stamp = mode.stamp ? [`Gate run: ${new Date().toISOString().replace(/\.\d+Z$/, 'Z')}`] : []
    return { exitCode: failed ? 1 : 0, lines: [...notes, ...lines, `Log: ${log.file}`, ...stamp, mode.verdict(failed)] }
  } finally {
    removeHandlers()
    closeSync(log.fd)
  }
}

const args = process.argv.slice(2)
const mode = args.length === 0 ? FULL : (args.length === 1 && args[0] === '--iterate' ? ITERATE : null)
if (!mode) {
  // A misspelt flag must not run the slow full gate, or pass for a partial run.
  console.log(`The gate could not start: the only argument it takes is --iterate, not ${args.map((a) => `"${printable(a)}"`).join(' ')}.`)
  console.log(FULL.verdict(true))
  process.exitCode = 2
} else {
  // Anything unexpected, such as a log write that fails part-way, is a run that did not finish: never a pass.
  try {
    const { exitCode, lines } = await runGate(process.cwd(), mode)
    for (const l of lines) console.log(l)
    process.exitCode = exitCode
  } catch (e) {
    console.log(`${mode.label} could not finish: ${e.message}`)
    console.log(mode.verdict(true))
    process.exitCode = 2
  }
}
