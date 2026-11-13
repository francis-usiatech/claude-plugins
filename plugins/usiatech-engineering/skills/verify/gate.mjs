#!/usr/bin/env node
// Runs the repo's verification gate for the local `verify` skill (ESP-44): the fake-pass check first (ESP-158), then
// the `verify` steps of .claude/engineering.json and the `verifyConditional` steps a changed file selects (a `when`
// prefix match no `unless` glob excludes, ESP-160), every non-slow step before any `"slow": true` one. Prints one
// line per step, in the order they ran, with its real exit code and ends with `Gate: PASS` or `Gate: FAIL`.
// Each full run records the tree hash it checked and the steps that passed, in the repo's git folder (ESP-162):
// --resume at the same tree and config reuses the passed steps, and --rerun-fix (only with `"verifyRerun":
// "fix-diff"`, ESP-161) reruns the `verify` steps, the fake-pass check and the conditional steps a fix selects since
// the last full pass. --tree-hash prints the tree hash and runs nothing.
// Each step's full output goes to a log file of its own in a private folder under the OS temp folder, so nothing has
// to be piped or filtered; gate.log there lists each command and its result. Folders older than 7 days are removed.
// A step that runs past its timeout is stopped with every process it started and fails the gate (ESP-52): its own
// `timeoutMs` from the config, or 10 minutes.
// Exits 0 when the gate passed, 1 when a step or the fake-pass check failed, and 2 when the gate could not start or
// finish (no usable config, git can't list the changed files, the log can't be written): a gate that ran nothing
// fails closed rather than pass. An interrupted run exits 130 (ESP-58); a step it stopped before it started shows
// `NOT RUN`.
// On a docs-only diff (docs-only.mjs) the full gate runs no step and no fake-pass check, and ends with
// `Gate: SKIPPED (docs-only diff)`, exit 0.
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
import { printable, runStep, stepLine, runSelected, utcNow } from './gate-steps.mjs'
import { treeHash, configHash, changedBetween, readRecord, writeRecord, LAST_RUN, LAST_FULL_PASS } from './gate-record.mjs'
import { skipReason } from '../../templates/github/scripts/verify-select.mjs'
import { hasControlChar, isPathPrefix } from '../../templates/github/scripts/governance-rules.mjs'
import { isPlainObject, isNonEmptyString } from '../../templates/github/scripts/workflow-rules.mjs'
import { editDistance } from '../../templates/github/scripts/supply-chain-rules.mjs'
import { isDocsOnly, instructionImports } from './docs-only.mjs'

const FAKE_PASS_SCRIPT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../templates/github/scripts/fake-pass-check.mjs')
const FAKE_PASS_NAME = 'fake-pass check'
const DEFAULT_STEP_TIMEOUT_MS = 600000
const STEP_LIST_KEYS = ['verify', 'verifyConditional', 'verifyIterate']
const RERUN_FIX_DIFF = 'fix-diff'
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
 * @returns {{ commit: string, note: string, resolved: boolean }} resolved is false on the HEAD fallback
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
    return { commit: best.commit, note: `Base: merge-base with ${printable(best.candidate)} (${best.commit.slice(0, 7)})`, resolved: true }
  }
  const why = errors.filter(Boolean).join('; ')
  const missing = `could not find "${printable(ref)}" or "origin/${printable(ref)}"${why ? ` (${printable(why)})` : ''}`
  if (explicit) throw new Error(`--base ${missing}.`)
  return { commit: 'HEAD', note: `Base: ${missing}, so changed files are compared with HEAD.`, resolved: false }
}

const gitOk = (root, args) => {
  try {
    execFileSync('git', args, { cwd: root, stdio: 'ignore' })
    return true
  } catch {
    return false
  }
}

/**
 * Whether the changed-file list covers every change on the branch, so a docs-only verdict can be trusted. Only the
 * configured base branch qualifies, and only from another branch: a `--base` ref, a fallback to HEAD, a ref that is no
 * branch (`@`, `HEAD~0`, a commit) or the current branch itself gives a merge-base at HEAD that hides committed code.
 * A detached HEAD, or a local base moved onto unpushed work (`git branch -f develop HEAD`), is not trusted either.
 * On any doubt the answer is no, so the gate runs.
 */
