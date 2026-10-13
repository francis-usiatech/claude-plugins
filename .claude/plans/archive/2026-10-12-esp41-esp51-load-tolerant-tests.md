# Plan: ESP-41 and ESP-51 load-tolerant timing tests

## Goal
Three tests fail the whole gate when the machine is busy, although the code they check is fine. Make them tolerant of load without losing what they guard, so a false failure no longer costs a full gate re-run.

## Requirement references
- Jira ESP-41 (epic ESP-8, label `efficiency`, Medium): "Fix flaky bash-workflow-timing test"
- Jira ESP-51 (epic ESP-8, label `efficiency`, Medium): "Make the AC11 lookup-timeout test less sensitive to machine load"
- `docs/specs/2026-10-02-workflow-checks-hardening.md` AC6 (the 100 ms budget, "median of 10 runs")
- `docs/specs/2026-09-28-security-supply-chain.md` AC11 (a decision inside the hook timeout when a lookup never resolves)

## Acceptance criteria
- AC1: The AC11 test in `tests/governance-policy.test.mjs` and the matching deadline test in `tests/supply-chain-lookups.test.mjs` have no elapsed-time assertion and a test timeout of 4 s (under the 6 s default deadline; Change log, stage 2). Both still assert the result and the `timed out after 50 ms` reason. After the test edits, with the deadline timer disabled in `templates/github/scripts/supply-chain-lookups.mjs` (a temporary local edit), both tests fail; with the file restored (`git diff --quiet` on it exits 0), both pass.
  - Evidence: with the timer's callback emptied, both tests timed out (at the 7 s of that moment; pass 0, cancelled 2, exit 1). With the final 4 s timeout and a timer that fires at the 6 s default instead of the 50 ms asked for, both ended as "test timed out after 4000ms" (pass 0, cancelled 2, exit 1). After `git checkout` of the file, `git diff --quiet` exit 0 and both pass (pass 2, fail 0) (shown, 2026-10-12)
- AC2: `tests/bash-workflow-timing.perf.mjs` keeps the 100 ms budget and runs up to three rounds of ten calls. It passes as soon as one round's median is under the budget, and fails only when all three are over, with a message that lists every round's times. With the budget set to 0 ms (a temporary local edit, reverted), the test fails and its message shows three rounds. Spec AC6 says the same.
  - Evidence: with `BUDGET_MS = 0` the test failed with "no round under 0 ms. round 1: median 80.5 ms (…); round 2: median 89.9 ms (…); round 3: median 280.8 ms (…)"; with 100 restored it passes (pass 1, fail 0); spec AC6 reads "median of 10 runs, in at least one of up to three rounds; ESP-41" (shown, 2026-10-12)
- AC3: Under artificial load (one busy Node process per logical core, 8 on this machine, started by a scratchpad script outside the repo), the two deadline tests pass 10 runs out of 10. The timing test is measured under the same load and at 4 and 6 busy processes, and the result is recorded here and on ESP-41: three rounds ride out a short busy moment, not sustained load.
  - Evidence: deadline tests 10 of 10 with 8 busy processes, with the 7 s timeout and again with the final 4 s. Timing test: 3 of 3 idle; 2 of 10 with 8 busy; 8 of 10 with 4 busy; 8 of 10 with 6 busy (shown, 2026-10-12)
- AC4: `tests/governance-gate.test.mjs` "should fail when deterministic checks did not succeed" is run 10 times under the same load. Either it passes 10 of 10 and the finding is written as a comment on ESP-51, or the cause is found in `tests/` and fixed in this PR with a Change log line. A cause outside `tests/` is not fixed here: stop and ask.
  - Evidence: 10 of 10 with 8 busy processes; not reproduced, no change to the file; comment on ESP-51 (shown, 2026-10-12)
- AC5: The gate passes: `node plugins/usiatech-engineering/skills/verify/gate.mjs` prints four `PASS` lines and `Gate: PASS`, exit 0.
  - Evidence: runner gate 2026-10-12T18:23:40Z, after the stage 2 fixes: tests, validate marketplace, validate plugin and fake-pass check all exit 0, `Gate: PASS`; npm test 1107 passed, 1 skipped, 0 failed of 1108, plus timing 1/1 (shown)

## Tasks
- [x] T1: Remove the elapsed-time assertion from both deadline tests and set the 7 s timeout; then disable the deadline timer, see both tests fail, and restore the file (covers AC1; ESP-51).
- [x] T2: Add the three-round retry to the timing test and update its title; show it fails with a 0 ms budget; amend spec AC6 (covers AC2; ESP-41).
- [x] T3: Run the three tests, and the governance-gate test, 10 times under load; record the result and comment on ESP-51 and ESP-41 (covers AC3, AC4; ESP-41, ESP-51).
- [x] T4: Run the gate and fill in the evidence (covers AC5; ESP-41, ESP-51).

## Files
- `plugins/usiatech-engineering/tests/governance-policy.test.mjs`
- `plugins/usiatech-engineering/tests/supply-chain-lookups.test.mjs`
- `plugins/usiatech-engineering/tests/bash-workflow-timing.perf.mjs`
- `plugins/usiatech-engineering/tests/governance-gate.test.mjs`
- `docs/specs/2026-10-02-workflow-checks-hardening.md`

## Commands and actions
- None beyond the normal gate. No dependency adds.
- A temporary local edit to `plugins/usiatech-engineering/templates/github/scripts/supply-chain-lookups.mjs` (AC1) and to the budget in the timing test (AC2), each reverted before the next step and never committed.
- A load script in the session scratchpad, outside the repo.
- Comments on Jira ESP-51 (the AC4 finding) and ESP-41 (the AC3 measurements).

