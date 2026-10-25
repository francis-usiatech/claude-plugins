// Usage: node docs/audits/2026-10-24-usage-audit/usage.cjs <transcript dir>... (e.g. ~/.claude/projects/<project-slug>). Week is FROM/TO below; ESP-117 baseline.
// Attribute last week's heiit token usage to the usiatech-engineering plugin.
const fs = require('fs'), path = require('path')

const FROM = new Date('2026-10-17T00:00:00'), TO = new Date('2026-10-24T00:00:00')
// Opus-relative cost weights per token: input, cache write 5m/1h, cache read, output
const w = u => (u.input_tokens || 0) + 1.25 * (u.cache_creation?.ephemeral_5m_input_tokens || 0) +
  2 * (u.cache_creation?.ephemeral_1h_input_tokens ?? (u.cache_creation_input_tokens || 0)) +
  0.1 * (u.cache_read_input_tokens || 0) + 5 * (u.output_tokens || 0)
const isUsia = s => /usiatech/i.test(s || '')

function readJsonl(f) {
  return fs.readFileSync(f, 'utf8').split('\n').filter(Boolean).map(l => { try { return JSON.parse(l) } catch { return null } }).filter(Boolean)
}
function inWeek(recs) { return recs.some(r => r.timestamp && new Date(r.timestamp) >= FROM && new Date(r.timestamp) < TO) }

const tot = { all: 0, main: 0, sub: 0 }
const subByType = {}, subModel = {}, skillUse = {}, usiaHooks = {}, ctxCarry = { skill: 0, hook: 0 }
let sessions = 0
const win = {}

function costOf(recs, onMsg) {
  const seen = new Set(); let sum = 0
  for (const r of recs) {
    if (r.type !== 'assistant' || !r.message?.usage) continue
    const id = r.message.id || r.uuid
    if (seen.has(id)) continue
    seen.add(id)
    const c = w(r.message.usage); sum += c
    onMsg && onMsg(r, c)
  }
  return sum
}

