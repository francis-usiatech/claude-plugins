# Plan: ESP-52 gate runner per-step timeout

## Goal
A gate step that runs past its timeout is stopped with its whole process tree and shown as a failure, so a hanging step can no longer hang the gate and the session.

## Requirement references
- Jira ESP-52 (epic ESP-8, label `efficiency`, High): "Gate runner: per-step timeout"

## Design
- Each step in `verify` and `verifyConditional` may carry `"timeoutMs"`, an integer from 1 to 2147483647. Without it the step gets the built-in default of 600000 ms (10 minutes). The fake-pass check runs under the default.
- `skills/verify/gate.mjs` stops using `spawnSync` and runs each step through `runCommand`, imported from `skills/mutation-test/mutation-runner.mjs`. That function already has the timeout, the tree kill (`taskkill /T /F` on Windows, the process group on POSIX) and the 2 s grace when the kill fails.
- `runCommand` changes: it can send stdout and stderr to a given file, run a program with arguments without a shell, and report the ending signal and the start error separately. Its defaults stay as they are, so the mutation runner behaves the same.
- A timed-out step prints `FAIL  <name> (timed out after <timeoutMs> ms, <n> s)` and then its last 40 lines, like any failed step. If the tree could not be stopped, the reason names the process id.

## Acceptance criteria
- AC1: A `verify` step with a `timeoutMs` whose command never ends prints `FAIL  <name> (timed out after <timeoutMs> ms, <n> s)` and the last 40 lines of its output; every later step prints `NOT RUN`; the fake-pass check prints `NOT RUN`; the last line is `Gate: FAIL`; the runner exits 1. The test has its own 30 s timeout (15 s as approved; see the Change log), so a runner that hangs fails it.
  - Evidence: shown. Gate 2026-10-12T20:47:31Z: "should stop a step at its timeout, show its last lines and skip the rest (AC1)" passed (14.1 s). Not run red: against the old runner the step hangs for good. Mutation run: the timeout mutations were caught.
- AC2: The step's whole process tree is stopped. The hanging step starts a second process, and each writes its process id to a file. The test first requires both files to exist and hold a process id, then checks that neither process is alive (for up to 5 s). The step's timeout is long enough for both processes to start on a loaded machine.
  - Evidence: shown on Windows (the process tree). Same gate run: "should stop the whole process tree of a timed-out step (AC2)" passed (13.2 s). The process-group half (POSIX) is not shown.
- AC3: A `timeoutMs` of 0, -1, 1.5, "60", null or 2147483648 in a `verify` step, and of 0 in a `verifyConditional` step, makes the runner run nothing, print a reason that names `timeoutMs` and the step, print `Gate: FAIL` and exit 2. Seven test cases.
  - Evidence: shown. All seven cases failed before the gate change and pass in the same gate run.
- AC4: A step with no `timeoutMs` that ends in time gives the same output as today: every test in `tests/gate.test.mjs` at 969c2b2 passes unchanged.
  - Evidence: shown. The test diff removes one line, an import that was widened; no existing test or assertion changed, and all pass in the same gate run.
- AC5: A step that ends by a signal prints `FAIL  <name> (killed by <signal>, <n> s)` and the runner exits 1 (POSIX only; skipped on Windows, where a shell step cannot end by a signal). A step whose shell cannot be started prints `FAIL  <name> (could not start: <reason>, <n> s)` and the runner exits 1 (Windows only, by pointing `ComSpec` at a missing file; skipped on POSIX). Each test states its skip reason.
  - Evidence: half shown. The could-not-start test passed (3.1 s). The signal test is not shown: skipped on Windows with its reason, and CI does not run (ESP-40).
- AC6: `runCommand` has tests in `tests/mutation-runner.test.mjs` for four behaviours: stdout and stderr both land in a given file; a program with arguments runs without a shell; the failing-kill case also resolves as an error with file output; the result reports the ending signal and the start error separately. Every test in that file at 969c2b2 passes unchanged.
  - Evidence: shown. Five new tests; four failed before the code change; all 17 in the file pass.
- AC7: An error thrown while a step is running still ends in `Gate: FAIL` with exit 2, now that the runner is async.
  - Evidence: shown. The test passes; it also passed against the old runner, and the mutation run shows it guards the new code.
