# Plan: Gate and release speed-ups, guard allow (ESP-158 to ESP-163)

## Goal
Cut wasted full-gate runs (cheap checks first, review round alongside the gate, `unless` exclusions, resume after a flake, opt-in narrow rerun after a review fix), and stop per-edit permission prompts for edits the approved plan covers.

## Requirement references
- docs/specs/2026-11-13-gate-speedups.md (R1–R16, AC1–AC19)
- ESP-158, ESP-159, ESP-160, ESP-161, ESP-162, ESP-163 (epic ESP-117)
- ADR-0002 (fake-pass checks fail the gate)

## Pre-plan checklist
- (a) New validation rules: `slow` (boolean), `unless` (glob list) on step entries and top-level `verifyRerun`. Callers searched: `checkSteps`/`readConfig` in `skills/verify/gate.mjs` (only reader of step keys), `run-verify.mjs` (CI reader), `hooks/scripts/governance-policy.mjs` and `templates/github/scripts/governance-rules.mjs` (no step-key or `verifyRerun` validation). Fixtures: `tests/gate.test.mjs`, `tests/gate-steps.test.mjs`, `tests/run-verify.test.mjs`, `templates/engineering.json`, this repo's `.claude/engineering.json`. The guard change adds no validation rule; it changes the decision returned for edits that pass (callers: `governance-guard.mjs`; fixtures: `tests/governance-guard.test.mjs`, `tests/governance-policy.test.mjs`).
- (b) Infrastructure mechanisms: tree hash by `git add -A` into a temporary copy of the index (`GIT_INDEX_FILE`) and `git write-tree`; run record under `git rev-parse --git-path usiatech-gate`; hook `permissionDecision: "allow"` (documented PreToolUse output, already used by the guard for `deny`/`ask`). n/a spike: standard git plumbing and hook output; the tests exercise them in temp repos.
- (c) Docs and ADRs touched: `plugins/usiatech-engineering/README.md` (Gate runner, config table, guard section), `skills/verify/SKILL.md`, `skills/release/SKILL.md`, `agents/governance-reviewer.md`, `hooks/hooks.json` description, spec `docs/specs/2026-11-13-gate-speedups.md`. ADR-0002 read, unchanged. No AGENTS.md template holds the "order after the build" text (searched `templates/`).

## Acceptance criteria
- AC1: a fake-pass finding fails the gate and no command step runs (test).
  - Evidence: gate.test.mjs "should run the fake-pass check first and stop before any command step on a finding (ESP-158 AC1)"; full gate PASS at tree ac47c92 (2026-11-13T18:27:02Z), then --rerun-fix after the spec AC18 wording fix: "Rerun after full gate at tree ac47c929255b5f4bec5eabc332a523c42fde6b55 (2026-11-13T18:27:02Z): 1 file changed since.", Gate: PASS, Gate tree 568bac24eed58ddf0d309103fa4e6ae4bb7017aa = --tree-hash, Gate run 2026-11-13T18:34:23Z (shown, 2026-11-13T18:35Z)
- AC2: with steps marked slow, every selected non-slow step runs before any slow one; a non-boolean `slow` exits 2 (test).
  - Evidence: gate.test.mjs "should run every selected non-slow step before any slow one..." and "should refuse a slow that is not true or false"; full gate PASS at tree ac47c92 (2026-11-13T18:27:02Z), then --rerun-fix after the spec AC18 wording fix: "Rerun after full gate at tree ac47c929255b5f4bec5eabc332a523c42fde6b55 (2026-11-13T18:27:02Z): 1 file changed since.", Gate: PASS, Gate tree 568bac24eed58ddf0d309103fa4e6ae4bb7017aa = --tree-hash, Gate run 2026-11-13T18:34:23Z (shown, 2026-11-13T18:35Z)
