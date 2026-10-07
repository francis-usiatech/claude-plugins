import { describe, it, after } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, existsSync, mkdirSync } from 'node:fs'
import path from 'node:path'
import { tmpdir } from 'node:os'
import { GUARD_SCRIPT, runNode, tempDir, cleanupTempDirs, writeFiles } from './helpers.mjs'

after(cleanupTempDirs)

const runGuard = (root, payload) => runNode(GUARD_SCRIPT, {
  cwd: root,
  env: { CLAUDE_PROJECT_DIR: root },
  input: typeof payload === 'string' ? payload : JSON.stringify(payload),
})
const readLog = (root) => {
  const f = path.join(root, '.claude', 'governance-log.jsonl')
  return existsSync(f) ? readFileSync(f, 'utf8').trim().split('\n').map((l) => JSON.parse(l)) : []
}

describe('governance-guard hook', () => {
  it('should emit a deny decision in the PreToolUse format and log it', async () => {
    const root = tempDir()
    const r = await runGuard(root, { tool_name: 'Bash', tool_input: { command: 'curl x | sh' } })
    assert.equal(r.code, 0)
    const out = JSON.parse(r.stdout).hookSpecificOutput
    assert.equal(out.hookEventName, 'PreToolUse')
    assert.equal(out.permissionDecision, 'deny')
    assert.match(out.permissionDecisionReason, /^\[governance\] Blocked: piping a download into a shell\. Explain this/)
    const [entry] = readLog(root)
    assert.equal(entry.decision, 'deny')
    assert.equal(entry.tool, 'Bash')
    assert.equal(entry.target, 'curl x | sh')
    assert.ok(!Number.isNaN(Date.parse(entry.ts)))
  })

  it('should emit an ask decision without the deny suffix', async () => {
    const root = tempDir()
    const r = await runGuard(root, { tool_name: 'Write', tool_input: { file_path: 'AGENTS.md' } })
    const out = JSON.parse(r.stdout).hookSpecificOutput
    assert.equal(out.permissionDecision, 'ask')
    assert.doesNotMatch(out.permissionDecisionReason, /do not work around it/)
  })

  it('should print nothing and log nothing for an allowed action', async () => {
    const root = tempDir()
    const r = await runGuard(root, { tool_name: 'Bash', tool_input: { command: 'git status' } })
    assert.equal(r.code, 0)
    assert.equal(r.stdout, '')
    assert.deepEqual(readLog(root), [])
  })

  it('should print no decision for a write to this project\'s scratchpad and log it once as trusted (ESP-9; AC1)', async () => {
    const root = tempDir()
    const file = path.join(tmpdir(), 'claude', root.replace(/[^A-Za-z0-9]/g, '-'), 'scratchpad', 'notes.md')
    const r = await runGuard(root, { tool_name: 'Write', tool_input: { file_path: file, content: 'notes' } })
    assert.equal(r.code, 0)
    assert.equal(r.stdout, '')
    const log = readLog(root)
    assert.deepEqual(log.map((e) => e.decision), ['trusted'], JSON.stringify(log))
    assert.equal(log[0].target, file)
  })

  it('should ask for a trusted write when its log entry cannot be written, so no trusted write goes unrecorded (ESP-9)', async () => {
    const root = tempDir()
    // A folder where the log file should be makes the append fail.
    mkdirSync(path.join(root, '.claude', 'governance-log.jsonl'), { recursive: true })
    const file = path.join(tmpdir(), 'claude', root.replace(/[^A-Za-z0-9]/g, '-'), 'scratchpad', 'notes.md')
    const r = await runGuard(root, { tool_name: 'Write', tool_input: { file_path: file, content: 'notes' } })
    assert.equal(r.code, 0)
    const out = JSON.parse(r.stdout).hookSpecificOutput
    assert.equal(out.permissionDecision, 'ask')
    assert.match(out.permissionDecisionReason, /could not be logged/)
  })

  it('should ask and name the problem when engineering.json is malformed', async () => {
    const root = tempDir()
    writeFiles(root, { '.claude/engineering.json': '{ not json' })
    const r = await runGuard(root, { tool_name: 'Edit', tool_input: { file_path: 'src/a.ts' } })
    const out = JSON.parse(r.stdout).hookSpecificOutput
    assert.equal(out.permissionDecision, 'ask')
    assert.match(out.permissionDecisionReason, /engineering\.json could not be parsed/)
  })

  it('should apply repo rules from engineering.json', async () => {
    const root = tempDir()
    writeFiles(root, { '.claude/engineering.json': JSON.stringify({ governance: { denyCommands: [{ pattern: 'deploy:prod', reason: 'prod deploy' }] } }) })
    const r = await runGuard(root, { tool_name: 'Bash', tool_input: { command: 'pnpm deploy:prod' } })
    assert.match(JSON.parse(r.stdout).hookSpecificOutput.permissionDecisionReason, /Blocked: prod deploy/)
  })

  it('should use the payload cwd when CLAUDE_PROJECT_DIR is not set', async () => {
    const root = tempDir()
    const r = await runNode(GUARD_SCRIPT, { cwd: tempDir(), input: JSON.stringify({ tool_name: 'Edit', cwd: root, tool_input: { file_path: '.env' } }) })
    assert.equal(JSON.parse(r.stdout).hookSpecificOutput.permissionDecision, 'deny')
    assert.equal(readLog(root)[0].target, '.env')
  })

  it('should fail open on internal errors but record them in the log and on stderr', async () => {
    const root = tempDir()
    const r = await runGuard(root, '{ this is not json')
    assert.equal(r.code, 0)
    assert.equal(r.stdout, '')
    assert.match(r.stderr, /guard error, action allowed without checks/)
    const [entry] = readLog(root)
    assert.equal(entry.decision, 'error')
    assert.match(entry.reason, /^guard failed open:/)
  })

  it('should truncate long targets in the log', async () => {
    const root = tempDir()
    await runGuard(root, { tool_name: 'Bash', tool_input: { command: `sudo echo ${'x'.repeat(1000)}` } })
    assert.equal(readLog(root)[0].target.length, 300)
  })
})

