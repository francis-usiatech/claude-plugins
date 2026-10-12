# Plan: ESP-44 gate runner

## Goal
One command runs a repo's whole verification gate and prints one line per step with its real exit code, then an overall verdict. The `verify` skill uses it, so no session pipes, greps or re-assembles gate commands by hand.

## Requirement references
- Jira ESP-44 (epic ESP-8, label `efficiency`, High): "Gate script: run full gate, print one summary line with real exit codes"

## Acceptance criteria
- AC1: With a config whose `verify` steps all exit 0 and no changed test file, the runner prints one line per step in config order, each with the step name and `exit 0`, then one line for the fake-pass check, a line with a UTC timestamp, and `Gate: PASS`. It exits 0.
  - Evidence: tests/gate.test.mjs "should print one line per step in order, then the fake-pass line, a UTC timestamp and PASS (AC1)"; runner gate: npm test 1107 passed, 1 skipped, 0 failed of 1108, plus timing 1/1 (shown, 2026-10-12T04:56:29Z)
- AC2: When a step exits 3, its line says `FAIL` and `exit 3`, every later step's line says `NOT RUN`, the fake-pass check is not run, the last 40 lines of the failing step's output are printed, the verdict is `Gate: FAIL` and the runner exits 1. A step whose command is unknown is a `FAIL` with its non-zero exit code.
  - Evidence: tests/gate.test.mjs "should stop at the first failure, show its exit code and output, and skip the rest (AC2)" and "should fail a step whose command is unknown, with its non-zero exit code (AC2)"; red first (module missing, 21 failing; stage 2 fixes 11 failing), then one more red on the 40-line tail; runner gate: npm test 1107 passed, 1 skipped, 0 failed of 1108, plus timing 1/1 (shown, 2026-10-12T04:56:29Z)
- AC3: A `verifyConditional` step runs only when a changed file starts with one of its `when` prefixes. Changed files are `git diff --name-only HEAD` plus untracked files. One test each for a tracked change that matches, an untracked file that matches, and no match (the step is not listed as run).
  - Evidence: tests/gate.test.mjs "conditional steps" suite: a tracked change that matches, an untracked file that matches, no match (shown as SKIPPED), a file moved out of the prefix, a config "skipped" key that is ignored and a prefix that differs in case; runner gate: npm test 1107 passed, 1 skipped, 0 failed of 1108, plus timing 1/1 (shown, 2026-10-12T04:56:29Z)
- AC4: With no `.claude/engineering.json`, an unparseable one, a `verify` that is not a list, an empty `verify`, a step without a string `name` and `run`, or a folder where git can't list changed files, the runner runs nothing, prints the reason and `Gate: FAIL`, and exits 2.
  - Evidence: tests/gate.test.mjs "a gate that cannot start" suite: 20 config cases, a repository with no commit, a log that cannot be created and a folder that is not a git repository, each exit 2; runner gate: npm test 1107 passed, 1 skipped, 0 failed of 1108, plus timing 1/1 (shown, 2026-10-12T04:56:29Z)
- AC5: After every step passes, the runner runs `templates/github/scripts/fake-pass-check.mjs` from its own plugin copy. With a changed test file containing `it.only(`, the fake-pass line says `FAIL` and `exit 1`, the finding is printed, the verdict is `Gate: FAIL` and the runner exits 1. When the check can't run and exits 2 (an invalid `governance.allowlist`), its line says `FAIL` and `exit 2`, its message is printed, the verdict is `Gate: FAIL` and the runner exits 1.
  - Evidence: tests/gate.test.mjs "fake-pass check" suite: a focused test fails the gate, warnings still pass, 45 findings are all printed, and a check that exits 2 gives a FAIL line and runner exit 1; runner gate: npm test 1107 passed, 1 skipped, 0 failed of 1108, plus timing 1/1 (shown, 2026-10-12T04:56:29Z)
- AC6: Each step's full output goes to a log file under the OS temp folder, never inside the repo, and the runner prints the log's path. With a passing step that prints 500 lines, the runner's own output is at most 12 lines, the log holds all 500, and the log's path is outside the repo root.
  - Evidence: tests/gate.test.mjs "log file" suite: 500 lines stay out of the runner's output and are in a log outside the repo, alone in a folder made for the run; stderr is in the log too; runner gate: npm test 1107 passed, 1 skipped, 0 failed of 1108, plus timing 1/1 (shown, 2026-10-12T04:56:29Z)