const coversBranch = (root, ref, { resolved, explicit, commit }) => {
  if (!resolved || explicit) return false
  const hasRemote = gitOk(root, ['show-ref', '--verify', '--quiet', `refs/remotes/origin/${ref}`])
  if (!hasRemote && !gitOk(root, ['show-ref', '--verify', '--quiet', `refs/heads/${ref}`])) return false
  let current
  try {
    current = execFileSync('git', ['symbolic-ref', '--quiet', '--short', 'HEAD'], { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim()
  } catch {
    return false // detached HEAD (or symbolic-ref failed): the branch's own commits can't be told apart
  }
  // Branch names compare without case: on Windows `Develop` checks out `develop`.
  const lower = current.toLowerCase()
  if (lower === ref.toLowerCase() || lower === `origin/${ref}`.toLowerCase()) return false
  // With a remote base, the merge-base must already be on it, so local commits moved onto the base still count.
  return !hasRemote || isAncestor(root, commit, `origin/${ref}`)
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
    // ESP-158: a slow step runs after every non-slow one.
    if (s.slow !== undefined && typeof s.slow !== 'boolean') throw new Error(`.claude/engineering.json "${key}": the "slow" of step "${printable(s.name)}" must be true or false.`)
    // ESP-160: globs in the same spelling as `when` prefixes; only a step selected by `when` can have exclusions.
    // A glob matches whole paths, so a folder-style "web/live/" would match no file: it must be "web/live/**".
    if (s.unless !== undefined && !(needsWhen && Array.isArray(s.unless) && s.unless.length && s.unless.every((g) => isPathPrefix(g) && !g.endsWith('/')))) {
      throw new Error(needsWhen
        ? `.claude/engineering.json "${key}": the "unless" of step "${printable(s.name)}" must be a list of globs relative to the repo root with forward slashes (for example "src/**/*.live.tsx"); a folder is written "web/live/**", not "web/live/".`
        : `.claude/engineering.json "${key}": step "${printable(s.name)}" always runs, so it can't have "unless". Use "verifyConditional" for a step that depends on the changed files.`)
    }
  }
  // Only the keys the runner reads are kept, so no other key in the config can pass for the runner's own `skipped`.
  return steps.map(({ name, run, when, unless, slow = false, timeoutMs = DEFAULT_STEP_TIMEOUT_MS, expectNoDiff = [] }) => (needsWhen
    ? { name, run, when, ...(unless && { unless }), slow, timeoutMs, expectNoDiff }
    : { name, run, slow, timeoutMs, expectNoDiff }))
}

// ESP-158: every non-slow step before any slow one, in config order inside each group.
const bySpeed = (steps) => [...steps.filter((s) => !s.slow), ...steps.filter((s) => s.slow)]

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
  // ESP-161: the narrowed rerun after a fix is opt-in, with one value.
  if (cfg.verifyRerun !== undefined && cfg.verifyRerun !== RERUN_FIX_DIFF) throw new Error(`.claude/engineering.json "verifyRerun" can only be "${RERUN_FIX_DIFF}". Remove it to keep the full-gate rerun.`)
  return cfg
}

const listChanged = (root, base = 'HEAD') => {
  try {
    return changedFiles(root, base)
  } catch (e) {
    throw new Error(`git could not list the changed files (${(e.stderr || e.message).trim()}).`)
  }
}

// The CI gate's rule (verify-select.mjs): a `when` prefix match that no `unless` glob excludes; case matters.
const covers = (step, file) => skipReason(step, [file]) === null
const selectByChanged = (steps, changed) => steps.map((s) => {
  const skipped = skipReason(s, changed)
  return skipped ? { ...s, skipped } : s
})

/**
 * The steps for this repo, in run order; throws on a config the gate can't be built from.
 * @returns {{ steps: { name: string, run: string, timeoutMs: number, slow: boolean, skipped?: string }[], notes: string[], base: string, docsOnly: number, cfg: object, always: object[], conditional: object[] }} skipped holds the reason a conditional step isn't run; base is the commit the fake-pass check diffs against; docsOnly is the number of changed files on a docs-only diff, else 0; always and conditional are the checked step lists, so --rerun-fix can select again from a fix's diff
 */
