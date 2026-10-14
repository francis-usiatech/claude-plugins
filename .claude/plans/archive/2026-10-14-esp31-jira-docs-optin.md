# Plan: ESP-31 Jira tracker ADR, docs and this repo's opt-in

**Final status:** shipped (partial: AC5 / spec AC10 dry run deferred by Francis) · Branch: `feature/esp31-jira-docs-optin` · Closed: 2026-10-14

## Goal
Record the decision to send ticket data to Jira with a user token as ADR-0003, document the Jira tracker in the plugin README and `templates/engineering.json`, and turn the Jira tracker on for this repo (project ESP). This is the last sub-task of ESP-27 and unblocks the develop → main release.

## Requirement references
- Spec `docs/specs/2026-10-09-jira-ticket-tracker.md` (Status: approved): R6 (wording only), R9, R10, AC9, AC10
- Jira: ESP-31 (sub-task of ESP-27)

## Acceptance criteria
- AC1 (spec AC9): `docs/adr/0003-jira-ticket-tracker.md` exists with `Status: Accepted`; `grep -n tracker` finds the Jira setup (the `tickets` key, `JIRA_EMAIL` / `JIRA_API_TOKEN` / `JIRA_SITE`, failure behaviour) in `plugins/usiatech-engineering/README.md` and `plugins/usiatech-engineering/templates/engineering.json`; the README's Design records table lists ADR 0003 and the spec.
  - Evidence: ADR line 3 `Status: Accepted (Francis, 2026-10-14)`; `grep -c tracker`: README 7, template 2 after the review fixes; Design records rows for the spec and ADR 0003 present (shown, 2026-10-14T22:24Z)
- AC2 (spec AC10, config part): this repo's `.claude/engineering.json` has `tickets.tracker` `"jira"`, `jira.site` `https://usiatech.atlassian.net`, project `ESP`, issueType `Subtask`, parent `ESP-27`, statuses started=`In Progress`, merged=`Ready for Release`, released=`Released`; `node plugins/usiatech-engineering/scripts/jira-tracker.mjs check` exits 0 and prints the parsed section (no config problem).
  - Evidence: `jira-tracker.mjs check` exit 0, printed tracker jira, site https://usiatech.atlassian.net, ESP, Subtask, parent ESP-27, the three statuses (shown, 2026-10-14T22:05Z; exit 0 again at 22:24Z)
- AC3 (spec R6 wording): spec R6 says approve-plan moves "the Jira keys named by the plan's tasks" (not every key in the requirement references), with a dated Change log line recording Francis's ESP-30 decision.
  - Evidence: spec R6 reads "the Jira keys named by the recorded plan's tasks"; Change log line dated 2026-10-14 ends "Approved by Francis." (shown, 2026-10-14T22:16Z)
- AC4: `templates/engineering.json` is still valid JSON and the gate (`node plugins/usiatech-engineering/skills/verify/gate.mjs`) passes.
  - Evidence: template JSON.parse ok; template `check` exit 0 (github); Gate: PASS at 2026-10-14T22:23:00Z after the last review fix (tests 152 s, both validates, fake-pass) (shown)
- AC5 (spec AC10, dry-run part) — DEFERRED by Francis 2026-10-14: `JIRA_EMAIL` / `JIRA_API_TOKEN` are not set in this shell. The read-only `find-transition` run against ESP-22 for each configured status is left as a manual step for Francis.
  - Evidence: not shown (deferred by Francis; no Jira credentials in shell)

## Tasks
- [x] T1: Write `docs/adr/0003-jira-ticket-tracker.md` (context, decision, consequences: token only from env, trusted host rule R11, no retries, fail-loud, ticket text leaves the repo) in the ADR 0002 format, Status Accepted (covers AC1; ESP-31)
- [x] T2: Plugin README: add a `tickets` row to the per-repo config table and a short "Jira tracker" section (config keys, env vars, failure behaviour, which skills use it); add ADR 0003 and the Jira spec to Design records (covers AC1; ESP-31)
- [x] T3: `templates/engineering.json`: add a `tickets` example (`tracker: "github"` default with a `$comment` explaining the Jira keys and env vars) (covers AC1, AC4; ESP-31)
- [x] T4: This repo's `.claude/engineering.json`: add the `tickets` section; run `jira-tracker.mjs check` (covers AC2; ESP-31)
- [x] T5: Spec: reword R6, add Change log line (covers AC3; ESP-31)
- [x] T6: Run the gate (covers AC4)
- [x] T7: Commit and open the PR into `develop`

## Files
- `docs/adr/0003-jira-ticket-tracker.md`
- `plugins/usiatech-engineering/README.md`
- `plugins/usiatech-engineering/templates/engineering.json`
- `.claude/engineering.json`
- `docs/specs/2026-10-09-jira-ticket-tracker.md`
- `.claude/plans/archive/2026-10-14-esp31-jira-docs-optin.md`

## Commands and actions
- `node plugins/usiatech-engineering/scripts/jira-tracker.mjs check` (reads config only; sends nothing)
- `node plugins/usiatech-engineering/skills/verify/gate.mjs` (the gate: `npm test`, `claude plugin validate`)
- Jira MCP: ESP-31 moved to In Progress (done), later Ready for Release on merge

## Out of scope
- AC10 live dry run (deferred, manual for Francis)
- Confirming the Blocks link direction with a live link
- ESP-61 (CI `DEFAULT_REF_PATTERN` for Jira keys)
- ESP-28/29/30 nits; version bump and develop → main release (separate release step)

## Approved
- By: Francis · Date: 2026-10-14
- Route: small (spec is `Status: approved`; 5 work files; no new skill, module or public interface)

## Change log
- 2026-10-14: AC10 dry run deferred (no Jira credentials in shell); config uses Subtask with parent ESP-27. Francis.
- 2026-10-14: Spec R6 rewording added (R6 belongs to ESP-30): only the Jira keys named by the plan's tasks move to started, per Francis's ESP-30 decision. Francis.
- 2026-10-14: Governance pre-flight PASS; AC5/AC10 dry run to be archived as "not shown" and noted in the ESP-27 release notes.
- 2026-10-14: Release review. Governance, convention, silent-failure and security all passed; the security-reviewer launch was refused once by the auto-mode classifier and retried with Francis's approval. Francis approved three wording fixes: the ADR's host-rule claim (any `*.atlassian.net` tenant passes unless `JIRA_SITE` pins the host), the README's "unknown keys are ignored", and "Approved by Francis" on the spec line. He also approved follow-up ESP-62 to reject unknown keys in the script. The governance-only re-review of the fixes passed; its stale-evidence flag was cleared by the gate PASS at 22:23:00Z.

## Deviations
- AC5 / spec AC10 dry run not run (deferred by Francis).
- First gate re-run after the review fixes failed only on the timing test `bash-workflow-timing.perf.mjs` (medians of 183–455 ms against a 100 ms limit) while a reviewer agent was running; it passed when run on its own at 22:23:00Z. No code was changed.