- AC7: `skills/verify/SKILL.md` keeps step 1. When `.claude/engineering.json` has a `verify` list, it tells Claude to run the gate with one call to the runner and not to pipe or filter its output. When there is no `engineering.json` or no `verify` key, it keeps the AGENTS.md or ask-the-user path and runs the commands one at a time, then the fake-pass check with its literal command. A new `plugin-structure.test.mjs` test checks that text; the existing verify assertions in that file stay unchanged.
  - Evidence: tests/plugin-structure.test.mjs "gate runner (ESP-44 AC7)" suite, 4 tests, red first (4 failing) and green after the skill edit; the 89 earlier tests in the file are unchanged and pass (93 of 93); runner gate: npm test 1107 passed, 1 skipped, 0 failed of 1108, plus timing 1/1 (shown, 2026-10-12T04:56:29Z)
- AC8: This repo's `.claude/engineering.json` has a `verify` list with `npm test`, `claude plugin validate .` and `claude plugin validate plugins/usiatech-engineering`, and keeps `governance.planEdits: "all"`. Running `node plugins/usiatech-engineering/skills/verify/gate.mjs` from the repo root prints four step lines and `Gate: PASS`, and exits 0. This is session evidence, not a repeatable test: it needs `claude` on PATH.
  - Evidence: .claude/engineering.json lists the three commands and keeps planEdits "all"; "node plugins/usiatech-engineering/skills/verify/gate.mjs" printed four PASS lines (tests exit 0, validate marketplace exit 0, validate plugin exit 0, fake-pass check exit 0) and Gate: PASS, exit 0 (shown, 2026-10-12T04:56:29Z)
- AC9: `plugins/usiatech-engineering/README.md` describes the runner: the command, the output lines, the exit codes 0, 1 and 2, and where the log goes.
  - Evidence: README paragraph "`verify` runs the gate through `skills/verify/gate.mjs`" with the command, the output lines, exit codes 0, 1 and 2, the log location and the limits (shown, 2026-10-12T04:56:29Z)

## Tasks
- [x] T1: TDD the runner `skills/verify/gate.mjs`: config loading and validation, step selection, running steps with captured output, the summary lines and exit codes (covers AC1, AC2, AC3, AC4, AC6; ESP-44).
- [x] T2: TDD the fake-pass step in the runner (covers AC5; ESP-44).
- [x] T3: TDD the skill text: a red structure test first, added beside the existing ones, then update `skills/verify/SKILL.md` (covers AC7; ESP-44).
- [x] T4: Add `verify` to this repo's `.claude/engineering.json` and add the README section (covers AC8, AC9; ESP-44).
- [x] T5: Run the gate with the new runner and fill in the evidence (covers AC8 and all others).

## Files
- `plugins/usiatech-engineering/skills/verify/gate.mjs`
- `plugins/usiatech-engineering/tests/gate.test.mjs`
- `plugins/usiatech-engineering/tests/plugin-structure.test.mjs`
- `plugins/usiatech-engineering/skills/verify/SKILL.md`
- `plugins/usiatech-engineering/README.md`
- `.claude/engineering.json`

## Commands and actions
- None beyond the normal gate (`npm test`, fake-pass check, both `claude plugin validate`). No dependency adds.

## Out of scope
- `templates/github/scripts/run-verify.mjs` and the CI workflows: the CI gate is unchanged, and the runner does not replace it.
- `expectNoDiff` support in the runner. CI honours it; the local skill never did.
- ESP-10 (a scoped and a full command set) and writing gate evidence into the plan automatically.
- Parsing test counts out of a step's output. The summary gives exit codes; counts stay in the log.
- A per-step timeout, and naming the signal of a killed step.
- ESP-51 and ESP-41 (the two timing tests).
- The version bump and README Versioning row. They go in the release PR (release-version-bump rule).

## Approved
- By: Francis · Date: 2026-10-11
- Route: small, by override. The rule says large, because the runner is a new module and the change touches 6 files. Francis chose "treat as small" (2026-10-11); ESP-44 is the requirement reference.

## Change log
- 2026-10-11: Plan drafted. Francis chose the plugin as the runner's home (`skills/verify/gate.mjs`, not the ticket's repo-only `scripts/gate.mjs`) and "treat as small".
- 2026-10-11: Pre-flight FLAG resolved; Francis took the recommended default for each item ("Approve with defaults"):
  - (1) The skill keeps its AGENTS.md and ask-the-user fallback for repos with no `verify` config (AC7). The runner still exits 2 there (AC4).
  - (2) Existing verify assertions in `plugin-structure.test.mjs` stay unchanged; the new test only adds (AC7, T3).
  - (3) The log goes under the OS temp folder, never inside the repo (AC6).
  - (4) A fake-pass check that exits 2 is a `FAIL` line with `exit 2`, and the runner exits 1 (AC5).
  - Smaller notes applied: `expectNoDiff` is out of scope; a folder git can't read is an exit 2 (AC4); AC2's "killed" clause became "an unknown command is a `FAIL` with its non-zero code".
