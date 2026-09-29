#!/usr/bin/env node
// Deterministic PR governance checks (no AI). Part of the usiatech-engineering CI kit.
// Env: PR_BODY, PR_LABELS (JSON array of names), BASE_REF, HEAD_REF, GITHUB_STEP_SUMMARY
import { execFileSync } from 'node:child_process'
import { readFileSync, existsSync, appendFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  matchAny, isSecretEnvFile, isPlainObject, isStringArray, DEFAULT_ASK_PATHS,
  checkWorkflow, isWorkflowPath, parseAllowlist, applyAllowlist, blockingFindings, formatFinding,
} from './governance-rules.mjs'

// Developers check out on case-insensitive file systems, where `.ENV` or `Agents.MD` is the same file.
const IGNORE_CASE = true

// Read the config from the tree this script was loaded from, not the working directory.
// The workflow runs the base-branch copy (_gov/) against the PR checkout, so resolving
// relative to cwd would let a PR rewrite the rules it is about to be judged by.
const govRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
const configPath = path.join(govRoot, '.claude/engineering.json')

const errors = []
const notes = []
const warnings = []

// A broken base-branch config fails the checks with a readable reason; the defaults apply for the bad keys.
const configError = (msg) => errors.push(`Base-branch .claude/engineering.json: ${msg}`)
const readConfig = () => {
  if (!existsSync(configPath)) return {}
  try {
    const parsed = JSON.parse(readFileSync(configPath, 'utf8'))
    if (isPlainObject(parsed)) return parsed
    configError('not a JSON object.')
  } catch (e) {
    configError(`could not be parsed: ${e.message}`)
  }
  return {}
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

const DEFAULT_REF_PATTERN = String.raw`(\bC\d{1,2}\b|\bFR-\d{2}\b|\bAC-\d{2}\b|\bADR-\d{4}\b|\bD\d{1,2}\b|§\s?\d+|#\d+)`
const cfg = readConfig()
const gov = objectKey(cfg, 'governance')
const git = objectKey(cfg, 'git')
const baseBranch = stringValue(git, 'baseBranch', 'git.baseBranch', 'develop')
const releaseBranch = stringValue(git, 'releaseBranch', 'git.releaseBranch', 'main')
const approvalLabel = stringValue(gov, 'approvalLabel', 'governance.approvalLabel', 'governance-approved')

const body = (process.env.PR_BODY || '').replace(/<!--[\s\S]*?-->/g, '')
const labels = JSON.parse(process.env.PR_LABELS || '[]')
const base = process.env.BASE_REF
const head = process.env.HEAD_REF
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
// -z gives raw, unquoted paths (git otherwise quotes non-ASCII names, which would slip past every path check).
// Records are NUL-separated: status, path, and a second path for renames and copies.
const diffFields = execFileSync('git', ['-c', 'core.quotePath=false', 'diff', '--name-status', '-z', `origin/${base}...HEAD`], { encoding: 'utf8' })
  .split('\0').filter(Boolean)
const changes = []
for (let i = 0; i < diffFields.length;) {
  const status = diffFields[i]
  const count = /^[RC]/.test(status) ? 2 : 1
  changes.push([status, ...diffFields.slice(i + 1, i + 1 + count)])
  i += 1 + count
}
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
const show = (ref, p) => execFileSync('git', ['show', `${ref}:${p}`], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] })
const findings = []
for (const [status, p1, p2] of changes) {
  const target = p2 || p1
  if (status === 'D' || !isWorkflowPath(target)) continue
  try {
    const before = status === 'A' ? null : show(`origin/${base}`, p1)
    findings.push(...checkWorkflow({ file: target, content: show('HEAD', target), base: before }))
  } catch (e) {
    errors.push(`Could not read ${target} to check its workflow content: ${e.message.split('\n')[0]}`)
  }
}
const checked = applyAllowlist(findings, allow.entries, IGNORE_CASE)
const blocking = blockingFindings(checked)
if (blocking.length) {
  const msg = `Workflow changes have ${blocking.length} high-risk finding(s): ${blocking.map(formatFinding).join(' ')}`
  if (approved) notes.push(`${msg} Accepted via label "${approvalLabel}".`)
  else errors.push(`${msg} Fix them, allowlist them in the base-branch .claude/engineering.json, or have the Document Owner add the label "${approvalLabel}".`)
}
for (const f of checked.filter((x) => !blocking.includes(x))) warnings.push(formatFinding(f))

// Report
const lines = ['## Governance checks', '', `Files changed: ${changes.length}`, '']
for (const e of errors) lines.push(`- ❌ ${e}`)
for (const w of warnings) lines.push(`- ⚠️ ${w}`)
for (const n of notes) lines.push(`- ℹ️ ${n}`)
if (!errors.length) lines.push('- ✅ All deterministic governance checks passed.')
const out = lines.join('\n') + '\n'
console.log(out)
if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY, out)
process.exit(errors.length ? 1 : 0)
