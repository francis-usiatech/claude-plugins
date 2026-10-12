// AC6 budget for the after-Bash workflow check, run by `npm test` as its own step after the parallel suite: on a
// machine busy with the other test files the median swung from under 20 ms to over 250 ms (2026-10-07 plan change).
// The file name doesn't match node --test's default patterns, so the parallel run skips it.
import { describe, it, after } from 'node:test'
import assert from 'node:assert/strict'
import { existsSync, readdirSync } from 'node:fs'
import path from 'node:path'
import { tempDir, cleanupTempDirs, writeFiles } from './helpers.mjs'
import { snapshotWorkflows, checkAfterBash, snapshotDir } from '../hooks/scripts/bash-workflow-check.mjs'

after(cleanupTempDirs)

const BUDGET_MS = 100
const MAX_ROUNDS = 3
const CLEAN = 'on: push\njobs:\n  a:\n    steps:\n      - run: echo ok\n'

describe('after-Bash workflow check timing (R6; AC6)', () => {
  // The snapshot plus the hook's own work, timed in this process so Node start-up doesn't count. The spawned hook adds
  // only Node start-up and its own module, which bash-workflow-check.test.mjs checks with NODE_DEBUG=esm.
  // Up to three rounds: one busy moment on the machine took a round to 102.7 ms and failed the whole gate (ESP-41).
  // A real slowdown is over the budget in every round.
  it('should take under 100 ms for the snapshot plus the check of a Bash call that changes no workflow file, with 20 workflow files (median of 10, best of 3 rounds)', async (t) => {
    const root = tempDir()
    writeFiles(root, Object.fromEntries(Array.from({ length: 20 }, (_, i) => [`.github/workflows/wf${i}.yml`, CLEAN])))
    const rounds = []
    for (let round = 0; round < MAX_ROUNDS; round++) {
      const times = []
      for (let i = 0; i < 10; i++) {
        const id = `toolu_perf${round}_${i}`
        const start = process.hrtime.bigint()
        assert.equal(snapshotWorkflows(root, id), true)
        const out = await checkAfterBash({ hook_event_name: 'PostToolUse', tool_name: 'Bash', tool_input: { command: 'echo hi' }, tool_use_id: id }, root)
        times.push(Number(process.hrtime.bigint() - start) / 1e6)
        assert.equal(out, null)
      }
      times.sort((a, b) => a - b)
      const median = (times[4] + times[5]) / 2
      rounds.push({ median, times })
      if (median < BUDGET_MS) break
    }
    const report = rounds.map((r, i) => `round ${i + 1}: median ${r.median.toFixed(1)} ms (${r.times.map((t) => t.toFixed(0)).join(', ')})`).join('; ')
    if (rounds.length > 1) t.diagnostic(report)
    assert.ok(rounds.at(-1).median < BUDGET_MS, `no round under ${BUDGET_MS} ms. ${report}`)
    assert.equal(existsSync(path.join(root, '.claude', 'governance-log.jsonl')), false, 'nothing logged')
    assert.deepEqual(readdirSync(snapshotDir(root)), [], 'no snapshot left')
  })
})
