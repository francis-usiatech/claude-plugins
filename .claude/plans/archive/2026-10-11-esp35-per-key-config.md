# Plan: ESP-35 per-key config validation

## Goal
Config problems that are harmless or make the guard stricter warn once per change of the advisory set, without prompting. Problems whose dropped value could weaken the guard still ask on every action.

## Requirement references
- Spec `docs/specs/2026-10-10-per-key-config-validation.md` (Status: approved), R1–R8
- Jira ESP-35, with sub-tasks ESP-47, ESP-48, ESP-50 and ESP-49 (one PR for all four, Francis 2026-10-10)

## Acceptance criteria
- AC1 (spec AC1): A test calls `evaluate` with `decisions: { batch: "yes" }` and an empty marker. It gets the same decision as with a valid config, plus one advisory warning naming `decisions.batch`. A second call with the marker already written gets no warning and no ask. A guard-hook test shows the allowed action's output has a `systemMessage` but no `permissionDecision`.
  - Evidence: tests/governance-policy.test.mjs "advisory warning, once per change" suite: "should warn once for … and leave the decision alone"; tests/governance-guard.test.mjs "should show an advisory config problem once, as a message with no permission decision"; npm test 1062 passed, 1 skipped, 0 failed of 1063 (shown, 2026-10-12T02:49:53Z)
- AC2 (spec AC2): The same as AC1, one test per advisory case: `trustedWritePaths: "x"`, a bad `trustedWritePaths` entry, a bad `allowlist` entry.
  - Evidence: tests/governance-policy.test.mjs same suite, one case each for a non-array trustedWritePaths, a bad trustedWritePaths entry and a bad allowlist entry; npm test 1062 passed, 1 skipped, 0 failed of 1063 (shown, 2026-10-12T02:49:53Z)
- AC3 (spec AC3): With `planEdits: "bogus"`, an evidence-only edit to `.claude/plans/active.md` asks, the same as `planEdits: "ask"`, and other actions get no Config-problem escalation.
  - Evidence: tests/governance-policy.test.mjs "should ask for every plan edit with planEdits \"ask\", and treat an unknown value the same (ESP-35 R2, AC3)" and "should treat an unknown planEdits as \"ask\" (R2)"; npm test 1062 passed, 1 skipped, 0 failed of 1063 (shown, 2026-10-12T02:49:53Z)
    - Green: `governance-policy.test.mjs` "should ask for every plan edit with planEdits "ask", and treat an unknown value the same" and "should report an unknown planEdits as advisory and not escalate the action" pass; `npm test` 1029/1029, timing 1/1
    - (shown, 2026-10-11T20:10Z)
- AC4 (spec AC4): One test per escalating case: unparseable JSON, `governance: 1`, bad `askPaths`, bad `protectedBranches`, a bad `denyCommands` entry, a bad `askCommands` entry, bad `git.releaseBranch`, bad `protectedPaths`, bad `immutableWhenCommitted`. Each turns an otherwise-allowed action into an ask with the "Config problem" reason on every call, whatever the marker holds.
  - Evidence: tests/governance-policy.test.mjs "should escalate … to an ask on every call" (12 cases) and "should ask on every call for an escalating problem and leave the marker alone (AC4)"; npm test 1062 passed, 1 skipped, 0 failed of 1063 (shown, 2026-10-12T02:49:53Z)
    - Green (policy half; the marker half comes with T2): the 12 "should escalate … to an ask on every call" tests pass, each calling `evaluate` twice; `npm test` 1029/1029
    - (shown, 2026-10-11T20:10Z)
- AC5 (spec AC5): One escalating plus one advisory problem gives an ask whose reason names both.
  - Evidence: tests/governance-policy.test.mjs "should name every problem, advisory ones included, when it escalates"; npm test 1062 passed, 1 skipped, 0 failed of 1063 (shown, 2026-10-12T02:49:53Z)
    - Green: "should name every problem, advisory ones included, when it escalates" passes; `npm test` 1029/1029
    - (shown, 2026-10-11T20:10Z)
- AC6 (spec AC6): A changed advisory set warns again. The same set doesn't. Clearing every problem and then reintroducing the first one warns again, also when they were cleared while an escalating problem was present.
  - Evidence: tests/governance-policy.test.mjs "should warn again when the advisory set changes, and after it was cleared (AC6)", "should warn again for a problem that was fixed while an escalating one was present (R5)" and "should keep what was shown when the config cannot be read at all"; tests/bash-workflow-check.test.mjs "should warn again for a problem that was fixed while an escalating one was present (ESP-35 R5, R6)"; npm test 1062 passed, 1 skipped, 0 failed of 1063 (shown, 2026-10-12T02:49:53Z)
