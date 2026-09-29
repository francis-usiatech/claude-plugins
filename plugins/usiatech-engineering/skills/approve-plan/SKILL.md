---
name: approve-plan
description: Records the plan the user has approved as .claude/plans/active.md, with measurable acceptance criteria and a task list, so governance can check scope and completion, and closes it when the work ships. Routes large work through clarify → to-spec → to-tickets first. Use when starting work that has no plan yet, right after the user approves a plan ("yes", "proceed", "approved"), when the user says "update the plan" or "change scope", or when work is finished ("close the plan").
---

# Approve, update or close a plan

The approved plan is the scope baseline. The governance guard asks for confirmation on any file edit outside the plan's **Files** list. The `governance-reviewer` agent checks the finished diff against it. Because the plan sets the scope, the guard also asks before every write to `.claude/plans/active.md`, so expect a confirmation prompt when you record or update it.

## Route (before drafting)
Pick the route and tell the user which rule decided it.
- **Small**, when all of these hold:
  - the work cites an existing requirement reference (intent §, capability ID, FR/AC, ADR, spec, `#issue`)
  - it touches 5 files or fewer
  - it adds no new skill, module, service or public interface
- **Large**, anything else. Run `clarify` → `to-spec` → `to-tickets` first. The spec path and ticket IDs become the requirement references, and the spec's acceptance criteria are copied into the plan with their IDs.
- The user can say "treat as small" or "treat as large". Record the override in the Change log.

## Record
1. If `.claude/plans/active.md` already exists and is unfinished, ask whether to close it or replace it.
2. Draft the plan from `${CLAUDE_PLUGIN_ROOT}/templates/plan.md`:
   - **Goal:** one or two sentences.
   - **Requirement references:** the intent sections, capability IDs, FR/AC numbers, ADRs, D-items, spec path and issues this work implements. Every plan needs at least one. If there isn't one, tell the user the work has no requirement basis and offer the large route.
   - **Acceptance criteria:** AC1, AC2…, at least one. Each is measurable: an observable behaviour, a command and its expected result, or a metric. Rewrite vague ones ("works well", "is fast") with the user. Leave each `Evidence:` line empty; `verify` fills it.
   - **Tasks:** a checklist. Each task names the AC it covers and its ticket (`#NN` or spec `T1`). Paths mentioned in tasks don't widen scope: only the **Files** section does.
   - **Files:** every path or glob to create or change (backticked, one per bullet). Keep globs as narrow as practical.
   - **Commands and actions:** any risky action the plan needs (migrations, dependency adds, deploys). Only include those the user agreed to.
   - **Out of scope:** what this plan explicitly doesn't do.
   - **Approved:** the user's name and today's date, and `Route: small` or `Route: large` with the rule that decided it.
3. Run the `governance-reviewer` agent on the draft in pre-flight mode. On the large route it also checks the plan against the spec and tickets. Fix a `BLOCK` before going on; a `FLAG` needs the user's decision.
4. Show the draft and the pre-flight verdict. After the user confirms, write `.claude/plans/active.md` and show it in one short message.

## Update (scope change)
When new work falls outside the plan:
1. Stop and explain what's needed and why.
2. After the user approves, add the new files, actions, acceptance criteria or tasks, with a dated Change log line.
3. Never widen the plan silently or with broad globs such as `**`.

## Close (work shipped or abandoned)
1. Move the file to `.claude/plans/archive/YYYY-MM-DD-<short-slug>.md`.
2. Add the final status (shipped, partial or abandoned), the commit/PR reference, each acceptance criterion with its final evidence status, and any deviations.
3. Archived plans are committed for traceability. `active.md` itself is never committed.
