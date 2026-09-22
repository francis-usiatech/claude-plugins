#!/usr/bin/env node
// Runs the same verification gate as the local `verify` skill, from .claude/engineering.json.
// Env: BASE_REF. Entries: { name, run, when?: [path prefixes], expectNoDiff?: [paths] }
import { execSync, spawnSync } from 'node:child_process'
import { readFileSync, existsSync, appendFileSync } from 'node:fs'

const cfg = existsSync('.claude/engineering.json') ? JSON.parse(readFileSync('.claude/engineering.json', 'utf8')) : {}
const base = process.env.BASE_REF
const changed = base ? execSync(`git diff --name-only origin/${base}...HEAD`, { encoding: 'utf8' }).split('\n').filter(Boolean) : []
const hasPkg = existsSync('package.json')
const steps = [...(cfg.verify || []), ...(cfg.verifyConditional || []).filter((s) => (s.when || []).some((w) => changed.some((f) => f.startsWith(w))))]
const rows = []
let failed = false
for (const s of steps) {
  if (failed) { rows.push([s.name, s.run, '⏭️ not run']); continue }
  if (!hasPkg && /^(pnpm|npm|npx|yarn)\b/.test(s.run)) { rows.push([s.name, s.run, '⏭️ skipped (no package.json yet)']); continue }
  console.log(`\n▶ ${s.name}: ${s.run}`)
  const r = spawnSync(s.run, { shell: true, stdio: 'inherit' })
  let ok = r.status === 0
  let note = ok ? '✅ pass' : `❌ exit ${r.status}`
  if (ok && s.expectNoDiff?.length) {
    const d = spawnSync(`git diff --quiet -- ${s.expectNoDiff.map((p) => `"${p}"`).join(' ')}`, { shell: true })
    if (d.status !== 0) { ok = false; note = `❌ ${s.expectNoDiff.join(', ')} out of date. Run \`${s.run}\` and commit the result.` }
  }
  if (!ok) failed = true
  rows.push([s.name, s.run, note])
}
const out = ['## Verify gate', '', '| Check | Command | Result |', '|---|---|---|', ...rows.map((r) => `| ${r[0]} | \`${r[1]}\` | ${r[2]} |`), '', `**Gate: ${failed ? 'FAIL' : 'PASS'}**`, ''].join('\n')
console.log(out)
if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY, out)
process.exit(failed ? 1 : 0)