- AC7 (spec AC7): With only advisory problems, the after-Bash check writes one `warn` log entry over two runs. With an escalating problem it writes one `error` entry per run.
  - Evidence: tests/bash-workflow-check.test.mjs "should log advisory config problems once, as a warning, over two runs" and "should log an escalating config problem as an error on every run, naming advisory ones too"; npm test 1062 passed, 1 skipped, 0 failed of 1063 (shown, 2026-10-12T02:49:53Z)
- AC8 (spec AC8): An unreadable marker means the warning is shown. A marker write failure writes one `error` log entry and leaves the decision unchanged.
  - Evidence: tests/governance-policy.test.mjs "should show the warning when the marker cannot be read (AC8)" and "should report a marker that cannot be written and leave the decision alone (AC8)"; npm test 1062 passed, 1 skipped, 0 failed of 1063 (shown, 2026-10-12T02:49:53Z)
- AC9 (spec AC9): `plugins/usiatech-engineering/README.md` names the advisory and escalating keys and says advisory problems warn once per change.
  - Evidence: README "Config problems" section lists the escalating and advisory keys and says advisory problems warn once per change (shown, 2026-10-12T02:49:53Z)
- AC10 (spec AC10): `npm test` reports 0 failures, the fake-pass check reports 0, and both `claude plugin validate .` and `claude plugin validate plugins/usiatech-engineering` exit 0.
  - Evidence: npm test 1062 passed, 1 skipped (the file-link marker test, which needs rights this machine lacks), 0 failed of 1063, plus timing 1/1, exit 0 (run under Git Bash); fake-pass exit 0; validate . exit 0; validate plugin exit 0 (shown, 2026-10-12T02:49:53Z)

## Tasks
- [x] T1: Classify each problem in `sanitizeConfig` as advisory or escalating. Treat an unknown `planEdits` as `"ask"`. `evaluate()` escalates only on escalating problems. Beyond the AC cases, the tests also cover every other R1 case: `decisions` not an object and a bad `decisions.nitsNeedDecision` (advisory); `git` not an object, and a `denyCommands` or `askCommands` that isn't a list (escalating) (covers AC3, AC4, AC5; ESP-47, spec T1). TDD.
- [x] T2: Add the warn-once marker, a hash of the advisory set, at `$TMP/usiatech-governance/<project>/config-warned`. That is the same folder as `snapshotDir`: ESP-21 already rejects it as a `trustedWritePaths` entry, and the guard asks on Bash commands that name it. The marker read/write helpers live in `governance-policy.mjs` so both hooks can import them. A test checks the marker path is under that folder. On a new set, write one `warn` log entry. The guard hook currently prints nothing for an allowed action; it gains a new output: `systemMessage` plus `additionalContext` with no `permissionDecision`. Handle read and write failures (covers AC1, AC2, AC6, AC8; ESP-48, spec T2). TDD.
- [x] T3: The after-Bash check uses the same classification and marker: advisory problems are logged once as `warn`, escalating ones as `error` on every run (covers AC7; ESP-50, spec T3). TDD.
- [x] T4: Add the advisory/escalating split and the warn-once behaviour to the README configuration section (covers AC9; ESP-49, spec T4).
- [x] T5: `agents/governance-reviewer.md` also counts and reports `warn` log entries (supports AC7; ESP-50).
- [x] T6: Run the gate (covers AC10).

## Files
- `docs/specs/2026-10-10-per-key-config-validation.md`
- `plugins/usiatech-engineering/hooks/scripts/governance-policy.mjs`
- `plugins/usiatech-engineering/hooks/scripts/governance-guard.mjs`
- `plugins/usiatech-engineering/hooks/scripts/bash-workflow-check.mjs`
- `plugins/usiatech-engineering/hooks/scripts/governance-state.mjs`
- `plugins/usiatech-engineering/tests/governance-policy.test.mjs`
- `plugins/usiatech-engineering/tests/governance-guard.test.mjs`
- `plugins/usiatech-engineering/tests/bash-workflow-check.test.mjs`
- `plugins/usiatech-engineering/README.md`
- `plugins/usiatech-engineering/agents/governance-reviewer.md`

## Commands and actions
- None beyond the normal gate (`npm test`, fake-pass check, `claude plugin validate`). No dependency adds.

## Out of scope
- Reporting unknown keys, and config schema versioning.
- Changing what any valid key means, the default deny rules, or the CI checks in `templates/github/scripts/`.
- The version bump and README Versioning row. They go in the release PR (release-version-bump rule).
- ESP-44, ESP-41 and other efficiency tickets.

