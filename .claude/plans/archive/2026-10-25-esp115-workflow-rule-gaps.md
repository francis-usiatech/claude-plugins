# Plan: Workflow-rule gaps from the ESP-111 reviews (ESP-115)

## Goal
Close the six gaps ESP-115 lists in `workflow-rules.mjs`: run-step checkouts from env or outputs, `actions/github-script` outputs and env, more commands that print PR text, `format()` PR refs, reusable-workflow job outputs, and the two `git log` limits.

## Requirement references
- Jira ESP-115 (sub-task of ESP-105), items 1–6

## Pre-plan checklist
- (a) New validation rules and format checks: the rules are internal to `templates/github/scripts/workflow-rules.mjs` (`runChecksOutPr`, `checksOutPrCode`, `prCheckoutIndex`, `walkJob`, `untrustedJobs`, `shellEventRead`, `printsOnlyHashes`, `PR_REF_EXPR`, `SHELL_EVENT_READ`). Callers searched: `checkWorkflow` is called by `governance-rules.mjs` (guard and CI) and `hooks/scripts/bash-workflow-check.mjs`; no other file imports the changed helpers. Fixtures searched: `tests/workflow-rules.test.mjs`, `tests/workflow-parity.test.mjs` and `tests/fixtures/workflows/*.yml` (parity fixtures must keep their current tiers, or the change is a stated behaviour change), `tests/bash-workflow-timing.perf.mjs` (1 MB timing).
- (b) Database or infrastructure mechanisms the design relies on: n/a: pure regex and walk changes in one module; no database, service or infra mechanism.
- (c) Docs and ADRs touched: `plugins/usiatech-engineering/README.md` rule table rows `wf-privileged-checkout` and `wf-untrusted-input` (line ~149–151) describe the sources and say "Outputs set by other actions and reusable-workflow outputs aren't followed" — must change. The version-history row is written by the release step, not this plan. No ADR covers workflow-rule detail (searched `docs/adr/`).

## Acceptance criteria
- AC1: Under a privileged trigger, a `run:` step checking out from `"$SHA"` (env set from a PR head), `${{ env.REF }}` (PR env), `${{ steps.x.outputs.sha }}` or `${{ needs.a.outputs.sha }}` gives `wf-privileged-checkout`; `git fetch origin "$SHA"` with `SHA: ${{ github.sha }}` does not. Shown by new tests in `workflow-rules.test.mjs`.
  - Evidence: block "run-step checkout from env or an output (item 1)", 5 tests pass in gate run 2026-10-25T23:16Z incl. copied/piped variable review case (shown, 2026-10-25T23:16Z)
- AC2: An `actions/github-script` step whose script reads event/PR text (`context.payload`, `github.rest|graphql|request|paginate`, an untrusted expression or tainted env name) taints `${{ steps.<id>.outputs.* }}` (`wf-untrusted-input` when read in `run:`), and with `core.exportVariable` taints later env (both the untrusted-input walk and the checkout walk: `ref: ${{ env.REF }}` gives `wf-privileged-checkout`). A script that reads none of these leaves outputs clean. Shown by new tests.
  - Evidence: block "actions/github-script outputs and env (item 2)", 3 tests pass in gate run 2026-10-25T23:16Z (shown, 2026-10-25T23:16Z)
- AC3: A run step that writes to `$GITHUB_OUTPUT` after `gh pr status`, `gh issue status`, `gh run list|view`, `gh search prs|issues|commits`, `gh --repo o/r pr view`, `git diff`, `git shortlog`, `git whatchanged`, `git format-patch`, `git cat-file -p` or `git rev-list --format=%s` taints the output; `git rev-list --count HEAD` and `git cat-file -t X` do not. Shown by new tests.
  - Evidence: block "more commands that print PR text (item 3)", 3 tests pass in gate run 2026-10-25T23:16Z incl. gh options before the command (shown, 2026-10-25T23:16Z)
- AC4: `ref: ${{ format('refs/{0}/{1}/head', 'pull', github.event.issue.number) }}` under `issue_comment` gives `wf-privileged-checkout`; `pull_request.number` counts too. Shown by new tests.
  - Evidence: block "a PR ref built from a PR or issue number (item 4)", 1 test passes in gate run 2026-10-25T23:16Z (shown, 2026-10-25T23:16Z)
- AC5: A `needs.<job>.outputs.*` read from a job with job-level `uses:` counts as untrusted (`wf-untrusted-input` in `run:`). Shown by a new test.
  - Evidence: block "reusable-workflow job outputs (item 5)", 1 test passes in gate run 2026-10-25T23:16Z (shown, 2026-10-25T23:16Z)
- AC6: `git log --format=%H --end-of-options "$SHA"` counts as hash-only; `git log --format=%H "$SHA"` still fails closed; `git -c log.showSignature=true log --format=%H` taints. The `shortcut:` comment in `printsOnlyHashes` is replaced. Shown by new tests.
  - Evidence: block "git log revisions and config (item 6)", 3 tests pass in gate run 2026-10-25T23:16Z; diff replaces the printsOnlyHashes shortcut: comment (shown, 2026-10-25T23:16Z)
