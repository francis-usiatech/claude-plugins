# Plan: Tighten planning.preflightReviewers entry checks (ESP-72)

## Goal
Make the guard report three `planning.preflightReviewers` entry mistakes it lets through today: an `agent` name with a control character or surrounding spaces, `"when": null`, and keys other than `agent`, `when` and `$comment`. All stay advisory config problems. `approve-plan` applies the same name rule and never echoes a raw name for a skipped entry.

## Requirement references
- ESP-72 (follow-up from the ESP-67 release review; parent ESP-63)
- `docs/specs/2026-10-16-delivery-speedup.md` R9, R12 (advisory validation of `planning.preflightReviewers`), R19 (README documents the key)

## Pre-plan checklist
- (a) New validation rules and format checks: searched the repo for `preflightReviewers` (callers and fixtures). The only reader of the sanitised value is `checkPlanning` in `hooks/scripts/governance-policy.mjs`; `approve-plan` reads the raw file as instructions. Fixtures: `tests/governance-policy.test.mjs` ESP-67 block (valid entries use plain names `docs-sync` and `security-tenancy-auditor`, which still pass) and `tests/plugin-structure.test.mjs` (text assertions on approve-plan lines 42–44 at 521, 525–526 and 542, kept matching). This repo's `.claude/engineering.json` sets no `planning` key. `gate.mjs` doesn't read `planning`. `hasControlChar` is reused from `templates/github/scripts/governance-rules.mjs` (needs adding to the import list). `$comment` is the documented note key (ESP-62, `scripts/jira-tracker.mjs:27-28`).
- (b) Database or infrastructure mechanisms the design relies on: n/a: pure config validation in an existing function, no new mechanism.
- (c) Docs and ADRs touched: searched docs, ADRs and the README for `preflightReviewers`. Touched: `plugins/usiatech-engineering/README.md` (config table row for `planning`, the "Config problems" list at line 210, a new Versioning row) and `plugins/usiatech-engineering/skills/approve-plan/SKILL.md` (the invalid-entry sentence, the index naming, and one sentence that a pre-flight reviewer receives only the draft plan). The spec and the archived plans mention the key but stay unchanged. No ADR covers it. No docs reviewer is configured (no `planning.preflightReviewers` in this repo).

## Acceptance criteria
- AC1: An entry whose `agent` contains a control character (for example `"a\nb"` or `"a\u2028b"`) or has a space at either end (`" docs-sync"`) gives exactly one advisory problem naming `planning.preflightReviewers[i]`, no escalating problem and no ask. The entry is dropped and the other entries are kept.
  - Evidence: `governance-policy.test.mjs` passing: "should report an agent with a line break / a line separator / a leading space / a trailing space as one advisory problem with no ask" and "should drop an agent with surrounding spaces and keep the other entries (ESP-72)"; red before the fix, green after; mutations 3 and 4 CAUGHT (shown, 2026-10-18T02:00Z)
- AC2: An entry with `"when": null` gives exactly one advisory problem naming `planning.preflightReviewers[i].when`, no escalating problem and no ask. The entry is kept without `when`, so it runs on every plan, as today.
  - Evidence: passing "should report a null when as one advisory problem with no ask" and "should keep an entry with a null when, without the when, so it runs on every plan (ESP-72)"; mutations 5 and 6 CAUGHT (shown, 2026-10-18T02:00Z)
- AC3: An entry with a key other than `agent`, `when` and `$comment` (for example `"When"` or `"paths"`) gives exactly one advisory problem naming the key, no escalating problem and no ask, and the entry is kept. An entry with `$comment` gives no problem. A key containing U+0085, U+2028 or U+2029 appears escaped as `\uXXXX` in the warning text.
  - Evidence: passing "should report a misspelled When key / an unknown paths key as one advisory problem with no ask", "should keep an entry with an unknown key (ESP-72)", "should allow a $comment key in an entry", "should report an unknown key on an entry that has no agent as well" and "should escape U+0085, U+2028 and U+2029 in an unknown key so the warning stays on one line"; mutations 1, 2, 7 and 8 CAUGHT (shown, 2026-10-18T02:00Z)
- AC4: Valid entries still give no config problem, and the existing ESP-67 guard tests and `plugin-structure.test.mjs` still pass.
  - Evidence: "should report no config problem for a missing planning, an empty list or valid entries" and all ESP-67 tests pass (29 of 29 in the preflightReviewers filter); full gate tests step PASS (shown, 2026-10-18T02:00Z)
