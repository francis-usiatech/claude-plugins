#!/usr/bin/env node
// Runs the same verification gate as the local `verify` skill, from .claude/engineering.json.
// Env: BASE_REF. Entries: { name, run, when?: [path prefixes], expectNoDiff?: [paths] }
import { execFileSync, spawnSync } from 'node:child_process'
import { readFileSync, existsSync, appendFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

// Read the config from the tree this script was loaded from, not the working directory.
// The workflow runs the base-branch copy (_gov/) against the PR checkout; resolving
// relative to cwd would let a PR empty its own verify list and pass the gate.
const govRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
const configPath = path.join(govRoot, '.claude/engineering.json')

const cfg = existsSync(configPath) ? JSON.parse(readFileSync(configPath, 'utf8')) : {}
const base = process.env.BASE_REF
// -z gives raw paths; without it git quotes non-ASCII names and no `when` prefix matches them.
const changed = base ? execFileSync('git', ['-c', 'core.quotePath=false', 'diff', '--name-only', '-z', `origin/${base}...HEAD`], { encoding: 'utf8' }).split('\0').filter(Boolean) : []
// The bootstrap skip holds only while the base branch has no package.json either; a PR that deletes it must not
// skip every npm step and pass (R6). govRoot is the base-branch checkout.
const hasPkg = existsSync('package.json') || existsSync(path.join(govRoot, 'package.json'))
const steps = [...(cfg.verify || []), ...(cfg.verifyConditional || []).filter((s) => (s.when || []).some((w) => changed.some((f) => f.startsWith(w))))]

// A missing or empty config must not report a pass. Without this, an absent
// engineering.json yields zero steps and the gate reports PASS having run nothing.
if (!steps.length) {
  console.error(`No verify steps found. Expected a non-empty "verify" array in ${configPath}.`)
  process.exit(1)
}

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
    const d = spawnSync('git', ['diff', '--quiet', '--', ...s.expectNoDiff])
    if (d.status !== 0) { ok = false; note = `❌ ${s.expectNoDiff.join(', ')} out of date. Run \`${s.run}\` and commit the result.` }
  }
  if (!ok) failed = true
  rows.push([s.name, s.run, note])
}
const out = ['## Verify gate', '', '| Check | Command | Result |', '|---|---|---|', ...rows.map((r) => `| ${r[0]} | \`${r[1]}\` | ${r[2]} |`), '', `**Gate: ${failed ? 'FAIL' : 'PASS'}**`, ''].join('\n')
console.log(out)
if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY, out)
process.exit(failed ? 1 : 0)
