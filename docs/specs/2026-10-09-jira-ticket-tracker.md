# Spec: Jira as the ticket tracker

Status: approved · Date: 2026-10-09 · Author: Francis

## Problem
`to-tickets` files tickets only as GitHub issues, and falls back to the spec's Tickets section. This repo tracks its work in Jira project ESP, so every spec's tickets have been filed in ESP by hand, and moved through the ESP workflow by hand at each plan, merge and release. Francis asked (2026-10-09) that tickets be created in Jira and that the skill be changed if it couldn't do it. GitHub issues #13 and #45–#48 were already closed as "Moved to Jira".

## Goals
- A repo can choose Jira as its ticket tracker in `.claude/engineering.json`. GitHub stays the default.
- With Jira chosen, `to-tickets` files tickets in Jira, `approve-plan` marks them started, and `release` marks them merged and released, all with no manual Jira step.
- A Jira failure is never hidden: the skill stops or reports exactly what was and wasn't done.
- This repo opts in.

## Non-goals
- GitHub Projects or any tracker other than GitHub issues and Jira.
- Two-way sync (Jira changes don't flow back to specs or plans).
- Changing GitHub-tracker behaviour.
- Changing the release tag format or version-bump rules (ESP-23).

## Requirements
- R1: `.claude/engineering.json` accepts a `tickets` section: `tracker` (`"github"`, the default, or `"jira"`), and for Jira the site URL, project key, issue type, optional parent key, and a map from the events `started`, `merged` and `released` to target status names. Each event is optional. Invalid or missing required values are reported as config problems that name the key.
- R2: A plugin script talks to the Jira Cloud REST API. It reads the account email and API token only from environment variables, and never writes them to config, files, logs or its output.
- R3: The script can create an issue (with optional parent), link two issues as Blocks, add a comment, and move an issue to a target status by finding the transition whose target status has that name.
- R4: The script fails loudly. A missing token or email, a network error or timeout, a 4xx or 5xx response, and a status name with no matching transition each exit non-zero with a message naming the issue and the cause. It never retries silently.
- R5: With `tracker: "jira"`, `to-tickets` files each ticket through the script in blocker order, links Blocks between them, and lists the keys in the spec's Tickets section. On the first failure it stops and reports which tickets were created and which weren't.
- R6: With `tracker: "jira"`, `approve-plan` moves the Jira keys named by the recorded plan's tasks to the `started` status, when one is configured. Parent and blocker keys that appear only in the requirement references are not moved.
- R7: With `tracker: "jira"`, `release` moves the plan's Jira keys to the `merged` status and comments the PR link when the PR merges into the base branch. When it tags the release branch, it moves every Jira key found in commit subjects or bodies since the previous tag to the `released` status, after showing the list. Git steps are not undone by a Jira failure; each failed transition is reported as a failure the user must fix.
- R8: `clarify` and `approve-plan` accept a Jira key (e.g. `ESP-24`) as a requirement reference, as they accept `#NN` today.
- R9: The skills, the README and `templates/engineering.json` document the Jira tracker, the environment variables and the failure behaviour. An ADR records the decision to send ticket data to Jira with a user token.
- R10: This repo's `.claude/engineering.json` sets the Jira tracker for project ESP with its status names (In Progress, Ready for Release, Released).
- R11: The script sends the token only to a trusted host, because the site comes from the repo's own config. The site's host must end in `.atlassian.net`, or equal the host of the `JIRA_SITE` environment variable when that is set. A site with a user name, password, port, path, query or fragment is rejected. Redirects are not followed; a 3xx response is a failure. Nothing is sent to an untrusted site.

## Acceptance criteria
- AC1 (R1): Config tests: a valid Jira `tickets` section gives no config problem; a missing site, project or issue type, an unknown `tracker` value and a non-string status name each give a config problem naming the key; no `tickets` section means GitHub.
- AC2 (R2): A test runs every script command with a token in the environment and checks that the token string appears in none of stdout, stderr or any file the script writes. The script reads no token from any file or argument.
- AC3 (R3): With an injected HTTP layer, tests show create (with and without parent), link, comment and transition each send the expected method, path and body, and that transition picks the transition whose target status name matches, case-insensitively.
- AC4 (R4): With an injected HTTP layer, tests show a missing token, a missing email, a network error, a timeout, a 401, a 404, a 500, and an unmatched status name each exit non-zero with a message naming the issue key (or ticket title) and the cause. No test sees a second request after a failure.
- AC5 (R5): The `to-tickets` skill text gives the Jira path: script calls in blocker order, Blocks links, the spec's Tickets section, and stop-and-report on the first failure. A grep for `tracker` in the skill finds it.
- AC6 (R6, R7): The `approve-plan` and `release` skill texts give the started, merged (with PR comment) and released transitions, the commit-message key scan since the previous tag, the shown list, and the report of failed transitions. A grep for `tracker` in each finds it.
- AC7 (R7): A tested helper returns the unique Jira keys for a configured project from a list of commit messages, ignoring keys of other projects and keys inside longer words.
- AC8 (R8): The `clarify` and `approve-plan` skill texts name Jira keys as valid requirement references.
- AC9 (R9): `docs/adr/0003-jira-ticket-tracker.md` exists with Status Accepted; `grep -n tracker` finds the Jira setup in the README and `templates/engineering.json`.
- AC10 (R10, R3): `.claude/engineering.json` in this repo has `tickets.tracker` `"jira"` and project `ESP`, `loadConfig` reports no problem, and a dry run of the script's transition lookup against ESP-22 (read-only) resolves each configured status name to a transition ID.
- AC11 (R1–R4, R7, R11): `npm test` exits 0, the fake-pass check passes, and the mutation test on the script and key helper catches every mutant or each survivor is explained.
- AC12 (R11): With an injected HTTP layer, tests show a site on another host, with a user name, a port or a path, or not matching a set `JIRA_SITE`, each fails with a message naming the host problem and sends no request; a site matching `JIRA_SITE` is accepted; every request is sent with `redirect: 'manual'`; and a 302 response fails.

## Constraints & decisions
- ADR-0001 (guard network lookups) covers the guard hook only; this script is called from skills, not hooks, so it adds no latency to edits. It follows ADR-0001's testing rule: the HTTP layer is injected and tests never touch the network.
- New, hard to reverse: the plugin handles a user's Jira API token and sends ticket text to Atlassian. Record it as ADR-0003 (R9).
- Environment variables: `JIRA_EMAIL` and `JIRA_API_TOKEN` (required), `JIRA_SITE` (optional trusted site for hosts outside `atlassian.net`). Chosen by Francis, 2026-10-09.
- No runtime dependencies: Node built-ins and global `fetch` only, as for the rest of the plugin.
- ADR-0002 applies: a test that can't fail fails the gate.
- This repo's `.claude/engineering.json` is a governance file; ESP-26 (ESP-22) also creates it. Whichever lands first creates it and the other edits it.
- The guard may ask before Bash commands that run the script or call the network; that is expected and unchanged.

## Open questions
- None. Tracker selection, access method, failure behaviour, transition mapping, events and released-ticket detection were settled in clarify.

## Change log
- 2026-10-09: R11 and AC12 added after an automated security review found that a repo-supplied site could receive the token; env variable names chosen. Approved by Francis.
- 2026-10-14: R6 reworded to the keys named by the plan's tasks, matching what ESP-30 shipped; moving every requirement-reference key would also move parent and blocker tickets. Decided during ESP-30, recorded in ESP-31. Approved by Francis.
- 2026-10-15: R1 now also covers unknown keys: a key in `tickets`, `tickets.jira` or `tickets.jira.statuses` other than `$comment` is a config problem that names the key, on the GitHub path too, and every level is reported in one run (ESP-62). Approved by Francis.
- 2026-10-18: R2 redaction applies to a raw token of 16 characters or more; a shorter one is not a real API token, and replacing it corrupted ordinary output (audit F17, ESP-78). The Basic credential is always redacted. Approved by Francis.

## Tickets
Filed in Jira as sub-tasks of ESP-27:
- ESP-28 · Tickets config and Jira REST script · Covers: R1–R4, R11, AC1–AC4, AC11, AC12 · Blocked by: none
- ESP-29 · to-tickets files in Jira; Jira keys as references · Covers: R5, R8, AC5, AC8 · Blocked by: ESP-28
- ESP-30 · Jira transitions in approve-plan and release · Covers: R6, R7, AC6, AC7 · Blocked by: ESP-28
- ESP-31 · ADR-0003, docs and this repo's Jira opt-in · Covers: R9, R10, AC9, AC10 · Blocked by: ESP-28
