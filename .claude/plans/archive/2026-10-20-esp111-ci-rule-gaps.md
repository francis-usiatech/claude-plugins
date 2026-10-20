# Plan: CI workflow-rule gaps from the ESP-107 reviews (ESP-111)

## Goal
Close the eight ESP-111 gaps: untrusted text that reaches a run script or a privileged checkout through job outputs, `env.*`, event-payload reads, `::set-output` or a `}}` inside a string literal, plus three error-reporting gaps in post-verdict and the skills.

## Requirement references
- ESP-111 (items 1–6 in the description, item 7 in comment 10913, item 8 in comment 10923), under parent ESP-105
- `docs/audits/2026-10-19-ponytail-audit.md` (R8, R10, R11 follow-ups from the ESP-107 reviews)

## Pre-plan checklist
- (a) New validation rules and format checks: every changed rule lives in `templates/github/scripts/workflow-rules.mjs`, and `checkWorkflow` is its only entry point. Callers searched: `governance-rules.mjs` (guard and CI share it), `hooks/scripts/check-after-bash.mjs` through governance-rules, and `governance-checks.mjs`. Fixtures searched: `tests/workflow-rules.test.mjs` (1130 lines, every rule's cases) and `tests/governance-policy.test.mjs` (workflow edits through the guard). `exprSpans` is called by `normalizeExprs`, `readsStepOutput` and `untrustedIn`. `runChecksOutPr` keeps its own `[^}]*` scan (`PR_HEAD_EXPR_AT`), which has the same `}`-in-literal gap. `verdictOf` is called by `governance-gate.mjs` and `post-verdict.mjs`. `prComments` is called by both too, and its 403 message is asserted in `tests/governance-gate.test.mjs:171`.
- (b) Database or infrastructure mechanisms: n/a: there's no database or infrastructure. Two GitHub runner behaviours are handled fail-closed rather than spiked (Francis, 2026-10-20). (1) Whether the runner skips a `}}` inside a quoted literal: `exprSpans` skips literals either way, and a span left unclosed is still read. (2) Whether `::set-output` is still honoured: it is tracked either way.
- (c) Docs and ADRs touched: `plugins/usiatech-engineering/README.md`: the `wf-untrusted-input` row (line 145), the `wf-privileged-checkout` row, and a 0.18.8 changelog row at release. No ADR covers the workflow rules; the specs are `docs/specs/2026-09-28-security-supply-chain.md` and `docs/specs/2026-10-02-workflow-checks-hardening.md`, and neither changes. `skills/{approve-plan,release,to-tickets,verify}/SKILL.md`: the `check` step (item 8). No docs reviewer is configured (`planning.preflightReviewers` is unset).

## Acceptance criteria
- AC1 (item 1): a job whose `outputs:` value reads an untrusted step output, or untrusted text directly, makes `${{ needs.<job>.outputs.* }}`, `needs.<job>` and `toJSON(needs)` untrusted in every job that reads them, in `run:`, `env:`, github-script and AI-action inputs. This holds whatever order the jobs are listed in, and through a chain a→b→c. Shown by `node --test tests/workflow-rules.test.mjs` with new cases, red first.
  - Evidence: suite "untrusted job outputs read through needs (ESP-111 item 1)": chains, order, toJSON(needs), env, undeclared needs fail closed; mutants M5–M8 CAUGHT (shown, 2026-10-20T23:19:28Z)
- AC2 (item 2): under a privileged trigger, an `actions/checkout` `ref` or `repository` that reads `needs.*` gives `wf-privileged-checkout`, as `steps.*` does. One that reads `env.X` also gives it when X is set from a PR ref, a `steps`/`needs` output, untrusted text or another such name: in an `env:` block, or by an earlier `$GITHUB_ENV` write that reads one. `toJSON(env)` and `env[…]` count when any name is such. A `ref` from `github.sha`, a literal, or an `env.REF` set to a literal (`env: REF: main`) still gives nothing. Tested in `tests/workflow-rules.test.mjs`.
  - Evidence: suite "checkout ref from env.* or needs.* (ESP-111 item 2)" (6 tests); mutants M17–M21, M26 CAUGHT (shown, 2026-10-20T23:19:28Z)
- AC3 (item 3): a `run:` step that writes to `$GITHUB_ENV` / `$GITHUB_OUTPUT` and reads `$GITHUB_EVENT_PATH`, `gh pr view` / `gh issue view` / `gh api`, or `git log` / `git show` whose output carries commit text taints later steps, as an untrusted `${{ }}` does. `git log --format=%H` (hash and date placeholders only) and `git rev-parse` don't. The git patterns are built on `GIT_PREFIX` (AGENTS.md F3), so `git -C . log --format=%s` is flagged. Tested in `tests/workflow-rules.test.mjs`.
  - Evidence: suite "event text a run script reads itself (ESP-111 item 3)"; git log/show allow-list incl. quoted, $, backtick, brace, glob and continuation bypasses from the reviews; mutants M10–M16, M29, M34 CAUGHT (shown, 2026-10-20T23:19:28Z)
- AC4 (item 4): a `run:` step that writes untrusted text with `echo "::set-output name=x::…"` makes `steps.<id>.outputs.*` untrusted, as a `$GITHUB_OUTPUT` write does. Tested in `tests/workflow-rules.test.mjs`.
  - Evidence: test "should flag a step output written with ::set-output (ESP-111 item 4)"; mutant M9 CAUGHT (shown, 2026-10-20T23:19:28Z)
- AC5 (item 5): when `prComments` fails, the error names the PR number and the page (for example `GitHub API returned 403 reading PR 7 comments, page 2`). The gate and post-verdict both print it. Tested in `governance-gate.test.mjs` and `post-verdict.test.mjs`.
  - Evidence: post-verdict "should name the PR and the page…", gate 403 message test; mutant M23 CAUGHT (shown, 2026-10-20T23:19:28Z)
- AC6 (item 6): with no header-format verdict comment on the PR, post-verdict PATCHes the newest github-actions[bot] comment that holds an old-format `<!-- governance-verdict … -->` marker instead of POSTing a new one. The gate still trusts only header-format comments (`verdictOf` is unchanged). Tested in `tests/post-verdict.test.mjs` (PATCH of the old comment) and `tests/governance-gate.test.mjs` (the old format is still ignored).
  - Evidence: post-verdict "should update a pre-0.18.4 bot verdict comment…" (echoed-text bot comment not chosen); gate test at governance-gate.test.mjs:132 still ignores header-less comments; mutants M24, M25 CAUGHT (shown, 2026-10-20T23:19:28Z)
- AC7 (item 7): `exprSpans` skips `'…'` literals (with `''` as an escaped quote) when it looks for `}}`. So `${{ format('}}{0}', steps.pr.outputs.sha) }}` as a privileged checkout `ref`, and `${{ format('}}{0}', github.event.issue.title) }}` in `run:`, are both flagged. A span whose literal never closes is read to the end of the text. `runChecksOutPr` reads `${{ }}` through `exprSpans` too, so `git fetch origin ${{ format('}', github.head_ref) }}` is flagged. Tested, and the existing linear-time (1 MB) cases still pass.
  - Evidence: suite "\"}}\" inside a '…' literal (ESP-111 item 7)" and 1 MB timing cases; mutants M1, M3, M4, M27 CAUGHT; the '' escape loop was equivalent and deleted (shown, 2026-10-20T23:19:28Z)
- AC8 (item 8): each of the four `jira-tracker.mjs check` steps (approve-plan step 4, release "Which tracker", to-tickets step 1, verify step 8) tells the agent to show any stderr warning to the user. Checked with `grep -l "stderr warning" plugins/usiatech-engineering/skills/{approve-plan,release,to-tickets,verify}/SKILL.md`, which lists all 4 files.
  - Evidence: grep -l "stderr warning" over the four SKILL.md files lists all 4 (shown, 2026-10-20T23:19:28Z)
- AC9: the gate passes (`npm test`, `claude plugin validate .`, `claude plugin validate plugins/usiatech-engineering`). A mutation run reports every mutant CAUGHT. It has at least one mutant per fix point:
  - the literal skip in `exprSpans` and the `''` escape;
  - the `runChecksOutPr` span read;
  - job-output taint and the fixed-point loop;
  - `env`/`needs` in `checksOutPrCode`;
  - each shell source pattern and the safe git format list;
  - the `::set-output` match;
  - the PR and page in the `prComments` error;
  - the old-format fallback in post-verdict.
  - Evidence: gate PASS 2026-10-20T23:19:28Z (npm test, both validates, fake-pass); mutation runs: full list 28/28 after fixes, then M30–M34 on the final allow-list (M32/M33 equivalent, code deleted or kept as is); final probes from the security review all flagged (shown, 2026-10-20T23:19:28Z)

## Tasks
- [x] T1: `exprSpans` skips quoted literals; `runChecksOutPr` reads spans through it (covers AC7; ESP-111)
- [x] T2: job-output taint carried into `needs.*`, worked out over all jobs until nothing changes (covers AC1; ESP-111)
- [x] T3: `checksOutPrCode` treats `needs.` like `steps.`, and treats `env.X` as PR code when X is untrusted (covers AC2; ESP-111)
- [x] T4: shell event-payload reads count as untrusted sources for `$GITHUB_ENV` / `$GITHUB_OUTPUT` writes (covers AC3; ESP-111)
- [x] T5: `::set-output` counts as a step-output write (covers AC4; ESP-111)
- [x] T6: `prComments` error names the PR and page (covers AC5; ESP-111)
- [x] T7: post-verdict falls back to the old-format bot comment when choosing which comment to PATCH (covers AC6; ESP-111)
- [x] T8: four SKILL.md `check` steps surface stderr (covers AC8; ESP-111)
- [x] T9: README rows for `wf-untrusted-input` and `wf-privileged-checkout`; gate, mutation run, reviews (covers AC9; ESP-111)

## Files
- `plugins/usiatech-engineering/templates/github/scripts/workflow-rules.mjs`
- `plugins/usiatech-engineering/templates/github/scripts/governance-checks.mjs`
- `plugins/usiatech-engineering/templates/github/scripts/post-verdict.mjs`
- `plugins/usiatech-engineering/tests/workflow-rules.test.mjs`
- `plugins/usiatech-engineering/tests/post-verdict.test.mjs`
- `plugins/usiatech-engineering/tests/governance-gate.test.mjs`
- `plugins/usiatech-engineering/skills/approve-plan/SKILL.md`
- `plugins/usiatech-engineering/skills/release/SKILL.md`
- `plugins/usiatech-engineering/skills/to-tickets/SKILL.md`
- `plugins/usiatech-engineering/skills/verify/SKILL.md`
- `plugins/usiatech-engineering/README.md`

## Commands and actions
- None beyond the gate and the mutation runner. No dependency adds, and no test workflow pushed to GitHub (no probe for item 7, decided by Francis).

## Out of scope
- Outputs set by other actions (`uses:` steps) are still not followed.
- Reusable-workflow (`workflow_call`) outputs.
- Parsing `gh --json` field lists or `jq` paths to tell safe fields from untrusted ones: any such read counts as untrusted (fail closed).
- Release (version bump, promotion, tag) is a separate step after merge.

## Approved
- By: Francis · Date: 2026-10-20
- Route: small (override: "treat as small"; it touches 11 files but adds no new module, skill or public interface, and ESP-111 is the requirement reference)

## Change log
- 2026-10-20: scope set by Francis. Fix items 1 and 3 in code; no probe for item 7 (fail closed); include item 6. Item 4 fails closed with no probe.
- 2026-10-20: Francis chose "treat as small" (11 files, no new module, skill or public interface; ESP-111 is the requirement reference).
- 2026-10-20: Francis approved adding the `runChecksOutPr` span fix (the same `}`-in-literal gap) under item 7.
- 2026-10-20: Francis chose for item 2: `env.X` in a checkout ref counts only when X is untrusted (env taint map), so a literal `env: REF: main` stays clean.
- 2026-10-20: Claude changed how T3 is built, within Francis's choice. The injection taint map doesn't flag `env: REF: ${{ github.event.pull_request.head.sha }}`: a head sha is PR code but not injection text. So a checkout ref's `env.X` counts unless X is a literal and no earlier step writes `$GITHUB_ENV`. This fails closed and keeps the literal case clean. Francis is told in the turn report.
- 2026-10-20: stage-1 review FLAG. Francis chose the narrower rule: `env.X` counts when X is set from a PR ref, an output, untrusted text or such a name, or after a `$GITHUB_ENV` write that reads one. So `env: REF: ${{ github.sha }}` / `base.sha` stays clean.
- 2026-10-20: the AC9 mutant on the `''` escape was dropped: it was equivalent (M2 survived because quotes pair up the same way either way), so the code was deleted. The `''` behaviour is still tested.
- 2026-10-20: stage-2 round 1 had three blocking findings, all fixed in `workflow-rules.mjs`:
  - `exprSpans` searched for the quote again on every span (quadratic). Fixed.
  - `untrustedJobs` repeated its passes over the jobs (quadratic). Fixed by counting a `needs.<id>` the job doesn't declare as untrusted (fail closed).
  - The `git log` / `git show` check blocked a short list of options. It now accepts only options known to be safe and checks every format.
  Francis approved a one-off security + governance re-review of the fixes instead of a second full round. The pre-existing security nits are filed as a follow-up.
- 2026-10-20: the governance and security re-reviews found more `git log` bypasses (quoted options, `$OPTS`, a bare `--pretty`, a line continuation, backticks, braces, a separator inside quotes). The check now accepts only plain text (`\w % . / : @ ^ ~ = , + -` and spaces), so any shell-special character fails closed; a quoted safe format is flagged too (`shortcut:` comment). Francis chose a last run of the reviewers' probes in place of another review; all were flagged.
- 2026-10-20: follow-up gaps (run-step checkout env, github-script outputs, more PR-text commands, `format()` PR refs, reusable-workflow outputs) filed as ESP-115.

## Final status
- Shipped on branch `feature/esp111-ci-rule-gaps` (PR into develop, released as 0.18.8).
- AC1–AC9: met, evidence above.
- Deviations: T3 uses a PR-ref env map rather than the injection taint map (Francis chose the narrower rule); undeclared `needs.<id>` reads fail closed; quoted git formats are flagged.
