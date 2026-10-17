---
name: approve-plan
description: Records the plan the user has approved as .claude/plans/active.md, with measurable acceptance criteria and a task list, so governance can check scope and completion, and closes it when the work ships. Routes large work through clarify → to-spec → to-tickets first. Use when the user asks to plan a piece of work ("plan this", "make a plan"), right after the user approves a plan ("yes", "proceed", "approved"), when the user says "update the plan" or "change scope", or when work is finished ("close the plan").
---

# Approve, update or close a plan

The approved plan is the scope baseline. The governance guard asks for confirmation on any file edit outside the plan's **Files** list. The `governance-reviewer` agent checks the finished diff against it. Because the plan sets the scope, the guard also asks before every write to `.claude/plans/active.md`, so expect a confirmation prompt when you record or update it. A repo that sets `governance.planEdits` to `"all"` in `.claude/engineering.json` turns that prompt off for `active.md` and `.claude/plans/archive/`; each write is still logged as trusted. The trade-off: the governance-reviewer's check for scope added without a dated Change log line is then the only scope check on plan changes, so still add a dated Change log line for every scope change.

Before routing, if `.claude/plans/active.md` already exists and is unfinished, ask whether to close it or replace it. Settle this first, so no clarify or spec work is spent while another plan is in progress.

## Route (before drafting)
Pick the route and tell the user which rule decided it.
- **Small**, when all of these hold:
  - the work cites an existing requirement reference (intent §, capability ID, FR/AC, ADR, spec, `#issue`, or a Jira key such as `ESP-24`). A spec counts only if it says `Status: approved`.
  - it touches 5 files or fewer
  - it adds no new skill, module, service or public interface
- **Large**, anything else. Run `clarify` → `to-spec` → `to-tickets` first. The spec path and ticket IDs become the requirement references. Add the spec path to **Files**, since the spec is committed with the work.
  - A large-route plan covers one ticket, or a set the user lists, so it matches one PR. Copy only the ACs those tickets cover, with their spec IDs.
  - Each remaining ticket gets its own plan after the previous one closes.
- The user can say "treat as small" or "treat as large". Record the override in the Change log. An override changes the route, not the rule that every plan needs a requirement reference: "treat as small" with no reference still needs one before the plan is recorded.

## Record
1. Draft the plan from `${CLAUDE_PLUGIN_ROOT}/templates/plan.md`:
   - **Goal:** one or two sentences.
   - **Requirement references:** the intent sections, capability IDs, FR/AC numbers, ADRs, D-items, spec path and issues (`#NN` or Jira keys) this work implements. Every plan needs at least one. If there isn't one, tell the user the work has no requirement basis and offer the large route.
   - **Pre-plan checklist:** answer each item before drafting the rest of the plan, and record the answers in the plan's Pre-plan checklist section.
     - (a) For any new validation rule or format check: the callers and test fixtures you searched.
     - (b) For any database or infrastructure mechanism the design relies on: the throwaway spike that proved it, or why none is needed.
     - (c) The docs and ADRs the work touches. List them from a search of the docs and ADRs before pre-flight, so the pre-flight reviews a real answer.
       - When a docs reviewer (a `planning.preflightReviewers` agent whose description says it reviews docs) is configured and runs, its pre-flight output answers this: add its findings to (c), labelled with the reviewer. If it fails, keep the search list and report the failure.
       - In the pre-flight report, name which reviewer was treated as the docs reviewer, or say that none was.
       - Paths named in (c) don't widen scope: only the **Files** section does.
     - Any item can be `n/a: <reason>`; a bare `n/a` with no reason is not an answer, and the pre-flight flags it.
   - **Acceptance criteria:** AC1, AC2…, at least one. Each is measurable: an observable behaviour, a command and its expected result, or a metric. Rewrite vague ones ("works well", "is fast") with the user. Leave each `Evidence:` line empty; `verify` fills it.
   - **Tasks:** a checklist. Each task names the AC it covers and its ticket (`#NN`, a Jira key, or spec `T1`). Paths mentioned in tasks don't widen scope: only the **Files** section does.
   - **Files:** every path or glob to create or change (backticked, one per bullet). Keep globs as narrow as practical.
   - **Commands and actions:** any risky action the plan needs (migrations, dependency adds, deploys). Only include those the user agreed to.
   - **Out of scope:** what this plan explicitly doesn't do.
   - **Approved:** the user's name and today's date, and `Route: small` or `Route: large` with the rule that decided it.
