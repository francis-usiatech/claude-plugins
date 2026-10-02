# Plan: Mutation runner: no hang on a failed kill, no writes through links into .git

## Goal
Fix the two low-confidence follow-ups from the PR #29 review: a failed process-tree kill can leave `runCommand` waiting forever, and a symlink or junction inside the repo that resolves into `.git` gets past `checkFile`.

## Requirement references
- #38
- docs/specs/2026-09-30-fake-pass-and-mutation-test.md (R13–R15: the runner restores every file and never writes outside the repo or into .git)

## Acceptance criteria
- AC1: When the process-tree kill fails, `runCommand` resolves with `outcome: 'error'` and a stderr naming the kill failure, instead of hanging. Test `it('should resolve as error, not hang, when the process tree cannot be killed')` passes with a test-level `timeout`, so the pre-fix run fails rather than hanging; its cleanup really kills the leaked child. A kill that reports failure while the command does end keeps the `timeout`/`aborted` outcome (test `it('should keep the timeout outcome when the kill reports a failure but the command still ends')`). Run: `node --test plugins/usiatech-engineering/tests/mutation-runner.test.mjs` from the repo root.
  - Evidence: tests "should resolve as error, not hang, when the process tree cannot be killed" and "should keep the timeout outcome when the kill reports a failure but the command still ends" pass (second was red without the grace period: actual error, expected timeout); test file 10/10 full runs green, 12/12 each (shown, 2026-10-02T22:11Z)
- AC2: A mutation list whose `file` goes through a junction or symlink inside the repo whose real path has `.git` as **any** segment (the repo's own `.git` or a nested `sub/.git`) is rejected with a `ListError` ("must not be inside .git"), and nothing is written. Test `it('should reject a path that reaches into .git through a symlink or junction')` passes.
  - Evidence: test "should reject a path that reaches into .git through a symlink or junction" passes, both gitlink/config and sublink/HEAD (red before fix: exit 0, expected 2) (shown, 2026-10-02T19:22Z)
- AC3: No regressions. From the repo root: `npm test` passes with 0 failures and 0 skipped/todo; `node plugins/usiatech-engineering/templates/github/scripts/fake-pass-check.mjs` exits 0; `claude plugin validate .` and `claude plugin validate plugins/usiatech-engineering` both exit 0.
  - Evidence: npm test 661/661 pass, 0 fail/skipped/todo; fake-pass-check exit 0; claude plugin validate . and plugins/usiatech-engineering exit 0 (shown, 2026-10-02T22:11Z)

## Tasks
- [x] T1: Red: add the AC1 test. The injected kill reports failure and keeps hold of the child; the command never exits on its own; there is a test-level `timeout`; `finally`/`after` kills the child for real (covers AC1; #38)
- [x] T2: Green: `killTree` returns whether the kill worked; `runCommand` takes an optional `kill` (default `killTree`). When the kill fails, it resolves `error` with the kill message, clears the timer and the abort listener, and detaches from the child's stderr so a late `close` is harmless (covers AC1; #38)
- [x] T3: Red: add the AC2 test with two cases in a temp repo: a junction to the repo's `.git`, and a junction to a nested `sub/.git`; list entries go through each (covers AC2; #38)
- [x] T4: Green: in `checkFile`, reject when any segment of the real relative path is `.git` (case-insensitive), the same rule as the literal check (covers AC2; #38)
- [x] T5: Run the AC3 gate (covers AC3)

## Files
- `plugins/usiatech-engineering/skills/mutation-test/mutation-runner.mjs`
- `plugins/usiatech-engineering/tests/mutation-runner.test.mjs`

## Commands and actions
- None beyond the normal gate (no dependencies, no version bump).

## Out of scope
- Version bump and release notes: these ship with the next version bump (expected with step 4.3, #13).
- Any other runner behaviour, the mutation-test SKILL.md, step 4.3 (#13) and the PR #28 workflow nits (separate plans).

## Approved
- By: Francis · Date: 2026-10-02
- Route: small (cites #38; touches 2 files; adds only an optional test-seam parameter to the existing `runCommand`, no new skill, module or interface)

## Change log
- 2026-10-02: drafted. Pre-flight FLAG fixed: the `.git` check covers any segment, not only the first; the AC1 test has a timeout and cleans up the leaked child.
- 2026-10-02: stage-2 conventions BLOCK (a partial taskkill failure on Windows turned real timeouts/aborts into ERROR). Francis chose a 2 s grace period: on a failed kill, `runCommand` waits for `close` before resolving `error`. AC1 now also requires test `it('should keep the timeout outcome when the kill reports a failure but the command still ends')`; test cleanup kills through a helper that logs instead of throwing. Same two files.

## Final status
- **Shipped:** commit `da13d56`, PR #39 merged into `develop` (`31fc7c8`) on 2026-10-02 and promoted to `main` in PR #40 (`323ac53`). Issue #38 closed.
- AC1: met (evidence shown, 2026-10-02T22:11Z).
- AC2: met (evidence shown, 2026-10-02T19:22Z).
- AC3: met (evidence shown, 2026-10-02T22:11Z).
- **Deviations:**
  - The 2 s kill grace period was added after the stage-2 conventions BLOCK (see the change log). It stays inside the plan's 2 files.
  - Reviewer nits not taken up are listed in PR #39 as possible follow-ups.
  - No version bump: the fix ships with the next bump (step 4.3, #13).
