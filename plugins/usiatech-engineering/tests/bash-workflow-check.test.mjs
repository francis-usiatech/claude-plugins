import { describe, it, after } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, existsSync, readdirSync, mkdirSync, writeFileSync, utimesSync, cpSync, symlinkSync, statSync, rmSync } from 'node:fs'
import { execFileSync } from 'node:child_process'
import path from 'node:path'
import { GUARD_SCRIPT, BASH_WF_SCRIPT, PLUGIN_ROOT, runNode, tempDir, cleanupTempDirs, writeFiles, git } from './helpers.mjs'
import { stateDir, stateFolderProblem } from '../hooks/scripts/governance-state.mjs'

after(cleanupTempDirs)

const FIXTURE = path.join(PLUGIN_ROOT, 'tests', 'fixtures', 'workflows', 'run-injection.yml').split(path.sep).join('/')
const INJECTION = 'on: issues\njobs:\n  a:\n    steps:\n      - run: echo "${{ github.event.issue.title }}"\n'
const CLEAN = 'on: push\njobs:\n  a:\n    steps:\n      - run: echo ok\n'
const DAY_MS = 24 * 60 * 60 * 1000

const hook = (script, root, payload) => runNode(script, { cwd: root, env: { CLAUDE_PROJECT_DIR: root }, input: JSON.stringify({ cwd: root, ...payload }) })
const readLog = (root) => {
  const f = path.join(root, '.claude', 'governance-log.jsonl')
  return existsSync(f) ? readFileSync(f, 'utf8').trim().split('\n').map((l) => JSON.parse(l)) : []
}
const sh = (root, command) => {
  try { execFileSync('bash', ['-c', command], { cwd: root, stdio: 'pipe' }); return 0 } catch (e) { return e.status ?? 1 }
}

// Runs one Bash call the way Claude Code does: guard (PreToolUse), the command, then the after-Bash hook.
const bashCall = async (root, command, { id = 'toolu_test1', expectFail = false } = {}) => {
  const ids = id ? { tool_use_id: id } : {}
  const pre = await hook(GUARD_SCRIPT, root, { hook_event_name: 'PreToolUse', tool_name: 'Bash', tool_input: { command }, ...ids })
  assert.equal(pre.code, 0, pre.stderr)
  const status = sh(root, command)
  assert.equal(status !== 0, expectFail, `exit status ${status} for ${command}`)
  const event = status === 0 ? 'PostToolUse' : 'PostToolUseFailure'
  const post = await hook(BASH_WF_SCRIPT, root, { hook_event_name: event, tool_name: 'Bash', tool_input: { command }, ...ids })
  assert.equal(post.code, 0, post.stderr)
  return { event, out: post.stdout ? JSON.parse(post.stdout) : null, stderr: post.stderr }
}

const snapshots = async (root) => {
  const dir = stateDir(root)
  return existsSync(dir) ? readdirSync(dir) : []
}

const assertShown = (r, file) => {
  assert.ok(r.out, `expected hook output; stderr: ${r.stderr}`)
  assert.equal(r.out.hookSpecificOutput.hookEventName, r.event)
  for (const text of [r.out.systemMessage, r.out.hookSpecificOutput.additionalContext]) {
    assert.match(text, /\[wf-untrusted-input, high\]/)
    assert.ok(text.includes(file), text)
  }
}

