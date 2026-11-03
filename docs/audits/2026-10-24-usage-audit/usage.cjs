// Usage: node docs/audits/2026-10-24-usage-audit/usage.cjs <from> <to> <transcript dir>... (e.g. ~/.claude/projects/<project-slug>). to is exclusive; ESP-117 baseline.
// Attribute a week's token usage, in dollars at each call's model, to the usiatech-engineering plugin.
const fs = require('fs'), path = require('path')
const { rates, callCost, reportGaps, parseArgs, readJsonl, inWeek, callId, callsById, contextTokens, userTurn } = require('./audit-common.cjs')

const args = parseArgs('usage.cjs')
const isUsia = s => /usiatech/i.test(s || '')
const isFork = s => /\(fork\)$/.test(s)
// The release flow itself writes commit message and PR body files to the scratchpad and edits the plan; that isn't fixing.
const RELEASE_FLOW_PATH = /[\\/](temp|tmp)[\\/]|scratchpad|\.claude[\\/]plans/i
const isFixing = c => ['Edit', 'Write'].includes(c.name) && !RELEASE_FLOW_PATH.test(c.input?.file_path || '')

const unpriced = {}
const tot = { all: 0, main: 0, sub: 0 }
const subByType = {}, subModel = {}, skillUse = {}, usiaHooks = {}, ctxCarry = { skill: 0, hook: 0 }, releaseSplit = { fixing: 0, overhead: 0 }
let sessions = 0
const win = {}

function subagentLabel(meta, srecs) {
  const t = meta.agentType || 'unknown'
  if (isUsia(t)) return t
  const skill = srecs.filter(r => r.type === 'user').slice(0, 3).map(r => userTurn(r).skill).find(Boolean)
  return skill ? skill + ' (fork)' : t
}

for (const ROOT of args.dirs) for (const f of fs.readdirSync(ROOT).filter(n => n.endsWith('.jsonl'))) {
  const recs = readJsonl(path.join(ROOT, f))
  if (!inWeek(recs, args)) continue
  sessions++
  // main thread: track injected plugin text, then charge it at cache-read rate on every later call
  let carrySkill = 0, carryHook = 0, activeSkill = null
  const calls = callsById(recs), seen = new Set()
  for (const r of recs) {
    if (r.type === 'assistant') for (const c of r.message?.content || []) {
      if (c.type === 'tool_use' && c.name === 'Skill') { const k = c.input?.skill; skillUse[k] = skillUse[k] || { n: 0, chars: 0 }; skillUse[k].n++ }
    }
    if (r.type === 'user') {
      const { text, genuine, skill } = userTurn(r)
      if (genuine) activeSkill = null
      if (skill) { activeSkill = skill; const k = 'usiatech-engineering:' + skill; skillUse[k] = skillUse[k] || { n: 0, chars: 0 }; skillUse[k].chars += text.length; carrySkill += text.length }
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
    const call = r.type === 'assistant' && r.message?.usage && calls.get(callId(r))
    if (!call || seen.has(callId(r))) continue
    seen.add(callId(r))
    const cost = callCost(call.usage, call.model, unpriced)
    tot.main += cost
    if (activeSkill) { win[activeSkill] = (win[activeSkill] || 0) + cost; win.__all = (win.__all || 0) + cost }
    if (activeSkill === 'release') releaseSplit[call.tools.some(isFixing) ? 'fixing' : 'overhead'] += cost
    const read = rates(call.usage, call.model)?.read || 0
    ctxCarry.skill += carrySkill / 4 * read / 1e6; ctxCarry.hook += carryHook / 4 * read / 1e6
  }
  const sd = path.join(ROOT, f.replace('.jsonl', ''), 'subagents')
  if (fs.existsSync(sd)) for (const sf of fs.readdirSync(sd).filter(n => n.endsWith('.jsonl'))) {
    let meta = {}; try { meta = JSON.parse(fs.readFileSync(path.join(sd, sf.replace('.jsonl', '.meta.json')), 'utf8')) } catch {}
    const srecs = readJsonl(path.join(sd, sf))
    const t = subagentLabel(meta, srecs)
    subByType[t] = subByType[t] || { n: 0, cost: 0, firstCtx: 0 }
    subByType[t].n++
    for (const call of callsById(srecs).values()) {
      const c = callCost(call.usage, call.model, unpriced)
      const k = t + ' @ ' + call.model; subModel[k] = (subModel[k] || 0) + 1
      subByType[t].cost += c; tot.sub += c
    }
    const first = srecs.find(r => r.type === 'assistant' && r.message?.usage)?.message.usage
    if (first) subByType[t].firstCtx += contextTokens(first)
  }
}
tot.all = tot.main + tot.sub
const pct = x => (tot.all ? 100 * x / tot.all : 0).toFixed(1) + '%'
const dollars = x => '$' + x.toFixed(2)
const subCost = test => Object.entries(subByType).filter(([k]) => test(k)).reduce((s, [, v]) => s + v.cost, 0)
const usiaSub = subCost(isUsia), forks = subCost(isFork)
const pluginShare = (win.release || 0) + (win.verify || 0) + usiaSub + forks
console.log('sessions', sessions, 'total', dollars(tot.all), 'main', pct(tot.main), 'sub', pct(tot.sub))
console.log('plugin share (release + verify + reviewers + forks):', pct(pluginShare), dollars(pluginShare))
console.log('release window: fixing work', pct(releaseSplit.fixing), dollars(releaseSplit.fixing) + ', overhead', pct(releaseSplit.overhead), dollars(releaseSplit.overhead))
console.log('  a release-window call is fixing work when it has an Edit or Write tool use outside temp folders and .claude/plans; reads between edits fall in overhead')
console.log('\nSubagents by type, forks under their skill (count, cost share, avg first-call context tokens):')
Object.entries(subByType).sort((a, b) => b[1].cost - a[1].cost).forEach(([k, v]) => console.log(' ', k, v.n, pct(v.cost), Math.round(v.firstCtx / v.n)))
console.log('\nusiatech subagents total', pct(usiaSub), ' forks total', pct(forks))
console.log('usiatech skill text carried in main ctx', pct(ctxCarry.skill), ' hook text', pct(ctxCarry.hook))
console.log('\nMain-thread cost while a usiatech skill is driving the turn:')
Object.entries(win).sort((a, b) => b[1] - a[1]).forEach(([k, v]) => console.log(' ', k, pct(v)))
console.log('\nSkill invocations (count, injected chars):')
Object.entries(skillUse).sort((a, b) => b[1].chars - a[1].chars).forEach(([k, v]) => console.log(' ', k, v.n, v.chars))
console.log('\nusiatech hooks (fires, ctx chars):')
Object.entries(usiaHooks).sort((a, b) => b[1].chars - a[1].chars).slice(0, 15).forEach(([k, v]) => console.log(' ', k, v.n, v.chars))
console.log('\nModels for usiatech subagent and fork calls:')
Object.entries(subModel).filter(([k]) => isUsia(k) || / \(fork\) @ /.test(k)).forEach(([k, v]) => console.log(' ', k, v))
reportGaps(unpriced)
