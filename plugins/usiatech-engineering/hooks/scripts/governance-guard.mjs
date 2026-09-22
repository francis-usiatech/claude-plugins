#!/usr/bin/env node
// usiatech-engineering: governance guard (PreToolUse on Bash, Edit, MultiEdit, Write, NotebookEdit).
//
// Decisions:
//   deny  -> the action is refused (catastrophic or rule-breaking)
//   ask   -> the user must confirm (risky, outside the approved plan, or touches governance files)
//   allow -> no output, normal permission flow continues
//
// Repo config: .claude/engineering.json  (keys: protectedPaths, immutableWhenCommitted, allowEnvExample, governance{...})
// Approved plan: .claude/plans/active.md  ("## Files" section lists paths/globs in scope)
// Every deny/ask is appended to .claude/governance-log.jsonl.
// Internal errors fail open (exit 0) so a bug never wedges a session; the reviewer agent is the second line of defence.
import { readFileSync, existsSync, appendFileSync, mkdirSync } from 'node:fs'
import { execSync } from 'node:child_process'
import path from 'node:path'

const globToRegExp = (g) => new RegExp('^' + g
  .replace(/[.+^${}()|[\]\\]/g, '\\$&')
  .replace(/\*\*\//g, '\u0001')
  .replace(/\*\*/g, '\u0002')
  .replace(/\*/g, '[^/]*')
  .replace(/\?/g, '[^/]')
  .replace(/\u0001/g, '(?:.*/)?')
  .replace(/\u0002/g, '.*') + '$')
const matchAny = (rel, globs) => globs.find((g) => globToRegExp(g).test(rel))

// ---- Default command rules (regex, case-insensitive). Repos add more via governance.denyCommands / askCommands.
const DENY_COMMANDS = [
  ['destructive delete of root/home/workspace', String.raw`\brm\s+-[a-z]*(rf|fr)[a-z]*\s+(\/(\s|$)|~|\$HOME|\*|\.\/?(\s|$))`],
  ['piping a download into a shell', String.raw`\b(curl|wget)\b[^|;&]*\|\s*(sudo\s+)?(ba|z|da)?sh\b`],
  ['bypassing git hooks', String.raw`--no-verify\b`],
  ['disk/filesystem destruction', String.raw`\b(mkfs(\.\w+)?|dd\s+[^|]*of=\/dev\/|:\(\)\s*\{\s*:\|:&\s*\};:)`],
  ['dropping a database or schema', String.raw`\bdrop\s+(database|schema)\b`],
  ['machine shutdown/reboot', String.raw`\b(shutdown|reboot|halt|poweroff)\b`],
  ['world-writable recursive permissions', String.raw`\bchmod\s+-R\s+0?777\b`],
]
const ASK_COMMANDS = [
  ['force push', String.raw`\bgit\s+push\b.*(\s--force(-with-lease)?\b|\s-f\b|\s\+\S)`],
  ['discarding work (reset/clean/restore/checkout)', String.raw`\bgit\s+(reset\s+--hard|clean\s+-[a-z]*f|restore\s+\.|checkout\s+--\s+\.|stash\s+(drop|clear))`],
  ['deleting a branch', String.raw`\bgit\s+(branch\s+-D|push\s+\S+\s+--delete|push\s+\S+\s+:\S)`],
  ['rewriting history', String.raw`\bgit\s+(rebase|filter-branch|filter-repo|commit\s+--amend)\b`],
  ['recursive delete', String.raw`\brm\s+-[a-z]*r`],
  ['destructive SQL', String.raw`\b(drop\s+table|truncate\s+|delete\s+from\s+\w+\s*(;|$|"|'))`],
  ['weakening row-level security', String.raw`(disable\s+row\s+level\s+security|no\s+force\s+row\s+level\s+security|bypassrls)`],
  ['resetting/dropping a database', String.raw`\b(prisma\s+migrate\s+reset|drizzle-kit\s+drop|db:reset|db:drop)\b`],
  ['adding a dependency', String.raw`\b(npm\s+(i|install|add)\s+[^-\s]|pnpm\s+(add|install\s+[^-\s])|yarn\s+add|pip3?\s+install|npx\s+-y\s)`],
  ['publishing a package', String.raw`\b(npm|pnpm|yarn)\s+publish\b`],
  ['remote host / infrastructure change', String.raw`\b(ssh|scp|rsync)\s|\b(terraform\s+(apply|destroy)|kubectl\s+(apply|delete)|ansible-playbook\b(?!.*--check)|firebase\s+deploy|docker\s+(system\s+prune|volume\s+rm))`],
  ['reading secrets', String.raw`\b(cat|less|more|head|tail|type|bat)\s+[^|;&]*\.env(?!\.example)(\.[\w-]+)?(\s|$)|\bprintenv\b`],
  ['elevated privileges', String.raw`\bsudo\s`],
  ['world-writable permissions', String.raw`\bchmod\s+(-R\s+)?0?777\b`],
]

const out = (decision, reason, ctx) => {
  try {
    const dir = path.join(ctx.root, '.claude')
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true })
    appendFileSync(path.join(dir, 'governance-log.jsonl'),
      JSON.stringify({ ts: new Date().toISOString(), tool: ctx.tool, target: ctx.target.slice(0, 300), decision, reason }) + '\n')
  } catch { /* logging is best-effort */ }
  process.stdout.write(JSON.stringify({
    hookSpecificOutput: {
      hookEventName: 'PreToolUse',
      permissionDecision: decision,
      permissionDecisionReason: `[governance] ${reason}${decision === 'deny' ? ' Explain this to the user and ask how to proceed; do not work around it.' : ''}`,
    },
  }))
  process.exit(0)
}