- AC3: a config with no `slow` key runs its steps in the same order as before, after the fake-pass check, and the report lists them in that order (test).
  - Evidence: gate.test.mjs "should keep config order with no slow key, after the fake-pass check (ESP-158 AC3)"; full gate PASS at tree ac47c92 (2026-11-13T18:27:02Z), then --rerun-fix after the spec AC18 wording fix: "Rerun after full gate at tree ac47c929255b5f4bec5eabc332a523c42fde6b55 (2026-11-13T18:27:02Z): 1 file changed since.", Gate: PASS, Gate tree 568bac24eed58ddf0d309103fa4e6ae4bb7017aa = --tree-hash, Gate run 2026-11-13T18:34:23Z (shown, 2026-11-13T18:35Z)
- AC4: the release skill, verify skill and README give one order: review round and full gate together, AC evidence check last.
  - Evidence: release SKILL.md step 3 (gate and review round together, final evidence check last), verify SKILL.md "One full gate per PR", README gate runner; plugin-structure.test.mjs one-full-gate tests; full gate PASS at tree ac47c92 (2026-11-13T18:27:02Z), then --rerun-fix after the spec AC18 wording fix: "Rerun after full gate at tree ac47c929255b5f4bec5eabc332a523c42fde6b55 (2026-11-13T18:27:02Z): 1 file changed since.", Gate: PASS, Gate tree 568bac24eed58ddf0d309103fa4e6ae4bb7017aa = --tree-hash, Gate run 2026-11-13T18:34:23Z (shown, 2026-11-13T18:35Z)
- AC5: a dry run in a scratchpad repo with `verifyRerun` set, following the new release order, where the review round finds a blocking issue: the first full gate overlaps the review round, and after the fix `--rerun-fix` replaces the second full gate, so one full gate and one narrowed rerun (old order: two full gates in a row); evidence is the gate outputs.
  - Evidence: scratchpad dry run 2026-11-13T17:49Z: run 1 full gate PASS (fake-pass, unit, api tests, web e2e) at tree 8770e2e; after a fix to api/b.ts, --rerun-fix printed "Rerun after full gate at tree 8770e2e... (2026-11-13T17:49:11Z): 1 file changed since.", ran fake-pass, unit, api tests and SKIPPED web e2e: one full gate plus one narrowed rerun; full gate PASS at tree ac47c92 (2026-11-13T18:27:02Z), then --rerun-fix after the spec AC18 wording fix: "Rerun after full gate at tree ac47c929255b5f4bec5eabc332a523c42fde6b55 (2026-11-13T18:27:02Z): 1 file changed since.", Gate: PASS, Gate tree 568bac24eed58ddf0d309103fa4e6ae4bb7017aa = --tree-hash, Gate run 2026-11-13T18:34:23Z (shown, 2026-11-13T18:35Z)
- AC6: a diff whose every `when` match is excluded by `unless` skips the step, and the `SKIPPED` line names the exclusion; a malformed `unless` exits 2 (test).
  - Evidence: gate.test.mjs "should skip a conditional step whose every matching file is excluded, and say so" and "should refuse a malformed unless..."; verify-select.test.mjs; full gate PASS at tree ac47c92 (2026-11-13T18:27:02Z), then --rerun-fix after the spec AC18 wording fix: "Rerun after full gate at tree ac47c929255b5f4bec5eabc332a523c42fde6b55 (2026-11-13T18:27:02Z): 1 file changed since.", Gate: PASS, Gate tree 568bac24eed58ddf0d309103fa4e6ae4bb7017aa = --tree-hash, Gate run 2026-11-13T18:34:23Z (shown, 2026-11-13T18:35Z)
- AC7: one changed file that matches `when` and not `unless` selects the step (test).
  - Evidence: verify-select.test.mjs "should select a step when one matching file is not excluded (AC7)"; gate.test.mjs AC6/AC7 test; full gate PASS at tree ac47c92 (2026-11-13T18:27:02Z), then --rerun-fix after the spec AC18 wording fix: "Rerun after full gate at tree ac47c929255b5f4bec5eabc332a523c42fde6b55 (2026-11-13T18:27:02Z): 1 file changed since.", Gate: PASS, Gate tree 568bac24eed58ddf0d309103fa4e6ae4bb7017aa = --tree-hash, Gate run 2026-11-13T18:34:23Z (shown, 2026-11-13T18:35Z)