- 2026-10-11: T1–T5 done. The evidence lines and task ticks were written by a scratchpad script (`fill-evidence.mjs`) run through Bash, so the guard did not log that write to `active.md`. The gate was run with the new runner from the repo source, because the installed plugin (0.13.0) does not have it yet. The fake-pass check printed one warning, `fp-placeholder` at `tests/gate.test.mjs:134`: the word is inside a test fixture string, the same fixture `fake-pass-check.test.mjs` uses.
- 2026-10-11 (release review, stage 1 FLAG; Francis: "Apply all"):
  - (1) Fix now: the runner printed only the last 40 lines of the fake-pass check, so with more than 40 findings the first ones were cut although README and SKILL say every finding is printed. It now prints them all; the 40-line cut applies to a failing step only. Red first (1 failing test, 45 findings), then green.
  - (2) Kept: a killed step prints `killed by <signal>` although naming the signal is listed under Out of scope. Without it the line would read `exit null`. The branch has no test.
  - (3) Acknowledged: the six guard `error` entries of 2026-10-12T01:46Z to 02:46Z belong to the ESP-35 work, before this plan was written. Francis acknowledged them in the 0.13.0 release (ESP-35 archive).
  - Smaller fixes: the runner now lists the changed files before any step, also with no conditional step, so a repository with no commit exits 2 as AC4 says (red first, 1 failing test); SKILL step 1 reads "missing or has no `verify` list"; `gate.test.mjs` removes the logs its runs create.
- 2026-10-11 (release review, stage 2; Francis: "Apply all defaults"):
  - Blocker (silent-failure reviewer, fixed without a decision): reached through a junction or symlink, the runner printed nothing and exited 0, because its main-module check compared a real path with the path as typed. `gate.mjs` is now an entry point with no such check, and anything unexpected ends in `Gate: FAIL` with exit 2. A test runs it through a junction.
  - Blocker (silent-failure reviewer, fixed without a decision): a conditional step could be dropped without a trace. An empty `when`, or a prefix with a backslash or a leading `./` or `/`, is now an exit 2, and an unselected step prints `SKIPPED  <name> (no changed file under …)`. AC3 said such a step "is not listed as run"; it is now listed as skipped. Prefixes match exactly, case included, as in the CI gate.
  - (A) Security, Medium: the log is `gate.log` in a new private folder `<temp>/usiatech-gate-<random>`, opened exclusively with owner-only permissions. AC6 still holds (under the OS temp folder, outside the repo).
  - (B) A log that cannot be created or written is exit 2 with `Gate: FAIL`, not a stack trace. No test covers a failing log write.
  - (C) A step `name` with control characters, or named `fake-pass check`, is an exit 2.
  - (D) README section headed "Gate runner". (F) SKILL step 2 says the runner selects the conditional suites. (G) Only the runner's own marker lines are kept out of the printed output.
  - (E) Kept: `gitList` and `changedFiles` repeat what `templates/github/scripts/fake-pass-check.mjs` does, with a comment saying why. Sharing them would change a CI template outside this plan's Files.
  - Each fix was red first: 11 new tests failed against the earlier runner and pass now.
  - Known limits, listed in the PR: no per-step timeout; unknown top-level config keys are ignored; the whole output of a failing step is read into memory; old logs are not removed; a step that leaves a background process writing can garble the next tail; the killed-by-signal and could-not-start branches have no test.
- 2026-10-11 (narrow re-review of the stage 2 fixes, silent-failure reviewer: both earlier blockers confirmed fixed, two new blockers in the rewrite, fixed without a decision):
  - A `skipped` key written in the config turned a step off, because the runner kept its own `skipped` flag on the config object. The runner now keeps only `name`, `run` and `when` from each step.
  - A file moved out of a `when` folder did not select the step, because git listed only the new path of a rename. The diff now uses `--no-renames`, so both paths count.
  - Also: a test for a log that cannot be created (exit 2); the "ran nothing" assertions also exclude `SKIPPED`; U+0085, U+2028 and U+2029 count as control characters in a step name.
  - Red first: 2 new tests failed, and pass now. No further review ran on these last two fixes; the gate did.
  - Known limit, listed in the PR: the runner cannot tell a fake-pass check that found nothing from one that did nothing (its script still has a main-module check); it holds because the runner calls it by its real path.