## Out of scope
- Any committed change to plugin code under `hooks/`, `skills/` or `templates/`.
- Moving the timing test out of `npm test`, or changing the 100 ms budget.
- Making the timing test pass under sustained load (Change log, 2026-10-12, AC3).
- The version bump and a README Versioning row. A test-only change ships with the next release (release-version-bump rule).
- ESP-52 to ESP-56 (gate runner limits).

## Approved
- By: Francis · Date: 2026-10-12
- Route: small. Requirement references ESP-41 and ESP-51, 5 files, no new module or interface.

## Change log
- 2026-10-12: Plan drafted and approved by Francis ("proceed"). One plan and one PR for both tickets, because they are test-only fixes with the same cause.
- 2026-10-12: Pre-flight FLAG, six items, no blocker; Francis: "Apply all defaults":
  - (1) The deadline timer is in `templates/github/scripts/supply-chain-lookups.mjs`, not in `governance-policy.mjs`; AC1 and Commands name that file.
  - (2) T1 edits the tests first and disables the timer after, so the failure is shown on the new tests.
  - (3) Spec AC6 says "median of 10 runs"; three rounds is a different measure, so the spec is amended and added to Files and Requirement references.
  - (4) The test timeout is 7 s, not 10 s.
  - (5) `tests/supply-chain-lookups.test.mjs` has the same `< 1000` assertion and is added to Files. `tests/helpers.mjs` is removed from Files, which keeps the count at 5.
  - (6) AC4 stops and asks when the cause is outside `tests/`; the ESP-51 comment is listed as an action; T4 names its tickets.
- 2026-10-12 (T1): the deadline test in `supply-chain-lookups.test.mjs` also gets the 7 s timeout (it had 2 s, and the AC11 test took up to 1.4 s under load); AC1 says so. The first temporary edit to the timer (`deadlineMs * 1e6`) left a timer of 14 hours alive, so the test processes never ended; the run was stopped, the leftover processes killed, and the edit replaced by an empty timer callback.
- 2026-10-12 (T3, AC3 changed; Francis: "Keep three rounds, reword AC3"): AC3 first said the timing test passes 10 of 10 under full load. It does not: 2 of 10 with 8 busy processes, 8 of 10 with 4 and with 6. The check calls git on every call, and starting a process on a loaded Windows machine takes about 500 ms, so all three rounds go over the budget (a failing run takes 15 to 30 s). Three rounds do what ESP-41 asks, ride out a short busy moment like the single 102.7 ms failure; they do not make the test pass under sustained load. The rule "check for other test runs before a gate" stays. Two other options were offered and not taken: a test that skips itself on a busy machine, and subtracting git's start-up time.
- 2026-10-12 (release review; no item needed a decision):
  - Stage 1 governance: PASS. One nit fixed (a space lost in `const CLEAN =`).
  - Stage 2 silent-failure: PASS with one lost guard, fixed. The 7 s timeout from pre-flight item (4) was above the 6 s default deadline, and the "timed out after 50 ms" text comes from the parameter, not from the timer's real delay, so a timer that ignored the 50 ms deadline would still pass. Both timeouts are now 4 s. Shown by a second temporary edit to `supply-chain-lookups.mjs` (the timer fires at the default): both tests timed out at 4 s; the file was restored. Nit applied: the timing test prints its rounds as a diagnostic when it needed more than one.
  - Stage 2 convention: PASS with nits. Applied: a shorter test title, the timeout reason in the second test's comment, a dated sentence in the spec's R6 design note. Not applied: a `RUNS` constant for the literal 10.
  - Security reviewer not run: the change is test code and one spec line.
- 2026-10-12: the 0 ms budget for AC2 was set and reset with `sed -i` through Bash on a file in Files; the scratchpad script was also changed with `sed -i`.
- 2026-10-12: closed and archived inside the feature PR #95, because this change has no release PR of its own. The file was moved here with `mv` through Bash, which the guard does not log as a plan write.

## Final status
- **Shipped** to develop by PR #95 (commit `2d0e9d6`, plus the commit that adds this archive). Not released: a test-only change, it ships with the next release. Jira ESP-41 and ESP-51 → Ready for Release.
- AC1: shown (both deadline tests time out with the timer disabled, and with a timer that ignores the 50 ms deadline; both pass with the file restored).
- AC2: shown (fails with a 0 ms budget and lists three rounds; spec AC6 amended).
- AC3: shown, as changed on 2026-10-12: deadline tests 10 of 10 under full load; the timing test is not load-proof (2 of 10 with 8 busy processes, 8 of 10 with 4 and with 6).
- AC4: shown (10 of 10 under load; the failure was not reproduced; file unchanged; comment on ESP-51).
- AC5: shown. Gate 2026-10-12T18:23:40Z: npm test 1107 passed, 1 skipped, 0 failed of 1108, plus timing 1/1; both validates exit 0; fake-pass check exit 0.
- CI does not run (GitHub billing block, ESP-40). Merged on the local gate.
- Reviews: pre-flight FLAG (six items, defaults applied); stage 1 governance PASS; stage 2 silent-failure PASS with one lost guard fixed; stage 2 convention PASS with nits. No review ran on the stage 2 fixes; the gate and the second timer check did. Security reviewer not run.
- Deviations: AC3 was changed after approval (Francis's decision). The test timeout went from the approved 7 s to 4 s after stage 2. Two temporary edits to `templates/github/scripts/supply-chain-lookups.mjs`, both reverted (the guard asked each time). `tests/governance-gate.test.mjs` is in Files and unchanged. `sed -i` and `mv` writes through Bash have no guard log entry.