- AC8: `plugins/usiatech-engineering/README.md` "Gate runner" documents `timeoutMs`, the 10-minute default, the timed-out line, that the process tree is stopped, and that the CI gate does not honour `timeoutMs`; "no per-step timeout" is gone from Limits; a `timeoutMs` outside 1 to 2147483647 is in "Steps it rejects".
  - Evidence: shown. Read by the convention and governance reviewers, who found every item present; `validate plugin` and the structure tests pass.
- AC9: On SIGINT or SIGTERM the runner stops the running step's process tree, prints `Gate: FAIL` and exits non-zero. The test runs on POSIX only (on Windows a test cannot send a process a signal it can handle) and states its skip reason.
  - Evidence: not shown. The test is skipped on Windows and CI does not run (ESP-40). The silent-failure reviewer probed `runCommand` on Windows with a signal already aborted and with an abort racing an exit 0; both resolved `aborted`.

## Tasks
- [x] T1: TDD the `runCommand` changes in `mutation-runner.mjs` (covers AC6; ESP-52)
- [x] T2: TDD the timeout in `gate.mjs`: the config check, the async step run through `runCommand`, the timed-out line, the interrupt handling (covers AC1, AC2, AC3, AC4, AC7, AC9; ESP-52)
- [x] T3: Tests for the killed-by-signal and could-not-start branches (covers AC5; ESP-52)
- [x] T4: README (covers AC8; ESP-52)
- [x] T5: Run the gate, mutation-test the new code, fill in the evidence (all ACs; ESP-52)

## Files
- `plugins/usiatech-engineering/skills/verify/gate.mjs`
- `plugins/usiatech-engineering/tests/gate.test.mjs`
- `plugins/usiatech-engineering/skills/mutation-test/mutation-runner.mjs`
- `plugins/usiatech-engineering/tests/mutation-runner.test.mjs`
- `plugins/usiatech-engineering/README.md`

## Commands and actions
- The normal gate: `node plugins/usiatech-engineering/skills/verify/gate.mjs`.
- A mutation run on `skills/verify/gate.mjs` and `skills/mutation-test/mutation-runner.mjs`: the mutation runner rewrites those files and restores them byte for byte.
- Jira: ESP-52 to In Progress at the start and to Ready for Release after the merge.
- No dependency adds. No version bump in this PR: it ships with the next release, a minor bump because this is a `feat`.

## Out of scope
- A timeout for the whole gate.
- A default that can be set in the config.
- The CI gate (`templates/github/scripts/run-verify.mjs`) and its workflows.
- ESP-53, ESP-54, ESP-55 and ESP-56.
- `skills/verify/SKILL.md`: its text stays true.

## Known gaps
- The 10-minute default has no test of its own: `gate.mjs` is an entry point with no exports, and a test can't wait 10 minutes.
- The kill-failed line is covered by `runCommand`'s own test, not through the gate. The same holds for the code that puts that reason on one line.
- AC5's signal test, AC9's test and the process-group half of AC2 cannot run on Windows, the only machine the gate runs on while CI is blocked (ESP-40). Their evidence stays "not shown" until CI runs.

## Approved
- By: Francis · Date: 2026-10-12
- Route: small, by override. The rule says large, because `timeoutMs` is a new public config key. Francis chose "Treat as small" (2026-10-12); ESP-52 is the requirement reference.

## Change log
- 2026-10-12: Plan drafted; pre-flight FLAG, eight items, no blocker. Francis decided four items and approved the plan ("approve"):
  - Route: treat as small.
  - Default timeout: 10 minutes.
  - Timeout and tree-kill code: `gate.mjs` imports `runCommand` from `skills/mutation-test/mutation-runner.mjs`, not a new shared module.
  - Interrupt: AC9 added (the step runs in its own process group on POSIX, so Ctrl+C no longer reaches it).
