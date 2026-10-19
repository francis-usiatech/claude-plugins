#!/usr/bin/env node
// usiatech-engineering: governance guard (PreToolUse on Bash, PowerShell, Edit, MultiEdit, Write, NotebookEdit).
// Reads the hook payload, asks governance-policy.mjs for a decision and reports it to Claude Code.
// Every deny/ask, every workflow or dependency content finding (decision "finding"), every dependency lookup
// that failed open (decision "error"), an advisory config problem the first time it is seen (decision "warn")
// and every write let through without asking because it is trusted (a trusted
// write path or an evidence-only plan edit; decision "trusted") is appended to .claude/governance-log.jsonl.
// Internal errors fail open (exit 0) so a bug never wedges a session, but they are logged as
// decision "error" so the governance-reviewer can see that the guard was not enforcing.
// Before a Bash or PowerShell call it doesn't deny, it snapshots the workflow files for the after-Bash check (R6).
import { appendGovernanceLog as logDecision } from './governance-log.mjs'
import { SHELL_TOOLS } from './governance-state.mjs'

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
  const { evaluate, loadConfig, logEntries, configMarkerPath, recordAdvice, CONFIG_FILE } = await import('./governance-policy.mjs')
  const { cfg, error } = loadConfig(root)
  const markerFile = configMarkerPath(root)
  let result = await evaluate(input, { root, cfg, configError: error, markerFile })
  // Every finding (R16) and failed-open lookup (R13) is logged whether or not the edit is allowed, then the decision.
  const written = logEntries(result, tool).map((entry) => ({ entry, ok: logDecision(root, entry) }))
  const logged = written.every((w) => w.ok)
  // ESP-35 R5: the warning counts as shown only once it is in the log, so one that couldn't be logged is due again.
  const unlogged = written.filter((w) => !w.ok && w.entry.target === CONFIG_FILE && w.entry.decision === 'error').map((w) => w.entry.reason)
  if (result?.configWarning && written.some((w) => w.ok && w.entry.decision === 'warn')) {
    const markerError = recordAdvice(markerFile, result.configHash)
    if (markerError && !logDecision(root, { tool, target: CONFIG_FILE, decision: 'error', reason: markerError })) unlogged.push(markerError)
  }
  // The log line is a trusted write's only record, so a trusted write that can't be logged needs a prompt instead.
  if (!logged && !result?.decision && result?.trusted) {
    result = { ...result, decision: 'ask', reason: `${result.reason} It could not be logged to .claude/governance-log.jsonl, so it needs confirmation.` }
  }
  if (SHELL_TOOLS.includes(tool) && result?.decision !== 'deny') {
    // A failed snapshot must not stop the command; the after-Bash check then falls back to the files changed since HEAD.
    // Imported here so a broken after-Bash module costs only the snapshot, not the guard.
    try {
      const { snapshotWorkflows } = await import('./bash-workflow-check.mjs')
      snapshotWorkflows(root, input.tool_use_id)
    } catch (e) {
      logDecision(root, { tool, target, decision: 'error', reason: `could not snapshot workflow files for the after-Bash check: ${e?.message || e}` })
    }
  }
  // ESP-35 R4: an advisory config warning is shown beside the decision and never changes it. A marker failure that
  // couldn't be logged is shown with it, since the log would have been its only record.
  const shown = [result?.configWarning, ...unlogged].filter(Boolean)
  const warning = shown.length ? `[governance] ${shown.join(' ')}` : null
  if (result?.decision) {
    process.stdout.write(JSON.stringify({
      ...(warning && { systemMessage: warning }),
      hookSpecificOutput: {
        hookEventName: 'PreToolUse',
        permissionDecision: result.decision,
        permissionDecisionReason: `[governance] ${result.reason}${result.decision === 'deny' ? ' Explain this to the user and ask how to proceed; do not work around it.' : ''}`,
      },
    }))
  } else if (warning) {
    process.stdout.write(JSON.stringify({ systemMessage: warning, hookSpecificOutput: { hookEventName: 'PreToolUse', additionalContext: warning } }))
  }
  process.exit(0)
} catch (e) {
  logDecision(root, { tool, target, decision: 'error', reason: `guard failed open: ${e?.message || e}` })
  process.stderr.write(`[governance] guard error, action allowed without checks: ${e?.message || e}\n`)
  process.exit(0)
}
