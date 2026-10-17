# Plan: `verified` status event, moved by verify (ESP-64)

## Goal
The Jira tracker gets a `verified` event, and the `verify` skill moves the plan's Jira tickets to it when the gate passes and every acceptance criterion is shown. HEIL maps it to In Testing.

## Requirement references
- `docs/specs/2026-10-16-delivery-speedup.md`: R1, R2, R19 (P1 part); AC1, AC2, AC3, AC14 (P1 part), AC15. R20's `verified` mapping is deferred (see Change log).
- ESP-64 (sub-task of ESP-63)
- ADR-0003 (Jira tracker failure rules)

## Acceptance criteria
- AC1 (spec AC1): Tests in `jira-tracker.test.mjs` show two things:
  - config validation accepts `statuses.verified: "In Testing"`, which appears in the loaded `statuses`;
  - an unknown event name is still rejected, with a message that lists `verified` among the events.
  - Evidence: jira-tracker.test.mjs: "should accept a verified status and keep it in the loaded statuses (ESP-64)" and "should list verified among the events when an event name is unknown (ESP-64)" pass (113/113; red first: 4 failing before T2) (shown, 2026-10-17T01:01Z)
- AC2 (spec AC2): The `transition` path and the new verify step behave as follows.
  - Tests in `jira-tracker.test.mjs` show that `transition --issue <KEY> --event verified`:
    - posts the transition to the mapped status and returns `transitioned: true`;
    - with no `verified` mapping, returns `transitioned: false` with the reason `no status is configured for "verified"` and sends no request.
  - `skills/verify/SKILL.md` has a step that moves the plan's task keys to `verified` only when the gate passed and every AC is `shown`.
  - The step says when it is skipped, and why: no config, the GitHub tracker, no `verified` status, no `.claude/plans/active.md`, no `## Acceptance criteria` section, or any AC not shown.
  - It says a non-zero `check` exit is a failure to report, not a reason to skip.
  - It follows the `started` failure rules: each failed key is reported, the other keys are still moved, nothing is retried silently and nothing is undone.
  - Evidence: jira-tracker.test.mjs: "should move an issue to the verified status through the matching transition (ESP-64)" and "should skip a transition to verified when no verified status is configured, sending nothing (ESP-64)" pass; skills/verify/SKILL.md step 8 states the trigger, the six skip cases, the check-failure rule and the started failure rules (convention and silent-failure reviewers confirmed) (shown, 2026-10-17T01:01Z)
- AC3 (spec AC3, with the deviation in the Change log): The new verify step is walked through by hand, once the gate passes and AC1, AC2, AC4 and AC5 are shown.
  - The step's trigger is checked by hand: Gate: PASS, and all other ACs `shown`.
  - ESP-64 is moved to In Testing through the Atlassian connector (amended 2026-10-16: the Jira credentials aren't in the shell, so the script isn't run).
  - The status is then read through the Atlassian connector. The script's `transition --event verified` path is covered by AC2's tests.
  - Evidence: Gate: PASS at 2026-10-17T00:56:44Z with AC1, AC2, AC4, AC5 shown; ESP-64 moved via Atlassian connector (transition 31) and read back: status "In Testing" (shown, 2026-10-17T01:01Z)
- AC4 (spec AC14, P1 part): The docs name the new event.
  - The README "Jira tracker" section shows `verified` in the example `statuses`, and its "What the skills do" list says verify moves keys to `verified`.
  - The `tickets` `$comment` in `templates/engineering.json` lists `verified` and names verify among the skills.
  - The header comment of `jira-tracker.mjs` names verify among the skills.
  - Evidence: README.md:70 example statuses include "verified": "In Testing"; README.md:80 verify bullet; templates/engineering.json:57 comment names verify and verified; jira-tracker.mjs:2 header names verify (shown, 2026-10-17T01:01Z)
- AC5 (spec AC15): The gate (`node plugins/usiatech-engineering/skills/verify/gate.mjs`) prints `Gate: PASS`.
  - Evidence: gate.mjs: tests PASS (104 s), validate marketplace PASS, validate plugin PASS, fake-pass check PASS, Gate: PASS at 2026-10-17T00:56:44Z (shown, 2026-10-17T01:01Z)
