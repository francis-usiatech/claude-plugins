// The gate's step runner on its own (code review 2026-11-09): paths a whole gate run can't reach on cue, such as an
// interrupt that lands between two steps, or a process tree stopped only in part.
import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { runSelected, resultOf } from '../skills/verify/gate-steps.mjs'

const step = (name) => ({ name, run: 'node -e "process.exit(0)"', timeoutMs: 1000, expectNoDiff: [] })

describe('gate steps: an interrupt between steps (ESP-58)', () => {
  it('should start no further step once the interrupt has landed, and fail the run', async () => {
    const interrupt = new AbortController()
    interrupt.abort()
    // No log: a step that started would need one, so starting any step would throw here.
    const { failed, lines } = await runSelected(process.cwd(), [step('first'), { ...step('cond'), skipped: 'no changed file under src/' }, step('last')], null, interrupt.signal)
    assert.equal(failed, true)
    assert.deepEqual(lines, ['NOT RUN  first', 'SKIPPED  cond (no changed file under src/)', 'NOT RUN  last'])
  })
})

describe('gate steps: a process tree stopped only in part (ESP-58)', () => {
  it('should say a timed-out step may have left part of its tree running, on one line', () => {
    const r = { outcome: 'timeout', leftRunning: 'process 4242: ERROR: Access is denied.\r\n  (child 4243)' }
    assert.equal(resultOf(r, 1000), 'timed out after 1000 ms, part of the process tree may still be running (process 4242: ERROR: Access is denied. (child 4243))')
  })

  it('should say the same for an interrupted step', () => {
    assert.equal(resultOf({ outcome: 'aborted', leftRunning: 'process 7: denied' }, 1000), 'interrupted, part of the process tree may still be running (process 7: denied)')
  })

  it('should add nothing when the tree was stopped', () => {
    assert.equal(resultOf({ outcome: 'timeout' }, 1000), 'timed out after 1000 ms')
    assert.equal(resultOf({ outcome: 'aborted' }, 1000), 'interrupted')
  })
})