for (const ROOT of process.argv.slice(2)) for (const f of fs.readdirSync(ROOT).filter(n => n.endsWith('.jsonl'))) {
  const recs = readJsonl(path.join(ROOT, f))
  if (!inWeek(recs)) continue
  sessions++
  // main thread: track injected plugin text, then charge it at cache-read rate on every later call
  let carrySkill = 0, carryHook = 0, activeSkill = null
  const main = costOf(recs.map((r, i) => (r.__i = i, r)), null)
  let cursor = 0
  const asstIdx = []
  const seen = new Set()
  recs.forEach((r, i) => { if (r.type === 'assistant' && r.message?.usage && !seen.has(r.message.id)) { seen.add(r.message.id); asstIdx.push(i) } })
  for (let i = 0; i < recs.length; i++) {
    const r = recs[i]
    if (r.type === 'assistant') for (const c of r.message?.content || []) {
      if (c.type === 'tool_use' && c.name === 'Skill') { const k = c.input?.skill; skillUse[k] = skillUse[k] || { n: 0, chars: 0 }; skillUse[k].n++ }
    }
    if (r.type === 'user') {
      const txt = Array.isArray(r.message?.content) ? r.message.content.map(c => c.text || '').join('') : String(r.message?.content || '')
      const genuine = !r.isMeta && !(Array.isArray(r.message?.content) && r.message.content.some(c => c.type === 'tool_result')) && !/^<(command|local|task-notif)/.test(txt.trim())
      if (genuine) activeSkill = null
      const m = txt.match(/Base directory for this skill: \S*usiatech-engineering\S*skills[\\/]+([\w-]+)/)
      if (m) activeSkill = m[1]
      if (m) { const k = 'usiatech-engineering:' + m[1]; skillUse[k] = skillUse[k] || { n: 0, chars: 0 }; skillUse[k].chars += txt.length; carrySkill += txt.length }
    }
    const a = r.attachment
    if (a && (a.type === 'hook_success' || a.type === 'hook_additional_context') && /governance-guard|bash-workflow-check/.test(a.command || '') ) {
      const k = a.hookName + ' ' + ((a.command || '').match(/[\w-]+\.mjs/) || [''])[0]
      usiaHooks[k] = usiaHooks[k] || { n: 0, chars: 0 }; usiaHooks[k].n++
      let ctx = ''
      try { ctx = JSON.parse(a.stdout || '{}').hookSpecificOutput?.additionalContext || '' } catch {}
      usiaHooks[k].chars += ctx.length + (a.content || '').length; carryHook += ctx.length
    }
    // each assistant call after this point re-reads the carried text from cache
    if (r.type === 'assistant' && r.message?.usage && asstIdx.includes(i)) {
      if (activeSkill) { win[activeSkill] = (win[activeSkill] || 0) + w(r.message.usage); win.__all = (win.__all || 0) + w(r.message.usage) }
      ctxCarry.skill += carrySkill / 4 * 0.1; ctxCarry.hook += carryHook / 4 * 0.1
    }
  }
  tot.main += main
  const sd = path.join(ROOT, f.replace('.jsonl', ''), 'subagents')
  if (fs.existsSync(sd)) for (const sf of fs.readdirSync(sd).filter(n => n.endsWith('.jsonl'))) {
    let meta = {}; try { meta = JSON.parse(fs.readFileSync(path.join(sd, sf.replace('.jsonl', '.meta.json')), 'utf8')) } catch {}
    const t = meta.agentType || 'unknown'
    const srecs = readJsonl(path.join(sd, sf))
    const c = costOf(srecs, r => { const k = t + ' @ ' + r.message.model; subModel[k] = (subModel[k] || 0) + 1 })
    subByType[t] = subByType[t] || { n: 0, cost: 0, firstCtx: 0 }
    subByType[t].n++; subByType[t].cost += c
    const first = srecs.find(r => r.type === 'assistant' && r.message?.usage)?.message.usage
    if (first) subByType[t].firstCtx += (first.input_tokens || 0) + (first.cache_creation_input_tokens || 0) + (first.cache_read_input_tokens || 0)
    tot.sub += c
  }
}
tot.all = tot.main + tot.sub
const pct = x => (100 * x / tot.all).toFixed(1) + '%'
console.log('sessions', sessions, 'weighted units', Math.round(tot.all), 'main', pct(tot.main), 'sub', pct(tot.sub))
console.log('\nSubagents by type (count, cost share, avg first-call context tokens):')
Object.entries(subByType).sort((a, b) => b[1].cost - a[1].cost).forEach(([k, v]) => console.log(' ', k, v.n, pct(v.cost), Math.round(v.firstCtx / v.n)))
const usiaSub = Object.entries(subByType).filter(([k]) => isUsia(k)).reduce((s, [, v]) => s + v.cost, 0)
console.log('\nusiatech subagents total', pct(usiaSub))
console.log('usiatech skill text carried in main ctx', pct(ctxCarry.skill), ' hook text', pct(ctxCarry.hook))
console.log('\nMain-thread cost while a usiatech skill is driving the turn:')
Object.entries(win).sort((a, b) => b[1] - a[1]).forEach(([k, v]) => console.log(' ', k, pct(v)))
console.log('\nSkill invocations (count, injected chars):')
Object.entries(skillUse).sort((a, b) => b[1].chars - a[1].chars).slice(0, 20).forEach(([k, v]) => console.log(' ', k, v.n, v.chars))
console.log('\nusiatech hooks (fires, ctx chars):')
Object.entries(usiaHooks).sort((a, b) => b[1].chars - a[1].chars).slice(0, 15).forEach(([k, v]) => console.log(' ', k, v.n, v.chars))
console.log('\nModels for usiatech subagent calls:')
Object.entries(subModel).filter(([k]) => isUsia(k)).forEach(([k, v]) => console.log(' ', k, v))
