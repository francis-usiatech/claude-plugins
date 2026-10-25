---
name: to-tickets
description: Splits an approved spec into small tickets that each name the requirements and acceptance criteria they cover and the tickets that block them, filed as GitHub issues, or as Jira issues when the repo sets the Jira tracker (or written into the spec's Tickets section when neither is available). Use after the to-spec skill, when the user says "make tickets", "break this down" or "to-tickets", or when approve-plan routes work to the large route.
---

# Spec to tickets

## 1. Split
1. Read the spec. It must say `Status: approved`. If it's a draft, stop and ask the user to approve it first.
2. Split it into tickets small enough for one reviewable PR each. Each ticket has:
   - a title (imperative, 60 characters or fewer)
   - **Covers:** the R and AC IDs it delivers
   - **Blocked by:** the tickets that must land first, or none
   - **Done when:** its ACs, restated as checks
3. Every R must be covered by at least one ticket. Order the tickets so blockers come first.
4. Find the tracker. GitHub is the default; Jira is used only when `.claude/engineering.json` sets `tickets.tracker` to `"jira"`.
   - When `.claude/engineering.json` exists, run `node "${CLAUDE_PLUGIN_ROOT}/scripts/jira-tracker.mjs" check` from the repo root. Take the tracker from the `tracker` field it prints, not from reading the file yourself. A missing `tickets` section prints `"github"`. Any non-zero exit (2 is a config problem) means stop: show the message, and don't fall back to GitHub. Show any stderr warning it prints to the user, even when it exits 0 (for example, a site outside `.atlassian.net`).
   - **GitHub tracker:** check access with `gh auth status` and `gh repo view --json nameWithOwner`. Both must succeed.
   - **Jira tracker through the MCP:** when the Atlassian MCP's `createJiraIssue` and `createIssueLink` tools are available and the `check` output has `jira.cloudId`, step 2.2 files through them and needs no environment credentials.
   - **Jira tracker through the script** (otherwise): check that `JIRA_EMAIL` and `JIRA_API_TOKEN` are set, without printing their values (for example `test -n "$JIRA_API_TOKEN"`). If either is missing, stop and ask the user to set it. Never ask for the token in the conversation, and never write it to a file.
5. Show the list as a table (`# | Title | Covers | Blocked by`). Say where the tickets will go: GitHub issues, Jira issues (with the project and the parent key from the config, if any) or the spec, and ask the user once to confirm before filing anything.

## 2. File
1. **With GitHub:** create the issues in blocker order, so each `Blocked by #NN` names a real issue.
   - `gh issue create --title '<spec-slug>: <title>' --body-file <file>`
   - Body: the spec path, `Covers: R1, AC2`, `Blocked by #NN` (or "none") and the done-when checks.
   - Write each body to a temp file in the session scratchpad, not the repo.
   - Apply the `spec:<slug>` label only if it already exists: `gh label list --search "spec:<slug>" --json name` returns an exact name match (plain `gh label list` stops at 30 labels). Never create labels.
   - Also list each issue in the spec's `## Tickets` section (`#NN · <title> · Covers: … · Blocked by: …`), so later plans and reviews can see which requirements are covered.
2. **With the Jira tracker:** file each ticket in blocker order, so every blocker already has a key. Use the MCP or the script as step 1.4 decided.
   - Create through the MCP: `createJiraIssue` with `cloudId`, `projectKey` and `issueTypeName` from the `check` output, `summary: '<spec-slug>: <title>'`, the body as `description`, and `parent` set to the configured parent (or the one the user named at confirmation) when there is one.
   - Create through the script: `node "${CLAUDE_PLUGIN_ROOT}/scripts/jira-tracker.mjs" create --summary '<spec-slug>: <title>' --body-file <file>`. The issue goes into the configured project, with the configured issue type and parent. Add `--parent <KEY>` only when the user named a different parent at confirmation.
   - Body: the spec path, `Covers: R1, AC2`, `Blocked by: <KEY>` (or "none") and the done-when checks. For the script, write each body to a temp file in the session scratchpad, not the repo.
   - Either way you get the new key (the script prints `{"key":"<KEY>"}`). Before the next call, add the issue to the spec's `## Tickets` section (`<KEY> · <title> · Covers: … · Blocked by: …`), so a key is never lost if the run stops. The section starts with a line saying the tickets were filed in Jira and under which parent.
   - Link each blocker right after the ticket it blocks is created. Through the MCP: `createIssueLink` with `cloudId`, `type: 'Blocks'`, `inwardIssue: <blocker key>` and `outwardIssue: <new key>`. Through the script: `node "${CLAUDE_PLUGIN_ROOT}/scripts/jira-tracker.mjs" link --blocker <blocker key> --blocked <new key>`.
   - A failed MCP call or any non-zero exit is a failure (for the script, 1 is a Jira failure, 2 is a bad argument or config). Stop at the first one, and see Rules.
3. **Without a tracker** (the access checks in step 1.4 failed and the user chose not to fix them): write the tickets into the spec's `## Tickets` section as T1, T2… with the same fields, and tell the user why they weren't filed.
4. Report the issue numbers, Jira keys or T-IDs. They and the spec path become the plan's requirement references.

## Rules
- Filing issues is visible to others. Never file without the confirmation in step 1.5.
- In a shell command, put each title inside single quotes and write any `'` in it as `'\''`. That way the shell never expands a `$`, a backtick or a `"` in a title.
- If an issue or a link fails, stop and don't retry silently. Report:
  - the tickets created, with their numbers or keys
  - the links made
  - the script's error message, as printed
  - the tickets and links not done

  Make sure every created ticket is in the spec's `## Tickets` section, so nothing filed is lost. Ask the user how to go on.
- A Jira `create` that fails with a timeout or a network error may still have created the issue. Report that ticket as **unknown, may exist**, not as not done. Give its exact summary, and ask the user to search Jira for it before anything is filed again, so it isn't duplicated.
