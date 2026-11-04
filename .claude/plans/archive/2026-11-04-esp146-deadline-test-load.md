# Plan: Stop the lookup deadline test timing out under load

**Status:** shipped. Branch `fix/esp146-deadline-test-load`, PR into `develop`. Not released to `main` when this was archived.

## Goal
Stop `should fail closed when a lookup misses the deadline` from failing the verify gate under machine load, by taking test set-up out of its 5000 ms limit. The test must still fail if a lookup hangs past its deadline.

## Requirement references
- ESP-146 (parent ESP-27)

## Pre-plan checklist
- (a) New validation rules and format checks: n/a: this changes one test's structure and adds no rule or check.
- (b) Database or infrastructure mechanisms the design relies on: n/a: no database or infrastructure. The design relies on node:test not counting a `before` hook against a test's `timeout`; T1's measured test duration confirms this.
- (c) Docs and ADRs touched: none in this PR. A search of `docs/`, the plugin README and the skills for `misses the deadline` and `lookupDeadlineMs` found one hit: the README's 0.20.1 history row lists this test as a known flake (ESP-146). That row records a released version, so it stays as written. The next release's bump PR adds the row that says the flake is fixed.

## Cause (measured 2026-11-03, Windows, 8 CPUs, median of 5 runs, milliseconds)
| Phase | Idle | 16 busy-loop processes |
| --- | --- | --- |
| `makeRepo` | 1503 | 12616 |
| `makeGovTree` | 35 | 23 |
| checks before the lookups | 136 | 934 |
| lookups to end (50 ms deadline) | 58 | 61 |
| total | 1731 | 13637 |

`makeRepo` runs about 11 git processes and is 87% to 93% of the time. Baseline `npm test` with 8 busy-loop processes: 1 of 1932 tests failed in the `node --test` stage, this one (`test timed out after 5000ms`, exit 1). That failure stopped `npm test` before its perf step, so the baseline says nothing about the perf step.

## Acceptance criteria
- AC1: With set-up in a `before` hook, the test's reported duration excludes `makeRepo` and `makeGovTree`: the test file run alone reports under 1000 ms for this test on an idle machine.
  - Evidence: test file run alone on idle machine reported 177.3 ms for `should fail closed when a lookup misses the deadline`; this gate run's `npm test` reported 195.07 ms; the diff shows `makeRepo` and `makeGovTree` in a `before` hook (shown, 2026-11-04T16:39Z)
- AC2: The test still fails on a hang: with `call` in `supply-chain-lookups.mjs` temporarily changed so it no longer races the deadline, the test fails; and with the lookup deadline temporarily ignored in favour of a timer longer than the test's limit, the test fails. Both are reverted afterwards.
  - Evidence: mutation runner 4 of 4 CAUGHT: race removed exit 1; fail-open exit 1; timer 120000 and lookupDeadlineMs not passed each TIMEOUT at 60 s, then CAUGHT exit 1 with a 240 s limit; files restored, `git status` shows only the test file changed (shown, 2026-11-04T16:39Z)
- AC3: `npm test` exits 0 with 6 busy-loop processes running throughout, on 8 CPUs. At 8 busy-loop processes, the load that failed the baseline, the deadline test passes and the `node --test` stage has 0 failures.
  - Evidence: `npm test` exit 0 with 6 busy-loop processes on 8 CPUs: 1932 tests, 0 fail, 0 cancelled, 4 skipped, perf step 1/1, deadline test 267.6 ms, 397 s. At 8 busy-loop processes: deadline test 410 ms, `node --test` stage 0 fail, 0 cancelled (perf step fails there, out of scope per the change log) (shown, 2026-11-04T16:39Z)
- AC4: The verify gate (`npm test` and both `claude plugin validate` runs) passes.
  - Evidence: gate run 2026-11-04T16:39:28Z: tests exit 0 (1932 tests, 0 fail, 0 cancelled, 4 skipped; perf 1/1), validate marketplace exit 0, validate plugin exit 0, fake-pass check exit 0, `Gate: PASS` (shown, 2026-11-04T16:39Z)

## Tasks
- [x] T1: Move the test into a nested `describe` whose `before` hook runs `makeRepo` and `makeGovTree`. Keep the test's name, `{ timeout: 5000 }` and its assertions (covers AC1; ESP-146)
- [x] T2: Mutate the fix points and confirm the test fails for each (covers AC2; ESP-146)
- [x] T3: Run `npm test` under load, with no reviewers running (covers AC3; ESP-146)
- [x] T4: Run the verify gate (covers AC4; ESP-146)

## Files
- `plugins/usiatech-engineering/tests/governance-checks.test.mjs`

## Commands and actions
- None beyond the temporary mutations in T2, which are reverted. A local script outside the repo generates the CPU load.

## Out of scope
- Production code: `governance-checks.mjs` and `supply-chain-lookups.mjs` keep their behaviour.
- Making `makeRepo` faster.
- Raising the limit: 5000 ms stays. The remaining timed work took about 1000 ms at 16 busy-loop processes.
- Other tests with a time limit: they did not fail in the runs under load, for example `governance-policy.test.mjs:1221` and `jira-tracker.test.mjs:328`.
- `bash-workflow-timing.perf.mjs`: its 100 ms budget is a deliberate speed guard and stays as written. With all 8 CPUs saturated it fails 3 of 3, so a gate run at that load can still fail on that step.
- Releasing to `main`.

## Approved
- By: Francis · Date: 2026-11-03
- Route: small (cites ESP-146, touches 1 file, adds no skill, module, service or public interface)

## Deviations
- AC3 was lowered from 8 to 6 busy-loop processes for the full `npm test`. See the change log.
- The test timing is proven at 8 busy-loop processes, but the full gate only at 6. A gate run with all CPUs saturated can still fail on the perf step.
- One perf probe at 6 needed its third round (110.0, 113.5, then 70.3 ms median), so that margin is thin. All 3 probes and the one full `npm test` at 6 passed.

## Change log
- 2026-11-03: drafted; governance-reviewer pre-flight PASS; approved by Francis.
- 2026-11-04: AC3 changed from 8 to 6 busy-loop processes for the full `npm test`, approved by Francis, with an added requirement that at 8 the deadline test passes and the `node --test` stage has 0 failures. The baseline run stopped before the perf step, so the plan's "no other test failed" was incomplete: `bash-workflow-timing.perf.mjs` fails at 8 and passes at 6. Added that test to Out of scope.
- 2026-11-04: Governance FLAG acknowledged by Francis: the after-Bash workflow check did not run for 3 background load runs (05:35:01Z, 06:11:00Z, 06:23:12Z). No workflow file changed.
