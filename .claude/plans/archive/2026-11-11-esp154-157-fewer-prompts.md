# Plan: Fewer prompts — scratchpad trust, plan pointer trust, review page (ESP-154/155/156)

## Goal
Stop prompts on session-scratchpad and `.claude/plans/active.md` writes, and make verification rounds use one grouped HTML review page.

## Requirement references
- ESP-155 (scratchpad trust), ESP-156 (active.md trust), ESP-154 (review page); design review page decisions D1.1–D4.2, accepted 2026-11-11.

## Pre-plan checklist
- (a) New validation rules and format checks: `{session}` placeholder in `trustedEntryProblem` / `PLACEHOLDERS`; callers searched: `trustedWriteEntry`, `evaluate`, `tests/governance-policy.test.mjs` trusted-path tests.
- (b) Database or infrastructure mechanisms the design relies on: hook input `session_id` (already in `input` passed to `evaluate`); desktop scratchpad path seen in governance log. No spike needed.
- (c) Docs and ADRs touched: plugin README (trusted paths, planEdits, decisions), `templates/engineering.json`, `setup-engineering` SKILL, skills clarify/approve-plan/to-spec/to-tickets/release.

## Acceptance criteria
- AC1: A Write to `$TMP/claude/<any>/<this session id>/scratchpad/x.md` is trusted with no prompt (ESP-155 AC1).
  - Evidence: gate run 2026-11-11T19:56Z test "should trust this session's desktop scratchpad without a prompt (AC1)" passes; session id matches transcript and scratchpad folder (shown, 2026-11-11T19:56Z)
- AC2: Another session id, a missing session id, or a never-trusted name inside the scratchpad still asks (ESP-155 AC2–AC4).
  - Evidence: gate run 2026-11-11T19:56Z tests "should still ask for another session's scratchpad or with no usable session id (AC2)" and "should still ask for never-trusted names inside the scratchpad (AC3)" pass (shown, 2026-11-11T19:56Z)
- AC3: With no `planEdits` set, an Edit of `.claude/plans/active.md` is trusted; link checks still ask; `"ask"` still asks (ESP-156 AC1–AC2).
  - Evidence: gate run 2026-11-11T19:56Z test "should trust plan and archive writes when planEdits is not set (ESP-156; AC1)" and suite `evaluate: planEdits "all"` pass (shown, 2026-11-11T19:56Z)
- AC4: setup-engineering adds `Edit(/.claude/plans/active.md)` and `Edit(/.claude/plans/archive/**)` allow rules; this repo's `.claude/settings.json` has them (ESP-156 AC3).
  - Evidence: both rules in setup-engineering SKILL.md line 20 and .claude/settings.json lines 4–5; gate run 2026-11-11T19:56Z test "should default to trusted plan edits and this session's scratchpad (ESP-155, ESP-156)" passes (shown, 2026-11-11T19:56Z)
- AC5: `templates/review-page.md` + `templates/review-page.html` exist; `clarify`, `approve-plan`, `to-tickets` and `release` reference them (to-tickets owns the joint spec+tickets page); `decisions.batch: false` disables the page; structure tests cover it (ESP-154 AC1–AC5).
  - Evidence: both templates in diff (untracked); clarify, approve-plan, to-tickets and release SKILL.md reference review-page; gate run 2026-11-11T19:56Z tests "should point every approval step at the review page (ESP-154; AC1)" and "should ship the review-page procedure and skeleton with a dark-mode block (ESP-154; AC2)" pass (shown, 2026-11-11T19:56Z)
- AC7: taskkill reporting only already-exited tree members counts as a successful kill (ESP-157).
  - Evidence: gate run 2026-11-11T19:56Z tests "should treat a taskkill report of only already-gone processes as a successful kill (ESP-157)" and "should count a Windows kill as done when taskkill reports only already-gone members (ESP-157)" pass; mutation test 9/9 CAUGHT (passed evidence) (shown, 2026-11-11T19:56Z)