- AC8: configs without `unless` select the same steps as before (test).
  - Evidence: verify-select.test.mjs AC8 tests; existing gate.test.mjs conditional-step tests unchanged and passing; full gate PASS at tree ac47c92 (2026-11-13T18:27:02Z), then --rerun-fix after the spec AC18 wording fix: "Rerun after full gate at tree ac47c929255b5f4bec5eabc332a523c42fde6b55 (2026-11-13T18:27:02Z): 1 file changed since.", Gate: PASS, Gate tree 568bac24eed58ddf0d309103fa4e6ae4bb7017aa = --tree-hash, Gate run 2026-11-13T18:34:23Z (shown, 2026-11-13T18:35Z)
- AC9: `gate.mjs` and `run-verify.mjs` select the same steps for the same diff (test).
  - Evidence: gate.test.mjs ESP-160 AC9 test (gate.mjs and run-verify.mjs select the same steps); run-verify.test.mjs; full gate PASS at tree ac47c92 (2026-11-13T18:27:02Z), then --rerun-fix after the spec AC18 wording fix: "Rerun after full gate at tree ac47c929255b5f4bec5eabc332a523c42fde6b55 (2026-11-13T18:27:02Z): 1 file changed since.", Gate: PASS, Gate tree 568bac24eed58ddf0d309103fa4e6ae4bb7017aa = --tree-hash, Gate run 2026-11-13T18:34:23Z (shown, 2026-11-13T18:35Z)
- AC10: after a failure at step N, `--resume` at the same tree runs step N and later only, and shows each earlier step as `PASSED EARLIER (<time>)` (test).
  - Evidence: gate.test.mjs ESP-162 AC10 resume test (PASSED EARLIER with time, runs from failed step); full gate PASS at tree ac47c92 (2026-11-13T18:27:02Z), then --rerun-fix after the spec AC18 wording fix: "Rerun after full gate at tree ac47c929255b5f4bec5eabc332a523c42fde6b55 (2026-11-13T18:27:02Z): 1 file changed since.", Gate: PASS, Gate tree 568bac24eed58ddf0d309103fa4e6ae4bb7017aa = --tree-hash, Gate run 2026-11-13T18:34:23Z (shown, 2026-11-13T18:35Z)
- AC11: editing a tracked file, or adding an untracked file, makes `--resume` run every step (test).
  - Evidence: gate.test.mjs "should run every step on --resume after a tracked edit or a new untracked file (ESP-162 AC11)"; full gate PASS at tree ac47c92 (2026-11-13T18:27:02Z), then --rerun-fix after the spec AC18 wording fix: "Rerun after full gate at tree ac47c929255b5f4bec5eabc332a523c42fde6b55 (2026-11-13T18:27:02Z): 1 file changed since.", Gate: PASS, Gate tree 568bac24eed58ddf0d309103fa4e6ae4bb7017aa = --tree-hash, Gate run 2026-11-13T18:34:23Z (shown, 2026-11-13T18:35Z)
- AC12: a change to `.claude/engineering.json` makes `--resume` run every step (test).
  - Evidence: gate.test.mjs "should run every step on --resume after a config change (ESP-162 AC12)"; full gate PASS at tree ac47c92 (2026-11-13T18:27:02Z), then --rerun-fix after the spec AC18 wording fix: "Rerun after full gate at tree ac47c929255b5f4bec5eabc332a523c42fde6b55 (2026-11-13T18:27:02Z): 1 file changed since.", Gate: PASS, Gate tree 568bac24eed58ddf0d309103fa4e6ae4bb7017aa = --tree-hash, Gate run 2026-11-13T18:34:23Z (shown, 2026-11-13T18:35Z)