- 2026-10-12: Pre-flight items folded in without a decision: AC6 names four behaviours; AC3 has an upper bound and a case count; AC2 requires both id files first; AC1 states the 40-line tail; the mutation run is listed under Commands and actions; AC7 covers the async entry point; AC8 says the CI gate ignores `timeoutMs`; Known gaps lists what cannot run on Windows.
- 2026-10-12 (T2): `gate.mjs` also imports `handleInterrupts` from the mutation runner, for AC9, with a silent notify. The Design names only `runCommand`. An interrupted step reads `FAIL  <name> (interrupted, <n> s)` and the gate exits 1.
- 2026-10-12 (T5, mutation run): 11 mutations, 10 caught, 0 survived, 1 timeout. The timeout is "the step's own timeout is used": the mutation puts the 10-minute default in its place, so the test hangs, which is the failure looked for. The run was made before the release-review fixes below and was not repeated.
- 2026-10-12 (first gate run, 20:30:52Z: FAIL): the fake-pass check reported `fp-skip`, high, on the three platform-only tests, which used the `{ skip: … }` option. Francis chose "Runtime t.skip" over a `governance.allowlist` entry: each test now starts with `if (…) return t.skip(reason)`. The fake-pass check does not look for that form, so the finding is no longer reported or logged as suppressed; the tests still don't run on the other platform. The governance reviewer notes that the precedent (`tests/governance-policy.test.mjs:1369`) skips after a probe at run time, where these three skip on a fixed platform check, and that `t.skip` is a blind spot of the check that the README does not list.
- 2026-10-12 (release review; fixes applied without a decision):
  - Stage 1 governance: FLAG, no BLOCK. The `fp-skip` item above; two guard `error` entries (the after-Bash workflow check does not run on a background command: the mutation run at 19:58Z and the first gate run at 20:27Z; `git status` showed only the five planned files); the `handleInterrupts` note above.
  - Stage 1 convention: PASS with nits. Applied: AC1's step timeout 3000 ms → 6000 ms and its test timeout 15 s → 30 s (the test took 14.1 s in the passing gate run); one clause in the `handleInterrupts` comment; `timeoutMs` in the README config table. Not applied: an example in `templates/engineering.json` (not in Files); a Versioning row (owed at the release).
  - Stage 2 silent-failure: PASS with nits; no path found where a failed, timed-out, interrupted or never-started step passes. Applied: the could-not-stop reason is put on one line. Not applied: an interrupt between steps reads `FAIL … (interrupted, 0 s)`, not `NOT RUN`; an interrupted gate exits 1, not 130.
  - Stage 2 security: PASS with nits, one Low finding, fixed: the tree test stopped leftover processes by a process id read from a file, which could hit another process if the id had been reused. The two test processes now end on their own after 60 s and the test stops nothing by id. Not applied: an absolute path for `taskkill` (existing code); README wording for a step that leaves its process group.
  - No review ran on these fixes; the second gate run did.
- 2026-10-12: closed and archived inside the feature PR, because this change has no release PR of its own.

## Final status
- **Shipped** to develop by the ESP-52 feature PR (commit `bd26850`, plus the commit that adds this archive). Not released: it ships with the next release, a minor bump. Jira ESP-52 → Ready for Release.
- AC1: shown. AC2: shown on Windows; the POSIX process group is not shown. AC3: shown. AC4: shown. AC5: could-not-start shown; the signal test is not shown. AC6: shown. AC7: shown. AC8: shown. AC9: not shown.
- Gate 2026-10-12T20:47:31Z: PASS. `tests` exit 0 in 386 s (1127 tests: 1124 passed, 3 skipped, 0 failed; plus timing 1/1); both validates exit 0; fake-pass check exit 0 with three `fp-placeholder` warnings, all fixture strings that were in the file before.
- `tests` is one gate step with no `timeoutMs`, so it runs under the 10-minute default; it took 386 s on a machine at about 80% CPU and 170 s in the first run.
- CI does not run (GitHub billing block, ESP-40). Merged on the local gate.
- Reviews: pre-flight FLAG (eight items folded in); stage 1 governance FLAG, no BLOCK; stage 1 convention, stage 2 silent-failure and stage 2 security PASS with nits.
- Deviations: AC1's test timeout went from the approved 15 s to 30 s. The three platform-only tests skip with `t.skip` at run time (Francis's decision). The mutation run was not repeated after the review fixes.
- Open, for tickets outside ESP-52: the fake-pass check does not see a run-time `t.skip`; when `taskkill` stops the root but not a descendant, the step reads plain "timed out" with no word that a process may be left; the mutation list's `timeoutMs` has no upper bound.