const planFiles = (root) => {
  const f = path.join(root, '.claude', 'plans', 'active.md')
  if (!existsSync(f)) return null
  const lines = readFileSync(f, 'utf8').split(/\r?\n/)
  const globs = []
  let inFiles = false
  for (const l of lines) {
    if (/^#{1,6}\s/.test(l)) { inFiles = /^#{1,6}\s+files\b/i.test(l); continue }
    if (!inFiles) continue
    const m = l.match(/^\s*[-*]\s+`?([^`\s]+)`?/)
    if (m) globs.push(m[1].replace(/^\.\//, ''))
  }
  return globs
}

try {
  let raw = ''
  for await (const c of process.stdin) raw += c
  const input = JSON.parse(raw || '{}')
  const tool = input.tool_name || ''
  const ti = input.tool_input || {}
  const root = process.env.CLAUDE_PROJECT_DIR || input.cwd || process.cwd()

  let cfg = {}
  const cfgPath = path.join(root, '.claude', 'engineering.json')
  if (existsSync(cfgPath)) { try { cfg = JSON.parse(readFileSync(cfgPath, 'utf8')) } catch { /* ignore */ } }
  const gov = cfg.governance || {}

  // ---------------- Bash ----------------
  if (tool === 'Bash') {
    const cmd = String(ti.command || '')
    const ctx = { root, tool, target: cmd }
    for (const [why, re] of [...DENY_COMMANDS, ...(gov.denyCommands || []).map((r) => [r.reason || 'repo deny rule', r.pattern])]) {
      if (new RegExp(re, 'i').test(cmd)) out('deny', `Blocked: ${why}.`, ctx)
    }
    const protectedBranches = gov.protectedBranches || [cfg.git?.releaseBranch || 'main', 'master']
    if (/\bgit\s+(commit|merge|push)\b/.test(cmd)) {
      let branch = ''
      try { branch = execSync('git rev-parse --abbrev-ref HEAD', { cwd: root, stdio: ['ignore', 'pipe', 'ignore'] }).toString().trim() } catch { /* not a repo */ }
      if (branch && protectedBranches.includes(branch)) out('ask', `Git ${cmd.match(/\bgit\s+(\w+)/)[1]} while on protected branch "${branch}". Work should happen on a feature branch.`, ctx)
      for (const b of protectedBranches) {
        if (new RegExp(String.raw`\bgit\s+push\b[^;&|]*\b${b}\b`).test(cmd)) out('ask', `Push to protected branch "${b}".`, ctx)
      }
    }
    for (const [why, re] of [...ASK_COMMANDS, ...(gov.askCommands || []).map((r) => [r.reason || 'repo ask rule', r.pattern])]) {
      if (new RegExp(re, 'i').test(cmd)) out('ask', `Risky action: ${why}. Confirm it is part of the approved plan.`, ctx)
    }
    process.exit(0)
  }

  // ---------------- File edits ----------------
  if (['Edit', 'MultiEdit', 'Write', 'NotebookEdit'].includes(tool)) {
    const file = ti.file_path || ti.notebook_path || ''
    if (!file) process.exit(0)
    const rel = path.relative(root, path.resolve(root, file)).split(path.sep).join('/')
    const ctx = { root, tool, target: rel }
    if (rel.startsWith('..')) out('ask', `Edit outside the project folder (${file}).`, ctx)

    const base = path.posix.basename(rel)
    if (/^\.env(\..+)?$/.test(base) && !(base === '.env.example' && cfg.allowEnvExample !== false)) out('deny', 'Env files hold secrets.', ctx)
    const prot = matchAny(rel, cfg.protectedPaths || ['generated/**', '**/generated/**'])
    if (prot) out('deny', `Protected path "${prot}" (generated or managed file; regenerate instead).`, ctx)
    for (const g of cfg.immutableWhenCommitted || []) {
      if (globToRegExp(g).test(rel) && existsSync(path.join(root, rel))) {
        let tracked = false
        try { execSync(`git ls-files --error-unmatch -- "${rel}"`, { cwd: root, stdio: 'ignore' }); tracked = true } catch { tracked = false }
        if (tracked) out('deny', `"${rel}" matches "${g}" and is already committed; create a new file instead.`, ctx)
      }
    }

    const exempt = ['.claude/plans/**', '.claude/governance-log.jsonl']
    if (!matchAny(rel, exempt)) {
      const askPaths = gov.askPaths || ['.claude/**', 'AGENTS.md', '**/AGENTS.md', 'CLAUDE.md', '.github/workflows/**', '**/package.json']
      const hit = matchAny(rel, askPaths)
      if (hit) out('ask', `"${rel}" is a governance, CI or dependency file (${hit}). Changes need explicit confirmation.`, ctx)

      const plan = planFiles(root)
      if (plan && plan.length && !matchAny(rel, plan)) out('ask', `"${rel}" is not in the approved plan (.claude/plans/active.md → Files). Confirm the scope change or update the plan.`, ctx)
      if (!plan && gov.requirePlan) out('ask', 'No approved plan is active (.claude/plans/active.md). Run the approve-plan skill first.', ctx)
    }
    process.exit(0)
  }
  process.exit(0)
} catch {
  process.exit(0)
}
