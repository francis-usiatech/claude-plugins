# Plan: Map `verified` to In Testing in this repo (ESP-71)

## Goal
Opt this repo into the `verified` status event shipped in 0.17.0, so a passing verify run moves its plan's Jira ticket to In Testing.

## Requirement references
- docs/specs/2026-10-16-delivery-speedup.md (Status: approved) · R20 (`verified` mapping part) · AC14 (this repo's config part)
- ESP-71 (sub-task of ESP-63; blocker ESP-64 is Released, plugin 0.17.0 installed)

## Acceptance criteria
- AC1: `.claude/engineering.json` has `tickets.jira.statuses.verified` = "In Testing", and the other three mappings are unchanged.
  - Evidence: `git diff` shows the single added line `"verified": "In Testing"`; started/merged/released unchanged; `check` output lists all four (shown, 2026-10-17T02:30Z)
- AC2: `node <installed 0.17.0>/scripts/jira-tracker.mjs check` run from the repo root exits 0 and its output lists `"verified":"In Testing"`.
  - Evidence: 0.17.0 `jira-tracker.mjs check` → exit=0, statuses `{"started":"In Progress","verified":"In Testing","merged":"Ready for Release","released":"Released"}` (shown, 2026-10-17T02:30Z)
- AC3: A verify run (plugin 0.17.0 loaded) that passes with all ACs shown moves the plan's ticket to In Testing. Deferred (Francis, 2026-10-16): shown on the first 0.17.0 verify run (ESP-65 or ESP-67). Until then ESP-71 is moved to In Testing only (not Ready for Release or later) via the Atlassian connector.
  - Evidence: deferred by decision; this session's verify skill is 0.16.1 (no Jira step) and no Jira credentials in the shell (not shown, 2026-10-17T02:30Z)

## Tasks
- [x] T1: Add `"verified": "In Testing"` to `tickets.jira.statuses` in `.claude/engineering.json` (covers AC1; ESP-71)
- [x] T2: Run the installed 0.17.0 `jira-tracker.mjs check` and record its output (covers AC2; ESP-71)
- [x] T3: Run verify; move ESP-71 to In Testing via the connector and record AC3 as deferred (covers AC3; ESP-71)

## Files
- `.claude/engineering.json`
- `.claude/plans/archive/2026-10-16-esp71-verified-mapping.md`

## Commands and actions
- None beyond the standard gate. No version bump (config-only, not part of the shipped plugin).

## Out of scope
- `.claude/governance.md` SD-1 (other half of R20) — ESP-68.
- Setting `JIRA_EMAIL` / `JIRA_API_TOKEN` in Claude's environment.
- Any plugin code, skill or README change.

## Approved
- By: Francis · Date: 2026-10-16
- Route: small (cites approved spec + ESP-71; 1 file; no new skill, module or interface)

## Change log
- 2026-10-16: Plan drafted from ESP-71.
- 2026-10-16: Pre-flight FLAG on AC3 (0.16.1 skills loaded, no Jira credentials). Francis chose to defer AC3 to the first 0.17.0 verify run; ESP-71 moves to In Testing only via the connector.
- 2026-10-17: Closed. Status: shipped (partial AC3, deferred by decision).

## Final status
- Status: shipped · Branch: `chore/esp71-verified-mapping`
- AC1: shown (2026-10-17T02:30Z)
- AC2: shown (2026-10-17T02:30Z)
- AC3: not shown, deferred by Francis to the first 0.17.0 verify run (ESP-65 or ESP-67). ESP-71 was moved to In Testing via the Atlassian connector.
- Reviews: governance, convention, silent-failure, security all PASS (stage 1 and 2 in parallel: 1 file, in plan).
- Deviations: AC3 deferred (see Change log). Note from silent-failure review: any session still on plugin 0.16.1 now fails every Jira `check` loudly (exit 2) until it runs 0.17.0.
