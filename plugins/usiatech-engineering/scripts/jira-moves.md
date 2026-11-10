# Jira moves

The shared procedure for every Jira write the skills make: `clarify`, `to-spec`, `to-tickets`, `approve-plan`, `verify`, `release` and `release-steps` follow it. Each skill says which event it fires and for which keys; this file says how.

## 1. Check
- When `.claude/engineering.json` exists, run `node "${CLAUDE_PLUGIN_ROOT}/scripts/jira-tracker.mjs" check` from the repo root. Show any stderr warning it prints to the user, even when it exits 0 (for example, a site outside `.atlassian.net`).
- With no config file, or `"tracker":"github"`, the Jira steps don't apply. Say so.
- A non-zero exit (2 is a config problem) is a failure to report, not a reason to skip.
- When `jira.statuses` in the output has no status for the event, skip the move and say so.

## 2. Transport
Read `jira.transport` from the `check` output. It is `connector` unless the config sets `"transport": "api"`.
- **`connector`:** make every move, comment, ticket and link through the Atlassian connector (the MCP tools) with `jira.cloudId`. Never run the script's `create`, `link`, `comment`, `find-transition` or `transition` commands: on this transport they refuse with exit 2. When the connector tools aren't available, every key fails: report each one, and don't switch to the script.
- **`api`:** use the script only, even when the connector is available. It needs `JIRA_EMAIL` and `JIRA_API_TOKEN` in the environment; a missing one is a non-zero exit, reported as a failure. Never ask for the token in the conversation, and never write it to a file.

## 3. Move a key with an event
A move never takes a ticket backwards. A ticket already at the event's status, or at a later one in the configured order, is left alone. So is a ticket in a status the config doesn't list whose Jira category is Done (Closed, Won't Do): moving it would reopen it. A move more than one status ahead walks each status in between, in order, and reports each step.
- **`connector`:**
  1. Read the current status: `getJiraIssue` with `cloudId`, the key as `issueIdOrKey` and `fields: ["status"]`. Take the status name and its category key, `status.statusCategory.key` (`new`, `indeterminate` or `done`).
  2. Get the walk: `node "${CLAUDE_PLUGIN_ROOT}/scripts/jira-tracker.mjs" steps --event <event> --from "<current status>" --from-category <category key>`. It sends nothing and prints `steps`, the statuses to move through in order. Empty `steps` with a `reason` means the key stays where it is: report the reason.
  3. For each status in `steps`, in order, find its transition ID: the `jira.transitions` value of the one event whose `jira.statuses` value is that status (any letter case). When no event, or more than one event, has that status, or that event has no transition ID, call `getTransitionsForJiraIssue` for the key and use the transition whose target status has that name. Then call `transitionJiraIssue` with `cloudId`, the key as `issueIdOrKey` and `transition: { id: <that ID> }`.
  4. A failed step stops the walk for that key. Report the key, the status it failed on and the statuses it already reached.
- **`api`:** `node "${CLAUDE_PLUGIN_ROOT}/scripts/jira-tracker.mjs" transition --issue <KEY> --event <event>`. It reads the status, walks the same steps and prints `{issue, event, status, from, transitioned, steps}`, with a `reason` when it moved nothing. A non-zero exit is a failure; its message names the statuses already reached.

## 4. Comment on a key
- **`connector`:** `addCommentToJiraIssue` with `cloudId`, the key as `issueIdOrKey` and the text as `commentBody`.
- **`api`:** `node "${CLAUDE_PLUGIN_ROOT}/scripts/jira-tracker.mjs" comment --issue <KEY> --body-file "<file>"`, with the body file in the session scratchpad.

## 5. Docs-only tickets
A ticket is docs-only when every plan task that names it is marked `(docs-only)`. `approve-plan` marks a task that way when everything it changes is docs under the `release` skill's **Docs-only diff** rule.
- A docs-only ticket stops at `devComplete` (Ready to Test) for the user's review. Don't fire `testingStarted`, `testingComplete`, `merged` or `released` for it, and say so in the report.
- The stop ends only when the user approves the ticket. The main thread records that as a dated Change log line in the plan: `<date>: <KEY> docs review approved by <name>`. Without that line, the key stays at `devComplete`.

## 6. Failures
- A failed `check`, connector call or script run never undoes the skill's own work (the plan, the gate verdict, the merge, the tag).
- Go on with the other keys. Then report each failed key with its message, as one the user must fix in Jira.
- Don't retry silently.
