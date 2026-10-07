#!/usr/bin/env node
// Deterministic PR governance checks (no AI). Part of the usiatech-engineering CI kit.
// Env: PR_BODY, PR_LABELS (JSON array of names), BASE_REF, HEAD_REF, GITHUB_STEP_SUMMARY
// The checks live in runGovernanceChecks() so tests can pass stub dependency lookups (D7); run as a script, this
// file wires the real npm lookups.
import { execFileSync } from 'node:child_process'
import { readFileSync, existsSync, appendFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  matchAny, isSecretEnvFile, isPlainObject, isStringArray, DEFAULT_ASK_PATHS,
  checkWorkflow, isWorkflowPath, checkDependencies, dependencyKind, checkFakePasses, isJsTsFile,
  parseAllowlist, applyAllowlist, allowlistWarnings, blockingFindings, formatFinding,
} from './governance-rules.mjs'
import { createLookups, lookupTargets, runLookups, CI_TIMEOUT_MS, CI_DEADLINE_MS } from './supply-chain-lookups.mjs'

// Developers check out on case-insensitive file systems, where `.ENV` or `Agents.MD` is the same file.
const IGNORE_CASE = true

// Read the config from the tree this script was loaded from, not the working directory.
// The workflow runs the base-branch copy (_gov/) against the PR checkout, so resolving
// relative to cwd would let a PR rewrite the rules it is about to be judged by.
const SCRIPT_GOV_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')

// R8 limits what a workflow allowlist entry can suppress, so the fix hint for workflow findings says how.
const WORKFLOW_ALLOWLIST_HINT = ' (a workflow entry needs one literal file path, and wf-unparsed cannot be allowlisted)'

const DEFAULT_REF_PATTERN = String.raw`(\bC\d{1,2}\b|\bFR-\d{2}\b|\bAC-\d{2}\b|\bADR-\d{4}\b|\bD\d{1,2}\b|§\s?\d+|#\d+)`

// The base-branch config, with typed readers that report a wrong-type key and fall back to the default for it.
const baseConfig = (govRoot, configError) => {
  const configPath = path.join(govRoot, '.claude/engineering.json')
  let cfg = {}
  if (existsSync(configPath)) {
    try {
      const parsed = JSON.parse(readFileSync(configPath, 'utf8'))
      if (isPlainObject(parsed)) cfg = parsed
      else configError('not a JSON object.')
    } catch (e) {
      configError(`could not be parsed: ${e.message}`)
    }
  }
  const objectKey = (obj, key) => {
    if (obj[key] == null || isPlainObject(obj[key])) return obj[key] || {}
    configError(`"${key}" must be an object.`)
    return {}
  }
  const stringValue = (obj, key, label, fallback) => {
    if (obj[key] == null) return fallback
    if (typeof obj[key] === 'string' && obj[key]) return obj[key]
    configError(`"${label}" must be a non-empty string.`)
    return fallback
  }
  const stringList = (obj, key, label, fallback) => {
    if (obj[key] == null) return fallback
    if (isStringArray(obj[key])) return obj[key]
    configError(`"${label}" must be an array of strings.`)
    return fallback
  }
  return { cfg, objectKey, stringValue, stringList }
}

// -z gives raw, unquoted paths (git otherwise quotes non-ASCII names, which would slip past every path check).
// Records are NUL-separated: status, path, and a second path for renames and copies.
const changedFiles = (base, cwd) => {
  const fields = execFileSync('git', ['-c', 'core.quotePath=false', 'diff', '--name-status', '-z', `origin/${base}...HEAD`], { cwd, encoding: 'utf8' })
    .split('\0').filter(Boolean)
  const changes = []
  for (let i = 0; i < fields.length;) {
    const status = fields[i]
    const count = /^[RC]/.test(status) ? 2 : 1
    changes.push([status, ...fields.slice(i + 1, i + 1 + count)])
    i += 1 + count
  }
  return changes
}

/**
 * Runs every governance check on the PR checked out in `cwd` and builds the report.
 * @param {object} opts
 * @param {Record<string, string|undefined>} opts.env  PR_BODY, PR_LABELS, BASE_REF, HEAD_REF
 * @param {{ registry: Function, advisories: Function }} opts.lookups  dependency lookups (createLookups() in CI)
 * @param {string} [opts.govRoot]  tree holding the base-branch .claude/engineering.json (this script's own by default)
 * @param {string} [opts.cwd]      PR checkout
 * @param {number} [opts.lookupDeadlineMs]  bound on all dependency lookups together (CI_DEADLINE_MS by default)
 * @returns {Promise<{ exitCode: 0|1, report: string, errors: string[], warnings: string[], notes: string[] }>}
 */
