# ADR 0003: Jira as an optional ticket tracker, with a user API token

Status: Accepted (Francis, 2026-10-14) · Date: 2026-10-14 · Author: Francis

References: spec `docs/specs/2026-10-09-jira-ticket-tracker.md` (R1–R11, AC9), Jira ESP-27 (sub-tasks ESP-28 to ESP-31).

## Context

`to-tickets` filed tickets only as GitHub issues, falling back to the spec's Tickets section. This repo tracks its work in Jira project ESP, so every ticket was filed and moved through the ESP workflow by hand at each plan, merge and release. Francis asked (2026-10-09) for tickets to be created and moved in Jira by the skills themselves.

Until now the plugin sent nothing to a third-party service on a user's behalf, and it never handled a user credential. Doing this for Jira means:
- the plugin reads a personal Atlassian API token, which carries the user's full Jira permissions;
- ticket titles, bodies, comments and PR links leave the repo and are stored in Atlassian;
- the Jira site comes from the repo's own config, which a pull request can change.

## Decision

A repo can set `tickets.tracker` to `"jira"` in `.claude/engineering.json`, with the site, project key, issue type, optional parent key and the status names for the `started`, `merged` and `released` events. GitHub stays the default; a repo without a `tickets` section behaves as before.

One zero-dependency script, `plugins/usiatech-engineering/scripts/jira-tracker.mjs`, does every Jira call for the `to-tickets`, `approve-plan` and `release` skills:
- **Credentials only from the environment.** `JIRA_EMAIL` and `JIRA_API_TOKEN` are read from environment variables and never written to config, files, logs or output (R2).
- **The token goes only to a trusted host.** The site's host must end in `.atlassian.net`, or equal the host of `JIRA_SITE` when that is set. A site with a user name, password, port, path, query or fragment is rejected, redirects are not followed, and nothing is sent to an untrusted site (R11).
- **Fail loudly, never retry.** A missing credential, a network error or timeout, a 4xx or 5xx response and a status with no matching transition each exit non-zero with a message naming the issue and the cause (R4). A config or argument problem exits 2.
- **Git first, Jira second.** A Jira failure never undoes a commit, merge or tag; each failed transition is reported for the user to fix in Jira (R7).

## Consequences

- **Ticket text leaves the repo.** Anything in a spec's ticket text, a plan's task keys or a PR link is sent to Atlassian. Repos that must not share that text keep the GitHub tracker.
- **A personal token is in the user's shell.** The plugin can't scope it; it carries the user's Jira permissions. The token-host rule limits where it is sent, not what it can do there.
- **A config change can redirect calls.** The host rule stops a site outside `.atlassian.net`, but without `JIRA_SITE` it still accepts any Atlassian tenant, so a PR that points `tickets.jira.site` at another `*.atlassian.net` site would receive the token. Setting `JIRA_SITE` to your own site pins the host. Otherwise the controls are the guard, which asks before `.claude/engineering.json` is edited, and PR review of that file.
- **Jira and git can disagree.** Because Jira failures don't roll back git steps, a ticket can stay in an old status after a merge or release. The skill's report is the signal to fix it by hand.
- **Backing out is a config change.** Removing the `tickets` section, or setting `tracker` to `"github"`, returns a repo to GitHub issues. Tickets already filed in Jira stay there; there is no sync back.

## Alternatives considered

- **The Atlassian MCP server.** It needs a connected session and an OAuth flow that isn't available in non-interactive runs or in CI, and the skills couldn't rely on it being installed. The script works anywhere Node runs.
- **A Jira CLI or SDK dependency.** Breaks the plugin's zero-dependency rule and adds a supply-chain surface for a handful of REST calls.
- **Token in `.claude/engineering.json` or a dotfile.** A file is easy to commit or leak; environment variables keep the secret out of the repo.
- **Retry on network errors.** A retried create can file a duplicate ticket. Failing loudly, with a timed-out create reported as "unknown, may exist", keeps the user in control.
- **Two-way sync.** Out of scope (spec non-goal); specs and plans stay the source of truth.