## Approved
- By: Francis · Date: 2026-10-11
- Route: large (it changes guard behaviour across more than 5 files. There was no approved spec when routing; clarify → to-spec → to-tickets produced the approved spec and ESP-47..50)

## Change log
- 2026-10-10: Plan drafted from the approved spec. Tickets ESP-47/48/49/50 are covered by one PR (Francis).
- 2026-10-11: Pre-flight FLAG resolved; Francis took the recommended default for each item:
  - (1, 2) The Approved section stays pending until approval, and the route wording is fixed.
  - (3) T1 also tests the remaining R1 cases.
  - (4) The marker path is named; it lives in the ESP-21-protected snapshot folder.
  - (5) The guard's new no-decision output is stated in T2 and checked in AC1.
  - (6) governance-reviewer counts `warn` entries (T5, plus agents/governance-reviewer.md).
  - (7) The spec's "README Versioning row records it" is done in the release PR, under the version-bump rule, not in this PR.
- 2026-10-11: T2–T6 done. T2 and T3 were written by a second session on the same branch; this session checked them, wrote T4 and T5, and ran the gate. Three trustedWritePaths test loops had their assertion moved from the `dropped` helper into the test body, after the fake-pass check flagged them (fp-no-assert).
- 2026-10-11 (release review, stage 1 FLAG; Francis decided each item):
  - (1) A non-array `governance.allowlist` stays advisory, like a bad entry. Spec R1 and Constraints now say so.
  - (2) Fix now: with an escalating problem present and no advisory problem left, the marker is cleared, so a problem fixed during that time and reintroduced later warns again (R5). An unparseable file leaves the marker alone. Changed `governance-policy.mjs` (`evaluate`), `bash-workflow-check.mjs` (`checkChanged`), three new tests, one added assertion in the AC4 marker test, spec R5, AC6 and Constraints. Red seen first (2 failing), then the gate: `npm test` 1048/1048 plus timing 1/1, fake-pass 0, both validates 0 (2026-10-12T01:01:24Z).
  - (3) Acknowledged: `active.md` got its evidence lines and ticks at 23:24Z by a route the guard didn't log, and `.claude/settings.local.json` (personal plugin trimming, gitignored, not in this commit) was written at 23:01Z outside the plan.
- 2026-10-11 (release review, stage 2; Francis decided each item):
  - Blocker (silent-failure reviewer, fixed without a decision): the marker was written before the `warn` entry was logged, so a failed log append lost the warning for good. The marker is now recorded only after the entry is logged, in both hooks; a config entry the after-Bash check can't log is shown instead.
  - (1) Hardening, with a shared module: a config value quoted in a problem is JSON-quoted and capped at 60 characters; the marker is read only from a trusted folder and only when it is a small regular file; the folder name, project-folder formula and trust rule move to a new `hooks/scripts/governance-state.mjs` used by both hooks (added to Files).
  - (2) A non-array `governance.trustedWritePaths` stays advisory but now counts as an empty list (no path trusted), not the defaults.
  - (3) All wording errors and code nits the reviewers listed are fixed in this PR, with tests for the marker-clear failure path.
  - (4) Mutation testing runs after the fixes; survivors go in the PR.
