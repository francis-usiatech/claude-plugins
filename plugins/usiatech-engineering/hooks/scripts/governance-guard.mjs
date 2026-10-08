#!/usr/bin/env node
// usiatech-engineering: governance guard (PreToolUse on Bash, Edit, MultiEdit, Write, NotebookEdit).
// Reads the hook payload, asks governance-policy.mjs for a decision and reports it to Claude Code.
// Every deny/ask, every workflow or dependency content finding (decision "finding"), every dependency lookup
// that failed open (decision "error") and every write let through without asking because it is trusted (a trusted
// write path or an evidence-only plan edit; decision "trusted") is appended to .claude/governance-log.jsonl.
// Internal errors fail open (exit 0) so a bug never wedges a session, but they are logged as
// decision "error" so the governance-reviewer can see that the guard was not enforcing.
// Before a Bash call it doesn't deny, it snapshots the workflow files for the after-Bash check (R6).
import { appendGovernanceLog as logDecision } from './governance-log.mjs'

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
  let result = await evaluate(input, { root, cfg, configError: error })
  // Every finding (R16) and failed-open lookup (R13) is logged whether or not the edit is allowed, then the decision.
  const logged = logEntries(result, tool).map((entry) => logDecision(root, entry)).every(Boolean)
  // The log line is a trusted write's only record, so a trusted write that can't be logged needs a prompt instead.
  if (!logged && !result?.decision && result?.trusted) {
    result = { ...result, decision: 'ask', reason: `${result.reason} It could not be logged to .claude/governance-log.jsonl, so it needs confirmation.` }
  }
  if (tool === 'Bash' && result?.decision !== 'deny') {
    // A failed snapshot must not stop the command; the after-Bash check then falls back to the files changed since HEAD.
    // Imported here so a broken after-Bash module costs only the snapshot, not the guard.
    try {
      const { snapshotWorkflows } = await import('./bash-workflow-check.mjs')
      snapshotWorkflows(root, input.tool_use_id)
    } catch (e) {
      logDecision(root, { tool, target, decision: 'error', reason: `could not snapshot workflow files for the after-Bash check: ${e?.message || e}` })
    }
  }
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