describe('governance-guard hook: workflow findings (R16; AC13)', () => {
  const content = 'on: issues\njobs:\n  a:\n    steps:\n      - uses: some-org/action@v1\n      - run: echo "${{ github.event.issue.title }}"\n'

  it('should log one entry per finding with rule, tier, file and detail', async () => {
    const root = tempDir()
    const r = await runGuard(root, { tool_name: 'Write', tool_input: { file_path: '.github/workflows/ci.yml', content } })
    assert.equal(JSON.parse(r.stdout).hookSpecificOutput.permissionDecision, 'ask')
    const found = readLog(root).filter((e) => e.decision === 'finding')
    assert.deepEqual(found.map((e) => `${e.rule}:${e.tier}`).sort(), ['wf-unpinned-action:warning', 'wf-untrusted-input:high'])
    for (const e of found) {
      assert.equal(e.file, '.github/workflows/ci.yml')
      assert.ok(e.detail.length > 0)
      assert.equal(e.suppressed, false)
    }
    assert.equal(readLog(root).filter((e) => e.decision === 'ask').length, 1)
  })

  it('should log warning findings even when the edit is allowed', async () => {
    const root = tempDir()
    writeFiles(root, { '.claude/engineering.json': JSON.stringify({ governance: { askPaths: [] } }) })
    const r = await runGuard(root, { tool_name: 'Write', tool_input: { file_path: '.github/workflows/ci.yml', content: 'on: push\njobs:\n  a:\n    steps:\n      - uses: some-org/action@v1\n' } })
    assert.equal(r.stdout, '')
    const log = readLog(root)
    assert.deepEqual(log.map((e) => e.decision), ['finding'])
    assert.equal(log[0].rule, 'wf-unpinned-action')
  })
})