## Tasks
- [x] T1: Write failing tests in `jira-tracker.test.mjs` for `verified` validation and the `transition --event verified` paths (covers AC1, AC2; ESP-64)
- [x] T2: Add `verified` to `EVENTS` in `scripts/jira-tracker.mjs`, between `started` and `merged`, and name verify in its header comment (covers AC1, AC2, AC4; ESP-64)
- [x] T3: Add the Jira step to `skills/verify/SKILL.md` after the AC check (step 7), with the trigger, the skip cases, the `check`-failure rule and the failure rules (covers AC2; ESP-64)
- [x] T4: Update the README "Jira tracker" section and the `templates/engineering.json` comment (covers AC4; ESP-64)
- [x] T5: Commit the spec with this PR. Run the reviews, then the gate, then the hand walk-through of AC3 (covers AC3, AC5; ESP-64)

## Files
- `plugins/usiatech-engineering/scripts/jira-tracker.mjs`
- `plugins/usiatech-engineering/tests/jira-tracker.test.mjs`
- `plugins/usiatech-engineering/skills/verify/SKILL.md`
- `plugins/usiatech-engineering/README.md`
- `plugins/usiatech-engineering/templates/engineering.json`
- `docs/specs/2026-10-16-delivery-speedup.md`

## Commands and actions
- `jira-tracker.mjs check`, which reads the config only and sends nothing.
- AC3's live Jira move of ESP-64 to In Testing, made through the Atlassian connector (amended 2026-10-16).
- A read-only status check of ESP-64 through the Atlassian connector. No hand-built `curl` with the token.

## Out of scope
- ESP-65..69 and ESP-70, which get their own plans.
- Mapping `verified` in this repo's `.claude/engineering.json` (spec R20). This waits until the plugin is updated to the release that ships `verified`, because the installed 0.16.1 rejects the unknown event.
- `--iterate` runs and the `verified` move. ESP-69 adds the rule that an iterate run never moves tickets.
- Moving tickets back when a later gate run fails (a spec non-goal).
- Editing ADR-0003. The new event follows its rules unchanged.
- The README Versioning row and the version bump. Both are added at the next develop → main release, as a minor bump under the release rule.

## Approved
- By: Francis · Date: 2026-10-16
- Route: large (the spec went through clarify → to-spec → to-tickets; 6 files, over the 5-file small-route limit)

## Change log
- 2026-10-16: Plan drafted for ESP-64, the first ticket of ESP-63.
- 2026-10-16: Pre-flight governance FLAG (2 Important, 3 Minor). Francis applied every recommended default:
  - (1) The repo `verified` mapping is deferred until after the plugin update. It was dropped from Files and AC4, and spec R20 moves to a follow-up.
  - (2) Deviation from spec AC3: the step can't fire on its own plan (AC3 is one of its ACs), so it is walked through by hand with the working-copy script and a scratch config.
  - (3) The status is read through the Atlassian connector.
  - (4) Added the no-plan and no-AC-section skip cases and the `check`-failure rule.
  - (5) verify is named in the template comment and the script header. ADR-0003 is unchanged.
- 2026-10-16: Jira changes made through the Atlassian connector this session, outside the script, because `JIRA_EMAIL` and `JIRA_API_TOKEN` aren't set in the shell. Francis approved the to-tickets mapping and the stage-1 decisions.
  - Moved ESP-63 and ESP-64 to In Progress.
  - Added comments on ESP-10, ESP-46, ESP-61 and ESP-63..69.
  - Linked ESP-67 blocks ESP-66.
- 2026-10-16: Stage-1 governance FLAG (4 items). Francis decided:
  - AC3 moves ESP-64 to In Testing through the Atlassian connector, not the working-copy script. The AC3 text above is amended to match, and the move is added to Commands and actions.
  - R20's `verified` mapping is filed as the new sub-task ESP-71, blocked by ESP-64, and recorded on ESP-64's line in the spec's Tickets section.
  - The connector moves listed above are recorded.
  - The verify skill writes the evidence.

## Final status
- Status: shipped · Branch: `feature/esp63-delivery-speedup` (PR into develop)
- AC1: shown · AC2: shown · AC3: shown (deviation: moved through the Atlassian connector, not by a verify run; see the Change log) · AC4: shown · AC5: shown
- Deviations:
  - R20's `verified` mapping was split out to ESP-71.
  - Jira changes were made through the connector, because the Jira credentials aren't set in the shell.
- Reviews:
  - Stage 1 governance: FLAG, decided by Francis (see the Change log).
  - Stage 2 convention, silent-failure and security: PASS, with nits listed in the PR.