export const runGovernanceChecks = async ({ env, lookups, govRoot = SCRIPT_GOV_ROOT, cwd = process.cwd(), lookupDeadlineMs = CI_DEADLINE_MS }) => {
  if (!lookups) throw new Error('runGovernanceChecks needs the dependency lookups')
  const errors = []
  const notes = []
  const warnings = []

  // A broken base-branch config fails the checks with a readable reason; the defaults apply for the bad keys.
  const configError = (msg) => errors.push(`Base-branch .claude/engineering.json: ${msg}`)
  const { cfg, objectKey, stringValue, stringList } = baseConfig(govRoot, configError)
  const gov = objectKey(cfg, 'governance')
  const git = objectKey(cfg, 'git')
  const baseBranch = stringValue(git, 'baseBranch', 'git.baseBranch', 'develop')
  const releaseBranch = stringValue(git, 'releaseBranch', 'git.releaseBranch', 'main')
  const approvalLabel = stringValue(gov, 'approvalLabel', 'governance.approvalLabel', 'governance-approved')

  const body = (env.PR_BODY || '').replace(/<!--[\s\S]*?-->/g, '')
  const labels = JSON.parse(env.PR_LABELS || '[]')
  const base = env.BASE_REF
  const head = env.HEAD_REF
  const approved = labels.includes(approvalLabel)

  // 1. Requirement references
  let refRe = new RegExp(DEFAULT_REF_PATTERN)
  try {
    refRe = new RegExp(stringValue(gov, 'requirementRefPattern', 'governance.requirementRefPattern', DEFAULT_REF_PATTERN))
  } catch (e) {
    configError(`"governance.requirementRefPattern" is not a valid regex: ${e.message}`)
  }
  const section = body.split(/^##\s+/m).find((s) => /^requirement references/i.test(s)) || ''
  if (!refRe.test(section)) {
    errors.push('PR description has no requirement reference under "## Requirement references" (intent §, C-number, FR-/AC-, ADR-NNNN, D-item or #issue).')
  }

  // 2. Branch flow
  if (base === releaseBranch && head !== baseBranch && !/^hotfix\//.test(head)) {
    errors.push(`PRs into "${releaseBranch}" must come from "${baseBranch}" (or a hotfix/* branch). This PR comes from "${head}".`)
  }

  // 3. Changed files
  const changes = changedFiles(base, cwd)
  const govPaths = stringList(gov, 'askPaths', 'governance.askPaths', DEFAULT_ASK_PATHS)
  const immutable = stringList(cfg, 'immutableWhenCommitted', 'immutableWhenCommitted', [])
  const govTouched = []
  for (const [status, p1, p2] of changes) {
    const target = p2 || p1
    for (const p of [p1, p2].filter(Boolean)) {
      if (isSecretEnvFile(path.posix.basename(p), cfg.allowEnvExample !== false, IGNORE_CASE) && status !== 'D') errors.push(`Env file committed: ${p}`)
    }
    if (/^(M|D|R)/.test(status) && matchAny(p1, immutable, IGNORE_CASE)) errors.push(`Committed immutable file changed (${status}): ${p1}. Create a new file (e.g. a new migration) instead.`)
    const hit = matchAny(target, govPaths, IGNORE_CASE)
    if (hit) govTouched.push(target)
  }
  if (govTouched.length) {
    const msg = `Governance/CI/dependency files changed: ${govTouched.join(', ')}.`
    if (approved) notes.push(`${msg} Accepted via label "${approvalLabel}".`)
    else errors.push(`${msg} The Document Owner must review and add the label "${approvalLabel}".`)
  }

  // 4. Workflow content (R12): the shared rules on each added, changed or renamed workflow, compared with its
  // base-branch version. Unsuppressed high-risk findings fail unless labelled; the rest are reported.
  const allow = parseAllowlist(gov.allowlist)
  allow.problems.forEach((p) => configError(`${p}.`))
  // The buffer fits the largest file the rules read (1,000,000 characters of up to 4 UTF-8 bytes), so the size rule
  // decides what is unreadable, not node's 1 MiB default.
  const show = (ref, p) => execFileSync('git', ['show', `${ref}:${p}`], { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], maxBuffer: 8 * 1024 * 1024 })
  // Each added, changed or renamed file of one kind, with its base-branch version (null when added). With
  // otherKindIsNew, a file renamed or copied from a path of another kind counts as added too (R9).
  const readChanged = (isKind, what, otherKindIsNew = false) => {
    const files = []
    for (const [status, p1, p2] of changes) {
      const target = p2 || p1
      if (status === 'D' || !isKind(target)) continue
      const isNew = status === 'A' || (otherKindIsNew && !isKind(p1))
      try {
        files.push({ file: target, content: show('HEAD', target), base: isNew ? null : show(`origin/${base}`, p1) })
      } catch (e) {
        errors.push(`Could not read ${target} to check its ${what} content: ${e.message.split('\n')[0]}`)
      }
    }
    return files
  }
  // Unsuppressed high-risk findings fail unless labelled; the rest are reported as warnings.
  const reportFindings = (label, findings) => {
    const checked = applyAllowlist(findings, allow.entries, IGNORE_CASE)
    const blocking = blockingFindings(checked)
    if (blocking.length) {
      const msg = `${label} changes have ${blocking.length} high-risk finding(s): ${blocking.map(formatFinding).join(' ')}`
      if (approved) notes.push(`${msg} Accepted via label "${approvalLabel}".`)
      else errors.push(`${msg} Fix them, allowlist them in the base-branch .claude/engineering.json${label === 'Workflow' ? WORKFLOW_ALLOWLIST_HINT : ''}, or have the Document Owner add the label "${approvalLabel}".`)
    }
    for (const f of checked.filter((x) => !blocking.includes(x))) warnings.push(formatFinding(f))
  }
  const workflows = readChanged(isWorkflowPath, 'workflow', true)
  reportFindings('Workflow', workflows.flatMap(checkWorkflow))
  // R8: allowlist entries that can't suppress a workflow finding, once per run when workflows were checked.
  if (workflows.length) warnings.push(...allowlistWarnings(gov.allowlist).map(formatFinding))

  // 5. Dependency content (R1–R6): the offline rules on each changed manifest and lockfile, then the advisory and
  // registry lookups across all of them, so a manifest range is looked up at the version its lockfile pins.
  // A lockfile is drift only when the package.json beside it did not change. A lookup that fails or times out
  // fails the check (R13): the label can't stand in for an advisory check that never ran.
  const depFiles = readChanged((p) => !!dependencyKind(p), 'dependency')
  const manifestDirs = new Set(depFiles.filter((f) => dependencyKind(f.file) === 'manifest').map((f) => path.posix.dirname(f.file)))
  const offline = depFiles.flatMap((f) => checkDependencies({ ...f, manifestChanged: manifestDirs.has(path.posix.dirname(f.file)) }))
  const online = await runLookups({ targets: lookupTargets(depFiles), lookups, deadlineMs: lookupDeadlineMs })
  for (const f of online.failures) errors.push(`Dependency lookup unavailable: ${f.lookup} (${f.reason}). The advisory and registry checks did not run; re-run the job when the npm registry is reachable.`)
  reportFindings('Dependency', [...offline, ...online.findings])

  // 6. Test content (R10, D2): the fp-* rules on each added, changed or renamed JS/TS file, read in full. A file git
  // can't read goes to the rules as null, so it is a tiered fp-unreadable finding, as in the local check (R11).
  const fakePassFindings = []
  for (const [status, p1, p2] of changes) {
    const file = p2 || p1
    if (status === 'D' || !isJsTsFile(file)) continue
    let content = null
    let readError = ''
    try {
      content = show('HEAD', file)
    } catch (e) {
      // A test file becomes fp-unreadable with git's reason; other JS/TS files only get fp-placeholder, which needs text.
      // git's own reason is on stderr; e.message starts with node's "Command failed: …" line.
      readError = String(e.stderr || '').trim().split('\n')[0] || e.code || e.message.split('\n')[0]
    }
    fakePassFindings.push(...checkFakePasses({ file, content })
      .map((f) => (readError && f.rule === 'fp-unreadable' ? { ...f, detail: `${f.detail} (git: ${readError})` } : f)))
  }
  reportFindings('Test', fakePassFindings)

  // Report
  const lines = ['## Governance checks', '', `Files changed: ${changes.length}`, '']
  for (const e of errors) lines.push(`- ❌ ${e}`)
  for (const w of warnings) lines.push(`- ⚠️ ${w}`)
  for (const n of notes) lines.push(`- ℹ️ ${n}`)
  if (!errors.length) lines.push('- ✅ All deterministic governance checks passed.')
  return { exitCode: errors.length ? 1 : 0, report: lines.join('\n') + '\n', errors, warnings, notes }
}

// Entry point: the real npm lookups, each request with its own CI timeout (D5).
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const { exitCode, report } = await runGovernanceChecks({ env: process.env, lookups: createLookups({ timeoutMs: CI_TIMEOUT_MS }) })
  console.log(report)
  if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY, report)
  process.exitCode = exitCode
}