const loadGate = (root, { base = null } = {}) => {
  const cfg = readConfig(root)
  const always = checkSteps(cfg.verify ?? null, 'verify', false)
  if (!always.length) throw new Error('.claude/engineering.json "verify" is empty, so there are no gate steps to run.')
  const conditional = checkSteps(cfg.verifyConditional ?? [], 'verifyConditional', true)
  const ref = base ?? baseBranchOf(cfg)
  const { commit, note, resolved } = resolveBase(root, ref, { explicit: base != null })
  const branchDiff = coversBranch(root, ref, { resolved, explicit: base != null, commit })
  // Listed even with no conditional step: the fake-pass check needs the same list, so a repo git can't diff stops here.
  const changed = listChanged(root, commit)
  // Only a whole-branch list can be docs-only (coversBranch); otherwise the gate runs.
  // Files the instruction files import with `@path` are instructions too; they are only looked up for a list that
  // passes the rule without them, so a code diff costs no extra reads. A read that fails stops the gate.
  const importsOf = () => instructionImports(root, [...gitList(root, ['ls-files']), ...gitList(root, ['ls-files', '--others', '--exclude-standard'])])
  const docsOnly = branchDiff && isDocsOnly(changed, cfg) && isDocsOnly(changed, cfg, importsOf()) ? changed.length : 0
  return { steps: bySpeed([...always, ...selectByChanged(conditional, changed)]), notes: [note], base: commit, docsOnly, cfg, always, conditional }
}