2. Run the `governance-reviewer` agent on the draft in pre-flight mode. On the large route it also checks the plan against the spec and tickets. Fix a `BLOCK` before going on; a `FLAG` needs the user's decision, recorded in the plan's change log.
   - **Pre-flight reviewers:** run each agent listed in `.claude/engineering.json` → `planning.preflightReviewers` on the draft in design mode, in parallel with `governance-reviewer`. Give each one the draft plan and ask for `PASS`, `FLAG` or `BLOCK` with findings.
     - Each entry is `{ "agent": "<name>", "when": ["<prefix>", …] }`. An entry with `when` runs only when one of its path prefixes matches the start of a path in the plan's **Files** section; an entry without `when` always runs.
     - An invalid entry (no non-empty string `agent`, or a bad `when`) is skipped and named in the pre-flight report. The guard has already warned about it once.
     - A reviewer that fails or isn't installed is reported by name and does not count as a pass.
     - A `BLOCK` from any pre-flight reviewer must be fixed before going on, as with `governance-reviewer`.
   - Combine the `BLOCK`s and `FLAG`s from every pre-flight reviewer, each labelled with the reviewer that raised it. Fix the `BLOCK`s, then put every open pre-flight decision (each `FLAG` and any scope question) into one question, with a recommended default for each item. When `.claude/engineering.json` sets `decisions.batch` to `false`, ask about each one on its own instead.
3. Show the draft and the pre-flight verdict. After the user confirms, write `.claude/plans/active.md` and show it in one short message. Don't write `.claude/plans/active.md` while a Pre-plan checklist item is empty, still the template placeholder or a bare `n/a`: fix the item first.
4. **Jira tracker only:** mark the plan's tickets started.
   - When `.claude/engineering.json` exists, run `node "${CLAUDE_PLUGIN_ROOT}/scripts/jira-tracker.mjs" check` from the repo root.
   - Skip this step when there's no config file, when `check` prints `"tracker":"github"`, or when `jira.statuses` in its output has no `started`. Say why you skipped it.
   - A non-zero exit from `check` (2 is a config problem) is a failure to report, not a reason to skip.
   - The keys are the Jira tickets the plan's tasks name. A parent or blocker key that appears only in the requirement references is not moved. If the tasks name no Jira key, say so.
   - For each key: `node "${CLAUDE_PLUGIN_ROOT}/scripts/jira-tracker.mjs" transition --issue <KEY> --event started`.
   - A non-zero exit doesn't undo the plan. Report each failed key with the script's message as one the user must fix, and go on with the other keys.

## Update (scope change)
When new work falls outside the plan:
1. Stop and explain what's needed and why.
2. After the user approves, add the new files, actions, acceptance criteria or tasks, with a dated Change log line.
3. Never widen the plan silently or with broad globs such as `**`.

## Close (work shipped or abandoned)
Close a shipped plan in the same PR as the work: `release` does it as the last step before the commit, after the reviews, so no follow-up PR is needed.
1. Move the file to `.claude/plans/archive/YYYY-MM-DD-<short-slug>.md`.
2. Add the final status (shipped, partial or abandoned), the branch name (the commit hash isn't known yet when the archive goes into the same commit; use the commit or PR reference when closing after the fact), each acceptance criterion with its final evidence status, and any deviations.
3. Archived plans are committed for traceability. A detail that is not known before the merge (PR number, tag, Jira status) is added in a later PR only if it's needed. `active.md` itself is never committed.
