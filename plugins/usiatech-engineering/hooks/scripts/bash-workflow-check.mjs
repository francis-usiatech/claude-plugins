#!/usr/bin/env node
// usiatech-engineering: after-Bash workflow check (PostToolUse and PostToolUseFailure on Bash; R6, ESP-6).
// The guard snapshots .github/workflows before each Bash call it doesn't deny; this hook compares afterwards and runs
// the shared workflow rules on every file the command added or changed, so a workflow written with a heredoc, cp or
// sed gets the same checks as one written with Edit. Every finding is logged to .claude/governance-log.jsonl;
// high-risk ones are shown to Claude and the user at once. The command has already run, so nothing is blocked.
// Internal errors fail open (exit 0) and are logged as decision "error", like the guard.
import { existsSync, readdirSync, readFileSync, writeFileSync, rmSync, statSync } from 'node:fs'
import { execFileSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import path from 'node:path'
import { appendGovernanceLog } from './governance-log.mjs'
import { stateDir, stateFolderProblem, checkedStateDir } from './governance-state.mjs'

const WORKFLOW_DIR = '.github/workflows'
// Not workflow-rules' isWorkflowPath: importing it would load the rules module on the no-change path (AC6).
const WORKFLOW_FILE = /^\.github\/workflows\/[^/]+\.ya?ml$/i
// Refs a command can push: HEAD, branches and tags. Remote-tracking refs only mirror what was fetched.
const WATCHED_REF = /^(HEAD|refs\/heads\/.+|refs\/tags\/.+)$/
// Well above the 10-minute Bash timeout plus however long a permission prompt waits.
const SNAPSHOT_MAX_AGE_MS = 24 * 60 * 60 * 1000
const SAFE_ID = /^[A-Za-z0-9_-]{1,128}$/

/**
 * Every git call goes through here, so tests can count them (AC6: exactly 4 for a Bash call that changes nothing).
 * The C locale keeps git's messages in English, so `baseIn` and the HEAD fallback can match them.
 */
export const gitRunner = {
  run: (root, args) => execFileSync('git', args, {
    cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], maxBuffer: 64 * 1024 * 1024, env: { ...process.env, LC_ALL: 'C', LANGUAGE: '' },
  }),
}

/** Where snapshots for a project live: its state folder (governance-state.mjs). */
export const snapshotDir = stateDir

/** Why a snapshot folder can't be trusted, or null: the state-folder rule (governance-state.mjs). */
export const snapshotFolderProblem = stateFolderProblem

// The snapshot folder, created private when `create` is set; null when it doesn't exist. Throws when it, or the
// shared folder above it, can't be trusted.
const checkedSnapshotDir = (root, { create }) => checkedStateDir(snapshotDir(root), { create, what: 'snapshot' })

const snapshotFile = (dir, id) => path.join(dir, `bash-wf-${id}.json`)

// Workflow files as project-relative path → content. A missing folder is an empty set.
const readWorkflows = (root) => {
  const dir = path.join(root, WORKFLOW_DIR)
  if (!existsSync(dir)) return {}
  const files = {}
  for (const d of readdirSync(dir, { withFileTypes: true })) {
    if (d.isFile() && /\.ya?ml$/i.test(d.name)) files[`${WORKFLOW_DIR}/${d.name}`] = readFileSync(path.join(dir, d.name), 'utf8')
  }
  return files
}

// Whether root is in a git work tree, from the file system only, so a project without git costs no git call.
const inGitRepo = (root) => {
  for (let dir = path.resolve(root); ; dir = path.dirname(dir)) {
    if (existsSync(path.join(dir, '.git'))) return true
    if (path.dirname(dir) === dir) return false
  }
}