- AC6: `npm test` and both `claude plugin validate` commands pass.
  - Evidence: gate run 2026-11-11T19:56:23Z: npm test exit 0 (2329 pass, 0 fail, 4 skipped), validate marketplace exit 0, validate plugin exit 0, fake-pass check exit 0 (shown, 2026-11-11T19:56Z)

## Tasks
- [x] T1: `{session}` placeholder + default scratchpad entry, test-first (covers AC1, AC2; ESP-155)
- [x] T2: `planEdits` default `"all"`, test-first; setup-engineering allow rules; repo settings (covers AC3, AC4; ESP-156)
- [x] T3: review-page procedure + skeleton, skill references, structure test (covers AC5; ESP-154)
- [x] T5: fix mutation-runner taskkill race that failed the gate twice, test-first (covers AC7; ESP-157)
- [x] T4: README, template config (covers AC6); the 0.26.0 bump is the separate chore(release) PR

## Files
- `plugins/usiatech-engineering/hooks/scripts/governance-policy.mjs`
- `plugins/usiatech-engineering/tests/**`
- `plugins/usiatech-engineering/templates/**`
- `plugins/usiatech-engineering/skills/**`
- `plugins/usiatech-engineering/agents/governance-reviewer.md`
- `plugins/usiatech-engineering/README.md`
- `plugins/usiatech-engineering/.claude-plugin/plugin.json`
- `.claude-plugin/marketplace.json`
- `README.md`
- `.claude/settings.json`
- `.claude/plans/**`

## Commands and actions
- npm test; claude plugin validate . ; claude plugin validate plugins/usiatech-engineering
- Jira ESP-154/155/156 transitions

## Out of scope
- Publishing review pages as Artifacts by default; changing other trusted paths.

## Approved
- By: Francis · Date: 2026-11-11
- Route: small (three tickets filed directly; design accepted via review page)
- Pre-flight: opus-5-5, light

## Change log
- 2026-11-11: plan created from accepted review page (D1.1–D4.2).
- 2026-11-11: code-review fixes (Francis approved release): AC4 rules root-anchored (`/.claude/plans/…`); AC5 four skills, to-spec drops its page because to-tickets asks the single spec+tickets approval.
- 2026-11-11: gate failed twice on the ESP-58 taskkill race (not this branch); Francis asked to release, so fixed it here as ESP-157 (skills/mutation-test/mutation-runner.mjs, covered by skills/** and tests/** in Files).
- 2026-11-11: stage-1 governance FLAG (after-Bash workflow check skipped the background gate.mjs run at 17:36Z; no .github changes) acknowledged by Francis; README minor fixed (to-spec dropped from the review-page lists, lines 66 and 412).
- 2026-11-11: stage 2 PASS (no findings 80+). Francis chose to fix the nits now: `session_id` must be a string (governance-policy.mjs, test-first); review-page.md escapes quotes and bans scripts/remote URLs (structure test); `values` hoisted above the trusted-path loop. Mutation test (Francis approved): 9 mutations, M2 (unanchored UUID) and M9 (killTree already-gone branch) survived; Francis asked for tests, added test-first (padded session ids; `killTree` exported with injectable `platform`/`execFile`); all 9 now CAUGHT. Policy file changed after the round, so a full gate and full review round follow.
- 2026-11-11: round-2 governance FLAG (after-Bash workflow check skipped the background mutation-runner run at 19:35:31Z; no .github changes) acknowledged by Francis; stage 2 round 2 follows.

## Final status
- Status: shipped
- Branch: `feature/esp154-156-fewer-prompts` → PR into `develop` (commit and PR follow in the same commit as this archive)
- Acceptance criteria: AC1–AC7 all shown (gate run 2026-11-11T19:56Z).
- Reviews: two full rounds (governance, convention, silent-failure, security), all PASS; two governance FLAGs (skipped after-Bash checks on background runs) acknowledged by Francis.
- Mutation test: 9 mutations, all CAUGHT after two added tests.
- Deviations: ESP-157 (mutation-runner taskkill race) added mid-release with a dated Change log line; to-spec does not get its own review page (to-tickets owns the joint page).
