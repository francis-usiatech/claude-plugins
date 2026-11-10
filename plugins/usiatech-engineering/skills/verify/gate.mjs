#!/usr/bin/env node
// Runs the repo's verification gate for the local `verify` skill (ESP-44): the `verify` steps of
// .claude/engineering.json, the `verifyConditional` steps whose `when` prefixes match a changed file, then the
// fake-pass check. Prints one line per step with its real exit code and ends with `Gate: PASS` or `Gate: FAIL`.
// Each step's full output goes to a log file of its own in a private folder under the OS temp folder, so nothing has
// to be piped or filtered; gate.log there lists each command and its result. Folders older than 7 days are removed.
// A step that runs past its timeout is stopped with every process it started and fails the gate (ESP-52): its own
// `timeoutMs` from the config, or 10 minutes.
// Exits 0 when the gate passed, 1 when a step or the fake-pass check failed, and 2 when the gate could not start or
// finish (no usable config, git can't list the changed files, the log can't be written): a gate that ran nothing
// fails closed rather than pass. An interrupted run exits 130 (ESP-58); a step it stopped before it started shows
// `NOT RUN`.
// With --check it loads the full gate (config, steps, base) and runs nothing: exit 0 when the gate can start, else 2.
// With --iterate (ESP-69) it runs only the `verifyIterate` steps whose `when` prefixes match a changed file, lists the
// changed files no step covers, and skips the fake-pass check. That is a partial run, never the done gate: it writes
// no `Gate:` verdict, and its last line says it is partial.
// This file is an entry point only and runs whenever it is loaded. It has no "am I the main module" check, because
// that check fails without a word when the plugin is reached through a link.
import { execFileSync } from 'node:child_process'
import { readFileSync, existsSync, mkdtempSync, openSync, closeSync, readdirSync, lstatSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { handleInterrupts, MAX_TIMEOUT_MS as MAX_STEP_TIMEOUT_MS } from '../mutation-test/mutation-runner.mjs'
import { printable, runStep, stepLine, runSelected } from './gate-steps.mjs'
import { hasControlChar, isPathPrefix } from '../../templates/github/scripts/governance-rules.mjs'
import { isPlainObject, isNonEmptyString } from '../../templates/github/scripts/workflow-rules.mjs'
import { editDistance } from '../../templates/github/scripts/supply-chain-rules.mjs'

const FAKE_PASS_SCRIPT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../templates/github/scripts/fake-pass-check.mjs')
const FAKE_PASS_NAME = 'fake-pass check'
const DEFAULT_STEP_TIMEOUT_MS = 600000
const STEP_LIST_KEYS = ['verify', 'verifyConditional', 'verifyIterate']
// A key this many edits from a step-list key (case aside) is taken as a misspelling of it.
const NEAR_MISS_EDITS = 2

// The two helpers below repeat what templates/github/scripts/fake-pass-check.mjs does. That file is a CI template
// repos copy, and it keeps these two to itself, so the list is rebuilt here rather than imported.
// -z keeps non-ASCII and unusual paths unquoted.
const gitList = (cwd, args) => execFileSync('git', [...args, '-z'], { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], maxBuffer: 64 * 1024 * 1024 })
  .split('\0').filter(Boolean)

// The files `verify` treats as changed: the diff against `base` (HEAD, or the merge-base for the full gate) plus
// untracked files, relative to the repo root. The diff is with the working tree, so uncommitted changes count too.
// A rename is listed as its old and its new path, so a file moved out of a folder still counts as a change there.
const changedFiles = (root, base) => [...gitList(root, ['diff', '--name-only', '--no-renames', base]), ...gitList(root, ['ls-files', '--others', '--exclude-standard'])]

// A ref that starts with a dash would reach git as an option, and one with a control character can't be printed.
const isRef = (ref) => isNonEmptyString(ref) && !ref.startsWith('-') && !hasControlChar(ref) && !/\s/.test(ref)