// The git state a command could hide a workflow in: watched ref → SHA, and workflow index entry → blob id. Two git
// calls; null outside a git repo. A git failure throws, so it is logged rather than skipped.
const readGit = (root) => {
  if (!inGitRepo(root)) return null
  let refsOut = ''
  try {
    refsOut = gitRunner.run(root, ['show-ref', '--head'])
  } catch (e) {
    if (e.status !== 1) throw e // 1: no refs yet (no commit)
  }
  const refs = {}
  for (const line of refsOut.split('\n')) {
    const [sha, ref] = line.split(' ')
    if (ref && WATCHED_REF.test(ref)) refs[ref] = sha
  }
  const index = {}
  for (const entry of gitRunner.run(root, ['ls-files', '-s', '-z', '--', WORKFLOW_DIR]).split('\0')) {
    const m = entry.match(/^\d+ ([0-9a-f]+) \d+\t([\s\S]+)$/) // a name can hold a line break
    if (m && WORKFLOW_FILE.test(m[2])) index[m[2]] = m[1]
  }
  return { refs, index }
}

/**
 * Saves the workflow files, and in a git repo the refs and workflow index entries, before a Bash call. Called by the
 * guard. Returns false (and saves nothing) when the call has no usable tool_use_id; the after-hook then falls back to
 * the files that differ from HEAD.
 */
export const snapshotWorkflows = (root, id) => {
  if (typeof id !== 'string' || !SAFE_ID.test(id)) return false
  const snapshot = { files: readWorkflows(root), git: readGit(root) }
  writeFileSync(snapshotFile(checkedSnapshotDir(root, { create: true }), id), JSON.stringify(snapshot), { mode: 0o600 })
  return true
}

// Removes snapshots left by calls that never reached the after-hook (an ask the user declined, an interrupt). Returns
// why any stale one couldn't be removed, so the caller logs it and still checks its own call.
const removeStaleSnapshots = (dir, now = Date.now()) => {
  const problems = []
  for (const name of readdirSync(dir)) {
    if (!/^bash-wf-.*\.json$/.test(name)) continue
    const f = path.join(dir, name)
    let mtimeMs
    try {
      mtimeMs = statSync(f).mtimeMs
    } catch (e) {
      if (e.code !== 'ENOENT') problems.push(`could not check stale snapshot ${name}: ${e.message}`)
      continue // ENOENT: removed meanwhile by the after-hook of a parallel call
    }
    if (now - mtimeMs <= SNAPSHOT_MAX_AGE_MS) continue
    try {
      rmSync(f, { force: true })
    } catch (e) {
      problems.push(`could not remove stale snapshot ${name}: ${e.message}`)
    }
  }
  return problems
}

const UNREADABLE = Symbol('unreadable snapshot')

// Reads and removes this call's snapshot; null when there is none, undefined when it isn't JSON, UNREADABLE when it
// can't be read. Read and remove failures go to `problems`, so the call is still checked (against HEAD).
const takeSnapshot = (dir, id, problems) => {
  if (typeof id !== 'string' || !SAFE_ID.test(id)) return null
  const f = snapshotFile(dir, id)
  if (!existsSync(f)) return null
  try {
    return JSON.parse(readFileSync(f, 'utf8'))
  } catch (e) {
    if (e instanceof SyntaxError) return undefined
    problems.push(`could not read this call's snapshot: ${e.message}`)
    return UNREADABLE
  } finally {
    try {
      rmSync(f, { force: true })
    } catch (e) {
      problems.push(`could not remove this call's snapshot: ${e.message}`)
    }
  }
}

const OBJECT_ID = /^[0-9a-f]{40}([0-9a-f]{24})?$/
const isMapOf = (v, valueOk) => !!v && typeof v === 'object' && !Array.isArray(v) && Object.values(v).every(valueOk)
const isObjectId = (id) => typeof id === 'string' && OBJECT_ID.test(id)
// A Bash command can rewrite its own snapshot, and the ids in it are passed to git, so only a well-formed one is used.
const validSnapshot = (s) => isMapOf(s, () => true) && isMapOf(s.files, (c) => typeof c === 'string')
  && (s.git === null || (isMapOf(s.git, () => true) && isMapOf(s.git.refs, isObjectId) && isMapOf(s.git.index, isObjectId)))

