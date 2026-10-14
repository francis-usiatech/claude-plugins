# Plan: ESP-28 Tickets config and Jira REST script

## Goal
Add a tested plugin script that validates the `tickets` config and talks to the Jira Cloud REST API (create, link, comment, transition by status name), reading credentials only from the environment and failing loudly on every error. Skills start using it in ESP-29 to ESP-31.

## Requirement references
- Spec `docs/specs/2026-10-09-jira-ticket-tracker.md` (Status: approved), R1, R2, R3, R4, R11
- Jira ESP-28 (sub-task of ESP-27)
- ADR-0001 (testing rule: the network layer is injected, tests never touch the network), ADR-0002 (tests that can't fail fail the gate)

## Acceptance criteria
- AC1 (spec AC1): Config tests: a valid Jira `tickets` section gives no problem; a missing site, project or issue type, an unknown `tracker` value and a non-string status name each give a problem naming the key; no `tickets` section means `"github"`.
  - Evidence: `tests/jira-tracker.test.mjs` "validateTicketsConfig (R1; AC1)" 13/13 pass; red run 11 fail on assertions against a stub (2 passed against the stub and aren't counted; the strengthened "without a parent" test wasn't re-run red); full `npm test` 1002/1002 + timing 1/1, fake-pass exit 0 (shown, 2026-10-09T22:17:33Z). Re-checked after the review fixes: file 87/87 (shown, 2026-10-14T17:04:36Z), gate PASS (shown, 2026-10-14T17:07:23Z)
- AC2 (spec AC2): A test runs every script command with a token in the environment and checks that the token string appears in none of stdout, stderr or any file the script writes. The script reads the token from no file or argument.
  - Evidence: `tests/jira-tracker.test.mjs` "runCli token handling (R2; AC2)" 4/4, "runCli commands (R3)" 10/10 and "runCli failures (R4; AC4)" 22/22 pass (file 80/80, shown 2026-10-14T03:28:19Z). Red run against a stub `runCli`: 32 fail, all ERR_ASSERTION (2026-10-14T03:25:44Z). Second red run for the edge cases added after green: 3 fail on ERR_ASSERTION (built-in property names as command and option, a typed value printed after `-`); the `--option=value` test passed against the first implementation and isn't counted. Re-checked after the review fixes: file 87/87 (shown, 2026-10-14T17:04:36Z), gate PASS (shown, 2026-10-14T17:07:23Z)
- AC3 (spec AC3): With an injected `fetch`, tests show create (with and without parent), link, comment and transition each send the expected method, path and body, and that transition picks the transition whose target status name matches, case-insensitively.
  - Evidence: `tests/jira-tracker.test.mjs` "createJiraClient requests (R3; AC3)" 7/7 pass (file 20/20); red run with empty-method stub: 7 fail (4 assertion, 3 no request sent) (shown, 2026-10-09T22:49:46Z).. Re-checked after the review fixes: file 87/87 (shown, 2026-10-14T17:04:36Z), gate PASS (shown, 2026-10-14T17:07:23Z); the unmatched-status gap noted at T2 was closed in T3
- AC4 (spec AC4): With an injected `fetch`, tests show a missing token, a missing email, a network error, a timeout, a 401, a 404, a 500 and an unmatched status name each exit non-zero with a message naming the issue key (or ticket title) and the cause, and that no further request is sent after the failure.
  - Evidence: `tests/jira-tracker.test.mjs` "createJiraClient failures (R4; AC4)" passes (file 44/44); red run on 2026-10-09: 20 fail on ERR_ASSERTION across the AC4 and AC6 tests (2 passed against the old code and aren't counted: the HTTP 401 message, the token not in the message); full `npm test` exit 0 after the rebase onto develop (shown, 2026-10-14T03:21:34Z). Re-checked after the review fixes: file 87/87 (shown, 2026-10-14T17:04:36Z), gate PASS (shown, 2026-10-14T17:07:23Z)
- AC6 (spec AC12): With an injected `fetch`, tests show a site on another host, with a user name, a port or a path, or not matching a set `JIRA_SITE`, each fails with a message naming the host problem and sends no request; a site matching `JIRA_SITE` is accepted; every request is sent with `redirect: 'manual'`; and a 302 response fails.
  - Evidence: `tests/jira-tracker.test.mjs` "createJiraClient trusted site (R11; AC12)" passes (file 44/44); red run shared with AC4 (20 fail on ERR_ASSERTION, 2026-10-09); full `npm test` exit 0 (shown, 2026-10-14T03:21:34Z). Re-checked after the review fixes: file 87/87 (shown, 2026-10-14T17:04:36Z), gate PASS (shown, 2026-10-14T17:07:23Z)
- AC5 (spec AC11, partly; plugin validate is the repo gate): `npm test` exits 0, the fake-pass check exits 0, both `claude plugin validate` commands exit 0, and the mutation test on the script catches every mutant or each survivor is explained.
  - Evidence: gate PASS (tests, validate marketplace, validate plugin, fake-pass check; shown, 2026-10-14T04:57:33Z). Mutation run of 43 mutants on `scripts/jira-tracker.mjs` with `node --test plugins/usiatech-engineering/tests/jira-tracker.test.mjs` (commands confirmed by Francis): 40 CAUGHT, 3 SURVIVED (default tracker, trailing slash on the site, a host ending in the letters "atlassian.net" without the dot), 0 NOT-FOUND, 0 TIMEOUT, 0 ERROR (2026-10-14T04:29:48Z). A test was added for each survivor; re-run of the 3: 3 CAUGHT (2026-10-14T04:31:06Z); file 84/84. After the review fixes: gate PASS (shown, 2026-10-14T17:07:23Z); file 87/87.

## Tasks
- [x] T1: Write failing config-validation tests, then `validateTicketsConfig` (covers AC1; ESP-28)
- [x] T2: Write failing request-shape tests, then the client: create, link, comment, transition-by-name, read-only transition lookup (covers AC3; ESP-28)
- [x] T3: Write failing error and site-trust tests, then credential checks (`JIRA_EMAIL`, `JIRA_API_TOKEN`), trusted-host binding (`*.atlassian.net` or `JIRA_SITE`), `redirect: 'manual'`, per-request timeout (AbortController) and errors naming the issue and cause (covers AC4, AC6; ESP-28)
- [x] T4: Write the token-leak test over every CLI command, then the CLI entry (`--config`, `--body-file`, JSON result on stdout) (covers AC2; ESP-28)
- [x] T5: Run the gate and the mutation test; record evidence (covers AC5; ESP-28)

## Files
- `plugins/usiatech-engineering/scripts/jira-tracker.mjs`
- `plugins/usiatech-engineering/tests/jira-tracker.test.mjs`
- `docs/specs/2026-10-09-jira-ticket-tracker.md`

## Commands and actions
- Mutation-test run on `plugins/usiatech-engineering/scripts/jira-tracker.mjs` (T5): list JSON in the session scratchpad; its commands are limited to `node --test plugins/usiatech-engineering/tests/jira-tracker.test.mjs`; the user confirms the commands before the run.
- No dependencies (Node built-ins and global `fetch`). No real Jira calls in tests; the read-only dry run against ESP is ESP-31.
- Release order: ESP-28 isn't promoted to main before ESP-31 (ADR-0003) lands.

## Out of scope
- Skill text changes (ESP-29, ESP-30), ADR-0003, README, `templates/engineering.json` and this repo's opt-in (ESP-31).
- The commit-message key helper (ESP-30).
- The guard's `sanitizeConfig`: the guard doesn't read `tickets`, so validation lives in the script.

## Approved
- By: Francis · Date: 2026-10-09
- Route: large (adds a new module and public script; spec and tickets done via clarify → to-spec → to-tickets, user chose the large route)

## Change log
- 2026-10-09: plan drafted for ESP-28; pre-flight PASS (2 minor fixes applied); approved by Francis.
- 2026-10-09: AC6 added and T3 widened (spec R11/AC12): an automated security review found a repo-supplied site could receive the token; host binding and `redirect: 'manual'` added. Env names `JIRA_EMAIL`, `JIRA_API_TOKEN`, `JIRA_SITE` chosen. Approved by Francis.
- 2026-10-09: paused for ESP-22 with T3 implemented test-first (red 20 fail on ERR_ASSERTION, 2 passed against old code and are not counted; green 44/44 in jira-tracker.test.mjs); full npm test not run, T3 not ticked.
- 2026-10-13: resumed at Francis's request; branch moved up to develop at 553c316 (38 commits) and the stash restored.
- 2026-10-14: T4 adds a fix the plan didn't list: the script's main-module check compares real paths, because a plugin reached through a link otherwise does nothing without a word (the gate runner's header names the same trap). Three gate runs (04:37, 04:44, 04:49Z) failed on unrelated tests under 100% CPU load (1-second timing tests in workflow-rules, an empty stderr in governance-gate); each failing file passed on its own and the fourth run passed.
- 2026-10-14: review round (stage 1 and stage 2 in parallel: 3 files, all in Files). convention-reviewer PASS; security-reviewer PASS with nits; silent-failure-reviewer 2 blocking findings: a network error lost its cause (Node's fetch says only "fetch failed"), and the timeout didn't cover reading the response body. Both fixed test-first (red: 3 fail on ERR_ASSERTION and the stalled-body test timed out at 5 s; green 87/87); governance-only re-review of the fix: PASS, both closed. governance-reviewer FLAG: stale evidence stamps and a stale T2 note (both corrected here), and 8 governance-log `error` entries ("after-Bash workflow check: background command") from 2026-10-12 work on ESP-35, 41, 51 and 52 while ESP-28 was paused. No commit touched `.github/workflows` or the CI templates since 2026-10-11. Francis accepted the FLAG and approved the commit (2026-10-14).

## Final status
- Shipped, branch `feature/esp28-jira-tracker-script`, archived in the same commit as the work. The commit and the PR into `develop` follow this archive. Not promoted to `main` before ESP-31 (ADR-0003) lands.
- Acceptance criteria: AC1 to AC6 shown.
- Deviations:
  - The real-path main-module check was added in T4 (not in the original task list); see the 2026-10-14 change log entry.
  - Three gate runs failed on unrelated tests under 100% CPU load before a passing run; see the change log.
  - Mutation run before the review fixes; the fixes in `sendRequest` were not re-mutated.
- Open nits, listed in the PR: a config parse error can echo the first characters of the file; Jira error text reaches stderr without control characters stripped; a `JIRA_SITE` with a port can never match; a non-JSON error body (HTML 502) is dropped; a transitions response with no list reads as "no transition to status"; the outer `.catch` of the entry doesn't redact (unreachable today); `isMainModule` returns false (exit 0, nothing done) when `realpathSync` throws.
- For ESP-29: confirm the Blocks link direction with one live link (the code sends `inwardIssue` = blocker, `outwardIssue` = blocked; the ESP-28/ESP-29 link reads "ESP-29 is blocked by ESP-28" from the inward side). Accepted risk (R11): a repo can name any `*.atlassian.net` site.