// The branch the full gate compares with (ESP-55): `--base <ref>`, else git.baseBranch, else develop.
const baseBranchOf = (cfg) => {
  const git = cfg.git ?? {}
  if (!isPlainObject(git)) throw new Error('.claude/engineering.json "git" is not an object.')
  if (git.baseBranch === undefined) return 'develop'
  if (!isRef(git.baseBranch)) throw new Error('.claude/engineering.json "git.baseBranch" must be a branch name.')
  return git.baseBranch
}

const mergeBase = (root, ref) => execFileSync('git', ['merge-base', 'HEAD', ref], { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim()

// Whether commit `a` is an ancestor of commit `b`. git exits 1 for "no"; both are commits merge-base just printed, so
// any other failure is also read as "no", and the caller keeps the local branch's merge-base.
const isAncestor = (root, a, b) => {
  try {
    execFileSync('git', ['merge-base', '--is-ancestor', a, b], { cwd: root, stdio: 'ignore' })
    return true
  } catch {
    return false
  }
}

/**
 * The commit the full gate compares with: the merge-base of HEAD and `ref` or `origin/<ref>`, whichever is newer, since
 * a local branch can be behind the one the work was cut from. When neither resolves, HEAD, with a note that says so, so
 * the gate still runs; a base the user named with --base (`explicit`) that can't be found stops the gate instead.
 * @returns {{ commit: string, note: string }}
 */
const resolveBase = (root, ref, { explicit = false } = {}) => {
  const found = []
  const errors = []
  for (const candidate of [ref, `origin/${ref}`]) {
    try {
      found.push({ candidate, commit: mergeBase(root, candidate) })
    } catch (e) {
      errors.push((e.stderr || e.message).replace(/\s+/g, ' ').trim())
    }
  }
  if (found.length) {
    const [first, second] = found
    const best = second && second.commit !== first.commit && isAncestor(root, first.commit, second.commit) ? second : first
    return { commit: best.commit, note: `Base: merge-base with ${printable(best.candidate)} (${best.commit.slice(0, 7)})` }
  }
  const why = errors.filter(Boolean).join('; ')
  const missing = `could not find "${printable(ref)}" or "origin/${printable(ref)}"${why ? ` (${printable(why)})` : ''}`
  if (explicit) throw new Error(`--base ${missing}.`)
  return { commit: 'HEAD', note: `Base: ${missing}, so changed files are compared with HEAD.` }
}

// The operator that chains a second command onto the first, or null (ESP-53). A chained command reports only the last
// command's status, so an earlier failure would pass: `;`, a single `&`, `||` (which turns a failure into a pass) and
// a pipe `|` (the status is the last command's). `&&` is allowed, and so are redirections such as `2>&1`.
// Double quotes hide every operator in both shells. Single quotes hide `;` (cmd.exe never splits on it) but not `&` or
// `|`, because cmd.exe doesn't treat single quotes as quotes. A backslash-escaped operator still counts: fail closed.
const chainOperator = (run) => {
  let quote = null
  for (let i = 0; i < run.length; i++) {
    const c = run[i]
    if (quote === '"') {
      if (c === '"') quote = null
      continue
    }
    if (c === '"' && quote === null) quote = '"'
    else if (c === "'") quote = quote === "'" ? null : "'"
    else if (c === ';' && quote === null) return ';'
    else if (c === '|') return run[i + 1] === '|' ? '||' : '|'
    else if (c === '&') {
      if (run[i + 1] === '&') i++
      else if (!['>', '<'].includes(run[i - 1]) && run[i + 1] !== '>') return '&'
    }
  }
  return null
}

const checkSteps = (steps, key, needsWhen) => {
  if (!Array.isArray(steps)) throw new Error(`.claude/engineering.json "${key}" is not a list.`)
  for (const s of steps) {
    if (!isPlainObject(s) || !isNonEmptyString(s.name) || !isNonEmptyString(s.run)) throw new Error(`.claude/engineering.json "${key}": every step needs a "name" and "run" string.`)
    if (hasControlChar(s.name) || s.name.trim() === FAKE_PASS_NAME) throw new Error(`.claude/engineering.json "${key}": a step "name" can't hold control characters or be "${FAKE_PASS_NAME}".`)
    // cmd.exe runs only the first line of a command, so a second line would pass without running.
    if (hasControlChar(s.run)) throw new Error(`.claude/engineering.json "${key}": the "run" of step "${s.name}" can't hold line breaks or other control characters. Use one command per step.`)
    const op = chainOperator(s.run)
    if (op) throw new Error(`.claude/engineering.json "${key}": the "run" of step "${printable(s.name)}" chains commands with "${op}", so an earlier failure would pass. Use one command per step, or join them with "&&".`)
    if (s.timeoutMs !== undefined && !(Number.isInteger(s.timeoutMs) && s.timeoutMs >= 1 && s.timeoutMs <= MAX_STEP_TIMEOUT_MS)) {
      throw new Error(`.claude/engineering.json "${key}": the "timeoutMs" of step "${s.name}" must be a whole number of milliseconds from 1 to ${MAX_STEP_TIMEOUT_MS}.`)
    }
    // ESP-54: the CI gate's shape, a list of paths relative to the repo root; an empty list checks nothing, as in CI.
    if (s.expectNoDiff !== undefined && !(Array.isArray(s.expectNoDiff) && s.expectNoDiff.every(isPathPrefix))) {
      throw new Error(`.claude/engineering.json "${key}": the "expectNoDiff" of step "${printable(s.name)}" must be a list of paths relative to the repo root with forward slashes (for example "dist/").`)
    }
    if (needsWhen && !(Array.isArray(s.when) && s.when.length && s.when.every(isPathPrefix))) {
      throw new Error(`.claude/engineering.json "${key}": step "${s.name}" needs a "when" list of path prefixes, relative to the repo root with forward slashes (for example "src/").`)
    }
  }
  // Only the keys the runner reads are kept, so no other key in the config can pass for the runner's own `skipped`.
  return steps.map(({ name, run, when, timeoutMs = DEFAULT_STEP_TIMEOUT_MS, expectNoDiff = [] }) => (needsWhen ? { name, run, when, timeoutMs, expectNoDiff } : { name, run, timeoutMs, expectNoDiff }))
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
  // A misspelt step-list key would run nothing without a word (ESP-53). Other unknown keys are the guard's to report.
  for (const k of Object.keys(cfg)) {
    if (STEP_LIST_KEYS.includes(k)) continue
    const meant = STEP_LIST_KEYS.find((sk) => editDistance(k.toLowerCase(), sk.toLowerCase(), NEAR_MISS_EDITS) <= NEAR_MISS_EDITS)
    if (meant) throw new Error(`.claude/engineering.json has a key "${printable(k)}" that looks like a misspelling of "${meant}", so its steps would not run. Rename it to "${meant}".`)
  }
  return cfg
}

const listChanged = (root, base = 'HEAD') => {
  try {
    return changedFiles(root, base)
  } catch (e) {
    throw new Error(`git could not list the changed files (${(e.stderr || e.message).trim()}).`)
  }
}

// The match is exact, as in the CI gate: case matters.
const covers = (step, file) => step.when.some((prefix) => file.startsWith(prefix))
const selectByChanged = (steps, changed) => steps.map((s) => (changed.some((file) => covers(s, file)) ? s : { ...s, skipped: `no changed file under ${s.when.join(', ')}` }))

/**
 * The steps for this repo, in order; throws on a config the gate can't be built from.
 * @returns {{ steps: { name: string, run: string, timeoutMs: number, skipped?: string }[], notes: string[], base: string }} skipped holds the reason a conditional step isn't run; base is the commit the fake-pass check diffs against
 */
const loadGate = (root, { base = null } = {}) => {
  const cfg = readConfig(root)
  const always = checkSteps(cfg.verify ?? null, 'verify', false)
  if (!always.length) throw new Error('.claude/engineering.json "verify" is empty, so there are no gate steps to run.')
  const conditional = checkSteps(cfg.verifyConditional ?? [], 'verifyConditional', true)
  const { commit, note } = resolveBase(root, base ?? baseBranchOf(cfg), { explicit: base != null })
  // Listed even with no conditional step: the fake-pass check needs the same list, so a repo git can't diff stops here.
  return { steps: [...always, ...selectByChanged(conditional, listChanged(root, commit))], notes: [note], base: commit }
}


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

// A new folder only this user can read, and logs no one else could have put there: step output can hold secrets.
// gate.log is the index (each command and its result); each step's output goes to a step-NN.log of its own, so a
// background process a step leaves writing can't garble the next step's lines (ESP-56).
const openLog = () => {
  const dir = mkdtempSync(path.join(tmpdir(), LOG_DIR_PREFIX))
  const file = path.join(dir, 'gate.log')
  return { dir, file, fd: openSync(file, 'wx+', 0o600), steps: 0 }
}

// The runner's own log folders: the name mkdtemp gives them (six random characters after the prefix).
const LOG_DIR_PREFIX = 'usiatech-gate-'
const LOG_DIR_NAME = /^usiatech-gate-[A-Za-z0-9]{6}$/
const LOG_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000

/**
 * Removes the runner's own log folders older than 7 days from the OS temp folder (ESP-56): only real folders with
 * the runner's name, owned by this user where the OS has owners; a link is never followed or removed.
 * @returns {string[]} a note for each folder that could not be removed; a failed clean-up never stops the gate
 */
const removeOldLogs = (now = Date.now()) => {
  const tmp = tmpdir()
  let names
  try {
    names = readdirSync(tmp)
  } catch (e) {
    return [`Old gate logs were not cleaned up: ${printable(tmp)} could not be listed (${printable(e.message)}).`]
  }
  const notes = []
  for (const name of names.filter((n) => LOG_DIR_NAME.test(n))) {
    const dir = path.join(tmp, name)
    try {
      const st = lstatSync(dir)
      if (st.isSymbolicLink() || !st.isDirectory()) continue
      if (typeof process.getuid === 'function' && st.uid !== process.getuid()) continue
      if (now - st.mtimeMs <= LOG_MAX_AGE_MS) continue
      rmSync(dir, { recursive: true, force: true })
    } catch (e) {
      notes.push(`An old gate log folder was not removed: ${printable(dir)} (${printable(e.message)}).`)
    }
  }
  return notes
}


// The fake-pass check's last line (ESP-55): without it, a check that ran on nothing can't be told from one that found
// nothing, so a passing check that doesn't print it fails the gate.
const SCAN_COUNT = /^fake-pass check: (scanned \d+ files?)$/

// Runs the selected steps and then the fake-pass check; returns the summary lines and whether anything failed.
const runSteps = async (root, steps, log, signal, base) => {
  const { failed, lines } = await runSelected(root, steps, log, signal)
  if (failed || signal?.aborted) return { failed: true, lines: [...lines, `NOT RUN  ${FAKE_PASS_NAME}`] }
  // The check prints every finding, warnings and suppressed ones included; `verify` reports them all, so none is cut.
  const check = await runStep(log, FAKE_PASS_NAME, process.execPath, { args: [FAKE_PASS_SCRIPT, '--base', base], cwd: root, timeoutMs: DEFAULT_STEP_TIMEOUT_MS, signal })
  const output = check.output()
  const count = output.map((l) => l.match(SCAN_COUNT)?.[1]).find(Boolean)
  const findings = output.filter((l) => !SCAN_COUNT.test(l))
  let result = check
  if (count) result = { ...check, result: `${check.result}, ${count}` }
  else if (check.ok) result = { ...check, ok: false, result: `${check.result}, but it printed no scan count, so it may have checked nothing` }
  return { failed: !result.ok, lines: [...lines, stepLine(result.ok, FAKE_PASS_NAME, result), ...findings] }
}

// The two ways to run. `stamp` adds the run time that `verify` copies into evidence, which a partial run never gives.
const FULL = { label: 'The gate', load: loadGate, run: runSteps, stamp: true, verdict: (failed) => `Gate: ${failed ? 'FAIL' : 'PASS'}` }
const ITERATE = { label: 'The partial run', load: loadIterate, run: runSelected, stamp: false, verdict: (failed) => `Partial run: ${failed ? 'FAIL' : 'PASS'}. This is not the done gate.` }
// `--check` loads the full gate as a run would (config, steps, base) and runs nothing, so `verify` can tell whether the
// gate can start before it moves any Jira ticket into testing (code review 2026-11-09).
const CHECK = { ...FULL, checkOnly: true }

/**
 * Runs the gate, or the partial run, for the repo that contains cwd, from its root.
 * @returns {Promise<{ exitCode: number, lines: string[] }>}
 */
const runGate = async (cwd, mode, options = {}) => {
  const cannotStart = (reason) => ({ exitCode: 2, lines: [`${mode.label} could not start: ${reason}`, mode.verdict(true)] })
  let root, loaded, log
  try {
    root = execFileSync('git', ['rev-parse', '--show-toplevel'], { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim()
  } catch (e) {
    return cannotStart(`git could not find a repository here (${(e.stderr || e.message).trim()}).`)
  }
  try {
    loaded = mode.load(root, options)
  } catch (e) {
    return cannotStart(e.message)
  }
  const { steps, notes } = loaded
  if (mode.checkOnly) return { exitCode: 0, lines: [...notes, 'Gate check: the gate can start. Nothing ran.'] }
  // Only a partial run gets here: the full gate refuses an empty `verify` list. No step means no log to write, and
  // no PASS: nothing was checked.
  if (steps.every((s) => s.skipped)) {
    return { exitCode: 0, lines: [...notes, ...steps.map((s) => `SKIPPED  ${s.name} (${s.skipped})`), 'Partial run: nothing ran. This is not the done gate.'] }
  }
  notes.push(...removeOldLogs())
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
    const { failed, lines } = await mode.run(root, steps, log, interrupt.signal, loaded.base)
    const stamp = mode.stamp ? [`Gate run: ${new Date().toISOString().replace(/\.\d+Z$/, 'Z')}`] : []
    // An interrupted run exits 130, as the mutation runner does, so a caller can tell it from a failed step (ESP-58).
    const exitCode = interrupt.signal.aborted ? 130 : (failed ? 1 : 0)
    return { exitCode, lines: [...notes, ...lines, `Log: ${log.file}`, ...stamp, mode.verdict(failed || interrupt.signal.aborted)] }
  } finally {
    removeHandlers()
    closeSync(log.fd)
  }
}

// No argument, `--iterate`, or `--base <ref>` for the full gate (ESP-55), each full-gate form optionally after `--check`.
// A partial run always diffs against HEAD: it checks what is being changed now, not the whole branch.
const parseRunArgs = (args) => {
  if (args.length === 1 && args[0] === '--iterate') return { mode: ITERATE, options: {} }
  const check = args[0] === '--check'
  const rest = check ? args.slice(1) : args
  const mode = check ? CHECK : FULL
  if (rest.length === 0) return { mode, options: {} }
  if (rest.length === 2 && rest[0] === '--base' && isRef(rest[1])) return { mode, options: { base: rest[1] } }
  return null
}

const args = process.argv.slice(2)
const parsed = parseRunArgs(args)
const mode = parsed?.mode
if (!mode) {
  // A misspelt flag must not run the slow full gate, or pass for a partial run.
  console.log(`The gate could not start: it takes no argument, --iterate, --base <ref> or --check [--base <ref>], not ${args.map((a) => `"${printable(a)}"`).join(' ')}.`)
  console.log(FULL.verdict(true))
  process.exitCode = 2
} else {
  // Anything unexpected, such as a log write that fails part-way, is a run that did not finish: never a pass.
  try {
    const { exitCode, lines } = await runGate(process.cwd(), mode, parsed.options)
    for (const l of lines) console.log(l)
    process.exitCode = exitCode
  } catch (e) {
    console.log(`${mode.label} could not finish: ${e.message}`)
    console.log(mode.verdict(true))
    process.exitCode = 2
  }
}
