import { describe, it, after } from 'node:test'
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { existsSync, mkdirSync, realpathSync, rmSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { pluginVersionWarning, contextAdvisory, readThreshold, projectSlug, runChecks, DEFAULT_CONTEXT_TOKENS } from '../scripts/session-check.mjs'
import { stateDir } from '../hooks/scripts/governance-state.mjs'
import { PLUGIN_ROOT, tempDir, cleanupTempDirs, git } from './helpers.mjs'

after(cleanupTempDirs)

// A plugin cache folder: <cache>/<version>/.claude-plugin/plugin.json for each version.
const pluginCache = (...versions) => {
  const cache = tempDir('usiatech-cache-')
  for (const v of versions) {
    mkdirSync(path.join(cache, v, '.claude-plugin'), { recursive: true })
    writeFileSync(path.join(cache, v, '.claude-plugin', 'plugin.json'), JSON.stringify({ name: 'usiatech-engineering', version: v }))
  }
  return cache
}

describe('session-check: stale plugin (ESP-120)', () => {
  it('should name both versions when a newer version is in the cache (AC1)', () => {
    const cache = pluginCache('0.9.0', '0.18.8', '0.18.10', '0.19.0')
    const msg = pluginVersionWarning({ pluginRoot: path.join(cache, '0.18.8') })
    assert.match(msg, /0\.18\.8/)
    assert.match(msg, /0\.19\.0/)
    assert.match(msg, /start a new session/i)
  })

  it('should compare versions as numbers, not text', () => {
    const cache = pluginCache('0.9.0', '0.18.10')
    assert.match(pluginVersionWarning({ pluginRoot: path.join(cache, '0.9.0') }), /0\.18\.10/)
    assert.equal(pluginVersionWarning({ pluginRoot: path.join(cache, '0.18.10') }), null)
  })

  it('should print nothing when the running version is the newest (AC2)', () => {
    const cache = pluginCache('0.18.9', '0.19.0')
    assert.equal(pluginVersionWarning({ pluginRoot: path.join(cache, '0.19.0') }), null)
  })

  it('should print nothing when there is no version cache, as in a source checkout (AC3)', () => {
    assert.equal(pluginVersionWarning({ pluginRoot: PLUGIN_ROOT }), null)
    assert.equal(pluginVersionWarning({ pluginRoot: path.join(tempDir(), 'missing') }), null)
  })
})

// A transcript folder for cwd under projectsDir, with one session whose last call had `tokens` of context.
const transcript = (projectsDir, cwd, sessionId, tokens) => {
  const dir = path.join(projectsDir, projectSlug(cwd))
  mkdirSync(dir, { recursive: true })
  const line = (t) => JSON.stringify({ type: 'assistant', message: { id: `m${t}`, usage: { input_tokens: 10, cache_creation_input_tokens: 90, cache_read_input_tokens: t - 100, output_tokens: 5 } } })
  writeFileSync(path.join(dir, `${sessionId}.jsonl`), [line(1000), JSON.stringify({ type: 'user' }), line(tokens), '{"type":"user"}', ''].join('\n'))
}

describe('session-check: context advisory (ESP-121)', () => {
  const setup = () => {
    const marker = tempDir('usiatech-marker-')
    return { projectsDir: tempDir('usiatech-projects-'), markerDir: () => marker, cwd: 'C:\\repo\\my.app' }
  }

  it('should recommend a fresh session above the threshold, once per session (AC2)', () => {
    const s = setup()
    transcript(s.projectsDir, s.cwd, 'sess-1', 350000)
    const first = contextAdvisory({ ...s, threshold: 300000 })
    assert.match(first, /350k/)
    assert.match(first, /300k/)
    assert.match(first, /fresh session|compact/i)
    assert.equal(contextAdvisory({ ...s, threshold: 300000 }), null, 'second run in the same session prints nothing')
  })

  it('should print nothing at or below the threshold', () => {
    const s = setup()
    transcript(s.projectsDir, s.cwd, 'sess-2', 300000)
    assert.equal(contextAdvisory({ ...s, threshold: 300000 }), null)
  })

  it('should find the project folder whatever the case of the drive letter', () => {
    const s = setup()
    const dir = path.join(s.projectsDir, projectSlug(s.cwd).toLowerCase())
    mkdirSync(dir, { recursive: true })
    writeFileSync(path.join(dir, 's.jsonl'), JSON.stringify({ type: 'assistant', message: { usage: { input_tokens: 400000 } } }) + '\n')
    assert.match(contextAdvisory({ ...s, threshold: 300000 }), /400k/)
  })

  it('should print nothing when there is no transcript', () => {
    assert.equal(contextAdvisory({ ...setup(), threshold: 300000 }), null)
  })
})

describe('session-check: threshold from the base branch (ESP-121 AC1)', () => {
  const repo = (baseConfig, workingConfig) => {
    const dir = tempDir('usiatech-repo-')
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

  it('should default to 300000 with no setting', () => {
    assert.equal(DEFAULT_CONTEXT_TOKENS, 300000)
    assert.deepEqual(readThreshold({ cwd: repo(null) }), { threshold: 300000, warning: null })
  })

  it('should read the base-branch value, not an edited working copy', () => {
    const dir = repo({ session: { contextAdvisoryTokens: 200000 } }, { session: { contextAdvisoryTokens: 900000 } })
    assert.equal(readThreshold({ cwd: dir }).threshold, 200000)
  })

  it('should fall back to the working copy, with a warning, when the base branch has no config', () => {
    const dir = repo(null, { session: { contextAdvisoryTokens: 250000 } })
    const r = readThreshold({ cwd: dir })
    assert.equal(r.threshold, 250000)
    assert.match(r.warning, /"develop" has no readable \.claude\/engineering\.json; using the working copy/)
  })

  it('should never pass a base branch to git as an option', () => {
    // Without --end-of-options, git show reads "--format=format:x:..." as a format and prints it, which is not JSON.
    const dir = repo({ session: { contextAdvisoryTokens: 200000 } }, { git: { baseBranch: '--format=format:x' }, session: { contextAdvisoryTokens: 250000 } })
    const r = readThreshold({ cwd: dir })
    assert.equal(r.threshold, 250000)
    assert.match(r.warning, /using the working copy/)
  })

  it('should warn and use the default for a bad value', () => {
    for (const bad of [0, -5, 1.5, '300000', null]) {
      const r = readThreshold({ cwd: repo({ session: { contextAdvisoryTokens: bad } }) })
      assert.equal(r.threshold, 300000, String(bad))
      assert.match(r.warning, /session\.contextAdvisoryTokens/)
    }
  })
})

describe('session-check: entry script', () => {
  const run = (cwd, configDir) => spawnSync(process.execPath, [path.join(PLUGIN_ROOT, 'scripts', 'session-check.mjs')], {
    cwd, encoding: 'utf8', env: { ...process.env, CLAUDE_CONFIG_DIR: configDir },
  })

  it('should exit 0 and print nothing in a source checkout with no transcript', () => {
    const r = run(tempDir(), tempDir())
    assert.equal(r.status, 0, r.stderr)
    assert.equal(r.stdout, '')
  })

  it('should keep the once-per-session marker in the private project state folder', (t) => {
    const cwd = realpathSync.native(tempDir())
    const configDir = tempDir()
    const state = stateDir(cwd)
    t.after(() => rmSync(state, { recursive: true, force: true }))
    transcript(path.join(configDir, 'projects'), cwd, 'sess-m', 350000)
    const r = run(cwd, configDir)
    assert.equal(r.status, 0, r.stderr)
    assert.match(r.stdout, /350k/)
    assert.ok(existsSync(path.join(state, 'session-check-sess-m.context')), 'marker in the state folder')
    assert.equal(run(cwd, configDir).stdout, '', 'second run prints nothing')
  })

  it('should report a failing check on stderr and exit 1', () => {
    const cwd = realpathSync.native(tempDir())
    const configDir = tempDir()
    // A file where the project's transcript folder should be makes the context check throw.
    mkdirSync(path.join(configDir, 'projects'))
    writeFileSync(path.join(configDir, 'projects', projectSlug(cwd)), 'x')
    const r = run(cwd, configDir)
    assert.equal(r.status, 1)
    assert.match(r.stderr, /^session-check: /m)
  })
})

describe('session-check: runChecks', () => {
  it('should still give the other advice when one check throws', () => {
    const r = runChecks([() => { throw new Error('boom') }, () => null, () => 'advice'])
    assert.deepEqual(r, { lines: ['advice'], errors: ['boom'] })
  })
})
