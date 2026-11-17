import { describe, it, after } from 'node:test'
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { mkdirSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { readOutputLevel, outputLevelContext } from '../hooks/scripts/output-level.mjs'
import { PLUGIN_ROOT, tempDir, cleanupTempDirs, git } from './helpers.mjs'

after(cleanupTempDirs)

const SCRIPT = path.join(PLUGIN_ROOT, 'hooks', 'scripts', 'output-level.mjs')
const EXEMPT = /specs, plans, approval and decision questions to the user, and HTML review pages/

// A git repo on develop whose committed config is baseConfig; workingConfig, when given, edits the working copy after.
const repo = (baseConfig, workingConfig) => {
  const dir = tempDir('usiatech-output-')
  git(dir, 'init', '-q', '-b', 'develop')
  git(dir, 'config', 'user.email', 't@example.com')
  git(dir, 'config', 'user.name', 't')
  mkdirSync(path.join(dir, '.claude'))
  if (baseConfig) writeFileSync(path.join(dir, '.claude', 'engineering.json'), JSON.stringify(baseConfig))
  writeFileSync(path.join(dir, 'f.txt'), 'x')
  git(dir, 'add', '-A')
  git(dir, 'commit', '-q', '-m', 'init')
  if (workingConfig) writeFileSync(path.join(dir, '.claude', 'engineering.json'), JSON.stringify(workingConfig))
  return dir
}

// Runs the hook as Claude Code does: hook input JSON on stdin, CLAUDE_PROJECT_DIR unset so input.cwd decides.
const runHook = (cwd, stdin = JSON.stringify({ hook_event_name: 'SessionStart', source: 'startup', cwd })) => {
  const env = { ...process.env }
  delete env.CLAUDE_PROJECT_DIR
  return spawnSync(process.execPath, [SCRIPT], { cwd, input: stdin, encoding: 'utf8', env })
}
const contextOf = (r) => JSON.parse(r.stdout).hookSpecificOutput.additionalContext

describe('output-level: reading output.level (ESP-167)', () => {
  it('should default to low with no config or no output key (AC1)', () => {
    assert.deepEqual(readOutputLevel({ cwd: repo(null) }), { level: 'low', warning: null })
    assert.deepEqual(readOutputLevel({ cwd: repo({ verify: [] }) }), { level: 'low', warning: null })
  })

  it('should read each valid level from the base branch, not an edited working copy (AC1, AC2)', () => {
    for (const level of ['low', 'medium', 'high']) {
      assert.equal(readOutputLevel({ cwd: repo({ output: { level } }) }).level, level)
    }
    assert.equal(readOutputLevel({ cwd: repo({ output: { level: 'medium' } }, { output: { level: 'high' } }) }).level, 'medium')
  })

  it('should fall back to the working copy, with no config problem, when the base branch has no config', () => {
    assert.deepEqual(readOutputLevel({ cwd: repo(null, { output: { level: 'medium' } }) }), { level: 'medium', warning: null })
    assert.doesNotMatch(contextOf(runHook(repo(null, { output: { level: 'low' } }))), /Config problem/)
  })

  it('should treat a null output or output.level as absent, as the guard treats other keys', () => {
    for (const output of [null, { level: null }]) {
      assert.deepEqual(readOutputLevel({ cwd: repo({ output }) }), { level: 'low', warning: null }, JSON.stringify(output))
    }
  })

  it('should use low and warn for an invalid output or output.level (AC3)', () => {
    for (const [cfg, msg] of [
      [{ output: 'low' }, /"output" must be an object/],
      [{ output: { level: 'verbose' } }, /"output\.level" must be "low", "medium" or "high"/],
      [{ output: { level: 'LOW' } }, /"output\.level" must be/],
      [{ output: { level: 1 } }, /"output\.level" must be/],
    ]) {
      const r = readOutputLevel({ cwd: repo(cfg) })
      assert.equal(r.level, 'low', JSON.stringify(cfg))
      assert.match(r.warning, msg)
      assert.match(r.warning, /using "low"/)
    }
  })

  it('should use low and warn for a config that is not valid JSON (AC3)', () => {
    const dir = repo(null)
    writeFileSync(path.join(dir, '.claude', 'engineering.json'), '{ not json')
    const r = readOutputLevel({ cwd: dir })
    assert.equal(r.level, 'low')
    assert.match(r.warning, /not valid JSON/)
  })
})

describe('output-level: rule text (ESP-167)', () => {
  it('should give the low rule with the exemption list (AC1)', () => {
    const text = outputLevelContext({ level: 'low', warning: null })
    assert.match(text, /output level: low/)
    assert.match(text, /one line/)
    assert.doesNotMatch(text, /two lines of the command/)
    assert.match(text, EXEMPT)
    assert.match(text, /full detail/)
  })

  it('should give the medium rule with the same exemption list (AC2)', () => {
    const text = outputLevelContext({ level: 'medium', warning: null })
    assert.match(text, /output level: medium/)
    assert.match(text, /one line/)
    assert.match(text, /at most two lines of the command/)
    assert.match(text, EXEMPT)
  })

  it('should give nothing for high (AC2)', () => {
    assert.equal(outputLevelContext({ level: 'high', warning: null }), null)
  })

  it('should add the config warning to the rule so it reaches the user (AC3)', () => {
    const text = outputLevelContext({ level: 'low', warning: '"output.level" must be "low", "medium" or "high"; using "low"' })
    assert.match(text, /Config problem: "output\.level" must be/)
    assert.match(text, /once per session; skip it if you already did/)
  })
})

describe('output-level: SessionStart hook (ESP-167)', () => {
  it('should print SessionStart JSON with the low rule when nothing is set (AC1)', () => {
    const r = runHook(repo(null))
    assert.equal(r.status, 0, r.stderr)
    const out = JSON.parse(r.stdout)
    assert.equal(out.hookSpecificOutput.hookEventName, 'SessionStart')
    assert.match(out.hookSpecificOutput.additionalContext, /output level: low/)
    assert.match(out.hookSpecificOutput.additionalContext, EXEMPT)
  })

  it('should print the medium rule for medium and nothing for high (AC2)', () => {
    assert.match(contextOf(runHook(repo({ output: { level: 'medium' } }))), /output level: medium/)
    const high = runHook(repo({ output: { level: 'high' } }))
    assert.equal(high.status, 0, high.stderr)
    assert.equal(high.stdout, '')
  })

  it('should never fail: invalid config, bad stdin and a folder outside git all exit 0 with the low rule (AC3)', () => {
    const bad = runHook(repo({ output: { level: 'loud' } }))
    assert.equal(bad.status, 0, bad.stderr)
    assert.match(contextOf(bad), /output level: low/)
    assert.match(contextOf(bad), /Config problem/)
    const noGit = tempDir('usiatech-nogit-')
    for (const r of [runHook(noGit, 'not json'), runHook(noGit, '')]) {
      assert.equal(r.status, 0, r.stderr)
      assert.match(contextOf(r), /output level: low/)
    }
  })
})
