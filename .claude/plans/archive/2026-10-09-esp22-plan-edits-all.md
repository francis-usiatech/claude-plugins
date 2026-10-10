# Plan: ESP-22 Plan edits without a prompt (`governance.planEdits: "all"`)

## Goal
Add `governance.planEdits: "all"`. Under it, plan (`active.md`) and archive writes go through without a prompt and are logged as trusted, while the secret, env-file and protected-path checks still win. The governance-reviewer flags scope added after approval without a dated Change log line. Document it and opt this repo in, in one PR to develop, then release.

## Requirement references
- Spec `docs/specs/2026-10-09-plan-edits-all.md` (Status: approved), R1–R9
- Jira ESP-22 (#72) and its sub-tasks ESP-24, ESP-25, ESP-26, one PR at the user's request ("get esp-22 done and released", 2026-10-09)
- ESP-9 (0.9.0 trusted writes and evidence-only plan edits); ADR-0002 (tests that can't fail fail the gate)

## Acceptance criteria
- AC1 (spec AC1): A test passes `planEdits: "all"` and gets no config problem. A test passes `planEdits: "yes"` and gets a config problem matching `"allow", "ask" or "all"`.
  - Evidence: governance-policy.test.mjs "should accept \"all\" with no config problem" + updated invalid-value regex: pass; rewritten config test red against pre-change code (assertion), green after (shown, 2026-10-09T23:23:43Z; re-run green 2026-10-09T23:45:12Z: npm test 998/998 + timing 1/1 exit 0)
- AC2 (spec AC2): Under `"all"`, tests create `active.md` with Write, replace it with Write, and add a **Files** entry with Edit and with MultiEdit. Each `evaluate()` call returns no ask or deny, and `logEntries` records `"decision": "trusted"`. The same create test without `"all"` still returns `ask`.
  - Evidence: "should trust creating and replacing the plan with Write", "should trust a new Files entry made with Edit or MultiEdit", "should still ask when creating the plan without \"all\"": pass; red run failed on assertions (shown, 2026-10-09T23:23:43Z; re-run green 2026-10-09T23:45:12Z: npm test 998/998 + timing 1/1 exit 0)
- AC3 (spec AC3): Under `"all"`, tests create a new archive file, edit an existing one and overwrite an existing one. Each returns no ask or deny and is logged as `trusted`.
  - Evidence: "should trust creating, editing and overwriting an archive file": pass; red on assertion (shown, 2026-10-09T23:23:43Z; re-run green 2026-10-09T23:45:12Z: npm test 998/998 + timing 1/1 exit 0)
- AC4 (spec AC4): Under `"all"`, a plan write and an archive write that contain a private key are denied. A write that contains a secret the guard only asks about still asks. A write to a path matched by `protectedPaths` is still denied.
  - Evidence: "should still deny a private key…", "should still ask about a secret…", "should still deny … protectedPaths": pass (the deny tests passed before the change too, as expected for behaviour that already existed; the ask-secret test was red) (shown, 2026-10-09T23:23:43Z; re-run green 2026-10-09T23:45:12Z: npm test 998/998 + timing 1/1 exit 0)
- AC5 (spec AC5, as amended): The existing `planEdits` tests for `"allow"` and `"ask"` pass unchanged, except that the regex for the invalid-value message (test line 1042) changes to the three-value wording R1 and AC1 require; line 1039 stays byte-identical. The archive-exempt test (line 170) stays unchanged. `npm test` exits 0.
  - Evidence: governance-policy.test.mjs 256/256, only line 1042 regex changed in existing tests, line 170 unchanged; npm test 998/998 + timing 1/1 exit 0 (shown, 2026-10-09T23:23:43Z; re-run green 2026-10-09T23:45:12Z: npm test 998/998 + timing 1/1 exit 0)
- AC6 (spec AC6): `plugins/usiatech-engineering/agents/governance-reviewer.md` tells the reviewer: when the log has a `trusted` write to `active.md`, compare the plan's Files, ACs and tasks against those at approval (from git history or the Change log) and return at least `FLAG` for any later addition without a dated Change log line. A grep for `planEdits` in that file finds the instruction.
  - Evidence: governance-reviewer.md check 9 "Scope added after approval"; grep -n planEdits finds line 64 (shown, 2026-10-09T23:24Z; re-checked 2026-10-09T23:58:40Z)
- AC7 (spec AC7): `grep -n '"all"'` finds the new value, with its trade-off, in `plugins/usiatech-engineering/README.md`, `plugins/usiatech-engineering/templates/engineering.json` and `plugins/usiatech-engineering/skills/approve-plan/SKILL.md`.
  - Evidence: grep "all" finds README Trusted writes (with Trade-off) and config table, approve-plan SKILL.md line 8 (with trade-off); templates/engineering.json $comment has it JSON-escaped as \\"all\\" (the value stays "allow", the default) (shown, 2026-10-09T23:24Z; re-checked 2026-10-09T23:58:40Z)
- AC8 (spec AC8): `node -e` that reads `.claude/engineering.json` prints `all` for `governance.planEdits`, and `loadConfig` on this repo reports no config problem. Manual check after the 0.11.0 install: an `active.md` scope edit and an archive write in this repo show no prompt (confirms Claude Code itself doesn't prompt for `.claude/**`).
  - Evidence: node -e prints all; loadConfig error null; evaluate on a plan edit → trusted, no config problem (shown, 2026-10-09T23:19:30Z). File held in scratchpad until commit (0.10.1 guard rejects "all"); restored at 23:43:04Z and re-checked in place: loadConfig planEdits all, error null; evaluate on an active.md Edit → trusted, reason names planEdits "all" (shown, 2026-10-09T23:59:43Z). Manual no-prompt check pending 0.11.0 install
- AC9 (spec AC9, plus repo gate): The mutation test on the changed decision code catches every mutant, or each survivor is explained. The fake-pass check exits 0, and both `claude plugin validate` commands exit 0.
  - Evidence: mutation-runner on governance-policy.mjs: 8 run, 8 CAUGHT, 0 survived (M1–M8: config value, branch off/always-on, archive/plan dropped, glob widened, trusted flag, message); fake-pass exit 0; claude plugin validate . and plugins/usiatech-engineering both exit 0 (shown, 2026-10-09T23:27:58Z; governance-policy.mjs unchanged since 23:27:57Z; fake-pass and both validates re-run exit 0 at 2026-10-09T23:45:12Z)
- AC10 (spec AC10): Under `"all"`, an archive folder junctioned elsewhere, a `.claude/plans` junctioned elsewhere, a hard-linked `active.md` and an archive junction to a missing target each return `ask` with a reason naming the link.
  - Evidence: 4 tests "should ask when the archive folder is a link to another folder", "…plans folder is a link…", "…plan is a hard link…", "…archive folder is a link to a missing target": red run 4 assertion failures (each came back trusted), green after; governance-policy.test.mjs 260/260; npm test 1002/1002 + timing 1/1 exit 0; fake-pass exit 0 (0 findings); both validates exit 0; mutation L1–L7 7/7 CAUGHT; repo opt-in still trusts active.md and archive (shown, 2026-10-10T02:06:01Z). After stage 2 nits (per-test reason patterns; spec AC order and TOCTOU limit): npm test 1002/1002 + timing 1/1 exit 0, fake-pass exit 0 (0 findings), both validates exit 0, mutation L1–L8 8/8 CAUGHT (L8: a crash in the check no longer passes the link tests) (shown, 2026-10-10T02:59:11Z)

## Tasks
- [x] T1: Write failing guard tests (config value, plan create/replace/scope edits, archive create/edit/overwrite, secret/protected-path precedence, "allow"/"ask" unchanged), then the guard change in `governance-policy.mjs`. Under `"all"` archive writes return `trusted` instead of today's `null`; under the default and `"ask"` they stay `null` (covers AC1–AC5; ESP-24)
- [x] T2: Add the post-approval scope-growth check to the governance-reviewer agent (covers AC6; ESP-25)
- [x] T3: Document `"all"` and its trade-off in the README, `templates/engineering.json` and the approve-plan skill; create this repo's `.claude/engineering.json` with `"governance": { "planEdits": "all" }` (covers AC7, AC8; ESP-26)
- [x] T4: Run the gate and the mutation test; record evidence (covers AC5, AC9; ESP-24)
- [x] T6: Test-first: failing link tests, then in the `"all"` branch trust only paths whose real path stays under `.claude/plans` and that aren't hard links, asking otherwise; re-run the gate, the mutation test and the reviewers; second commit on PR #78 (covers AC10, AC9; ESP-24)
- [x] T5: Release to develop: stage 1 governance-reviewer, stage 2 security, silent-failure and convention reviewers; commit with ESP-24/25/26 refs; PR to develop merged; Jira ESP-24/25/26 to Ready for Release. The 0.11.0 release follows under its own plan (ESP-22)

## Files
- `plugins/usiatech-engineering/hooks/scripts/governance-policy.mjs`
- `plugins/usiatech-engineering/tests/governance-policy.test.mjs`
- `plugins/usiatech-engineering/agents/governance-reviewer.md`
- `plugins/usiatech-engineering/README.md`
- `plugins/usiatech-engineering/templates/engineering.json`
- `plugins/usiatech-engineering/skills/approve-plan/SKILL.md`
- `.claude/engineering.json`
- `docs/specs/2026-10-09-plan-edits-all.md`

## Commands and actions
- Mutation-test run on the changed decision code in `governance-policy.mjs` (T4): list JSON in the session scratchpad; its only command is `node --test plugins/usiatech-engineering/tests/governance-policy.test.mjs`; the user confirms the commands before the run.
- Before recording this plan: the current ESP-28 `active.md` is gitignored and not in the stash; it is copied to `~/.claude/session-data/esp28-paused-active.md` (done) and restored when ESP-28 resumes.
- Creating `.claude/engineering.json` (governance file): the guard asks; the approval label is added by convention (this repo has no CI label gate).
- Spec AC5 amended in this PR with a dated Change log line (contradiction with R1/AC1 on the message test).
- Release 0.11.0 (separate plan after T5): version bump in `plugin.json`, `marketplace.json` and the README Versioning row on its own release branch, as for 0.10.1. Claude opens the develop→main PR and never merges it; after the user merges, tag, `claude plugin marketplace update` and `claude plugin update`.
- Jira: ESP-24/25/26 to In Progress now; to Ready for Release on merge to develop; ESP-22 and sub-tasks to Released after the tag.

## Out of scope
- Changing the `"allow"` default or the `"ask"` behaviour.
- Trusting plan files written or moved through Bash.
- ESP-27 / ESP-28 (paused; stash "ESP-28 T3 green (paused for ESP-22)"), ESP-23 and ESP-20.

## Approved
- By: Francis · Date: 2026-10-09
- Route: large (adds a new config value and reviewer behaviour; spec and tickets done via clarify → to-spec → to-tickets). One plan for ESP-24, ESP-25 and ESP-26 because the user listed the set (ESP-22) to ship together.

## Change log
- 2026-10-09: plan drafted for ESP-22 (ESP-24–26) at Francis's request to put ESP-22 before all other work; ESP-28 paused.
- 2026-10-09: pre-flight FLAG; fixes applied (ESP-28 plan preserved, AC5 amendment made explicit, T5 ends at develop, CI label wording, archive default unchanged, AC9 label, manual prompt check in AC8). Approved by Francis ("proceed"), including the spec AC5 amendment.
- 2026-10-09: `.claude/engineering.json` held in the scratchpad until the commit, because the installed 0.10.1 guard reports "all" as a config problem and would ask on every edit.
- 2026-10-09: `.claude/engineering.json` restored at 23:43Z. Stage 1 pre-commit governance review: FLAG (AC evidence stamps older than the restore). Francis chose to restamp: gate re-run 23:45:12Z, AC6–AC8 re-checked 23:58–23:59Z, evidence lines updated, then stage 2.
- 2026-10-09: PR #78 opened. AC10 and T6 added from the security reviewer's symlink note (a linked `active.md` would be trusted under "all" where it used to ask); Francis chose "Fix in this PR". Spec R9 and AC10 added. Files unchanged.

## Final status
- **Shipped** to develop: commits `14cad94` (feature) and `59d78da` (link check), PR #78 merged as `b1cacc9` (2026-10-09). To be released as 0.11.0 (minor) under the version-bump rule, on its own release plan. Jira ESP-24/25/26 → Ready for Release.
- AC1–AC5: shown (9 tests red-first, now green; only the line 1042 regex changed in existing tests).
- AC6: shown (governance-reviewer check 9). AC7: shown (README, template `$comment`, approve-plan skill).
- AC8: shown (repo opt-in trusted by `evaluate`). The manual no-prompt check is still pending the 0.11.0 install.
- AC9: shown (8/8 mutants caught on the feature, 8/8 on the link check). AC10: shown (4 link tests red-first, now green).
- Final gate (2026-10-10T02:59:11Z): npm test 1002/1002 plus timing 1/1, fake-pass exit 0, both validates exit 0. CI green on 4 jobs (Ubuntu and Windows, Node 20 and 22).
- Reviews:
  - Stage 1 governance: FLAG (stale evidence stamps), resolved by restamping. The link-check delta: PASS.
  - Stage 2 on both commits: security and silent-failure PASS with nits; convention flagged only the subject length, fixed both times. Nits listed in the PR.
- Deviations:
  - Scope grew after approval: R9/AC10/T6 (symlink fix), recorded in the Change log.
  - A link-test helper failed the fake-pass check (fp-no-assert); the assertions were moved into each test.