// This call's snapshot, or the reason there is no usable one (the after-hook then checks against HEAD instead), plus
// any stale snapshot that couldn't be removed. Its own snapshot is taken first, so a call that waited long on a
// prompt can't lose it to the cleanup.
const loadSnapshot = (root, id) => {
  let dir
  try {
    dir = checkedSnapshotDir(root, { create: false })
  } catch (e) {
    return { problem: e.message, cleanupProblems: [] }
  }
  if (!dir) return { problem: 'no snapshot for this call', cleanupProblems: [] }
  const cleanupProblems = []
  const snapshot = takeSnapshot(dir, id, cleanupProblems)
  cleanupProblems.push(...removeStaleSnapshots(dir))
  if (snapshot === null) return { problem: 'no snapshot for this call', cleanupProblems }
  if (snapshot === UNREADABLE) return { problem: "this call's snapshot could not be read", cleanupProblems }
  if (!validSnapshot(snapshot)) return { problem: 'the snapshot for this call is not valid (changed after it was taken?)', cleanupProblems }
  return { snapshot, cleanupProblems }
}

// Files added or changed since the snapshot, each with its content before (null for a new file).
const changedSince = (before, after) => Object.entries(after)
  .filter(([rel, content]) => before[rel] !== content)
  .map(([rel, content]) => ({ file: rel, content, base: before[rel] ?? null }))

// --end-of-options: an id or path must never be read as a git option.
const blob = (root, spec) => gitRunner.run(root, ['cat-file', 'blob', '--end-of-options', spec])

// A file's content in a commit, or null when the commit doesn't have it (a file the command added has no base).
const baseIn = (root, commit, rel) => {
  try {
    return blob(root, `${commit}:./${rel}`)
  } catch (e) {
    if (/does not exist|exists on disk, but not in/.test(String(e.stderr))) return null
    throw e
  }
}

// Workflows a command committed (a moved or new ref) or staged since the snapshot, which needn't change the files on
// disk. Content that was already on disk before the command is skipped: it was checked when it was written.
const changedInGit = (root, before, after, filesBefore) => {
  const changed = []
  const add = (file, content, base, source) => {
    if (filesBefore[file] !== content) changed.push({ file, content, base, source })
  }
  // HEAD last, so a commit on a branch is named by the branch; a detached-HEAD commit is still seen.
  const refs = Object.entries(after.refs).sort(([a], [b]) => (a === 'HEAD') - (b === 'HEAD'))
  for (const [ref, sha] of refs) {
    const old = before.refs[ref]
    if (old === sha) continue
    const base = old ?? before.refs.HEAD ?? null // a new ref is compared with HEAD before the command
    const names = base
      ? gitRunner.run(root, ['diff', '-z', '--name-only', '--relative', '--no-renames', '--diff-filter=d', '--end-of-options', base, sha, '--', WORKFLOW_DIR])
      : gitRunner.run(root, ['ls-tree', '-r', '-z', '--name-only', '--end-of-options', sha, '--', WORKFLOW_DIR])
    for (const rel of names.split('\0').filter((n) => WORKFLOW_FILE.test(n))) {
      add(rel, blob(root, `${sha}:./${rel}`), base && baseIn(root, base, rel), `commit on ${ref}`)
    }
  }
  for (const [rel, id] of Object.entries(after.index)) {
    const old = before.index[rel]
    if (old !== id) add(rel, blob(root, id), old ? blob(root, old) : null, 'staged')
  }
  return changed
}

// One entry per file and content, the first kept: a workflow written, staged and committed by one command is checked
// once, as a change on disk.
const uniqueChanges = (changed) => {
  const seen = new Set()
  return changed.filter((c) => {
    const key = `${c.file}\0${c.content}`
    return !seen.has(key) && seen.add(key)
  })
}