- 2026-10-11 (status at session save): all stage 2 fixes are in and the gate is green (npm test 1059/1059 plus timing 1/1, fake-pass 0, both validates 0, 2026-10-12T01:45:06Z). Not done yet: the mutation run (the runner's baseline failed on governance-policy.test.mjs under its own shell; the same command passes 304/304 from Git Bash), the narrow re-review of the fix diff, the commit and the PR.
- 2026-10-11 (mutation run and narrow re-review; Francis took every recommendation):
  - Mutation run: 22 of 25 caught, 3 survived. The baseline failure of the earlier session did not come back and its cause is not known.
  - (1) Tests added for the gaps: a marker whose folder is a link is not used; a marker that is a link to a file is not used (skipped where file links aren't permitted, as on this machine); the guard shows a marker failure it couldn't log; the after-Bash check logs a marker write failure. The "marker too big" test was removed because it could not fail: an oversized marker never equals a hash.
  - (2) The marker is removed only from a folder that can be trusted, like the read and the write (`pendingAdvice`). Spec R7 and README say so.
  - (3) The shown problem list is capped at 1000 characters and then says how many more there are; the `warn` log entry names every problem (`pendingAdvice` returns `logReason`, `evaluate` returns `configLogReason`). Spec R4 and README say so.
  - (4) Francis approved narrowing the governance-reviewer exemption: an `error` entry targeting `.claude/engineering.json` is not a fail-open only when its reason is one of the three config or marker reasons.
  - (5) The 60-character cut is documented for `trustedWritePaths` entries only, which is what the code does. Other quoted values (an invalid command pattern, a wildcard-only allowlist path) are not cut.
  - (6) README and spec R7 now name the "isn't a small regular file" case and say the guard shows a marker failure it couldn't log. The warning's "the guard doesn't ask because of it" wording is unchanged.
  - Acknowledged: `active.md` was written at 01:47Z by a route the guard didn't log (the session-save status line); two `error` log entries say a background command's workflow changes were not checked (the mutation-runner runs; no workflow file changed).
  - Evidence: red seen first (3 failing). Mutation re-run: 30 of 31 caught; the survivor is the marker size and file-type check, whose only test is the skipped one. Two gate runs failed on "should return a decision within the hook timeout when a lookup never resolves (AC11)" (a wall-clock limit of 1000 ms) while another project's test run loaded the machine, one of them also on a governance-gate test; both tests pass alone. The third run is green: 1062 passed, 1 skipped, 0 failed of 1063, timing 1/1, fake-pass 0, both validates 0 (2026-10-12T02:49:53Z).
- 2026-10-11: closed and archived inside the 0.13.0 release PR, as ESP-12 was in 0.12.0 (ESP-39's intent); the release has no separate release plan (Francis: "proceed with next step").
- 2026-10-11 (0.13.0 release review, stage 1 FLAG; Francis decided each item):
  - (1) Investigated, then acknowledged: the governance log has six `error` entries saying a background command's workflow changes were not checked, not the two this plan and PR #87 name. They are a mutation-list edit (01:46Z), three mutation-runner runs (02:01Z, 02:38Z, 02:46Z) and two background gate runs (02:27Z, 02:33Z). No workflow file changed: `git diff v0.12.0..HEAD -- .github` is empty, `.github` has no working-tree change, and every mutation targets a file under `plugins/usiatech-engineering/hooks/scripts/`.
  - (2) Final status says the narrow re-review "ran", as PR #87 does, because its verdict is recorded only in a session file.
  - Checked, no decision needed: Jira shows ESP-35 and ESP-47..50 at Ready for Release.

## Final status
- **Shipped** to develop: feature commit `f1fbe21`, PR #87 merged as `5d56a51` (2026-10-12T02:55:48Z). Released as 0.13.0 (minor, feat) under the version-bump rule: release PR #88 (`7c9acf2`), promotion PR #89 (`d4743c9`), annotated tag `v0.13.0` on main. `claude plugin update` shows 0.13.0 at user scope. Jira ESP-35/47/48/49/50 → Released.
- AC1, AC2: shown (governance-policy "advisory warning, once per change" suite; governance-guard no-decision message test).
- AC3: shown (unknown `planEdits` counts as `"ask"` and doesn't escalate).
- AC4, AC5: shown (12 escalating cases ask on every call; an escalation names advisory problems too).
- AC6: shown (a changed set warns again, also after a clear while an escalating problem was present).
- AC7: shown (after-Bash check: one `warn` over two runs, one `error` per run).
- AC8: shown (unreadable marker shows the warning; a marker write failure is logged and leaves the decision alone).
- AC9: shown (README "Config problems" section).
- AC10: shown. Final gate before the commit (2026-10-12T02:49:53Z): npm test 1062 passed, 1 skipped, 0 failed of 1063, plus timing 1/1; fake-pass exit 0; both validates exit 0.
- Release gate on `chore/release-0.13.0` (2026-10-12T03:27:06Z): npm test 1062 passed, 1 skipped, 0 failed of 1063, plus timing 1/1; fake-pass exit 0; both validates exit 0.
- Mutation test: 30 of 31 caught. The survivor is the marker size and file-type check, whose only test needs a file symlink and is skipped on this machine.
- CI on #87 showed 4× FAILURE, most likely the GitHub billing block (ESP-40). Francis merged on the local gate.
- Reviews:
  - Stage 1 governance: FLAG, three items decided by Francis (Change log).
  - Stage 2: convention, silent-failure and security ran on the first version; one silent-failure blocker fixed, the other items decided by Francis (Change log).
  - Narrow re-review of the fixes: silent-failure and governance ran; governance raised six items, every recommendation taken. The last round of fixes was checked by the gate and the mutation run, not by a further review.
- Deviations: `hooks/scripts/governance-state.mjs` was added to Files during stage 2 (Change log). `active.md` was written twice by a route the guard didn't log, and `.claude/settings.local.json` was written outside the plan (all acknowledged in the Change log). Six guard `error` entries for unchecked background commands, not two; no workflow file changed (Change log, 0.13.0 release review). Known limits are listed in the PR #87 body.
