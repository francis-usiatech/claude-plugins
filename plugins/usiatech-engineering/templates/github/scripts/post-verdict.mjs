#!/usr/bin/env node
// Posts/updates the single governance-review comment on the PR from the AI reviewer's structured output.
// Env: VERDICT_JSON, HEAD_SHA, PR_NUMBER, GITHUB_REPOSITORY, GITHUB_TOKEN, GITHUB_API_URL, GITHUB_STEP_SUMMARY
import { appendFileSync } from 'node:fs'
import { readApprovalLabel, prComments, verdictOf, isLegacyVerdict, verdictMarker, VERDICT_HEADER } from './governance-checks.mjs'

const api = process.env.GITHUB_API_URL || 'https://api.github.com'
const repo = process.env.GITHUB_REPOSITORY
const pr = process.env.PR_NUMBER
const sha = process.env.HEAD_SHA
const headers = { Authorization: `Bearer ${process.env.GITHUB_TOKEN}`, Accept: 'application/vnd.github+json', 'Content-Type': 'application/json' }

let v
try { v = JSON.parse(process.env.VERDICT_JSON || '') } catch { v = null }
if (!v || !['PASS', 'FLAG', 'BLOCK'].includes(v.verdict)) {
  v = { verdict: 'ERROR', summary: 'The AI governance review did not return a valid result. Re-run the ai-governance-review job.', findings: [], traceability: [] }
}
// `<` is escaped so AI text can't open an HTML comment that poses as the verdict marker.
const esc = (s) => String(s ?? '').replace(/\|/g, '\\|').replace(/\r?\n/g, ' ').replace(/</g, '&lt;')
const icon = { PASS: '✅', FLAG: '🟡', BLOCK: '⛔', ERROR: '⚠️' }[v.verdict]
const lines = [
  VERDICT_HEADER,
  `## ${icon} Governance review: ${v.verdict}`, '',
  `Commit \`${sha.slice(0, 7)}\``, '',
  esc(v.summary), '',
]
if (v.findings?.length) {
  lines.push('| # | Severity | Finding | Location | Rule / requirement | Action |', '|---|---|---|---|---|---|')
  v.findings.forEach((f, i) => lines.push(`| ${i + 1} | ${esc(f.severity)} | ${esc(f.finding)} | ${esc(f.file)}${f.line ? `:${esc(f.line)}` : ''} | ${esc(f.rule)} | ${esc(f.action)} |`))
  lines.push('')
}
if (v.traceability?.length) {
  lines.push('<details><summary>Traceability</summary>', '', '| Change | Requirement |', '|---|---|')
  v.traceability.forEach((t) => lines.push(`| ${esc(t.area)} | ${esc(t.requirement)} |`))
  lines.push('', '</details>', '')
}
lines.push(v.verdict === 'FLAG' ? `_FLAG needs the Document Owner's decision: fix the findings, or add the \`${readApprovalLabel()}\` label to accept them._` : '')
lines.push(verdictMarker({ verdict: v.verdict, sha }))
const body = lines.join('\n')

let existing
let legacy
let readError
try {
  for await (const c of prComments({ api, repo, pr, headers })) {
    if (verdictOf(c)) existing = c
    else if (isLegacyVerdict(c)) legacy = c
  }
} catch (e) {
  readError = e
}
// A comment from before 0.18.4 has no header; update it rather than add a second verdict comment (ESP-111).
existing ??= legacy
// exitCode rather than process.exit(): exiting while fetch sockets are still closing crashes Node on Windows.
if (readError) {
  // Posting without the full list would add a duplicate verdict comment (R10).
  console.error(`Failed to read PR comments: ${readError.message}`)
  process.exitCode = 1
} else {
  const res = existing
    ? await fetch(`${api}/repos/${repo}/issues/comments/${existing.id}`, { method: 'PATCH', headers, body: JSON.stringify({ body }) })
    : await fetch(`${api}/repos/${repo}/issues/${pr}/comments`, { method: 'POST', headers, body: JSON.stringify({ body }) })
  if (!res.ok) {
    console.error(`Failed to post verdict: ${res.status} ${await res.text()}`)
    process.exitCode = 1
  } else {
    if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY, body + '\n')
    console.log(`Verdict ${v.verdict} posted for ${sha}.`)
  }
}