// Fallback without a snapshot: workflow files that differ from HEAD, untracked and git-ignored ones included (GitHub
// runs whatever is pushed, and an ignored file can still be force-added), with HEAD as the base. `-z` keeps names git
// would otherwise quote (non-ASCII ones) intact. Staged content is checked from the index, so a workflow staged
// without changing the file on disk is seen; a file with a merge conflict has no single staged version (`u`), so it is
// checked as it is on disk. With no commit yet, everything in the index or untracked is new.
const changedSinceHead = (root, isWorkflowPath) => {
  const names = (args) => gitRunner.run(root, args).split('\0').filter(isWorkflowPath)
  let hasHead = true
  let onDisk
  try {
    onDisk = names(['diff', '-z', '--name-only', '--relative', 'HEAD', '--', WORKFLOW_DIR])
  } catch (e) {
    if (!/unknown revision|bad revision/.test(String(e.stderr))) throw e
    hasHead = false
    onDisk = []
  }
  const staged = hasHead
    ? names(['diff', '-z', '--cached', '--name-only', '--relative', '--diff-filter=du', 'HEAD', '--', WORKFLOW_DIR])
    : names(['ls-files', '-z', '--cached', '--', WORKFLOW_DIR])
  onDisk.push(...names(['ls-files', '-z', '--others', '--', WORKFLOW_DIR]), ...(hasHead ? [] : staged))
  const base = (rel) => (hasHead ? baseIn(root, 'HEAD', rel) : null)
  return {
    hasHead,
    changed: uniqueChanges([
      ...onDisk.filter((rel) => existsSync(path.join(root, rel)))
        .map((rel) => ({ file: rel, content: readFileSync(path.join(root, rel), 'utf8'), base: base(rel) })),
      ...staged.map((rel) => ({ file: rel, content: blob(root, `:./${rel}`), base: base(rel), source: 'staged' })),
    ]),
  }
}

// Runs the rules on the changed files; returns the findings with the repo allowlist applied, each naming where a
// change outside the files on disk was seen, and the config entries that couldn't be logged (`unlogged`).
const checkChanged = async (root, changed) => {
  const { loadConfig, sanitizeConfig, pendingAdvice, recordAdvice, configMarkerPath, CONFIG_FILE, CASE_INSENSITIVE_FS } = await import('./governance-policy.mjs')
  const { checkWorkflow, applyAllowlist } = await import('../../templates/github/scripts/governance-rules.mjs')
  const { cfg, error } = loadConfig(root)
  const { gov, problems, advisory, escalating } = sanitizeConfig(cfg)
  const unlogged = []
  const logConfig = (decision, reason) => {
    const logged = appendGovernanceLog(root, { tool: 'Bash', target: CONFIG_FILE, decision, reason })
    if (!logged) unlogged.push(reason)
    return logged
  }
  const escalates = !!error || escalating.length > 0
  if (escalates) logConfig('error', `config problem, checked with the rules that still apply: ${[error, ...problems].filter(Boolean).join('; ')}`)
  // ESP-35 R6: advisory problems alone are logged once per change, sharing the guard's marker. Beside an escalating
  // problem the marker is left alone, unless the config was read and has no advisory problem left: then it is cleared (R5).
  if (!escalates || (!error && !advisory.length)) {
    const marker = configMarkerPath(root)
    const { logReason, hash, markerError } = pendingAdvice(advisory, marker)
    // The marker is recorded only once the warning is in the log, so one that couldn't be logged is due again.
    const recordError = logReason && logConfig('warn', logReason) ? recordAdvice(marker, hash) : null
    for (const reason of [markerError, recordError]) if (reason) logConfig('error', reason)
  }
  const seenIn = (source) => (f) => (source ? { ...f, detail: `${f.detail} (seen in ${source})` } : f)
  return {
    findings: [
      ...changed.flatMap((c) => applyAllowlist(checkWorkflow(c), gov.allowlist || [], CASE_INSENSITIVE_FS).map(seenIn(c.source))),
      ...(gov.allowlistWarnings || []),
    ],
    unlogged,
  }
}