// The same shape as loadGate, for an --iterate run: `verify` isn't read, so only a bad map or config stops the run.
const loadIterate = (root) => {
  const mapped = checkSteps(readConfig(root).verifyIterate ?? [], 'verifyIterate', true)
  const changed = listChanged(root)
  const steps = bySpeed(selectByChanged(mapped, changed))
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

// A git or file error as one printable line.
const errorText = (e) => printable((e.stderr || e.message).replace(/\s+/g, ' ').trim())

// The run record's name for the fake-pass check: it checks the files changed since the base, so a moved base is a
// different check.
const fakePassKey = (base) => `${FAKE_PASS_NAME}\u0000${base}`

// The fake-pass check; returns whether it passed and its lines (the summary line, then every finding).
const runFakePass = async (root, log, signal, base) => {
  // The check prints every finding, warnings and suppressed ones included; `verify` reports them all, so none is cut.
  const check = await runStep(log, FAKE_PASS_NAME, process.execPath, { args: [FAKE_PASS_SCRIPT, '--base', base], cwd: root, timeoutMs: DEFAULT_STEP_TIMEOUT_MS, signal })
  const output = check.output()
  const count = output.map((l) => l.match(SCAN_COUNT)?.[1]).find(Boolean)
  const findings = output.filter((l) => !SCAN_COUNT.test(l))
  let result = check
  if (count) result = { ...check, result: `${check.result}, ${count}` }
  else if (check.ok) result = { ...check, ok: false, result: `${check.result}, but it printed no scan count, so it may have checked nothing` }
  return { ok: result.ok, lines: [stepLine(result.ok, FAKE_PASS_NAME, result), ...findings] }
}

// Runs the fake-pass check first (ESP-158: it only reads the changed files, so it fails fast), then the selected
// steps. Steps in `earlier` passed at this tree in the last run and are reused (ESP-162).
// `earlier` is only ever filled from a record at this same tree, config and base, so its steps stay in the next record
// even when this run stops before reaching them (an interrupt must not throw away a resumed gate's earlier passes).
const runSteps = async (root, steps, log, signal, { base, earlier = {} }) => {
  const key = fakePassKey(base)
  const reused = Object.hasOwn(earlier, key) ? earlier[key] : null
  const check = reused ? { ok: true, lines: [`PASSED EARLIER  ${FAKE_PASS_NAME} (${reused})`] } : await runFakePass(root, log, signal, base)
  if (!check.ok || signal?.aborted) {
    return { failed: true, lines: [...check.lines, ...steps.map((s) => (s.skipped ? `SKIPPED  ${s.name} (${s.skipped})` : `NOT RUN  ${s.name}`))], passed: { ...earlier } }
  }
  const run = await runSelected(root, steps, log, signal, earlier)
  return { failed: run.failed, lines: [...check.lines, ...run.lines], passed: { ...earlier, [key]: reused ?? utcNow(), ...run.passed } }
}

// The ways to run. `stamp` adds the run time that `verify` copies into evidence, which a partial run never gives;
// `record` keeps the run record (ESP-162).
const FULL = { label: 'The gate', load: loadGate, run: runSteps, stamp: true, record: true, verdict: (failed) => `Gate: ${failed ? 'FAIL' : 'PASS'}` }
const ITERATE = { label: 'The partial run', load: loadIterate, run: (root, steps, log, signal) => runSelected(root, steps, log, signal), stamp: false, verdict: (failed) => `Partial run: ${failed ? 'FAIL' : 'PASS'}. This is not the done gate.` }
// `--check` loads the full gate as a run would (config, steps, base) and runs nothing, so `verify` can tell whether the
// gate can start before it moves any Jira ticket into testing (code review 2026-11-09).
const CHECK = { ...FULL, checkOnly: true, record: false }
const RESUME = { ...FULL, resume: true }
const RERUN_FIX = { ...FULL, rerunFix: true }
const TREE_HASH = { label: 'The tree hash', treeHashOnly: true, verdict: () => 'Tree hash: not available' }

/**
 * Prepares the run record for a full run (ESP-161, ESP-162): the tree and config hashes, the steps to reuse on
 * --resume, and on --rerun-fix the steps a fix selects since the last full pass. Throws when --resume or --rerun-fix
 * can't be honoured safely; a plain run that can't hash the tree just records nothing.
 * @returns {{ tree: string, config: string, earlier: Record<string, string>, steps?: object[], notes: string[] } | null}
 */
const prepareRecord = (root, mode, loaded) => {
  let tree, config
  try {
    tree = treeHash(root)
    config = configHash(root)
  } catch (e) {
    const why = `the tree hash could not be worked out (${errorText(e)})`
    if (mode.resume || mode.rerunFix) throw new Error(`${why}, so the earlier run can't be matched.`)
    loaded.notes.push(`Gate tree: unknown, ${why}. This run is not recorded.`)
    return null
  }
  if (mode.rerunFix) return prepareRerun(root, loaded, tree, config)
  if (!mode.resume) return { tree, config, earlier: {}, notes: [] }
  const { record, note } = readRecord(root, LAST_RUN)
  const why = !record ? (note ?? 'no earlier run is recorded')
    : record.config !== config ? '.claude/engineering.json changed since the last run'
      : record.tree !== tree ? 'the working tree changed since the last run'
        : record.base !== loaded.base ? 'the base commit changed since the last run' : null
  if (why) return { tree, config, earlier: {}, notes: [`Resume: ${why}, so every step runs.`] }
  return { tree, config, earlier: record.steps, notes: [`Resume: reusing the steps that passed at tree ${tree}.`] }
}

// --rerun-fix (ESP-161): the `verify` steps, the fake-pass check and the conditional steps the fix's diff selects.
const prepareRerun = (root, loaded, tree, config) => {
  if (loaded.cfg.verifyRerun !== RERUN_FIX_DIFF) throw new Error(`--rerun-fix needs "verifyRerun": "${RERUN_FIX_DIFF}" in .claude/engineering.json. Without it, run the full gate.`)
  const { record: pass, note } = readRecord(root, LAST_FULL_PASS)
  if (!pass || typeof pass.at !== 'string') throw new Error(`--rerun-fix needs a recorded full gate pass, and ${note ?? 'there is none'}. Run the full gate.`)
  if (pass.config !== config) throw new Error('--rerun-fix: .claude/engineering.json changed since the last full gate pass. Run the full gate.')
  let changed
  try {
    changed = changedBetween(root, pass.tree, tree)
  } catch (e) {
    throw new Error(`--rerun-fix could not compare the tree with the last full pass (${errorText(e)}). Run the full gate.`)
  }
  const steps = bySpeed([...loaded.always, ...selectByChanged(loaded.conditional, changed)])
  return { tree, config, earlier: {}, steps, notes: [`Rerun after full gate at tree ${pass.tree} (${pass.at}): ${changed.length} file${changed.length === 1 ? '' : 's'} changed since.`] }
}

// Writes the run record after a run; a write that fails is reported in a note and never changes the verdict.
const saveRecord = (root, mode, loaded, record, { failed, passed }) => {
  const notes = []
  const at = utcNow()
  try {
    writeRecord(root, LAST_RUN, { tree: record.tree, config: record.config, base: loaded.base, steps: passed, at })
    // Only a run where every step passed at this tree is a full pass; a narrowed rerun never is (ESP-161).
    if (!failed && !mode.rerunFix) writeRecord(root, LAST_FULL_PASS, { tree: record.tree, config: record.config, base: loaded.base, steps: passed, at })
  } catch (e) {
    notes.push(`The run record could not be written (${printable(e.message)}), so --resume and --rerun-fix can't use this run.`)
  }
  return notes
}

// The record names the tree the steps checked. A step that writes files git doesn't ignore (build output, updated
// snapshots) leaves another tree, which `--tree-hash`, `--resume` and the evidence check would not match: say so.
const treeMoved = (root, tree) => {
  try {
    const after = treeHash(root)
    return after === tree ? [] : [`The steps changed files git doesn't ignore: the tree is now ${after}, not ${tree}. Ignore or commit what they write, or --resume and the AC evidence check won't match this run.`]
  } catch (e) {
    return [`The tree hash after the run could not be worked out (${errorText(e)}).`]
  }
}

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
  if (mode.treeHashOnly) {
    try {
      return { exitCode: 0, lines: [`Gate tree: ${treeHash(root)}`] }
    } catch (e) {
      return { exitCode: 2, lines: [`The tree hash could not be worked out: ${errorText(e)}`] }
    }
  }
  try {
    loaded = mode.load(root, options)
  } catch (e) {
    return cannotStart(e.message)
  }
  const { notes } = loaded
  if (mode.checkOnly) return { exitCode: 0, lines: [...notes, 'Gate check: the gate can start. Nothing ran.'] }
  // A docs-only diff (the `release` skill's rule) runs no step and no fake-pass check: the user's docs review replaces
  // them. The verdict names the skip, so it can't be read as a pass.
  if (loaded.docsOnly) {
    return { exitCode: 0, lines: [...notes, `SKIPPED  all steps (docs-only diff: ${loaded.docsOnly} Markdown file${loaded.docsOnly === 1 ? '' : 's'})`, 'Gate: SKIPPED (docs-only diff)'] }
  }
  let record = null
  if (mode.record) {
    try {
      record = prepareRecord(root, mode, loaded)
    } catch (e) {
      return cannotStart(e.message)
    }
    if (record) notes.push(...record.notes)
  }
  const steps = record?.steps ?? loaded.steps
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
    const run = await mode.run(root, steps, log, interrupt.signal, { base: loaded.base, earlier: record?.earlier ?? {} })
    const failed = run.failed || interrupt.signal.aborted
    const saved = record ? [...saveRecord(root, mode, loaded, record, { failed, passed: run.passed }), ...treeMoved(root, record.tree)] : []
    const tree = record ? [`Gate tree: ${record.tree}`] : []
    const stamp = mode.stamp ? [`Gate run: ${utcNow()}`] : []
    // An interrupted run exits 130, as the mutation runner does, so a caller can tell it from a failed step (ESP-58).
    const exitCode = interrupt.signal.aborted ? 130 : (failed ? 1 : 0)
    return { exitCode, lines: [...notes, ...run.lines, ...saved, `Log: ${log.file}`, ...tree, ...stamp, mode.verdict(failed)] }
  } finally {
    removeHandlers()
    closeSync(log.fd)
  }
}

