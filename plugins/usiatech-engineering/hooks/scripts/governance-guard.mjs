#!/usr/bin/env node
// usiatech-engineering: governance guard (PreToolUse on Bash, Edit, MultiEdit, Write, NotebookEdit).
// Reads the hook payload, asks governance-policy.mjs for a decision and reports it to Claude Code.
// Every deny/ask, every workflow or dependency content finding (decision "finding") and every dependency lookup
// that failed open (decision "error") is appended to .claude/governance-log.jsonl.
// Internal errors fail open (exit 0) so a bug never wedges a session, but they are logged as
// decision "error" so the governance-reviewer can see that the guard was not enforcing.
import { existsSync, appendFileSync, mkdirSync } from 'node:fs'
import path from 'node:path'

const logDecision = (root, entry) => {
  try {
    const dir = path.join(root, '.claude')
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true })
    appendFileSync(path.join(dir, 'governance-log.jsonl'),
      JSON.stringify({ ts: new Date().toISOString(), ...entry, target: String(entry.target || '').slice(0, 300) }) + '\n')
  } catch (e) {
    process.stderr.write(`[governance] could not write governance-log.jsonl: ${e.message}\n`)
  }
}

let root = process.env.CLAUDE_PROJECT_DIR || process.cwd()
let tool = ''
let target = ''
try {
  let raw = ''
  for await (const c of process.stdin) raw += c
  const input = JSON.parse(raw || '{}')
  tool = input.tool_name || ''
  target = String(input.tool_input?.command || input.tool_input?.file_path || input.tool_input?.notebook_path || '')
  root = process.env.CLAUDE_PROJECT_DIR || input.cwd || process.cwd()

  // Imported here so a missing or broken policy module is logged like any other internal error.
  const { evaluate, loadConfig, logEntries } = await import('./governance-policy.mjs')
  const { cfg, error } = loadConfig(root)
  const result = await evaluate(input, { root, cfg, configError: error })
  // Every finding (R16) and failed-open lookup (R13) is logged whether or not the edit is allowed, then the decision.
  for (const entry of logEntries(result, tool)) logDecision(root, entry)
  if (result?.decision) {
    process.stdout.write(JSON.stringify({
      hookSpecificOutput: {
        hookEventName: 'PreToolUse',
        permissionDecision: result.decision,
        permissionDecisionReason: `[governance] ${result.reason}${result.decision === 'deny' ? ' Explain this to the user and ask how to proceed; do not work around it.' : ''}`,
      },
    }))
  }
  process.exit(0)
} catch (e) {
  logDecision(root, { tool, target, decision: 'error', reason: `guard failed open: ${e?.message || e}` })
  process.stderr.write(`[governance] guard error, action allowed without checks: ${e?.message || e}\n`)
  process.exit(0)
}