/** The hook's work for one Bash call in project `root`: returns the hook output, or null when there is nothing to show. */
export const checkAfterBash = async (input, root) => {
  if (input.tool_name !== 'Bash') return null
  const target = String(input.tool_input?.command || '')
  const logError = (reason) => appendGovernanceLog(root, { tool: 'Bash', target, decision: 'error', reason: `after-Bash workflow check: ${reason}` })
  const { snapshot: before, problem, cleanupProblems } = loadSnapshot(root, input.tool_use_id)
  cleanupProblems.forEach(logError)
  // A background command is still running when this hook fires, so its workflow changes can't be seen yet.
  if (input.tool_input?.run_in_background === true) {
    logError('background command, so its workflow changes were not checked')
    return null
  }
  let changed
  let gitProblem = null
  if (before) {
    changed = changedSince(before.files, readWorkflows(root))
    // A git failure here must not cost the findings for the files on disk.
    try {
      const gitAfter = before.git && readGit(root)
      if (gitAfter) changed = uniqueChanges([...changed, ...changedInGit(root, before.git, gitAfter, before.files)])
    } catch (e) {
      gitProblem = `git failed after the command, so workflows it committed or staged were not checked: ${e?.message || e}`
      logError(gitProblem)
    }
  } else if (!inGitRepo(root)) {
    changed = changedSince({}, readWorkflows(root))
    logError(`${problem} and the project has no git, so every workflow file was checked`)
  } else {
    const { isWorkflowPath } = await import('../../templates/github/scripts/workflow-rules.mjs')
    const fallback = changedSinceHead(root, isWorkflowPath)
    changed = fallback.changed
    logError(fallback.hasHead
      ? `${problem}, so workflow files that differ from HEAD (on disk or staged) were checked instead`
      : `${problem} and there is no commit yet, so every staged and untracked workflow file was checked`)
  }
  // The common case: nothing to check, and the rules module is never loaded.
  if (!changed.length && !gitProblem) return null

  const { findings, unlogged } = changed.length ? await checkChanged(root, changed) : { findings: [], unlogged: [] }
  const { logEntries } = await import('./governance-policy.mjs')
  const { blockingFindings, formatFinding, oneLine } = await import('../../templates/github/scripts/governance-rules.mjs')
  const logged = logEntries({ target, findings }, 'Bash').map((entry) => appendGovernanceLog(root, entry)).every(Boolean)
  const blocking = blockingFindings(findings)
  // The log is the only record of a warning, so findings that can't be logged are shown instead. A git failure is
  // shown too: it is exactly when a committed or staged workflow could slip through.
  if (!blocking.length && logged && !gitProblem && !unlogged.length) return null
  const notes = [
    blocking.length ? `The Bash command changed ${changed.length} workflow file(s) with ${blocking.length} high-risk finding(s). Fix them before going on.` : null,
    !blocking.length && !logged ? `The Bash command changed ${changed.length} workflow file(s); its findings could not be logged to .claude/governance-log.jsonl.` : null,
    gitProblem ? `${oneLine(gitProblem, 500)}.` : null, // git's message can hold line breaks; the log keeps it whole
    unlogged.length ? `This could not be logged to .claude/governance-log.jsonl: ${oneLine(unlogged.join(' '), 1500)}` : null,
  ].filter(Boolean)
  const message = `[governance] ${notes.join(' ')}${findings.length ? ` Findings: ${findings.map(formatFinding).join(' ')}` : ''}`
  return { systemMessage: message, hookSpecificOutput: { hookEventName: input.hook_event_name || 'PostToolUse', additionalContext: message } }
}

// Run as a hook only when executed directly; the guard and the tests import the exports above.
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  let root = process.env.CLAUDE_PROJECT_DIR || process.cwd()
  let target = ''
  try {
    let raw = ''
    for await (const c of process.stdin) raw += c
    const input = JSON.parse(raw || '{}')
    root = process.env.CLAUDE_PROJECT_DIR || input.cwd || root
    target = String(input.tool_input?.command || '')
    const out = await checkAfterBash(input, root)
    if (out) process.stdout.write(JSON.stringify(out))
    process.exit(0)
  } catch (e) {
    appendGovernanceLog(root, { tool: 'Bash', target, decision: 'error', reason: `after-Bash workflow check failed open: ${e?.message || e}` })
    process.stderr.write(`[governance] after-Bash workflow check error, workflow changes not checked: ${e?.message || e}\n`)
    process.exit(0)
  }
}
