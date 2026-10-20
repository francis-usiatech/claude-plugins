# Plan: Mutation runner fixes (ESP-108: R7, R9, R15)

**Final status: shipped** on branch `feature/esp108-runner-fixes` (closed 2026-10-20). AC1–AC7 are all shown: see the Evidence lines (last Gate: PASS at 2026-10-20T02:51:49Z). Reviews:
- Pre-flight PASS.
- Round 1 (stage 1 and 2 in parallel): governance, convention and security PASS. Silent-failure flagged a certain TIMEOUT that reads as caught (borderline). Fixed as T7, with AC6 and AC7.
- Round 2 (full): convention and silent-failure PASS. Security PASS with nits. Governance FLAG for 3 guard error entries from earlier sessions, accepted by Francis. The nits were fixed as T8.
- Round 3 (full): governance and convention PASS. Silent-failure and security PASS with nits, which are listed in the PR.

Mutation tests: 10 of 10 CAUGHT on the final code, after one added unit test (the timeoutDetail margin).

Deviations: `timeoutDetail` is exported for its unit test (AGENTS.md allows an export a test imports). Scope grew twice, with T7 and T8, each with a dated Change log line.


## Goal
Stop the mutation runner from overwriting an edit made to a mutated file during a run (R7). Run each shared baseline with the largest timeout among its entries (R9). Accept repo folders whose names start with `..` (R15).

## Requirement references
- ESP-108 (parent ESP-105)
- `docs/audits/2026-10-19-ponytail-audit.md` R7, R9, R15. The audit R-numbers are the requirement reference (standing rule, no spec).

## Pre-plan checklist
- (a) New validation rules and format checks:
  - R15 narrows an existing check in `checkFile` (`mutation-runner.mjs:51`). Its only caller is `validateList`, which `runMutations` and `readList` call.
  - Fixtures searched: the "parent path" case (`tests/mutation-runner.test.mjs:143`), and the symlink and junction cases (`:233` and `:245`). These still hit the `segments.includes('..')` check or the `rel === '..' || startsWith('..' + sep)` check, so they keep failing with exit 2.
- (b) Database or infrastructure mechanisms: n/a: the runner uses only Node `fs` and `child_process`, with no database or infrastructure.
- (c) Docs and ADRs touched:
  - The search found `plugins/usiatech-engineering/README.md:30` (runner exit codes and restore behaviour) and `skills/mutation-test/SKILL.md:52-56` (baseline and exit-3 recovery steps). Both need a line for R7, and the README needs one for R9.
  - The specs `docs/specs/2026-09-30-fake-pass-and-mutation-test.md` and `2026-10-02-workflow-checks-hardening.md` are historical and stay unchanged.
  - No ADR covers the runner.

