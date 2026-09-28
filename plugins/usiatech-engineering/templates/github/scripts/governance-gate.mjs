#!/usr/bin/env node
// Final required check: combines deterministic checks, verify gate and the AI verdict for the current head commit.
// Env: NEEDS_JSON, PR_LABELS, HEAD_SHA, PR_NUMBER, GITHUB_REPOSITORY, GITHUB_TOKEN, GITHUB_API_URL, GITHUB_STEP_SUMMARY, APPROVAL_LABEL
import { appendFileSync } from 'node:fs'

const api = process.env.GITHUB_API_URL || 'https://api.github.com'
const repo = process.env.GITHUB_REPOSITORY
const pr = process.env.PR_NUMBER
const sha = process.env.HEAD_SHA
const needs = JSON.parse(process.env.NEEDS_JSON || '{}')
const labels = JSON.parse(process.env.PR_LABELS || '[]')
const approvalLabel = process.env.APPROVAL_LABEL || 'governance-approved'
const headers = { Authorization: `Bearer ${process.env.GITHUB_TOKEN}`, Accept: 'application/vnd.github+json' }
const problems = []
const notes = []
const result = (j) => needs[j]?.result

if (result('governance-checks') !== 'success') problems.push(`Deterministic governance checks: ${result('governance-checks') || 'missing'}.`)
if (!['success', 'skipped'].includes(result('verify-gate'))) problems.push(`Verify gate: ${result('verify-gate') || 'missing'}.`)
if (['failure', 'cancelled'].includes(result('ai-governance-review'))) problems.push(`AI governance review job: ${result('ai-governance-review')}.`)

// A skipped review is a deliberate opt-out (GOVERNANCE_AI_REVIEW=off, draft or fork PR),
// so it must not demand a verdict, and there is no point scanning for one.
const aiSkipped = result('ai-governance-review') === 'skipped'

let verdict = null
let page = 1
for (; !aiSkipped;) {
  const res = await fetch(`${api}/repos/${repo}/issues/${pr}/comments?per_page=100&page=${page}`, { headers })
  if (!res.ok) { problems.push(`Could not read PR comments to find the verdict: GitHub API returned ${res.status}. Re-run the gate.`); break }
  const list = await res.json()
  if (!Array.isArray(list) || !list.length) break
  for (const c of list) {
    if (c.user?.login !== 'github-actions[bot]') continue
    const m = c.body?.match(/<!-- governance-verdict (\{.*?\}) -->/)
    if (!m) continue
    try { const v = JSON.parse(m[1]); if (v.sha === sha) verdict = v.verdict } catch { /* ignore */ }
  }
  if (list.length < 100) break
  page++
}
if (aiSkipped) notes.push('AI governance review skipped; deterministic checks and the verify gate still applied.')
else if (!verdict) problems.push(`No AI governance verdict for commit ${sha.slice(0, 7)} (draft PR, fork PR, or the review has not run). Mark ready for review or re-run the workflow.`)
else if (verdict === 'BLOCK') problems.push('AI governance verdict is BLOCK. Fix the findings and push.')
else if (verdict === 'ERROR') problems.push('AI governance review errored. Re-run the ai-governance-review job.')
else if (verdict === 'FLAG' && !labels.includes(approvalLabel)) problems.push(`AI governance verdict is FLAG. Fix the findings or have the Document Owner add the "${approvalLabel}" label.`)

const out = ['## Governance gate', '', `AI verdict: **${verdict || (aiSkipped ? 'skipped' : 'none')}**`, '', ...notes.map((n) => `- ⏭️ ${n}`), ...(problems.length ? problems.map((p) => `- ❌ ${p}`) : ['- ✅ Governance gate passed.']), ''].join('\n')
console.log(out)
if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY, out)
// exitCode rather than process.exit(): exiting while fetch sockets are still closing crashes Node on Windows.
process.exitCode = problems.length ? 1 : 0
