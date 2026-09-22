# Governance rules (repo-specific)

Extra rules the `governance-reviewer` agent enforces in addition to AGENTS.md, intent/ADRs and the approved plan. Keep each rule short, testable and bulleted. Machine-checkable command rules go in `.claude/engineering.json` → `governance.denyCommands` / `askCommands`.

## Must never
- <e.g. call an external AI API from application code before ADR-0007's trigger is met>

## Must always
- <e.g. every new endpoint has a cross-tenant test>

## Needs explicit approval
- <e.g. any change to authentication or RLS policies>
