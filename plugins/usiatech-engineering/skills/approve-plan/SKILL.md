---
name: approve-plan
description: Records the plan the user has approved as .claude/plans/active.md so governance can check scope, and closes it when the work ships. Use right after the user approves a plan ("yes", "proceed", "approved"), when the user says "update the plan" or "change scope", or when work is finished ("close the plan").
---

# Approve, update or close a plan

The approved plan is the scope baseline. The governance guard asks for confirmation on any file edit outside the plan's **Files** list. The `governance-reviewer` agent checks the finished diff against it.

## Record (after the user approves)
1. If `.claude/plans/active.md` already exists and is unfinished, ask whether to close it or replace it.
2. Write `.claude/plans/active.md` using `${CLAUDE_PLUGIN_ROOT}/templates/plan.md`:
   - **Goal:** one or two sentences.
   - **Requirement references:** the intent sections, capability IDs, FR/AC numbers, ADRs and D-items this work implements. Every plan needs at least one reference. If there isn't one, tell the user the work has no requirement basis and ask how to proceed.
   - **Files:** every path or glob to create or change (backticked, one per bullet). Keep globs as narrow as practical.
   - **Commands and actions:** any risky action the plan needs (migrations, dependency adds, deploys). Only include those the user agreed to.
   - **Out of scope:** what this plan explicitly doesn't do.
   - **Approved by / date:** the user's name and today's date.
3. Show the recorded plan in one short message.

## Update (scope change)
When new work falls outside the plan:
1. Stop and explain what's needed and why.
2. After the user approves, add the new files or actions under **Files** / **Commands and actions**, with a dated "Change log" line.
3. Never widen the plan silently or with broad globs such as `**`.

## Close (work shipped or abandoned)
1. Move the file to `.claude/plans/archive/YYYY-MM-DD-<short-slug>.md`.
2. Add the final status (shipped, partial or abandoned), the commit/PR reference and any deviations.
3. Archived plans are committed for traceability. `active.md` itself is never committed.
