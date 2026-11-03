// Usage: node docs/audits/2026-10-24-usage-audit/window.cjs <from> <to> <transcript dir>... (e.g. ~/.claude/projects/<project-slug>). to is exclusive; ESP-117 baseline.
// Inside each usiatech skill window: calls, context size, tool mix, tool-result bytes, review rounds, in dollars at each call's model.
// Per release: main-thread context growth across its release-steps calls.
const fs = require('fs'), path = require('path')
const { callCost, reportGaps, parseArgs, readJsonl, inWeek, callId, callsById, contextTokens, userTurn } = require('./audit-common.cjs')

const args = parseArgs('window.cjs')
const HIGH_CONTEXT = 3e5
const isReleaseSteps = c => c.type === 'tool_use' && c.name === 'Skill' && /^(usiatech-engineering:)?release-steps$/.test(c.input?.skill || '')
const isCommitPhase = c => /^\s*(phase[=:\s]+)?commit\b/i.test(c.input?.args || '')
const unpriced = {}
const S = {}
const sessCost = []
const releases = []
const ctxBuckets = { '<100k': 0, '100-200k': 0, '200-400k': 0, '400k+': 0 }
let all = 0
const bucket = n => n < 1e5 ? '<100k' : n < 2e5 ? '100-200k' : n < 4e5 ? '200-400k' : '400k+'
for (const ROOT of args.dirs) for (const f of fs.readdirSync(ROOT).filter(n => n.endsWith('.jsonl'))) {
  const recs = readJsonl(path.join(ROOT, f))
  if (!inWeek(recs, args)) continue
  let active = null, sc = 0, maxCtx = 0, calls = 0
  // A release runs from its commit phase through the phases after it, however many skill windows or user turns that takes.
  // Another commit before any later phase is a retry of the same release.
  let release = null, stepFrom = null
  const seen = new Set(), toolName = {}, allCalls = callsById(recs)
  for (const r of recs) {
    if (r.type === 'user') {
      const { genuine, isToolResult, skill } = userTurn(r)
      // growth is measured within the turn: a user message, paste or compaction before the next call isn't the fork's
      if (genuine) { active = null; stepFrom = null }
      if (skill) { active = skill; S[active] = S[active] || { inv: 0, calls: 0, cost: 0, ctx: 0, tools: {}, trBytes: {}, agents: {}, bash: {} }; S[active].inv++ }
      if (active && isToolResult) for (const x of r.message.content) if (x.type === 'tool_result') {
        const n = toolName[x.tool_use_id] || '?'
        S[active].trBytes[n] = (S[active].trBytes[n] || 0) + JSON.stringify(x.content || '').length
      }
    }
    const call = r.type === 'assistant' && r.message?.usage && allCalls.get(callId(r))
    if (!call) continue
    const ctx = contextTokens(call.usage)
    if (!seen.has(callId(r)) && stepFrom !== null) { release.growth += ctx - stepFrom; stepFrom = null }
    for (const c of r.message.content || []) if (c.type === 'tool_use') {
      toolName[c.id] = c.name
      if (isReleaseSteps(c)) {
        const commit = isCommitPhase(c)
        if (!release || (commit && release.pastCommit)) { release = { session: f.slice(0, 8), start: ctx, steps: 0, growth: 0, pastCommit: false }; releases.push(release) }
        if (!commit) release.pastCommit = true
        release.steps++; stepFrom = ctx
      }
      if (active) {
        const s = S[active]; s.tools[c.name] = (s.tools[c.name] || 0) + 1
        if (c.name === 'Agent' || c.name === 'Task') { const t = c.input?.subagent_type || '?'; s.agents[t] = (s.agents[t] || 0) + 1 }
        if (c.name === 'Bash' || c.name === 'PowerShell') { const k = String(c.input?.command || '').replace(/\s+/g, ' ').slice(0, 40); s.bash[k] = (s.bash[k] || 0) + 1 }
      }
    }
    if (seen.has(callId(r))) continue
    seen.add(callId(r))
    const cost = callCost(call.usage, call.model, unpriced)
    all += cost; sc += cost; calls++; maxCtx = Math.max(maxCtx, ctx); ctxBuckets[bucket(ctx)] += cost
    if (active) { const s = S[active]; s.calls++; s.cost += cost; s.ctx += ctx }
  }
  sessCost.push([f.slice(0, 8), sc, calls, maxCtx])
}
const pct = x => (all ? 100 * x / all : 0).toFixed(1) + '%'
const top = (o, n) => Object.entries(o).sort((a, b) => b[1] - a[1]).slice(0, n).map(([k, v]) => k + '=' + v).join(', ')
console.log('sessions', sessCost.length, 'main total $' + all.toFixed(2))
for (const [k, s] of Object.entries(S).sort((a, b) => b[1].cost - a[1].cost)) {
  console.log(`\n## ${k}: ${s.inv} invocations, ${s.calls} API calls (${Math.round(s.calls / s.inv)}/inv), ${pct(s.cost)} main cost, avg ctx ${Math.round(s.ctx / s.calls / 1000)}k`)
  console.log('  tools:', top(s.tools, 10))
  console.log('  tool-result KB:', top(Object.fromEntries(Object.entries(s.trBytes).map(([a, b]) => [a, Math.round(b / 1024)])), 8))
  console.log('  agents:', top(s.agents, 8))
  console.log('  bash:', top(s.bash, 8))
}
console.log('\nMain cost by context size of the call:', Object.entries(ctxBuckets).map(([k, v]) => k + ' ' + pct(v)).join(', '))
console.log('Top sessions (id, share, calls, max ctx):')
sessCost.sort((a, b) => b[1] - a[1]).slice(0, 8).forEach(([id, c, n, m]) => console.log(' ', id, pct(c), n, Math.round(m / 1000) + 'k'))
const high = releases.filter(r => r.start > HIGH_CONTEXT)
const meanGrowth = rows => rows.length ? Math.round(rows.reduce((s, r) => s + r.growth, 0) / rows.length) : 0
console.log(`\nMain-thread growth across release-steps, per release (${releases.length} releases, mean ${meanGrowth(releases)}; ${high.length} started above 300k, mean ${meanGrowth(high)}):`)
releases.forEach(r => console.log(`  ${r.session}: start ${Math.round(r.start / 1000)}k, ${r.steps} release-steps, growth ${r.growth}${r.start > HIGH_CONTEXT ? ' (300k+)' : ''}`))
reportGaps(unpriced)
