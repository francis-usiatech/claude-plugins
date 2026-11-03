// Shared by usage.cjs and window.cjs: prices, command-line arguments and transcript reading.
const fs = require('fs')

// $ per MTok, from https://platform.claude.com/docs/en/about-claude/pricing.md (read 2026-11-03).
const PRICES = {
  'claude-fable-5-1': { input: 10, write5m: 12.5, write1h: 20, read: 0.25, output: 50 },
  'claude-opus-5-5': { input: 4, write5m: 5, write1h: 8, read: 0.2, output: 20 },
  'claude-sonnet-5-5': { input: 2, write5m: 2.5, write1h: 4, read: 0.1, output: 10 },
  'claude-haiku-5-5': { input: 0.1, write5m: 0.125, write1h: 0.2, read: 0.01, output: 0.5 },
}
// Haiku 5.5 pays more when the whole prompt, cached tokens included, is over 100,000 tokens.
const HAIKU_LONG = { input: 0.5, write5m: 0.625, write1h: 1, read: 0.05, output: 2.5 }
const HAIKU_LONG_OVER = 100000
const SYNTHETIC = '<synthetic>'

const contextTokens = u => (u.input_tokens || 0) + (u.cache_creation_input_tokens || 0) + (u.cache_read_input_tokens || 0)

// The rates for one call, or null when it has no price: an unknown model, or fast mode, which isn't in the table.
// Dated ids such as claude-opus-5-5-20261001 match.
function rates(usage, model) {
  const id = Object.keys(PRICES).find(k => model === k || String(model).startsWith(k + '-'))
  if (!id || usage.speed === 'fast') return null
  return id === 'claude-haiku-5-5' && contextTokens(usage) > HAIKU_LONG_OVER ? HAIKU_LONG : PRICES[id]
}

// Dollars for one call. A call with no price is counted in unpriced and costs 0, so it can't pass as Opus.
function callCost(u, model, unpriced) {
  const p = rates(u, model)
  if (!p) { const k = (model || 'unknown') + (u.speed === 'fast' ? ' fast' : ''); unpriced[k] = (unpriced[k] || 0) + 1; return 0 }
  // cache_creation splits writes by duration; transcripts without it are charged at the 1h rate
  const write5m = u.cache_creation?.ephemeral_5m_input_tokens || 0
  const write1h = u.cache_creation ? u.cache_creation.ephemeral_1h_input_tokens || 0 : u.cache_creation_input_tokens || 0
  return ((u.input_tokens || 0) * p.input + write5m * p.write5m + write1h * p.write1h +
    (u.cache_read_input_tokens || 0) * p.read + (u.output_tokens || 0) * p.output) / 1e6
}

let unreadableLines = 0

// What the totals leave out.
function reportGaps(unpriced) {
  const rows = Object.entries(unpriced)
  if (rows.length) console.log('\nunpriced calls (cost left out):', rows.map(([k, n]) => k + ' ' + n).join(', '))
  if (unreadableLines) console.log('\nunreadable transcript lines (left out):', unreadableLines)
}

function parseDay(text) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(text || '')) return null
  const d = new Date(text + 'T00:00:00') // with a time and no zone, this is local time
  return d.getDate() === Number(text.slice(8)) ? d : null
}

// <from> <to> <dir>..., days in local time, to exclusive. Exits 2 on bad input.
function parseArgs(script) {
  const [fromText, toText, ...dirs] = process.argv.slice(2)
  const from = parseDay(fromText), to = parseDay(toText)
  if (!from || !to || from >= to || !dirs.length) {
    console.error(`Usage: node ${script} <from YYYY-MM-DD> <to YYYY-MM-DD, exclusive> <transcript dir>... (e.g. ~/.claude/projects/<project-slug>)`)
    process.exit(2)
  }
  return { from, to, dirs }
}

function readJsonl(f) {
  return fs.readFileSync(f, 'utf8').split('\n').filter(Boolean).map(l => { try { return JSON.parse(l) } catch { unreadableLines++; return null } }).filter(Boolean)
}

// A session counts whole when any of its records falls in the week.
const inWeek = (recs, { from, to }) => recs.some(r => r.timestamp && new Date(r.timestamp) >= from && new Date(r.timestamp) < to)

const callId = r => r.message.id || r.uuid

// One API call spans several records of a message.id: each has one content block, and only the last has the final output count.
function callsById(recs) {
  const calls = new Map()
  for (const r of recs) {
    if (r.type !== 'assistant' || !r.message?.usage || r.message.model === SYNTHETIC) continue
    const id = callId(r), call = calls.get(id) || { model: r.message.model, tools: [] }
    call.usage = r.message.usage
    for (const c of r.message.content || []) if (c.type === 'tool_use') call.tools.push(c)
    calls.set(id, call)
  }
  return calls
}

// How a user record moves the active skill window: genuine user text ends it, injected skill text starts one.
function userTurn(r) {
  const c = r.message?.content, text = Array.isArray(c) ? c.map(x => x.text || '').join('') : String(c || '')
  const isToolResult = Array.isArray(c) && c.some(x => x.type === 'tool_result')
  return {
    text, isToolResult,
    genuine: !r.isMeta && !isToolResult && !/^<(command|local|task-notif)/.test(text.trim()),
    skill: text.match(/Base directory for this skill: \S*usiatech-engineering\S*skills[\\/]+([\w-]+)/)?.[1],
  }
}

module.exports = { rates, callCost, reportGaps, parseArgs, readJsonl, inWeek, callId, callsById, contextTokens, userTurn }