- AC5: The README "Config problems" list and `planning` config row describe the new checks, and a Versioning row records the change. `approve-plan` says that an `agent` with a control character or surrounding spaces is invalid, that a skipped entry is named by its index (`planning.preflightReviewers[i]`) and never by its raw name, and that a pre-flight reviewer receives only the draft plan. A structure assertion covers the index wording.
  - Evidence: README.md config row, "Config problems" list and 0.18.1 row edited; SKILL.md lines 42–44 edited; `plugin-structure.test.mjs` passing "should treat a padded or control-character agent as invalid and name a skipped entry by its index, not its name (ESP-72)" and "should give each pre-flight reviewer only the draft plan (ESP-72)" (shown, 2026-10-18T02:00Z)
- AC6: `node plugins/usiatech-engineering/skills/verify/gate.mjs` prints Gate: PASS.
  - Evidence: repo runner printed Gate: PASS at 2026-10-18T01:37:04Z, after the last code edit (the mutation runner restored the file byte for byte); installed 0.18.0 runner Gate: PASS at 2026-10-18T01:45:58Z and again at 2026-10-18T02:00:29Z, after the 01:46:49Z no-op rewrite of the changed files (a 01:55Z run failed only on the load-sensitive after-Bash timing test, which passed on its own) (shown, 2026-10-18T02:00Z)

## Tasks
- [x] T1: Write the failing guard tests first (tdd): agent control character (C0 and U+2028), agent with a leading or trailing space, `when: null`, unknown key, `$comment` allowed, escaped U+2028 key in the warning, bad entry dropped while the others are kept (covers AC1–AC4; ESP-72)
- [x] T2: Extend `checkPlanning`: reject `hasControlChar(agent)` or `agent !== agent.trim()`; report `when === null` and delete it from a copy of the entry; report each key other than `agent`, `when` and `$comment`, quoted with `JSON.stringify` and with U+0085, U+2028 and U+2029 escaped (covers AC1–AC3; ESP-72)
- [x] T3: Update the README config row, the "Config problems" list and the Versioning row. Update the approve-plan invalid-entry sentence (name rule, index naming) and add the draft-plan-only sentence. Add a structure assertion for the index wording (covers AC5; ESP-72)
- [x] T4: Run the gate and suggest a mutation-test run on `checkPlanning` (covers AC6; ESP-72)

## Files
- `plugins/usiatech-engineering/hooks/scripts/governance-policy.mjs`
- `plugins/usiatech-engineering/tests/governance-policy.test.mjs`
- `plugins/usiatech-engineering/tests/plugin-structure.test.mjs`
- `plugins/usiatech-engineering/README.md`
- `plugins/usiatech-engineering/skills/approve-plan/SKILL.md`

## Commands and actions
- None beyond the gate and an optional mutation-test run (which restores files byte for byte).

## Out of scope
- Unknown keys directly under `planning` (only entry keys are checked)
- A name pattern or length cap on `agent`
- Trimming a padded `agent` (it is dropped, as ESP-67 drops other bad entries)
- Changing `oneLine` in `governance-rules.mjs`
- The version bump in `plugin.json` (done in the develop→main release PR)
- Spec changes

## Approved
- By: Francis · Date: 2026-10-17
- Route: small (cites ESP-72 and spec R9/R12; 5 files; no new skill, module or public interface)

## Change log
- 2026-10-17: Governance pre-flight FLAG. Francis accepted all four recommended defaults:
  - (1) approve-plan applies the agent-name rule and names skipped entries by index; `plugin-structure.test.mjs` added to Files.
  - (2) `$comment` is allowed in entries.
  - (3) A padded agent is dropped, not trimmed.
  - (4) Unknown keys are quoted with `JSON.stringify`, with U+0085, U+2028 and U+2029 escaped by hand, because `JSON.stringify` leaves them raw (checked with node).
- 2026-10-17: Release review round. Stage 1 governance FLAG:
  - (1) Evidence stamps predated a 01:46:49Z rewrite of the 5 files, which was the no-op escaping script. Resolved: the gate re-ran (PASS at 02:00:29Z) and AC1–AC6 were restamped.
  - (2) Three ask actions in the governance log (00:55Z guard probe of a force-push string, 00:58Z `rm -rf` in a scratchpad, 01:13Z `docs/audits/` write) came from another session (the ponytail audit). Francis: record them as not part of this change. `docs/audits/` stays out of the commit, and nothing was pushed.
- 2026-10-17: Stage 2: convention, silent-failure and security all PASS. Francis chose to list the nits in the PR and file one follow-up (ESP-73): agent-name allowlist for bidi and format characters, DEL in `quoteKey`, the shared code-point list, the unused `when` binding and the doc-comment wording.
- 2026-10-17: mutation-test: 8 of 8 CAUGHT on `checkPlanning`.

## Final status
- Shipped on branch `feature/esp72-preflight-entry-checks` (PR to develop).
- AC1–AC6: all shown (2026-10-18T02:00Z).
- Deviations: `plugin-structure.test.mjs` was added to Files at pre-flight (Change log (1)). Otherwise none.