- AC13: a full run prints `Gate tree: <hash>` equal to `--tree-hash` output; a resumed run whose steps all passed at that tree ends `Gate: PASS`, one with a failing step ends `Gate: FAIL` (test).
  - Evidence: gate.test.mjs AC10/AC13 test (Gate tree equals --tree-hash, resumed PASS/FAIL); this run: Gate tree equals --tree-hash; full gate PASS at tree ac47c92 (2026-11-13T18:27:02Z), then --rerun-fix after the spec AC18 wording fix: "Rerun after full gate at tree ac47c929255b5f4bec5eabc332a523c42fde6b55 (2026-11-13T18:27:02Z): 1 file changed since.", Gate: PASS, Gate tree 568bac24eed58ddf0d309103fa4e6ae4bb7017aa = --tree-hash, Gate run 2026-11-13T18:34:23Z (shown, 2026-11-13T18:35Z)
- AC14: with `verifyRerun` set and a recorded full pass, a fix touching one conditional step's folder runs the `verify` steps, the fake-pass check and that step only, and prints the `Rerun after full gate at tree` line (test).
  - Evidence: gate.test.mjs ESP-161 AC14 rerun-fix test; AC5 dry run output; full gate PASS at tree ac47c92 (2026-11-13T18:27:02Z), then --rerun-fix after the spec AC18 wording fix: "Rerun after full gate at tree ac47c929255b5f4bec5eabc332a523c42fde6b55 (2026-11-13T18:27:02Z): 1 file changed since.", Gate: PASS, Gate tree 568bac24eed58ddf0d309103fa4e6ae4bb7017aa = --tree-hash, Gate run 2026-11-13T18:34:23Z (shown, 2026-11-13T18:35Z)
- AC15: `--rerun-fix` without the key, with an unknown value, or without a recorded full pass exits 2 and runs nothing (test).
  - Evidence: gate.test.mjs ESP-161 AC15 tests (no key, unknown value, no recorded full pass exit 2); full gate PASS at tree ac47c92 (2026-11-13T18:27:02Z), then --rerun-fix after the spec AC18 wording fix: "Rerun after full gate at tree ac47c929255b5f4bec5eabc332a523c42fde6b55 (2026-11-13T18:27:02Z): 1 file changed since.", Gate: PASS, Gate tree 568bac24eed58ddf0d309103fa4e6ae4bb7017aa = --tree-hash, Gate run 2026-11-13T18:34:23Z (shown, 2026-11-13T18:35Z)
- AC16: the release and verify skills state the rerun rule and its conditions, and `governance-reviewer` checks the tree hash and the named full pass, flagging a mismatch.
  - Evidence: release SKILL.md Rerun rule and Final evidence check, verify SKILL.md --rerun-fix section, governance-reviewer.md item 7 tree-hash and named-full-pass checks; full gate PASS at tree ac47c92 (2026-11-13T18:27:02Z), then --rerun-fix after the spec AC18 wording fix: "Rerun after full gate at tree ac47c929255b5f4bec5eabc332a523c42fde6b55 (2026-11-13T18:27:02Z): 1 file changed since.", Gate: PASS, Gate tree 568bac24eed58ddf0d309103fa4e6ae4bb7017aa = --tree-hash, Gate run 2026-11-13T18:34:23Z (shown, 2026-11-13T18:35Z)
- AC17: this repo's `.claude/engineering.json` sets `"verifyRerun": "fix-diff"`, and `gate.mjs --check` exits 0.
  - Evidence: .claude/engineering.json has "verifyRerun": "fix-diff"; gate.mjs --check printed "Gate check: the gate can start. Nothing ran." exit 0; full gate PASS at tree ac47c92 (2026-11-13T18:27:02Z), then --rerun-fix after the spec AC18 wording fix: "Rerun after full gate at tree ac47c929255b5f4bec5eabc332a523c42fde6b55 (2026-11-13T18:27:02Z): 1 file changed since.", Gate: PASS, Gate tree 568bac24eed58ddf0d309103fa4e6ae4bb7017aa = --tree-hash, Gate run 2026-11-13T18:34:23Z (shown, 2026-11-13T18:35Z)
