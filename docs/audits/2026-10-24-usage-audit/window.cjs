// Usage: node docs/audits/2026-10-24-usage-audit/window.cjs <transcript dir>... (e.g. ~/.claude/projects/<project-slug>). Week is FROM/TO below; ESP-117 baseline.
// Inside each usiatech skill window: calls, context size, tool mix, tool-result bytes, review rounds.
const fs = require('fs'), path = require('path')

const FROM = new Date('2026-10-17T00:00:00'), TO = new Date('2026-10-24T00:00:00')
const w = u => (u.input_tokens || 0) + 1.25 * (u.cache_creation?.ephemeral_5m_input_tokens || 0) +
  2 * (u.cache_creation?.ephemeral_1h_input_tokens ?? (u.cache_creation_input_tokens || 0)) +
  0.1 * (u.cache_read_input_tokens || 0) + 5 * (u.output_tokens || 0)
const S = {}
const sessCost = []
const ctxBuckets = { '<100k': 0, '100-200k': 0, '200-400k': 0, '400k+': 0 }
let all = 0
const bucket = n => n < 1e5 ? '<100k' : n < 2e5 ? '100-200k' : n < 4e5 ? '200-400k' : '400k+'
for (const ROOT of process.argv.slice(2)) for (const f of fs.readdirSync(ROOT).filter(n => n.endsWith('.jsonl'))) {
  const recs = fs.readFileSync(path.join(ROOT, f), 'utf8').split('\n').filter(Boolean).map(l => { try { return JSON.parse(l) } catch { return null } }).filter(Boolean)
  if (!recs.some(r => r.timestamp && new Date(r.timestamp) >= FROM && new Date(r.timestamp) < TO)) continue
  let active = null, sc = 0, maxCtx = 0, calls = 0
  const seen = new Set(), toolName = {}
  for (const r of recs) {
    if (r.type === 'user') {
      const c = r.message?.content
      const txt = Array.isArray(c) ? c.map(x => x.text || '').join('') : String(c || '')
      const isTR = Array.isArray(c) && c.some(x => x.type === 'tool_result')
      if (!r.isMeta && !isTR && !/^<(command|local|task-notif)/.test(txt.trim())) active = null
      const m = txt.match(/Base directory for this skill: \S*usiatech-engineering\S*skills[\\/]+([\w-]+)/)
      if (m) { active = m[1]; S[active] = S[active] || { inv: 0, calls: 0, cost: 0, ctx: 0, tools: {}, trBytes: {}, agents: {}, bash: {} }; S[active].inv++ }
      if (active && isTR) for (const x of c) if (x.type === 'tool_result') {
        const n = toolName[x.tool_use_id] || '?'
        S[active].trBytes[n] = (S[active].trBytes[n] || 0) + JSON.stringify(x.content || '').length
      }
    }
    if (r.type !== 'assistant' || !r.message?.usage) continue
    for (const c of r.message.content || []) if (c.type === 'tool_use') {
      toolName[c.id] = c.name
      if (active) {
        const s = S[active]; s.tools[c.name] = (s.tools[c.name] || 0) + 1
        if (c.name === 'Agent' || c.name === 'Task') { const t = c.input?.subagent_type || '?'; s.agents[t] = (s.agents[t] || 0) + 1 }
        if (c.name === 'Bash' || c.name === 'PowerShell') { const k = String(c.input?.command || '').replace(/\s+/g, ' ').slice(0, 40); s.bash[k] = (s.bash[k] || 0) + 1 }
      }
    }
    if (seen.has(r.message.id)) continue
    seen.add(r.message.id)
    const u = r.message.usage, cost = w(u), ctx = (u.input_tokens || 0) + (u.cache_creation_input_tokens || 0) + (u.cache_read_input_tokens || 0)
    all += cost; sc += cost; calls++; maxCtx = Math.max(maxCtx, ctx); ctxBuckets[bucket(ctx)] += cost
    if (active) { const s = S[active]; s.calls++; s.cost += cost; s.ctx += ctx }
  }
  sessCost.push([f.slice(0, 8), sc, calls, maxCtx])
}
const pct = x => (100 * x / all).toFixed(1) + '%'
const top = (o, n) => Object.entries(o).sort((a, b) => b[1] - a[1]).slice(0, n).map(([k, v]) => k + '=' + v).join(', ')
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