## Acceptance criteria
- AC1 (R7): If a mutation's command rewrites the mutated file:
  - the runner exits 3;
  - stderr names the file and a backup path;
  - the backup holds the bytes the command wrote;
  - the file is not overwritten with the original bytes (it still holds the command's bytes);
  - mutations after it don't run.
  - Test: `tests/mutation-runner.test.mjs`, "should not overwrite a file changed during the run…".
  - Evidence: test "should not overwrite a file changed during the run…(R7)" passes (red before: exit 0); backups sit in a private mkdtemp folder (0600 checked on POSIX) (shown, 2026-10-20T02:52Z)
- AC2 (R7, no regression): The existing restore, abort, CRLF and non-UTF-8 tests still pass, with every file byte-identical afterwards.
  - Evidence: all 26 tests in tests/mutation-runner.test.mjs pass, incl. the CRLF, abort, restore-fails and non-UTF-8 tests (shown, 2026-10-20T02:52Z)
- AC3 (R9): Two entries share one command whose unmutated run takes about 1.5 s. Entry 1 has `timeoutMs` 60000 and entry 2 has 500. The baseline passes and both mutations run. For a timed-out baseline, the "baseline failed" message has no "exit" text.
  - Evidence: test "should run a shared baseline with the largest timeoutMs … (R9)" passes (red before: "baseline failed (timeout, exit 1)") (shown, 2026-10-20T02:52Z)
- AC4 (R15): `..cache/b.txt` inside the repo is accepted (not exit 2, "links outside"). `../x` and a link outside the repo are still refused with exit 2.
  - Evidence: test "should accept a repo folder whose name starts with ".." (R15)" passes (red before: exit 2); the parent-path, symlink and junction refusal tests still pass (shown, 2026-10-20T02:52Z)
- AC5: The `npm test` gate passes, and the mutation test on the three fixes reports each one CAUGHT.
  - Evidence: gate run 2026-10-20T02:51:49Z Gate: PASS; mutation run 10 of 10 CAUGHT (R7 compare, original ok, deleted file, deleted notice, backup private dir, R9 largest timeout, no exit, timeout note, note margin, R15) (shown, 2026-10-20T02:52Z)
- AC6 (review fix): when an entry's timeoutMs is not longer than its command's unmutated run, its TIMEOUT line says "the unmutated run took N ms", so a certain timeout isn't read as a catch.
  - Evidence: R9 test asserts "TIMEOUT may loop … the unmutated run took N ms" and none on "slow suite"; test "should mark a timeout within 1.5 times…" pins the margin (shown, 2026-10-20T02:52Z)
- AC7 (review fix): when the file is back to its original bytes at restore time, the run continues with exit 0 and no RestoreError.
  - Evidence: test "should go on without a restore error when the file is back to its original bytes (R7)" passes (red before: exit 3) (shown, 2026-10-20T02:52Z)

## Tasks
- [x] T1: Red test for R7. A mutation whose command overwrites `guard-lf.mjs` (fixture helper `rewrite.mjs`) should end in exit 3, a backup holding the rewritten bytes, and the file left as the command wrote it (AC1; ESP-108)
- [x] T2: R7 fix in `runOne`'s `finally`:
  - Keep the mutated buffer.
  - Before restoring, read the file. If it no longer equals the mutated buffer, don't write. Save the current bytes, and the original bytes, to temp files, then throw `RestoreError`. The error names the file and both temp files and says the mutation may still be in it.
  - If the file was deleted (ENOENT), write the original bytes back, since there's no edit to lose. Any other read error goes to the existing `restoreFailed` path.
  - Qualify the header comment's "restored byte for byte" promise (lines 5-6).
  - Add a `shortcut:` comment on the compare-then-write window (AC1, AC2; ESP-108)
- [x] T3: Red test, then fix, for R9. The baseline uses the largest `timeoutMs` per command, and a timeout message has no exit code (AC3; ESP-108)
- [x] T4: Red test, then fix, for R15: `rel === '..' || rel.startsWith('..' + path.sep)` (AC4; ESP-108)
- [x] T5: Docs. README line 30 (exit 3 also when the file changed during the run; the baseline uses the largest timeout). SKILL.md step 3 (restore unless the file changed during the run) and the exit-3 paragraph: don't `git checkout` before copying your edit back from the backup (AC1, AC3; ESP-108)
- [x] T6: Gate and mutation test of the three fixes (AC5; ESP-108)
- [x] T7: Red tests, then fixes, for the stage-2 findings: baseline duration note on TIMEOUT (AC6), skip the R7 stop when the file holds the original bytes (AC7), and update the header exit-3 line (AC6, AC7; ESP-108)
- [x] T8: Round-2 nits: backups in a private mkdtemp folder (wx, 0600); "reading it before the restore failed" wording; stderr note when a deleted file is written back; certain-timeout note from baselineMs * 1.5 >= timeoutMs, worded "may not be a catch" (AC1, AC6; ESP-108)

## Files
- `plugins/usiatech-engineering/skills/mutation-test/mutation-runner.mjs`
- `plugins/usiatech-engineering/tests/mutation-runner.test.mjs`
- `plugins/usiatech-engineering/skills/mutation-test/SKILL.md`
- `plugins/usiatech-engineering/README.md`

## Commands and actions
- None beyond the usual: branch `feature/esp108-runner-fixes` off develop, then the release flow.

## Out of scope
- ESP-109, ESP-110, ESP-111.
- The version bump: that's the release PR's job.
- Locking or atomic compare-and-swap for R7. The small compare-then-write window is noted with a `shortcut:` comment.

## Approved
- By: Francis · Date: 2026-10-19
- Route: small (cites ESP-108 and audit R7/R9/R15; 4 files; no new skill, module or public interface: `RestoreError` stays private)

## Change log
- 2026-10-19: drafted. Pre-flight PASS (governance-reviewer). Its low-confidence notes were folded in: ENOENT writes the original back, the header and SKILL.md step 3 are qualified. Francis chose "leave untouched" for R7 and approved.
- 2026-10-20: stage-2 review findings (silent-failure: certain TIMEOUT reads as caught; convention and silent-failure: current===original false exit 3; convention: header exit-3 line) added as AC6, AC7 and T7. Francis chose to fix them now with a full re-review round.
- 2026-10-20: round-2 governance FLAG (3 guard fail-open error entries on 2026-10-19 17:35Z-20:04Z from the ESP-79/106/107 sessions, outside this work) accepted by Francis. Round-2 nits (security: guessable temp backup name; silent-failure: read-failure wording, silent ENOENT write-back, near-limit timeout margin) added as T8; Francis chose to fix them now with another full review round.