- AC18: the guard returns `allow` for an edit to a file in the plan's Files list and for a trusted write, and the trusted write is still logged as `trusted` (test).
  - Evidence: governance-guard.test.mjs in-plan allow and scratchpad allow tests (trusted logged); planEdits all plan write now logged trusted without allow per security review; full gate PASS at tree ac47c92 (2026-11-13T18:27:02Z), then --rerun-fix after the spec AC18 wording fix: "Rerun after full gate at tree ac47c929255b5f4bec5eabc332a523c42fde6b55 (2026-11-13T18:27:02Z): 1 file changed since.", Gate: PASS, Gate tree 568bac24eed58ddf0d309103fa4e6ae4bb7017aa = --tree-hash, Gate run 2026-11-13T18:34:23Z (shown, 2026-11-13T18:35Z)
- AC19: an out-of-plan file, an ask path and a broken config still return `ask`, a secret still denies, and an edit with no active plan returns no decision (test).
  - Evidence: governance-policy.test.mjs R16 test (ask path ask, secret deny, broken config ask); governance-guard.test.mjs out-of-plan ask, no-plan no decision, plan mode, .git and missing-mode no allow; full gate PASS at tree ac47c92 (2026-11-13T18:27:02Z), then --rerun-fix after the spec AC18 wording fix: "Rerun after full gate at tree ac47c929255b5f4bec5eabc332a523c42fde6b55 (2026-11-13T18:27:02Z): 1 file changed since.", Gate: PASS, Gate tree 568bac24eed58ddf0d309103fa4e6ae4bb7017aa = --tree-hash, Gate run 2026-11-13T18:34:23Z (shown, 2026-11-13T18:35Z)
## Tasks
- [x] T1: guard returns `allow` for in-plan and trusted edits (covers AC18, AC19; ESP-163)
- [x] T2: shared selection module with `unless`, used by `gate.mjs` and `run-verify.mjs` (covers AC6–AC9; ESP-160)
- [x] T3: fake-pass check first, `slow` ordering, run-order report (covers AC1–AC3; ESP-158)
- [x] T4: run record, tree hash, `--tree-hash`, `--resume` (covers AC10–AC13; ESP-162)
- [x] T5: `verifyRerun` key and `--rerun-fix`; opt this repo in (covers AC14, AC15, AC17; ESP-161)
- [x] T6: release and verify skills, README, governance-reviewer evidence check, AC5 dry run (covers AC4, AC5, AC16; ESP-159, ESP-161, ESP-162)

## Files
- `docs/specs/2026-11-13-gate-speedups.md`
- `.claude/engineering.json`
- `plugins/usiatech-engineering/hooks/hooks.json`
- `plugins/usiatech-engineering/hooks/scripts/governance-guard.mjs`
- `plugins/usiatech-engineering/hooks/scripts/governance-policy.mjs`
- `plugins/usiatech-engineering/templates/engineering.json`
- `plugins/usiatech-engineering/templates/github/scripts/verify-select.mjs`
- `plugins/usiatech-engineering/templates/github/scripts/run-verify.mjs`
- `plugins/usiatech-engineering/skills/verify/gate.mjs`
- `plugins/usiatech-engineering/skills/verify/gate-steps.mjs`
- `plugins/usiatech-engineering/skills/verify/gate-record.mjs`
- `plugins/usiatech-engineering/skills/verify/SKILL.md`
- `plugins/usiatech-engineering/skills/release/SKILL.md`
- `plugins/usiatech-engineering/agents/governance-reviewer.md`
- `plugins/usiatech-engineering/README.md`
- `plugins/usiatech-engineering/tests/gate.test.mjs`
- `plugins/usiatech-engineering/tests/gate-steps.test.mjs`
- `plugins/usiatech-engineering/tests/plugin-structure.test.mjs`
- `plugins/usiatech-engineering/tests/gate-record.test.mjs`
- `plugins/usiatech-engineering/tests/verify-select.test.mjs`
- `plugins/usiatech-engineering/tests/run-verify.test.mjs`
- `plugins/usiatech-engineering/tests/governance-guard.test.mjs`
- `plugins/usiatech-engineering/tests/governance-policy.test.mjs`