// No argument, `--iterate`, `--tree-hash`, or `--base <ref>` for the full gate (ESP-55), each full-gate form optionally
// after `--check`, `--resume` (ESP-162) or `--rerun-fix` (ESP-161). A partial run always diffs against HEAD: it checks
// what is being changed now, not the whole branch.
const FULL_FLAGS = { '--check': CHECK, '--resume': RESUME, '--rerun-fix': RERUN_FIX }
const parseRunArgs = (args) => {
  if (args.length === 1 && args[0] === '--iterate') return { mode: ITERATE, options: {} }
  if (args.length === 1 && args[0] === '--tree-hash') return { mode: TREE_HASH, options: {} }
  const flagged = Object.hasOwn(FULL_FLAGS, args[0] ?? '')
  const rest = flagged ? args.slice(1) : args
  const mode = flagged ? FULL_FLAGS[args[0]] : FULL
  if (rest.length === 0) return { mode, options: {} }
  if (rest.length === 2 && rest[0] === '--base' && isRef(rest[1])) return { mode, options: { base: rest[1] } }
  return null
}

const args = process.argv.slice(2)
const parsed = parseRunArgs(args)
const mode = parsed?.mode
if (!mode) {
  // A misspelt flag must not run the slow full gate, or pass for a partial run.
  console.log(`The gate could not start: it takes no argument, --iterate, --tree-hash, --base <ref>, or --check, --resume or --rerun-fix [--base <ref>], not ${args.map((a) => `"${printable(a)}"`).join(' ')}.`)
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
