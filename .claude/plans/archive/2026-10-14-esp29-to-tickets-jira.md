# Plan: to-tickets files in Jira; Jira keys as references (ESP-29)

## Goal
With `tickets.tracker` set to `"jira"`, the `to-tickets` skill files a spec's tickets in Jira through `scripts/jira-tracker.mjs`, and `clarify` and `approve-plan` accept Jira keys such as `ESP-24` as requirement references.

## Requirement references
- Spec `docs/specs/2026-10-09-jira-ticket-tracker.md` (Status: approved): R5, R8, AC5, AC8
- Jira ESP-29 (sub-task of ESP-27); blocker ESP-28 merged in PR #100

## Acceptance criteria
- AC1 (spec AC5, R5): `skills/to-tickets/SKILL.md` gives the Jira path. It reads the tracker with `jira-tracker.mjs check` before confirming. It names the `create` and `link` script calls in blocker order (`--summary`, `--body-file` in the scratchpad, `--blocker`/`--blocked`), lists the keys in the spec's `## Tickets` section, and on the first non-zero exit stops and reports the tickets created, the links made and what was not done. It also says the GitHub path stays the default. `grep -n tracker skills/to-tickets/SKILL.md` finds the Jira path.
  - Evidence: grep -n tracker skills/to-tickets/SKILL.md finds 9 lines: tracker check (step 1.4), Jira create/link in blocker order, Tickets-section keys, stop-and-report rule; GitHub stays default (shown, 2026-10-14T17:53:18Z)
- AC2 (spec AC8, R8): `skills/clarify/SKILL.md` and `skills/approve-plan/SKILL.md` name Jira keys (e.g. `ESP-24`) as valid requirement references, alongside `#NN`. `grep -n "ESP-24" skills/clarify/SKILL.md skills/approve-plan/SKILL.md` finds both.
  - Evidence: grep ESP-24 finds clarify/SKILL.md:11 and approve-plan/SKILL.md:15; plan template shows a Jira key example (shown, 2026-10-14T17:53:18Z)
- AC3: The verification gate passes (`node skills/verify/gate.mjs`: npm test, both `claude plugin validate` steps and the fake-pass check).
  - Evidence: Gate: PASS at 2026-10-14T17:53:18Z: tests pass, validate marketplace, validate plugin, fake-pass check (shown, 2026-10-14T17:53:18Z)
## Tasks
- [x] T1: Add the Jira path to `to-tickets`: the tracker check in step 1.4, the filing steps in section 2, the Tickets-section format with keys, and the stop-and-report rule; update the description so it says Jira (covers AC1; ESP-29)
- [x] T2: Name Jira keys as requirement references in `clarify` (accept the key; for its text, use a Jira tool already in the session or ask the user; no new script command) and in `approve-plan` (route rule, Record step, ticket per task) (covers AC2; ESP-29)
- [x] T3: Add a Jira key example to the requirement-references line of `templates/plan.md`, so drafted plans show it (covers AC2; ESP-29)
- [x] T4: Run the gate (covers AC3)

## Files
- `plugins/usiatech-engineering/skills/to-tickets/SKILL.md`
- `plugins/usiatech-engineering/skills/clarify/SKILL.md`
- `plugins/usiatech-engineering/skills/approve-plan/SKILL.md`
- `plugins/usiatech-engineering/templates/plan.md`
- `.claude/plans/archive/2026-10-14-esp29-to-tickets-jira.md`

## Commands and actions
- None beyond the gate. No live Jira calls; nothing is filed in Jira by this work.

## Out of scope
- Transitions in `approve-plan` and `release`, and the commit-message key helper (ESP-30, R6, R7, AC6, AC7).
- ADR-0003, README, `templates/engineering.json` and this repo's opt-in (ESP-31, R9, R10).
- The CI governance check's default reference pattern (`templates/github/scripts/governance-checks.mjs`), which does not match Jira keys. A repo can set `governance.requirementRefPattern`. The spec's R8 names only the skills. If wanted, ticket it separately.
- The ESP-28 review nits listed in PR #100.
- Confirming the Blocks link direction with a live link: that needs this repo's opt-in (ESP-31).

## Approved
- By: Francis · Date: 2026-10-14
- Route: small (cites the approved spec and ESP-29; 4 files plus the archive; adds no skill, module or public interface)

## Change log
- 2026-10-14: plan recorded. Pre-flight FLAG 1 (clarify can't read a Jira issue through the script) resolved with option (a): accept the key only, and add no script command. Approved by Francis.
- 2026-10-14: release review. Governance, security and convention PASS; silent-failure flagged a blocking finding (a create that times out may have filed the issue). Fixed in to-tickets: unknown-may-exist rule, keys written to the spec as soon as each is created, check always runs and any non-zero exit stops. Governance-only re-review PASS.
- 2026-10-14: Francis chose to fix the security nit now: titles are single-quoted in both create commands, with a Rules line on escaping. Governance-only re-review PASS. Francis approved retrying the convention review after the classifier refused its first launch.

## Final status
- Shipped on branch feature/esp29-to-tickets-jira, one commit, PR into develop.
- AC1 shown, AC2 shown, AC3 shown (gate PASS 2026-10-14T17:53:18Z).
- Deviations: none in scope. Follow-up ESP-61 filed (CI reference pattern accepts Jira keys).