## Commands and actions
- AC5 dry run: a throwaway git repo in the session scratchpad with a small `.claude/engineering.json`, run through `gate.mjs` by hand; nothing is pushed and it is deleted after.
- Release after merge: version bump and `claude plugin update` (release skill, user confirms the level).

## Out of scope
- Step ordering in the CI gate; a task-runner cache; guard decisions for Bash/PowerShell; allowing edits when no plan is active.

## Approved
- By: Francis · Date: 2026-11-13
- Route: large (new modules and gate flags; more than 5 production files). Override of the route's steps: spec written from the tickets without `clarify`, existing ESP keys mapped instead of `to-tickets` (Francis, 2026-11-13).
- Pre-flight: opus, full

## Final status
- Shipped on branch feature/esp-158-162-gate-speedups (commit and PR follow at once). All 19 ACs shown; all tasks done.
- Deviations: AC5 reworded (one full gate plus one narrowed rerun); ESP-163 allow narrowed by the security review (no allow for planEdits "all" plan writes, any .git folder, plan mode, a missing permission mode, or failed-open lookups); tests/plugin-structure.test.mjs added to Files.

## Change log
- 2026-11-13: after commit 89d6693 and PR 197 (code-review plugin: no issues), the security-guidance commit review found 3 issues. Fixed: no in-plan allow through a link or junction, and no allow for evidence-only plan edits (planWrite). Accepted by Francis and documented in the README: the run record can be faked by a Bash write to the git folder (same trust as the gate output). Gate rerun with --rerun-fix before the fix commit.
- 2026-11-13: ESP-159 option B and ESP-161 opt-in decided by Francis; ESP-158..162 moved under ESP-117.
- 2026-11-13: pre-flight FLAG 1 fixed by adding AC13 and widening AC2, AC3, AC6, AC14 (wording and coverage, no new scope); FLAG 3 fixed by listing the AC5 dry run; files `tests/gate-steps.test.mjs` and `templates/engineering.json` added from its notes.
- 2026-11-13: ESP-163 (guard allow) added to this PR at Francis's request; release together.
- 2026-11-13: AC5 corrected (wording, no new scope): with option B a blocking fix still needs a second gate run; the saving is the overlap with the review round and the narrowed `--rerun-fix`, so AC5 now counts one full gate plus one narrowed rerun.
- 2026-11-13: `/code-review high` found 10 issues, all fixed: no hook allow in plan mode or after a failed-open lookup; `unless` folder entries ending in "/" refused; a note when the steps change the tree; a resumed run keeps its earlier passes on an early stop; a clear error for a non-list `unless` in CI; one error-text helper; compiled `unless` globs cached; temp record file removed on a failed write; README notes the git objects the tree hash writes. `tests/plugin-structure.test.mjs` added to Files: its wording checks for the old gate order (fake-pass last, gate after the last change, testingComplete after the review round) follow the T6 text.
- 2026-11-13: release review round. Security FAIL (blocking) fixed: a plan write trusted by `planEdits: "all"` no longer gets `allow` (it could widen Files to `**` and then allow `.git/hooks/*` writes unprompted), `.git/**` is never in-plan, and no allow without a `permission_mode` in the hook input; spec R16 and README updated (narrows ESP-163, no new scope). Governance FLAG on the AC19 test fixed (asserts `deny`); convention nit fixed (`isPlainObject` imported). First full gate FAIL: `npm test` hit the 600 s default under parallel load; `tests` step given `timeoutMs` 1200000.
- 2026-11-13: security fix re-review PASS; its nit taken (no in-plan allow under any `**/.git/**`, nested repos included). Francis acknowledged the governance FLAG (two after-Bash snapshot errors on background commands; no workflow file changed) and kept the allow for trusted memory and scratchpad writes (security nit).
- 2026-11-13: Francis approved the spec and plan, accepted pre-flight FLAG 2 (resumed and narrowed gates count as AC evidence under the tree-hash and recorded-pass checks), and confirmed the guard allow scope (in-plan and trusted edits only).
