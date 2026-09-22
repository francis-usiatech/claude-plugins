#!/usr/bin/env node
// Deterministic PR governance checks (no AI). Part of the usiatech-engineering CI kit.
// Env: PR_BODY, PR_LABELS (JSON array of names), BASE_REF, HEAD_REF, GITHUB_STEP_SUMMARY
import { execSync } from 'node:child_process'
import { readFileSync, existsSync, appendFileSync } from 'node:fs'
import path from 'node:path'

const globToRegExp = (g) => new RegExp('^' + g
  .replace(/[.+^${}()|[\]\\]/g, '\\$&')
  .replace(/\*\*\//g, '\u0001').replace(/\*\*/g, '\u0002')
  .replace(/\*/g, '[^/]*').replace(/\?/g, '[^/]')
  .replace(/\u0001/g, '(?:.*/)?').replace(/\u0002/g, '.*') + '$')
const matchAny = (p, globs) => globs.find((g) => globToRegExp(g).test(p))

const cfg = existsSync('.claude/engineering.json') ? JSON.parse(readFileSync('.claude/engineering.json', 'utf8')) : {}
const gov = cfg.governance || {}
const git = cfg.git || {}
const baseBranch = git.baseBranch || 'develop'
const releaseBranch = git.releaseBranch || 'main'
const approvalLabel = gov.approvalLabel || 'governance-approved'

const body = (process.env.PR_BODY || '').replace(/<!--[\s\S]*?-->/g, '')
const labels = JSON.parse(process.env.PR_LABELS || '[]')
const base = process.env.BASE_REF
const head = process.env.HEAD_REF
const approved = labels.includes(approvalLabel)
const errors = []
const notes = []

// 1. Requirement references
const refRe = new RegExp(gov.requirementRefPattern || String.raw`(\bC\d{1,2}\b|\bFR-\d{2}\b|\bAC-\d{2}\b|\bADR-\d{4}\b|\bD\d{1,2}\b|§\s?\d+|#\d+)`)
const section = body.split(/^##\s+/m).find((s) => /^requirement references/i.test(s)) || ''
if (!refRe.test(section)) {
  errors.push('PR description has no requirement reference under "## Requirement references" (intent §, C-number, FR-/AC-, ADR-NNNN, D-item or #issue).')
}

// 2. Branch flow
if (base === releaseBranch && head !== baseBranch && !/^hotfix\//.test(head)) {
  errors.push(`PRs into "${releaseBranch}" must come from "${baseBranch}" (or a hotfix/* branch). This PR comes from "${head}".`)
}

// 3. Changed files
const diff = execSync(`git diff --name-status origin/${base}...HEAD`, { encoding: 'utf8' }).trim()
const changes = diff ? diff.split('\n').map((l) => l.split('\t')) : []
const govPaths = gov.askPaths || ['.claude/**', 'AGENTS.md', '**/AGENTS.md', 'CLAUDE.md', 'REVIEW.md', '.github/**', '**/package.json']
const immutable = cfg.immutableWhenCommitted || []
const govTouched = []
for (const [status, p1, p2] of changes) {
  const target = p2 || p1
  for (const p of [p1, p2].filter(Boolean)) {
    const b = path.posix.basename(p)
    if (/^\.env(\..+)?$/.test(b) && b !== '.env.example' && status !== 'D') errors.push(`Env file committed: ${p}`)
  }
  if (/^(M|D|R)/.test(status) && matchAny(p1, immutable)) errors.push(`Committed immutable file changed (${status}): ${p1}. Create a new file (e.g. a new migration) instead.`)
  const hit = matchAny(target, govPaths)
  if (hit) govTouched.push(target)
}
if (govTouched.length) {
  const msg = `Governance/CI/dependency files changed: ${govTouched.join(', ')}.`
  if (approved) notes.push(`${msg} Accepted via label "${approvalLabel}".`)
  else errors.push(`${msg} The Document Owner must review and add the label "${approvalLabel}".`)
}

// Report
const lines = ['## Governance checks', '', `Files changed: ${changes.length}`, '']
for (const e of errors) lines.push(`- ❌ ${e}`)
for (const n of notes) lines.push(`- ℹ️ ${n}`)
if (!errors.length) lines.push('- ✅ All deterministic governance checks passed.')
const out = lines.join('\n') + '\n'
console.log(out)
if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY, out)
process.exit(errors.length ? 1 : 0)