describe('after-Bash workflow check (R6; AC6)', () => {
  it('should be registered for Bash on both PostToolUse and PostToolUseFailure', () => {
    const hooks = JSON.parse(readFileSync(path.join(PLUGIN_ROOT, 'hooks', 'hooks.json'), 'utf8')).hooks
    for (const event of ['PostToolUse', 'PostToolUseFailure']) {
      const entry = (hooks[event] || []).find((m) => m.hooks.some((h) => /bash-workflow-check\.mjs/.test(h.command)))
      assert.ok(entry, `${event} has no bash-workflow-check hook`)
      assert.equal(entry.matcher, 'Bash')
    }
  })

  it('should report and log a high-risk workflow written by a heredoc', async () => {
    const root = tempDir()
    const r = await bashCall(root, `mkdir -p .github/workflows && cat > .github/workflows/evil.yml <<'EOF'\n${INJECTION}EOF`)
    assertShown(r, '.github/workflows/evil.yml')
    const findings = readLog(root).filter((e) => e.decision === 'finding')
    assert.deepEqual(findings.map((e) => [e.rule, e.file, e.tool]), [['wf-untrusted-input', '.github/workflows/evil.yml', 'Bash']])
    assert.deepEqual(await snapshots(root), [], 'the snapshot is removed')
  })

  it('should report and log a high-risk workflow copied in with cp', async () => {
    const root = tempDir()
    const r = await bashCall(root, `mkdir -p .github/workflows && cp "${FIXTURE}" .github/workflows/triage.yaml`)
    assertShown(r, '.github/workflows/triage.yaml')
    assert.equal(readLog(root).filter((e) => e.decision === 'finding' && e.rule === 'wf-untrusted-input').length, 1)
  })

  it('should still report a high-risk workflow when the command then fails (PostToolUseFailure)', async () => {
    const root = tempDir()
    const r = await bashCall(root, `mkdir -p .github/workflows && cp "${FIXTURE}" .github/workflows/evil.yml && false`, { expectFail: true })
    assert.equal(r.event, 'PostToolUseFailure')
    assertShown(r, '.github/workflows/evil.yml')
    assert.equal(readLog(root).filter((e) => e.decision === 'finding').length, 1)
    assert.deepEqual(await snapshots(root), [])
  })

  it('should print and log nothing for a command that changes no workflow file', async () => {
    const root = tempDir()
    writeFiles(root, { '.github/workflows/ci.yml': INJECTION })
    const r = await bashCall(root, 'echo hello > notes.txt')
    assert.equal(r.out, null)
    assert.deepEqual(readLog(root), [])
    assert.deepEqual(await snapshots(root), [])
  })

  it('should log a warning-only change without interrupting', async () => {
    const root = tempDir()
    const r = await bashCall(root, `mkdir -p .github/workflows && printf 'on: push\\njobs:\\n  a:\\n    steps:\\n      - uses: some-org/action@v1\\n' > .github/workflows/w.yml`)
    assert.equal(r.out, null)
    assert.deepEqual(readLog(root).map((e) => [e.decision, e.rule, e.tier]), [['finding', 'wf-unpinned-action', 'warning']])
  })

  it('should compare a changed workflow against its content before the command', async () => {
    const root = tempDir()
    writeFiles(root, { '.github/workflows/ci.yml': 'on: push\njobs:\n  a:\n    permissions:\n      contents: read\n    steps:\n      - run: echo ok\n' })
    await bashCall(root, `sed -i 's/contents: read/contents: write/' .github/workflows/ci.yml`)
    assert.deepEqual(readLog(root).map((e) => e.rule), ['wf-permissions-widened'])
  })

  it('should apply a literal-path allowlist entry, logging the finding as suppressed', async () => {
    const root = tempDir()
    writeFiles(root, { '.claude/engineering.json': JSON.stringify({ governance: { allowlist: [{ rule: 'wf-untrusted-input', path: '.github/workflows/evil.yml' }] } }) })
    const r = await bashCall(root, `mkdir -p .github/workflows && cp "${FIXTURE}" .github/workflows/evil.yml`)
    assert.equal(r.out, null)
    assert.deepEqual(readLog(root).filter((e) => e.decision === 'finding').map((e) => [e.rule, e.suppressed]), [['wf-untrusted-input', true]])
  })

  // ESP-50 (spec R6, AC7). The check is called directly, without the guard, so the entries are its own. Outside a git
  // repo with no snapshot every workflow file on disk counts as changed, so the config is read on each run.
  const configEntries = async (cfg, runs) => {
    const { checkAfterBash } = await import('../hooks/scripts/bash-workflow-check.mjs')
    const root = tempDir()
    writeFiles(root, { '.claude/engineering.json': JSON.stringify(cfg), '.github/workflows/ci.yml': CLEAN })
    try {
      for (let run = 0; run < runs; run++) await checkAfterBash({ tool_name: 'Bash', tool_input: { command: 'true' } }, root)
    } finally {
      rmSync(stateDir(root), { recursive: true, force: true })
    }
    return readLog(root).filter((e) => e.target === '.claude/engineering.json')
  }

  it('should log advisory config problems once, as a warning, over two runs (ESP-50; AC7)', async () => {
    const entries = await configEntries({ decisions: { batch: 'yes' } }, 2)
    assert.deepEqual(entries.map((e) => e.decision), ['warn'], JSON.stringify(entries))
    assert.match(entries[0].reason, /Config warning: "decisions\.batch" must be true or false/)
  })

  it('should log an escalating config problem as an error on every run, naming advisory ones too (ESP-50; AC7)', async () => {
    const entries = await configEntries({ decisions: { batch: 'yes' }, governance: { askPaths: 'x' } }, 2)
    assert.deepEqual(entries.map((e) => e.decision), ['error', 'error'], JSON.stringify(entries))
    for (const e of entries) assert.match(e.reason, /^config problem, checked with the rules that still apply: .*("governance\.askPaths".*"decisions\.batch"|"decisions\.batch".*"governance\.askPaths")/)
  })

  it('should warn again for a problem that was fixed while an escalating one was present (ESP-35 R5, R6)', async () => {
    const { checkAfterBash } = await import('../hooks/scripts/bash-workflow-check.mjs')
    const root = tempDir()
    writeFiles(root, { '.github/workflows/ci.yml': CLEAN })
    try {
      for (const cfg of [{ decisions: { batch: 'yes' } }, { governance: { askPaths: 'x' } }, { decisions: { batch: 'yes' } }]) {
        writeFiles(root, { '.claude/engineering.json': JSON.stringify(cfg) })
        await checkAfterBash({ tool_name: 'Bash', tool_input: { command: 'true' } }, root)
      }
    } finally {
      rmSync(stateDir(root), { recursive: true, force: true })
    }
    const entries = readLog(root).filter((e) => e.target === '.claude/engineering.json')
    assert.deepEqual(entries.map((e) => e.decision), ['warn', 'error', 'warn'], JSON.stringify(entries))
  })

  it('should show an advisory config problem it could not log, and log it on the next run (ESP-35 R5, R6)', async () => {
    const { checkAfterBash } = await import('../hooks/scripts/bash-workflow-check.mjs')
    const root = tempDir()
    writeFiles(root, { '.claude/engineering.json': JSON.stringify({ decisions: { batch: 'yes' } }), '.github/workflows/ci.yml': CLEAN })
    const logFile = path.join(root, '.claude', 'governance-log.jsonl')
    const run = () => checkAfterBash({ tool_name: 'Bash', tool_input: { command: 'true' } }, root)
    try {
      // A folder where the log file should be makes the append fail.
      mkdirSync(logFile, { recursive: true })
      const out = await run()
      assert.match(out.systemMessage, /could not be logged to \.claude\/governance-log\.jsonl: Config warning: "decisions\.batch"/)
      assert.equal(out.hookSpecificOutput.additionalContext, out.systemMessage)
      assert.equal(existsSync(path.join(stateDir(root), 'config-warned')), false)
      rmSync(logFile, { recursive: true })
      assert.equal(await run(), null)
      assert.equal(await run(), null)
      assert.deepEqual(readLog(root).filter((e) => e.target === '.claude/engineering.json').map((e) => e.decision), ['warn'])
    } finally {
      rmSync(stateDir(root), { recursive: true, force: true })
    }
  })

  it('should log an error on each run while the marker cannot be written (ESP-35 R6, R7)', async () => {
    const { checkAfterBash } = await import('../hooks/scripts/bash-workflow-check.mjs')
    const root = tempDir()
    writeFiles(root, { '.claude/engineering.json': JSON.stringify({ decisions: { batch: 'yes' } }), '.github/workflows/ci.yml': CLEAN })
    try {
      // A file where the project's state folder should be makes the marker write fail.
      mkdirSync(path.dirname(stateDir(root)), { recursive: true })
      writeFileSync(stateDir(root), 'x')
      for (let run = 0; run < 2; run++) await checkAfterBash({ tool_name: 'Bash', tool_input: { command: 'true' } }, root)
    } finally {
      rmSync(stateDir(root), { recursive: true, force: true })
    }
    const entries = readLog(root).filter((e) => e.target === '.claude/engineering.json')
    assert.deepEqual(entries.map((e) => e.decision), ['warn', 'error', 'warn', 'error'], JSON.stringify(entries))
    assert.match(entries[1].reason, /could not record that the config warning was shown/)
  })

  it('should log a marker it cannot clear as an error, beside an escalating problem too (ESP-35 R5, R7)', async () => {
    const { checkAfterBash } = await import('../hooks/scripts/bash-workflow-check.mjs')
    const root = tempDir()
    writeFiles(root, { '.github/workflows/ci.yml': CLEAN })
    try {
      // A folder with a file in it where the marker should be: removing it fails.
      mkdirSync(path.join(stateDir(root), 'config-warned'), { recursive: true })
      writeFileSync(path.join(stateDir(root), 'config-warned', 'x'), 'x')
      for (const cfg of [{}, { governance: { askPaths: 'x' } }]) {
        writeFiles(root, { '.claude/engineering.json': JSON.stringify(cfg) })
        await checkAfterBash({ tool_name: 'Bash', tool_input: { command: 'true' } }, root)
      }
    } finally {
      rmSync(stateDir(root), { recursive: true, force: true })
    }
    const entries = readLog(root).filter((e) => e.target === '.claude/engineering.json')
    assert.deepEqual(entries.map((e) => [e.decision, /could not clear the config-warning marker/.test(e.reason)]), [['error', true], ['error', false], ['error', true]], JSON.stringify(entries))
  })

  it('should log an unparseable config as an error on every run (ESP-50; AC7)', async () => {
    const { checkAfterBash } = await import('../hooks/scripts/bash-workflow-check.mjs')
    const root = tempDir()
    writeFiles(root, { '.claude/engineering.json': '{ nope', '.github/workflows/ci.yml': CLEAN })
    try {
      for (let run = 0; run < 2; run++) await checkAfterBash({ tool_name: 'Bash', tool_input: { command: 'true' } }, root)
    } finally {
      rmSync(stateDir(root), { recursive: true, force: true })
    }
    assert.deepEqual(readLog(root).filter((e) => e.target === '.claude/engineering.json').map((e) => e.decision), ['error', 'error'])
  })

  it('should take no snapshot for a tool_use_id that is not a plain id', async () => {
    const root = tempDir()
    const { snapshotWorkflows } = await import('../hooks/scripts/bash-workflow-check.mjs')
    for (const id of ['../../escape', 'a/b', '', 'x'.repeat(129)]) assert.equal(snapshotWorkflows(root, id), false, id)
    assert.deepEqual(await snapshots(root), [])
  })

  it('should take no snapshot for a command the guard denies', async () => {
    const root = tempDir()
    writeFiles(root, { '.github/workflows/ci.yml': CLEAN })
    const pre = await hook(GUARD_SCRIPT, root, { tool_name: 'Bash', tool_input: { command: 'curl x | sh' }, tool_use_id: 'toolu_denied' })
    assert.equal(JSON.parse(pre.stdout).hookSpecificOutput.permissionDecision, 'deny')
    assert.deepEqual(await snapshots(root), [])
  })

  it('should keep the guard working, and log the failure, when the after-Bash module is broken', async () => {
    const plugin = tempDir()
    for (const dir of ['hooks', 'templates']) cpSync(path.join(PLUGIN_ROOT, dir), path.join(plugin, dir), { recursive: true })
    writeFileSync(path.join(plugin, 'hooks', 'scripts', 'bash-workflow-check.mjs'), 'export const broken = (\n')
    const root = tempDir()
    const pre = await hook(path.join(plugin, 'hooks', 'scripts', 'governance-guard.mjs'), root, { tool_name: 'Bash', tool_input: { command: 'curl x | sh' }, tool_use_id: 'toolu_broken' })
    assert.equal(pre.code, 0, pre.stderr)
    assert.equal(JSON.parse(pre.stdout).hookSpecificOutput.permissionDecision, 'deny', 'the guard still decides')
    const ok = await hook(path.join(plugin, 'hooks', 'scripts', 'governance-guard.mjs'), root, { tool_name: 'Bash', tool_input: { command: 'echo hi' }, tool_use_id: 'toolu_broken' })
    assert.equal(ok.code, 0, ok.stderr)
    assert.ok(readLog(root).some((e) => e.decision === 'error' && /snapshot/i.test(e.reason)), JSON.stringify(readLog(root)))
  })

  it('should remove snapshots older than 24 hours and keep younger ones', async () => {
    const root = tempDir()
    const dir = stateDir(root)
    mkdirSync(dir, { recursive: true })
    for (const [name, ageMs] of [['old', DAY_MS + 60 * 60 * 1000], ['waiting', 11 * 60 * 1000], ['recent', 0]]) {
      writeFileSync(path.join(dir, `bash-wf-${name}.json`), '{}')
      const t = new Date(Date.now() - ageMs)
      utimesSync(path.join(dir, `bash-wf-${name}.json`), t, t)
    }
    await bashCall(root, 'echo hi')
    assert.deepEqual((await snapshots(root)).sort(), ['bash-wf-recent.json', 'bash-wf-waiting.json'])
  })

  it('should use its own snapshot even when it is older than the stale limit (fix set E)', async () => {
    const root = tempDir()
    writeFiles(root, { '.github/workflows/ci.yml': CLEAN })
    const { snapshotWorkflows, checkAfterBash } = await import('../hooks/scripts/bash-workflow-check.mjs')
    assert.equal(snapshotWorkflows(root, 'toolu_slow'), true)
    const old = new Date(Date.now() - DAY_MS - 60 * 60 * 1000)
    utimesSync(path.join(stateDir(root), 'bash-wf-toolu_slow.json'), old, old)
    writeFiles(root, { '.github/workflows/evil.yml': INJECTION })
    const out = await checkAfterBash({ hook_event_name: 'PostToolUse', tool_name: 'Bash', tool_input: { command: 'x' }, tool_use_id: 'toolu_slow' }, root)
    assert.match(out?.systemMessage ?? '', /\[wf-untrusted-input, high\] \.github\/workflows\/evil\.yml/)
    assert.deepEqual(readLog(root).filter((e) => e.decision === 'error'), [], 'checked against the snapshot, not the fallback')
    assert.deepEqual(await snapshots(root), [])
  })

  it('should log a stale snapshot it cannot remove and still check the call (fix set E)', async () => {
    const root = tempDir()
    const stuck = path.join(stateDir(root), 'bash-wf-stuck.json')
    mkdirSync(path.join(stuck, 'x'), { recursive: true }) // a folder, so removing it as a file fails
    const old = new Date(Date.now() - DAY_MS - 60 * 60 * 1000)
    utimesSync(stuck, old, old)
    const r = await bashCall(root, `mkdir -p .github/workflows && cp "${FIXTURE}" .github/workflows/evil.yml`)
    assertShown(r, '.github/workflows/evil.yml')
    assert.ok(readLog(root).some((e) => e.decision === 'error' && /stale snapshot/i.test(e.reason)), JSON.stringify(readLog(root)))
  })

  it('should still check the call when its own snapshot cannot be read or removed, and log why (fix set F)', async () => {
    const root = tempDir()
    const { checkAfterBash } = await import('../hooks/scripts/bash-workflow-check.mjs')
    mkdirSync(path.join(stateDir(root), 'bash-wf-toolu_stuck.json', 'x'), { recursive: true }) // a folder: reading and removing it fail
    writeFiles(root, { '.github/workflows/evil.yml': INJECTION })
    const out = await checkAfterBash({ hook_event_name: 'PostToolUse', tool_name: 'Bash', tool_input: { command: 'x' }, tool_use_id: 'toolu_stuck' }, root)
    assert.match(out?.systemMessage ?? '', /\[wf-untrusted-input, high\] \.github\/workflows\/evil\.yml/)
    const reasons = readLog(root).filter((e) => e.decision === 'error').map((e) => e.reason)
    assert.ok(reasons.some((r) => /could not read this call's snapshot/.test(r)), JSON.stringify(reasons))
    assert.ok(reasons.some((r) => /could not remove this call's snapshot/.test(r)), JSON.stringify(reasons))
  })

  it('should log a snapshot that cannot be read as unreadable, not as changed (fix set G)', async () => {
    const root = tempDir()
    const { checkAfterBash } = await import('../hooks/scripts/bash-workflow-check.mjs')
    mkdirSync(path.join(stateDir(root), 'bash-wf-toolu_eisdir.json'), { recursive: true }) // a folder: reading it fails
    await checkAfterBash({ hook_event_name: 'PostToolUse', tool_name: 'Bash', tool_input: { command: 'x' }, tool_use_id: 'toolu_eisdir' }, root)
    const reasons = readLog(root).filter((e) => e.decision === 'error').map((e) => e.reason)
    assert.ok(reasons.some((r) => /this call's snapshot could not be read and the project has no git/.test(r)), JSON.stringify(reasons))
    assert.ok(!reasons.some((r) => /not valid/.test(r)), JSON.stringify(reasons))
  })

  it('should still check the call when a stale snapshot cannot be inspected (fix set F; POSIX)', async () => {
    const root = tempDir()
    mkdirSync(stateDir(root), { recursive: true })
    const loop = path.join(stateDir(root), 'bash-wf-loop.json')
    assert.ok(!existsSync(loop))
    if (process.platform === 'win32') return // creating a symlink needs extra rights on Windows; CI covers this on Linux
    symlinkSync(loop, loop) // stat fails with ELOOP
    const r = await bashCall(root, `mkdir -p .github/workflows && cp "${FIXTURE}" .github/workflows/evil.yml`)
    assertShown(r, '.github/workflows/evil.yml')
    assert.ok(readLog(root).some((e) => e.decision === 'error' && /could not check stale snapshot/.test(e.reason)), JSON.stringify(readLog(root)))
  })

  it('should check every workflow file on disk, and log that, when there is no snapshot and no git (fix set E)', async () => {
    const root = tempDir()
    writeFiles(root, { '.github/workflows/ci.yml': CLEAN })
    const r = await bashCall(root, `cp "${FIXTURE}" .github/workflows/evil.yml`, { id: null })
    assertShown(r, '.github/workflows/evil.yml')
    assert.ok(readLog(root).some((e) => e.decision === 'error' && /no snapshot/i.test(e.reason) && /every workflow file/i.test(e.reason)), JSON.stringify(readLog(root)))
  })

  it('should fall back to files changed since HEAD, and log that, when there is no tool_use_id', async () => {
    const root = tempDir()
    git(root, 'init', '-q')
    git(root, 'config', 'user.email', 'test@example.com')
    git(root, 'config', 'user.name', 'Test')
    writeFiles(root, { '.github/workflows/ci.yml': CLEAN })
    git(root, 'add', '-A')
    git(root, 'commit', '-q', '-m', 'base')
    const r = await bashCall(root, `cp "${FIXTURE}" .github/workflows/new.yml`, { id: null })
    assert.deepEqual(await snapshots(root), [])
    assertShown(r, '.github/workflows/new.yml')
    const log = readLog(root)
    assert.ok(log.some((e) => e.decision === 'error' && /no snapshot/i.test(e.reason)), JSON.stringify(log))
    assert.deepEqual(log.filter((e) => e.decision === 'finding').map((e) => e.file), ['.github/workflows/new.yml'], 'the unchanged ci.yml is not re-checked')
  })

  it('should show findings it could not log, even when none is high-risk', async () => {
    const root = tempDir()
    mkdirSync(path.join(root, '.claude', 'governance-log.jsonl'), { recursive: true })
    const r = await bashCall(root, `mkdir -p .github/workflows && printf 'on: push\\njobs:\\n  a:\\n    steps:\\n      - uses: some-org/action@v1\\n' > .github/workflows/w.yml`)
    assert.ok(r.out, `expected hook output; stderr: ${r.stderr}`)
    for (const text of [r.out.systemMessage, r.out.hookSpecificOutput.additionalContext]) {
      assert.match(text, /could not be logged/)
      assert.match(text, /\[wf-unpinned-action, warning\]/)
    }
  })

  it('should still check the call when another snapshot vanishes during cleanup', async () => {
    const root = tempDir()
    mkdirSync(stateDir(root), { recursive: true })
    // A dangling link is listed by readdir but stat fails with ENOENT, like a file a parallel hook just removed.
    symlinkSync(path.join(root, 'gone'), path.join(stateDir(root), 'bash-wf-gone.json'), 'junction')
    const r = await bashCall(root, `mkdir -p .github/workflows && cp "${FIXTURE}" .github/workflows/evil.yml`)
    assertShown(r, '.github/workflows/evil.yml')
    assert.deepEqual(readLog(root).map((e) => [e.decision, e.rule]), [['finding', 'wf-untrusted-input']])
  })

  it('should log a background Bash call as unchecked and remove its snapshot', async () => {
    const root = tempDir()
    const { snapshotWorkflows, checkAfterBash } = await import('../hooks/scripts/bash-workflow-check.mjs')
    assert.equal(snapshotWorkflows(root, 'toolu_bg'), true)
    writeFiles(root, { '.github/workflows/evil.yml': INJECTION })
    const out = await checkAfterBash({ hook_event_name: 'PostToolUse', tool_name: 'Bash', tool_input: { command: 'sleep 9 &', run_in_background: true }, tool_use_id: 'toolu_bg' }, root)
    assert.equal(out, null)
    assert.deepEqual(readLog(root).map((e) => [e.decision, /background/.test(e.reason)]), [['error', true]])
    assert.deepEqual(await snapshots(root), [])
  })

  it('should include git-ignored workflow files in the HEAD fallback', async () => {
    const root = tempDir()
    git(root, 'init', '-q')
    git(root, 'config', 'user.email', 'test@example.com')
    git(root, 'config', 'user.name', 'Test')
    writeFiles(root, { '.gitignore': '.github/workflows/local-*.yml\n', '.github/workflows/ci.yml': CLEAN })
    git(root, 'add', '-A')
    git(root, 'commit', '-q', '-m', 'base')
    const r = await bashCall(root, `cp "${FIXTURE}" .github/workflows/local-evil.yml`, { id: null })
    assertShown(r, '.github/workflows/local-evil.yml')
    assert.deepEqual(readLog(root).filter((e) => e.decision === 'finding').map((e) => e.file), ['.github/workflows/local-evil.yml'])
  })

  describe('workflows committed or staged without changing the files on disk (R6, fix set B)', () => {
    // A repo on a feature branch with one clean committed workflow.
    const repo = () => {
      const root = tempDir()
      git(root, 'init', '-q')
      git(root, 'config', 'user.email', 'test@example.com')
      git(root, 'config', 'user.name', 'Test')
      git(root, 'config', 'core.autocrlf', 'false')
      git(root, 'checkout', '-q', '-b', 'feature/x')
      writeFiles(root, { '.github/workflows/ci.yml': CLEAN })
      git(root, 'add', '-A')
      git(root, 'commit', '-q', '-m', 'base')
      return root
    }
    // INJECTION has no single quote, so it goes into the single-quoted shell string as is.
    const evilBlob = `printf '%s' '${INJECTION}' | git hash-object -w --stdin`

    it('should report a workflow committed with update-index while the file on disk stays clean', async () => {
      const root = repo()
      const r = await bashCall(root, `b=$(${evilBlob}) && git update-index --cacheinfo 100644,$b,.github/workflows/ci.yml && git commit -q -m x && git reset -q HEAD~1 -- .github/workflows/ci.yml`)
      assert.equal(readFileSync(path.join(root, '.github/workflows/ci.yml'), 'utf8'), CLEAN, 'the file on disk is unchanged')
      assertShown(r, '.github/workflows/ci.yml')
      assert.match(r.out.systemMessage, /commit on refs\/heads\/feature\/x/)
      assert.deepEqual(readLog(root).filter((e) => e.decision === 'finding').map((e) => e.rule), ['wf-untrusted-input'])
    })

    it('should report a workflow committed on another branch, then switched away from', async () => {
      const root = repo()
      const r = await bashCall(root, `git checkout -q -b other && cp "${FIXTURE}" .github/workflows/ci.yml && git commit -q -am x && git checkout -q feature/x`)
      assert.equal(readFileSync(path.join(root, '.github/workflows/ci.yml'), 'utf8'), CLEAN)
      assertShown(r, '.github/workflows/ci.yml')
      assert.match(r.out.systemMessage, /commit on refs\/heads\/other/)
    })

    it('should report a workflow that is only staged', async () => {
      const root = repo()
      const r = await bashCall(root, `b=$(${evilBlob}) && git update-index --add --cacheinfo 100644,$b,.github/workflows/new.yml`)
      assert.ok(!existsSync(path.join(root, '.github/workflows/new.yml')), 'nothing on disk')
      assertShown(r, '.github/workflows/new.yml')
      assert.match(r.out.systemMessage, /staged/)
    })

    it('should report a workflow written and committed once, not once per place it is seen', async () => {
      const root = repo()
      await bashCall(root, `cp "${FIXTURE}" .github/workflows/ci.yml && git commit -q -am x`)
      assert.equal(readLog(root).filter((e) => e.decision === 'finding').length, 1, JSON.stringify(readLog(root)))
    })

    it('should not report again a workflow that was already on disk before the command committed it', async () => {
      const root = repo()
      writeFiles(root, { '.github/workflows/ci.yml': INJECTION }) // written earlier with Edit, checked by the guard then
      const r = await bashCall(root, 'git commit -q -am x')
      assert.equal(r.out, null)
      assert.deepEqual(readLog(root), [])
    })

    it('should print and log nothing for a commit that touches no workflow', async () => {
      const root = repo()
      const r = await bashCall(root, 'echo x > a.txt && git add a.txt && git commit -q -m x')
      assert.equal(r.out, null)
      assert.deepEqual(readLog(root), [])
    })

    // Fix set D: a Bash command can rewrite its own snapshot, so nothing read from it may reach git as an option.
    for (const [what, tamper] of [
      ['whose ref is not an object id', (s, out) => { s.git.refs['refs/heads/feature/x'] = `--output=${out}`; return JSON.stringify(s) }],
      ['whose index entry is not an object id', (s, out) => { s.git.index['.github/workflows/ci.yml'] = `--output=${out}`; return JSON.stringify(s) }],
      ['that is not JSON', () => '{"files":'],
    ]) {
      it(`should ignore a snapshot ${what}, log it, and check against HEAD instead`, async () => {
        const root = repo()
        const { snapshotWorkflows, checkAfterBash } = await import('../hooks/scripts/bash-workflow-check.mjs')
        assert.equal(snapshotWorkflows(root, 'toolu_tamper'), true)
        const f = path.join(stateDir(root), 'bash-wf-toolu_tamper.json')
        const s = JSON.parse(readFileSync(f, 'utf8'))
        const out = path.join(root, 'pwned.txt')
        writeFileSync(f, tamper(s, out))
        writeFiles(root, { '.github/workflows/ci.yml': INJECTION })
        const r = await checkAfterBash({ hook_event_name: 'PostToolUse', tool_name: 'Bash', tool_input: { command: 'x' }, tool_use_id: 'toolu_tamper' }, root)
        assert.ok(!existsSync(out), 'git was given the tampered value as an option')
        assert.match(r.systemMessage, /\[wf-untrusted-input, high\] \.github\/workflows\/ci\.yml/)
        assert.ok(readLog(root).some((e) => e.decision === 'error' && /snapshot.*not valid/i.test(e.reason)), JSON.stringify(readLog(root)))
      })
    }

    it('should not snapshot into, or read from, a snapshot folder that is a link, and should log why', async () => {
      const root = repo()
      const elsewhere = tempDir()
      mkdirSync(path.dirname(stateDir(root)), { recursive: true })
      symlinkSync(elsewhere, stateDir(root), 'junction')
      const r = await bashCall(root, `cp "${FIXTURE}" .github/workflows/ci.yml`)
      assert.deepEqual(readdirSync(elsewhere), [], 'nothing written through the link')
      assertShown(r, '.github/workflows/ci.yml')
      assert.ok(readLog(root).filter((e) => e.decision === 'error' && /snapshot folder/i.test(e.reason)).length >= 2, JSON.stringify(readLog(root)))
    })

    // Fix set E (T7 stage 2 re-review).
    const gitFailure = (message) => Object.assign(new Error(message), { status: 128, stderr: message })
    const withGit = async (mod, run, body) => {
      const real = mod.gitRunner.run
      mod.gitRunner.run = (r, args) => run(r, args, real)
      try { return await body() } finally { mod.gitRunner.run = real }
    }

    it('should check workflow names git quotes (non-ASCII) in the HEAD fallback', async () => {
      const root = repo()
      writeFiles(root, { '.github/workflows/dé.yml': CLEAN })
      git(root, 'add', '-A')
      git(root, 'commit', '-q', '-m', 'accent')
      const r = await bashCall(root, `cp "${FIXTURE}" .github/workflows/dé.yml && cp "${FIXTURE}" .github/workflows/né.yml`, { id: null })
      assert.ok(r.out, `expected hook output; stderr: ${r.stderr}`)
      assert.deepEqual(readLog(root).filter((e) => e.decision === 'finding').map((e) => e.file).sort(), ['.github/workflows/dé.yml', '.github/workflows/né.yml'])
    })

    it('should still show workflows changed on disk when git fails after the command, and log what was skipped', async () => {
      const root = repo()
      const mod = await import('../hooks/scripts/bash-workflow-check.mjs')
      assert.equal(mod.snapshotWorkflows(root, 'toolu_gitfail'), true)
      writeFiles(root, { '.github/workflows/evil.yml': INJECTION })
      const out = await withGit(mod, () => { throw gitFailure('fatal: detected dubious ownership') },
        () => mod.checkAfterBash({ hook_event_name: 'PostToolUse', tool_name: 'Bash', tool_input: { command: 'x' }, tool_use_id: 'toolu_gitfail' }, root))
      assert.match(out?.systemMessage ?? '', /\[wf-untrusted-input, high\] \.github\/workflows\/evil\.yml/)
      assert.ok(readLog(root).some((e) => e.decision === 'error' && /committed or staged/.test(e.reason) && /dubious ownership/.test(e.reason)), JSON.stringify(readLog(root)))
    })

    it('should show, not only log, a git failure after a command that changed nothing on disk (fix set F)', async () => {
      const root = repo()
      const mod = await import('../hooks/scripts/bash-workflow-check.mjs')
      assert.equal(mod.snapshotWorkflows(root, 'toolu_gitfail2'), true)
      const out = await withGit(mod, () => { throw gitFailure('fatal: index file corrupt') },
        () => mod.checkAfterBash({ hook_event_name: 'PostToolUse', tool_name: 'Bash', tool_input: { command: 'x' }, tool_use_id: 'toolu_gitfail2' }, root))
      for (const text of [out?.systemMessage ?? '', out?.hookSpecificOutput?.additionalContext ?? '']) {
        assert.match(text, /committed or staged .*not checked.*index file corrupt/)
      }
    })

    it('should report a workflow staged in a repo with no commit yet, when there is no snapshot (fix set F)', async () => {
      const root = tempDir()
      git(root, 'init', '-q')
      const r = await bashCall(root, `mkdir -p .github/workflows && cp "${FIXTURE}" .github/workflows/evil.yml && git add -A`, { id: null })
      assertShown(r, '.github/workflows/evil.yml')
      assert.ok(readLog(root).some((e) => e.decision === 'error' && /no commit yet/.test(e.reason)), JSON.stringify(readLog(root)))
    })

    it('should report a staged-only workflow change when there is no snapshot (fix set F)', async () => {
      const root = repo()
      const r = await bashCall(root, `b=$(${evilBlob}) && git update-index --cacheinfo 100644,$b,.github/workflows/ci.yml`, { id: null })
      assert.equal(readFileSync(path.join(root, '.github/workflows/ci.yml'), 'utf8'), CLEAN, 'the file on disk is unchanged')
      assertShown(r, '.github/workflows/ci.yml')
      assert.match(r.out.systemMessage, /seen in staged/)
    })

    it('should report a staged workflow whose name has a line break (fix set F)', async () => {
      const root = repo()
      const mod = await import('../hooks/scripts/bash-workflow-check.mjs')
      assert.equal(mod.snapshotWorkflows(root, 'toolu_nl'), true)
      assert.equal(sh(root, `b=$(${evilBlob}) && git -c core.protectNTFS=false update-index --add --cacheinfo 100644,$b,$'.github/workflows/a\\nb.yml'`), 0)
      const out = await mod.checkAfterBash({ hook_event_name: 'PostToolUse', tool_name: 'Bash', tool_input: { command: 'x' }, tool_use_id: 'toolu_nl' }, root)
      assert.match(out?.systemMessage ?? '', /\[wf-untrusted-input, high\] \.github\/workflows\/a\sb\.yml/) // the message shows the line break as a space
    })

    // Fix set G (T7 re-review of fix set F).
    it('should check a workflow with a merge conflict on disk, and keep other findings, when there is no snapshot (fix set G)', async () => {
      const root = repo()
      git(root, 'checkout', '-q', '-b', 'other')
      writeFiles(root, { '.github/workflows/ci.yml': INJECTION })
      git(root, 'commit', '-q', '-am', 'other')
      git(root, 'checkout', '-q', 'feature/x')
      writeFiles(root, { '.github/workflows/ci.yml': CLEAN.replace('ok', 'mine') })
      git(root, 'commit', '-q', '-am', 'mine')
      assert.notEqual(sh(root, 'git merge -q other'), 0, 'the merge should stop with a conflict')
      const r = await bashCall(root, `cp "${FIXTURE}" .github/workflows/evil.yml`, { id: null })
      assertShown(r, '.github/workflows/evil.yml')
      assertShown(r, '.github/workflows/ci.yml') // the conflicted file is checked as it is on disk
    })

    it('should show a git failure on one line and capped in length (fix set G)', async () => {
      const root = repo()
      const mod = await import('../hooks/scripts/bash-workflow-check.mjs')
      assert.equal(mod.snapshotWorkflows(root, 'toolu_gitlong'), true)
      const out = await withGit(mod, () => { throw gitFailure(`fatal: bad object\n::error::forged\n${'x'.repeat(5000)}`) },
        () => mod.checkAfterBash({ hook_event_name: 'PostToolUse', tool_name: 'Bash', tool_input: { command: 'x' }, tool_use_id: 'toolu_gitlong' }, root))
      for (const text of [out?.systemMessage ?? '', out?.hookSpecificOutput?.additionalContext ?? '']) {
        assert.match(text, /not checked.*bad object ::error::forged/)
        assert.ok(!/[\u0000-\u001f\u007f]/.test(text), JSON.stringify(text))
        assert.ok(text.length < 1000, `message is ${text.length} characters`)
      }
    })

    it('should run git in the C locale, so its messages can be matched', async () => {
      const root = repo()
      const { gitRunner } = await import('../hooks/scripts/bash-workflow-check.mjs')
      const prev = process.env.LC_ALL
      process.env.LC_ALL = 'de_DE.UTF-8'
      try {
        assert.equal(gitRunner.run(root, ['-c', 'alias.lc=!printenv LC_ALL', 'lc']).trim(), 'C')
      } finally {
        if (prev === undefined) delete process.env.LC_ALL
        else process.env.LC_ALL = prev
      }
    })

    it('should check new workflow files in a repo with no commit yet, when there is no snapshot', async () => {
      const root = tempDir()
      git(root, 'init', '-q')
      const r = await bashCall(root, `mkdir -p .github/workflows && cp "${FIXTURE}" .github/workflows/evil.yml`, { id: null })
      assertShown(r, '.github/workflows/evil.yml')
      assert.equal(readLog(root).filter((e) => e.decision === 'finding').length, 1)
    })

    for (const [what, failing] of [['listing changes since HEAD', 'diff'], ['reading the HEAD version', 'cat-file']]) {
      it(`should not take a git failure ${what} in the HEAD fallback for "no HEAD yet"`, async () => {
        const root = repo()
        writeFiles(root, { '.github/workflows/ci.yml': INJECTION })
        const mod = await import('../hooks/scripts/bash-workflow-check.mjs')
        await assert.rejects(withGit(mod, (r, args, real) => { if (args[0] === failing) throw gitFailure('fatal: index file corrupt'); return real(r, args) },
          () => mod.checkAfterBash({ hook_event_name: 'PostToolUse', tool_name: 'Bash', tool_input: { command: 'x' } }, root)), /index file corrupt/)
      })
    }

    it('should make exactly 4 git calls for a Bash call that changes no workflow (2 snapshot, 2 check)', async () => {
      const root = repo()
      const mod = await import('../hooks/scripts/bash-workflow-check.mjs')
      const calls = []
      const run = mod.gitRunner.run
      mod.gitRunner.run = (r, args) => { calls.push(args.join(' ')); return run(r, args) }
      try {
        assert.equal(mod.snapshotWorkflows(root, 'toolu_count'), true)
        writeFiles(root, { 'notes.txt': 'hi' })
        const out = await mod.checkAfterBash({ hook_event_name: 'PostToolUse', tool_name: 'Bash', tool_input: { command: 'x' }, tool_use_id: 'toolu_count' }, root)
        assert.equal(out, null)
      } finally {
        mod.gitRunner.run = run
      }
      assert.equal(calls.length, 4, calls.join('\n'))
      assert.deepEqual(readLog(root), [])
    })
  })

  describe('stateFolderProblem (fix set D)', () => {
    const stat = ({ dir = true, link = false, uid = 1000, mode = 0o700 } = {}) => ({ isDirectory: () => dir, isSymbolicLink: () => link, uid, mode })
    const cases = [
      ['a private folder of the user', stat(), 1000, null],
      ['a link', stat({ dir: false, link: true }), 1000, /not a real folder/],
      ['a file', stat({ dir: false }), 1000, /not a real folder/],
      ['a folder of another user', stat({ uid: 0 }), 1000, /owned by/],
      ['a group-writable folder', stat({ mode: 0o770 }), 1000, /writable/],
      ['a world-writable folder', stat({ mode: 0o707 }), 1000, /writable/],
      ['a folder on Windows (no POSIX owner)', stat({ uid: 0, mode: 0o777 }), undefined, null],
    ]
    for (const [what, st, uid, expected] of cases) {
      it(`should ${expected ? 'refuse' : 'accept'} ${what}`, async () => {
        const problem = stateFolderProblem(st, uid)
        if (expected) assert.match(problem, expected)
        else assert.equal(problem, null)
      })
    }

    it('should write snapshot files that only the user can read (POSIX)', async () => {
      const root = tempDir()
      const { snapshotWorkflows } = await import('../hooks/scripts/bash-workflow-check.mjs')
      assert.equal(snapshotWorkflows(root, 'toolu_mode'), true)
      const st = statSync(path.join(stateDir(root), 'bash-wf-toolu_mode.json'))
      assert.ok(st.isFile())
      if (process.platform !== 'win32') {
        assert.equal(st.mode & 0o077, 0, `file mode ${(st.mode & 0o777).toString(8)}`)
        assert.equal(statSync(stateDir(root)).mode & 0o077, 0, 'folder mode')
      }
    })
  })

  // The AC6 timing test is in bash-workflow-timing.perf.mjs, run by npm test on its own after this suite.
  it('should load no rules module in the spawned hook when no workflow file changed, and load them when one did', async () => {
    const root = tempDir()
    writeFiles(root, { '.github/workflows/ci.yml': CLEAN })
    const { snapshotWorkflows } = await import('../hooks/scripts/bash-workflow-check.mjs')
    // Snapshots, applies the command's change, then runs the hook with NODE_DEBUG=esm, which makes Node print the URL
    // of every ES module it loads to stderr.
    const modulesLoaded = async (id, change) => {
      assert.equal(snapshotWorkflows(root, id), true)
      writeFiles(root, change)
      const post = await runNode(BASH_WF_SCRIPT, { cwd: root, env: { CLAUDE_PROJECT_DIR: root, NODE_DEBUG: 'esm' }, input: JSON.stringify({ cwd: root, hook_event_name: 'PostToolUse', tool_name: 'Bash', tool_input: { command: 'x' }, tool_use_id: id }) })
      assert.equal(post.code, 0, post.stderr)
      return new Set(post.stderr.match(/[\w.-]+\.mjs/g) || [])
    }
    const RULES = ['governance-policy.mjs', 'governance-rules.mjs', 'workflow-rules.mjs']

    const unchanged = await modulesLoaded('toolu_load1', { 'notes.txt': 'hi' })
    assert.ok(unchanged.has('bash-workflow-check.mjs'), `NODE_DEBUG=esm listed no modules: ${[...unchanged]}`)
    assert.deepEqual(RULES.filter((m) => unchanged.has(m)), [])
    assert.deepEqual(readLog(root), [], 'the unchanged run took the no-change path, not the no-snapshot fallback')

    const changed = await modulesLoaded('toolu_load2', { '.github/workflows/ci.yml': INJECTION })
    assert.deepEqual(RULES.filter((m) => changed.has(m)), RULES)
  })
})