- 2026-10-11: final gate 2026-10-12T04:45:15Z with the runner: tests, validate marketplace, validate plugin and fake-pass check all exit 0, `Gate: PASS`. The evidence stamps and counts in this file were updated with `sed` through Bash, which the guard does not log.
- 2026-10-11 (final silent-failure pass on commit e5a4337; it stopped early on a session-cost warning, so it was a static read only: provisional pass with nits):
  - Its note on line breaks was checked by hand and is real on Windows: a `run` with a line break ran only its first line, so a second command that would fail never ran and the gate passed. Francis: "finish here". Fixed in a second commit: a `run` with a line break or another control character is an exit 2; a `when` prefix with a control character, a space at either end or a `..` segment is an exit 2. Red first (4 failing), then green.
  - Gate with the runner, 2026-10-12T04:56:29Z: tests, validate marketplace, validate plugin and fake-pass check all exit 0, `Gate: PASS`. No review ran on this last fix. The evidence stamps were updated with `sed` through Bash.
  - PR #91 has two commits (the feature and this fix) because the branch was already pushed and is not force-pushed.
- 2026-10-11: closed and archived inside the 0.14.0 release PR, as ESP-35 was in 0.13.0 (ESP-39's intent); the release has no separate release plan (Francis: "continue with next step"). The file was moved here with `mv` through Bash, which the guard does not log as a plan write. Claude read the diff of the last fix (`f521842`) in the release session and found no way for it to pass a gate that should fail: both new checks end in exit 2. A tab in a `run` is refused too. No reviewer agent ran on that commit.
- 2026-10-11 (0.14.0 release review; no item needed a decision):
  - Stage 1 governance: PASS with three nits. Two wording nits fixed: the Versioning row says a `when` that is "missing or empty", and the Deviations line no longer says the README lists every known limit. The third stays: the version-bump rule this plan cites is not written in a repo document (ESP-23).
  - Stage 2 convention: PASS with five nits, all fixed: this review is recorded here and under Reviews, the first Final status bullet has the merge time and the release branch, and two sentences of the Versioning row are clearer.

## Final status
- **Shipped** to develop: feature commit `e5a4337` and fix commit `f521842`, PR #91 merged as `75cb9ed` (2026-10-12T05:24:04Z). To be released as 0.14.0 (minor, feat) under the version-bump rule, from branch `chore/release-0.14.0`. Jira ESP-44 is at Ready for Release.
- AC1: shown (one line per step in order, the fake-pass line, a UTC timestamp and `Gate: PASS`).
- AC2: shown (stops at the first failure with its exit code and the last 40 lines; an unknown command is a `FAIL`).
- AC3: shown, with one change: a conditional step that isn't selected is listed as `SKIPPED`, not left out (Change log, stage 2).
- AC4: shown ("a gate that cannot start" suite, each case exit 2).
- AC5: shown (a focused test fails the gate; a fake-pass check that exits 2 is a `FAIL` line and runner exit 1).
- AC6: shown, with one change: the log is `gate.log` in a new private folder under the OS temp folder (Change log, stage 2).
- AC7: shown (`plugin-structure.test.mjs` "gate runner (ESP-44 AC7)" suite, 4 tests).
- AC8: shown as session evidence (four `PASS` lines and `Gate: PASS`, 2026-10-12T04:56:29Z).
- AC9: shown (README "Gate runner" section).
- Final gate before the merge (2026-10-12T04:56:29Z), run with the new runner: npm test 1107 passed, 1 skipped, 0 failed of 1108, plus timing 1/1; both validates exit 0; fake-pass check exit 0.
- Release gate on `chore/release-0.14.0` (2026-10-12T05:43:47Z, after the review fixes), run with the runner: npm test 1107 passed, 1 skipped, 0 failed of 1108, plus timing 1/1; both validates exit 0; fake-pass check exit 0.
- No mutation run on the runner is recorded.
- CI does not run (GitHub billing block, ESP-40). PR #91 was merged on the local gate.
- Reviews:
  - Stage 1 governance: FLAG, three items, Francis: "Apply all" (Change log).
  - Stage 2: two silent-failure blockers fixed; the other items took the defaults (Change log).
  - Narrow re-review of the stage 2 fixes: two more silent-failure blockers fixed.
  - Final silent-failure pass on `e5a4337`: a static read only, cut short by a session-cost warning; its line-break finding became `f521842`.
  - `f521842`: read by Claude in the release session; no reviewer agent.
  - 0.14.0 release review: stage 1 governance PASS and stage 2 convention PASS, nits only (Change log).
- Deviations: the runner lives in the plugin, not in a repo-only `scripts/gate.mjs` as the ticket says (Francis's choice). A killed step names its signal although that is listed under Out of scope. The evidence lines in this plan were written by a script and by `sed` through Bash, and the file was archived with `mv`, so the guard has no log entry for those writes. Known limits are listed in the PR #91 body; the main ones are in the README "Gate runner" section.