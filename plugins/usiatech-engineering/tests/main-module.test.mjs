// F4: a script started through a link or junction must still run. Comparing argv[1] to import.meta.url as written
// made each of these exit 0 without doing anything.
import { describe, it, after } from 'node:test'
import assert from 'node:assert/strict'
import { symlinkSync } from 'node:fs'
import { spawnSync } from 'node:child_process'
import path from 'node:path'
import { tempDir, cleanupTempDirs, PLUGIN_ROOT } from './helpers.mjs'

after(cleanupTempDirs)

// Each script with input it can't use, so a run that does anything prints something.
const SCRIPTS = [
  { file: 'hooks/scripts/bash-workflow-check.mjs', input: 'not json' },
  { file: 'skills/mutation-test/mutation-runner.mjs' },
  { file: 'templates/github/scripts/fake-pass-check.mjs' },
  { file: 'templates/github/scripts/governance-checks.mjs' },
]

describe('entry scripts reached through a link (F4)', () => {
  for (const { file, input = '' } of SCRIPTS) {
    it(`should run ${path.basename(file)} when its folder is reached through a link`, (t) => {
      const dir = tempDir()
      const link = path.join(dir, 'linked')
      try {
        symlinkSync(path.join(PLUGIN_ROOT, path.dirname(file)), link, 'junction')
      } catch (e) {
        t.skip(`links can't be made here: ${e.message}`)
        return
      }
      const env = { ...process.env, CLAUDE_PROJECT_DIR: dir }
      delete env.GITHUB_STEP_SUMMARY
      const run = spawnSync(process.execPath, [path.join(link, path.basename(file))], { cwd: dir, env, input, encoding: 'utf8', timeout: 30000 })
      assert.notEqual(`${run.stdout}${run.stderr}`.trim(), '', `exit ${run.status}, no output`)
    })
  }
})
