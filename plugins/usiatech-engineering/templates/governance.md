# Governance rules (repo-specific)

Extra rules the `governance-reviewer` agent enforces in addition to AGENTS.md, intent/ADRs and the approved plan. Keep each rule short, testable and bulleted. Machine-checkable command rules go in `.claude/engineering.json` → `governance.denyCommands` / `askCommands`.

## Must never
- <e.g. call an external AI API from application code before ADR-0007's trigger is met>

## Must always
- <e.g. every new endpoint has a cross-tenant test>

## Needs explicit approval
- <e.g. any change to authentication or RLS policies>

## Standing decisions
Decisions the repo has already made. `governance-reviewer` reports a matching FLAG as "FLAG, settled by SD-n", with no user decision. It honours at most 10 entries. A standing decision never settles a BLOCK, an Important finding, a must-never or needs-approval rule, a guard error or missing AC evidence.
- SD-1: A pre-flight fix that only makes wording more precise (no new file, AC, task, command or action) is applied with one dated Change log line and shown with the plan, without a separate decision. Owner: <name> · Date: <YYYY-MM-DD>