- AC7: Each fix has a mutation the tests kill (mutation-test skill), and the verification gate passes, including the 1 MB worst-case timing tests.
  - Evidence: mutation-runner 2026-10-25 (passed in): 28 mutations over T1-T6 and review fixes, all caught; gate PASS 2026-10-25T23:16Z (1705 pass, 0 fail) incl. 1 MB timing tests (SHELL_EVENT_READ, runChecksOutPr ESP-115) (shown, 2026-10-25T23:16Z)

## Tasks
- [x] T1: Red tests then fix for run-step checkout env/outputs (covers AC1; ESP-115 item 1)
- [x] T2: Red tests then fix for github-script outputs/env (covers AC2; ESP-115 item 2)
- [x] T3: Red tests then fix for more PR-text commands (covers AC3; ESP-115 item 3)
- [x] T4: Red tests then fix for issue.number / pull_request.number refs (covers AC4; ESP-115 item 4)
- [x] T5: Red test then fix for reusable-workflow job outputs (covers AC5; ESP-115 item 5)
- [x] T6: Red tests then fix for git log `--end-of-options` and `-c` prefix (covers AC6; ESP-115 item 6)
- [x] T7: README rule rows updated (covers AC1–AC6; ESP-115)
- [x] T8: Mutation run and verification gate (covers AC7; ESP-115)

Constraints (AGENTS.md): every new git matcher is built on `GIT_PREFIX`; new helpers stay module-private; new regexes stay linear (1 MB timing). Mutation targets: T1 the shell-variable and span checks in `runChecksOutPr`; T2 the github-script taint in `walkJob` and `prCheckoutIndex`; T3 the new `SHELL_EVENT_READ` alternatives and the git sub-command dispatch; T4 the `issue.number` term; T5 the `job.uses` taint; T6 the `--end-of-options` split and the `-c` prefix check.

## Files
- `plugins/usiatech-engineering/templates/github/scripts/workflow-rules.mjs`
- `plugins/usiatech-engineering/tests/workflow-rules.test.mjs`
- `plugins/usiatech-engineering/tests/workflow-parity.test.mjs`
- `plugins/usiatech-engineering/tests/bash-workflow-timing.perf.mjs`
- `plugins/usiatech-engineering/tests/fixtures/workflows/*.yml`
- `plugins/usiatech-engineering/README.md`

## Commands and actions
- None beyond the repo's verify gate and the mutation-test runner.

## Out of scope
- git aliases and repo/global git config that the checker can't see (`git config alias.x log`).
- Outputs of third-party actions other than `actions/github-script`.
- Parsing shell words in run scripts.
- Version bump and release row (done by the release flow).

## Approved
- By: Francis · Date: 2026-10-25
- Route: small (cites Jira ESP-115; 3 files; no new skill, module, service or public interface)

## Change log
- 2026-10-25: plan approved by Francis before drafting.
- 2026-10-25: pre-flight FLAG. Francis decided to add the parity test, the perf test and the workflow fixtures to Files now, and to keep `gh search commits` (a source of the same kind as the ticket's commands). Also added the AGENTS.md constraints and the per-task mutation targets.
- 2026-10-25: review round 1. Silent-failure: environ/printenv reads on a checkout line were missed; fixed. Security: 3 medium bypasses (github client copies and destructuring, gh ls and options between words, copied or piped shell variables); Francis chose to fix them here. Each fix was test-first, and every mutation was caught. No new files.
- 2026-10-25: after the round-1 fixes the full gate was re-run at 23:03Z: npm test, 1705 pass, 0 fail, including the perf test. The 22:51Z AC evidence stands for AC1-AC6. For AC7 there are 6 more mutations, all caught.
- 2026-10-25: review round 2. Security found that github-script exec.* (gh or git with array arguments) was missed; octokit was added with it. Francis chose to fix it here: test first, 3 mutations caught.

## Final status
- Status: shipped. Branch `feature/esp115-workflow-rule-gaps`; the commit and PR follow at once.
- AC1–AC7: shown (verify gate 2026-10-25T23:16Z: 1705 pass, 0 fail, 4 skipped, 1 MB timing tests pass; 28 mutations caught).
- Deviations: the review rounds added fixes within the plan's three changed files. Silent-failure: environ/printenv reads. Security round 1: github client aliases, gh `ls` and options between words, copied or piped shell variables. Security round 2: github-script `exec` and `octokit`. One behaviour change: a PR-derived variable anywhere in a run step that checks out is flagged, including `echo "$SHA" && git fetch origin main`.
- Not fixed (listed in the PR as follow-ups): `child_process` with array arguments in github-script; `git diff --quiet --no-quiet`; 5 or more gh options or a quoted `"gh"`; `${!n}` or `env | grep` indirection; a SHA passed between steps through a file; `curl` to api.github.com (existed before).
