# Plan: Audit PR C — CI rule fixes (ESP-77)

## Goal
Close the five CI-rule gaps from the ponytail audit: conditional verify steps skipped for non-ASCII paths (F6), focused/skipped tests written with modifier chains (F8), `issue_comment` not treated as privileged (F9), untrusted input reaching a script through `env` (F10), and a symlinked test file read as text in CI (F19). Fix the three review nits deferred from PR A, and set `persist-credentials: false` on the gate job's checkouts.

## Requirement references
- `docs/audits/2026-10-17-ponytail-audit.md` F6, F8, F9, F10, F19, and its "How to use this brief" rules (test-first, smallest fix, no new dependencies)
- ESP-77 (sub-task of ESP-74), including its comment of 2026-10-17 (3 nits from the ESP-75 review, PR #118, and the optional `persist-credentials` hardening)
- `docs/specs/2026-09-28-security-supply-chain.md` R7, R8 and R9 (privileged triggers, untrusted input), which F9 and F10 extend
- `AGENTS.md` "Git paths are read raw" (F6) and "Config values come from `engineering.json`" (nit 3)

## Pre-plan checklist
- (a) New validation rules and format checks:
  - F6, `run-verify.mjs:17`: the only caller is the CI workflow's verify-gate job; tests in `tests/run-verify.test.mjs`. Same `-z` and `core.quotePath=false` form as `changedFiles` in `governance-checks.mjs:79`.
  - F8, `FOCUSED` and `SKIPPED` in `fake-pass-rules.mjs:130-139`: used only inside `checkFakePasses`, which `fake-pass-check.mjs` (local) and `governance-checks.mjs` (CI) both call. Fixtures: `tests/fake-pass-rules.test.mjs`. `tests/fake-pass-parity.test.mjs` checks local and CI agree.
  - F9, `PRIVILEGED_TRIGGERS` (`workflow-rules.mjs:16`): used only by `privilegedRules`. `checksOutPrCode` already matches `refs/pull/` in a checkout ref, `pull/` after `git fetch` and `gh pr checkout`, so `issue_comment` workflows that check out `refs/pull/${{ github.event.issue.number }}/head` are seen without a new ref pattern. Tests in `tests/workflow-rules.test.mjs`, including the 1 MB timing tests.
  - F10, `untrustedInputRules` (`workflow-rules.mjs:503`): the only caller is `checkWorkflow`. It reads `run`, `actions/github-script` `script` and AI-action inputs through `untrustedIn`. Workflow, job and step `env` are read through the existing `strings()` and `untrustedIn()` helpers; no new parser.
  - F19, `governance-checks.mjs` test-content step (`:208-227`): the local twin is `readChangedFile` in `fake-pass-check.mjs:47-53` (`lstatSync(...).isFile()` → null). Tests in `tests/governance-checks.test.mjs` (they build real git repos) and `tests/fake-pass-parity.test.mjs`.
  - Nits: `esc` in `post-verdict.mjs:20` (tests `tests/post-verdict.test.mjs`); the no-verdict text at `governance-gate.mjs:47` (tests `tests/governance-gate.test.mjs`, which may assert the old text); `readApprovalLabel` at `governance-checks.mjs:72-74`, whose third `stringValue` argument is the label used in config-problem messages.
- (b) Database or infrastructure mechanisms: none. `git ls-tree` reports a symlink as mode `120000` on every platform, including Windows checkouts with `core.symlinks=false`, because the mode is read from the commit, not the disk. To confirm with the failing test first (T1). The F10 env rule follows GitHub's documented env precedence: step over job over workflow.
- (c) Docs and ADRs touched: searched the README, `docs/`, the ADRs, the agents and `AGENTS.md` for "privileged trigger", `pull_request_target`, `wf-untrusted-input`, `fp-focused`, `fp-skipped` and `verifyConditional`.
  - Touched:
    - `plugins/usiatech-engineering/README.md`: the `wf-privileged-checkout` row (`:140`) adds `issue_comment`; the `wf-untrusted-input` row (`:142`) adds `${{ env.NAME }}` set from untrusted text; the fake-pass section names modifier chains; the existing 0.18.2 Versioning row (`:316`) gets the PR C changes, since 0.18.2 is not released yet.
    - `docs/specs/2026-09-28-security-supply-chain.md` R7: a dated note that `issue_comment` is also privileged (the audit asks for this note).
    - `plugins/usiatech-engineering/agents/security-reviewer.md:69`: the privileged-trigger list adds `issue_comment`.
  - Not touched: no ADR covers these rules. No docs reviewer is configured (`planning.preflightReviewers` is unset).

## Acceptance criteria
- AC1 (F6): with `BASE_REF` set, a change to `tools/café.py` runs the `verifyConditional` step whose `when` is `["tools/"]`. ASCII paths behave as before.
  - Evidence: run-verify.test.mjs "should run a conditional step for a changed non-ASCII path (F6)": tools/café.py red before the fix, green after; a tools/a"b.py case (quoted by git even with core.quotePath=false) added after mutation "F6 … without -z" first SURVIVED, then CAUGHT; other run-verify tests green (shown, 2026-10-19T02:43Z; re-confirmed by the post-fix gate)
- AC2 (F8): `it.only.each(t)(…)`, `test.concurrent.only(…)` and `describe.only.each(t)(…)` each give the focused-test finding; `it.skip.each(t)(…)`, `test.concurrent.skip(…)`, `it.todo.each(t)(…)` and `test.concurrent.fixme(…)` each give the skipped-test finding. `it.each(t)(…)`, `test.concurrent(…)` and `obj.only(…)` give none. `tests/fake-pass-parity.test.mjs` still passes.
  - Evidence: fake-pass-rules.test.mjs: 7 chain cases red before the fix, green after; "should not flag run-modifier chains without only or skip (F8)" green; fake-pass-parity.test.mjs green; round-1 fix adds test.only.failing, test.skip.failing and a tagged it.only.each table (green); round-2 ReDoS fix adds 3 timing cases (320 KB .it.only and .it.skip chains, one it with 20k .only segments) under 2 s, each about 10 ms after the fix; 8 F8 mutations CAUGHT, 3 of them ReDoS mutations (shown, 2026-10-19T02:43Z)
- AC3 (F9): an `on: issue_comment` workflow whose job checks out `refs/pull/${{ github.event.issue.number }}/head` gives `wf-privileged-checkout`, and `wf-privileged-secrets` when the job uses a secret. The same job under `pull_request` gives neither.
  - Evidence: workflow-rules.test.mjs "should flag issue_comment checking out the commented PR, and its secrets (F9)": red, then green (pull_request variant gives []); mutation "F9 issue_comment not privileged" CAUGHT (shown, 2026-10-19T02:43Z; re-confirmed by the post-fix gate)
- AC4 (F10): `env: T: ${{ github.event.pull_request.title }}` at workflow, job or step level, then `run: echo "${{ env.T }}"`, gives `wf-untrusted-input`; so do `${{ env['T'] }}`, `${{ ENV.t }}` and the same reference in an `actions/github-script` script or an AI action input. `run: echo "$T"` gives none. A step `env` that sets `T` to a safe value shadows a job- or workflow-level untrusted `T`, so that step gives none. An env name set from another untrusted env (`U: ${{ env.T }}` at a lower level) counts as untrusted.
  - Evidence: workflow-rules.test.mjs "untrusted input passed through env (F10)": 5 tests red before the fix, all 8 green after (levels, spellings, script and AI input, $T safe, shadowing, chained names, whole env object); 7 F10 mutations CAUGHT; both 1 MB timing tests green (shown, 2026-10-19T02:43Z; re-confirmed by the post-fix gate)
- AC5 (F19): in CI, a changed test file that is a symlink at `HEAD` (mode `120000`) gives `fp-unreadable` with a reason naming the link, as the local check does. A changed non-test JS file that is a symlink gives no finding, as locally. A regular test file is checked as before.
  - Evidence: governance-checks.test.mjs "should report a test file that is a symlink at HEAD as fp-unreadable, as locally (F19)": red, then green (linked src file gives no fp- finding); mutation "F19 symlink mode not checked in CI" CAUGHT (shown, 2026-10-19T02:43Z; re-confirmed by the post-fix gate)
- AC6 (nits): `post-verdict.mjs` passes `f.line` through `esc()`, so a line value holding `|`, a line break or `<` can't break the table or open a comment. The gate's no-verdict message no longer names "draft PR, fork PR"; it says the review hasn't run or posted a verdict for this commit and to re-run the workflow. `readApprovalLabel` passes `'governance.approvalLabel'` as the label path.
  - Evidence: post-verdict.test.mjs "should escape … a comment opener in a finding line" and governance-gate.test.mjs "should fail when there is no verdict for the head commit" (new text, no draft/fork hint): red, then green; mutation "Nit 1 finding line not escaped" CAUGHT. readApprovalLabel label path changed to 'governance.approvalLabel' (governance-checks.mjs:74); not observable, since readApprovalLabel discards config problems, so no test (shown, 2026-10-19T02:43Z; re-confirmed by the post-fix gate)
- AC7 (hardening): both `actions/checkout` steps in the `governance-gate` job of `templates/github/workflows/pr-governance.yml` set `persist-credentials: false`. The gate job pushes nothing; it reads the API with `GITHUB_TOKEN` from env.
  - Evidence: pr-governance.yml governance-gate job: both checkouts set persist-credentials: false; gate script makes no git calls (fetch API with GITHUB_TOKEN only); validate plugin passed in the gate (shown, 2026-10-19T02:43Z; re-confirmed by the post-fix gate)
- AC8 (docs): the README rows, the 0.18.2 Versioning row, the spec R7 note and the security-reviewer trigger list say what AC2–AC4 and AC5 changed. The 0.18.2 upgrade note still says to re-copy the whole `templates/github/` kit (scripts and workflow).
  - Evidence: README fp-only, fp-skip, fp-unreadable, wf-privileged-checkout and wf-untrusted-input rows, and the 0.18.2 row (upgrade note names scripts/ and pr-governance.yml); spec R7 dated note; security-reviewer.md trigger list (shown, 2026-10-19T02:43Z; re-confirmed by the post-fix gate)
- AC9: a mutation-test run on the changed rule lines has no survivors, then `node plugins/usiatech-engineering/skills/verify/gate.mjs` prints Gate: PASS (mutations first, gate last).
  - Evidence: after the round-2 ReDoS fix, mutation run 19 of 19 CAUGHT, 0 SURVIVED, 0 NOT-FOUND (2026-10-19T02:3xZ, list scratchpad/esp77-mutations.json), then repo runner node plugins/usiatech-engineering/skills/verify/gate.mjs printed Gate: PASS at 2026-10-19T02:43:24Z (tests, both validations, fake-pass check; two expected fp-placeholder warnings on the rule source and a fixture). Earlier runs: 16 of 16 and Gate: PASS at 02:19:26Z after the round-1 fix; a 00:37:02Z run failed only the known load-sensitive governance-gate pagination test (shown, 2026-10-19T02:43Z)

## Tasks
- [x] T1: Failing tests first (tdd): run-verify non-ASCII case; fake-pass-rules chain cases (focused, skipped, and the no-finding cases); workflow-rules `issue_comment` and env cases; governance-checks symlinked test file; post-verdict `f.line`; governance-gate no-verdict text; readApprovalLabel label path (covers AC1–AC6; ESP-77)
- [x] T2: F6. `run-verify.mjs` reads changed paths with `['-c', 'core.quotePath=false', 'diff', '--name-only', '-z', …]` and splits on `\0` (covers AC1; ESP-77)
- [x] T3: F8. `FOCUSED` and `SKIPPED` allow a modifier chain: `(?<![\w$.])(?:it|test|describe|suite|context)(?=(?:\.\w+)*?\.only\b)(?:\.\w+)+\s*[(\x60]` (round-2 ReDoS fix), and the same form for skip, todo and fixme (covers AC2; ESP-77)
- [x] T4: F9. Add `'issue_comment'` to `PRIVILEGED_TRIGGERS` (covers AC3; ESP-77)
- [x] T5: F10. In `untrustedInputRules`, work out the untrusted env names per step (workflow, then job, then step, lowercased, a lower level shadowing a higher one) and treat `env.<name>` in a scanned expression as untrusted. Reuse `exprSpans`, `normalizeExpr` and `untrustedIn` (covers AC4; ESP-77)
- [x] T6: F19. In the test-content step of `governance-checks.mjs`, read the `HEAD` mode with `git -c core.quotePath=false --literal-pathspecs ls-tree -z HEAD -- <file>`; for `120000`, pass `content: null` with reason "is a symbolic link" (covers AC5; ESP-77)
- [x] T7: Nits. `esc(f.line)` in post-verdict, the new no-verdict text in governance-gate (and its comment at `:24` if it names the same causes), and the `readApprovalLabel` label path (covers AC6; ESP-77)
- [x] T8: `persist-credentials: false` on the two gate-job checkouts (covers AC7; ESP-77)
- [x] T9: README rows and the 0.18.2 row, the spec R7 note, the security-reviewer list (covers AC8; ESP-77)
- [x] T10: Mutation test on the changed lines, then the gate on a quiet machine (covers AC9; ESP-77)

## Files
- `plugins/usiatech-engineering/templates/github/scripts/run-verify.mjs`
- `plugins/usiatech-engineering/templates/github/scripts/fake-pass-rules.mjs`
- `plugins/usiatech-engineering/templates/github/scripts/workflow-rules.mjs`
- `plugins/usiatech-engineering/templates/github/scripts/governance-checks.mjs`
- `plugins/usiatech-engineering/templates/github/scripts/post-verdict.mjs`
- `plugins/usiatech-engineering/templates/github/scripts/governance-gate.mjs`
- `plugins/usiatech-engineering/templates/github/workflows/pr-governance.yml`
- `plugins/usiatech-engineering/tests/run-verify.test.mjs`
- `plugins/usiatech-engineering/tests/fake-pass-rules.test.mjs`
- `plugins/usiatech-engineering/tests/workflow-rules.test.mjs`
- `plugins/usiatech-engineering/tests/governance-checks.test.mjs`
- `plugins/usiatech-engineering/tests/post-verdict.test.mjs`
- `plugins/usiatech-engineering/tests/governance-gate.test.mjs`
- `plugins/usiatech-engineering/README.md`
- `plugins/usiatech-engineering/agents/security-reviewer.md`
- `docs/specs/2026-09-28-security-supply-chain.md`

## Commands and actions
- None beyond the normal gate, mutation test and release flow.

## Out of scope
- The other audit findings (PR D: ESP-78, PR E: ESP-79).
- Env values set at run time through `$GITHUB_ENV` or step outputs (`steps.x.outputs.y`); only `env:` keys in the file are read.
- `persist-credentials: false` on the other jobs' checkouts (governance-checks, verify-gate); the ESP-77 comment names only the gate job.
- Symlinks in CI for workflow and dependency files (F19 covers test files only), and new PR-ref patterns for `issue_comment` beyond the ones `checksOutPrCode` already matches (`github.event.issue.number` alone in a `git checkout` with no `pull/` ref).
- The shell-tokenizer follow-up and the flaky-test ticket from PR B.
- Re-copying the CI kit into subscriber repos. The README upgrade note tells them to.

## Change log
- 2026-10-18: drafted. Route large with override (Francis), as for PR A and PR B.
- 2026-10-18: pre-flight PASS (governance-reviewer); 3 wording fixes applied (T3 regex tail, AC2 named cases, readChangedFile name). Approved as drafted (Francis).
- 2026-10-19: AC4 fails closed on the whole env object too (toJSON(env), env.*, env[x]) when any name is untrusted, to match the github-path rules; AC1 test adds a git-quoted name (tools/a"b.py) so -z is proven, not only core.quotePath. Both within the approved files.
- 2026-10-19: release round 1. Stage 1 governance PASS; stage 2 convention PASS, security PASS, workflow PASS, silent-failure FLAG with one blocking finding: `test.only.failing(…)` and `test.skip.failing(…)` gave no finding. Fixed: FOCUSED and SKIPPED now allow any chain after the marker, ending in `(` or a backtick; tests add `test.only.failing`, `test.skip.failing` and a tagged `it.only.each` table, and the run-verify quoted-name case asserts its summary row too. `ls-tree` in governance-checks now pipes stderr (stage-1 note). Decisions (Francis): a full review round again on the fix, per the release rule; the three low-confidence F10 env gaps (a whole-expression `env:` block, names outside `[\w-]`, names in one block that differ only in case) go to a follow-up ESP sub-task under ESP-74, not this PR. AC9 re-run after the fix: 16 of 16 mutations CAUGHT, then Gate: PASS at 2026-10-19T02:19:26Z.
- 2026-10-19: release round 2. Stage 1 governance FLAG (one item): AC1 and AC3–AC8 evidence stamps (00:39Z) were older than the round-1 fix edits. Restamped to the post-fix gate (Gate: PASS 2026-10-19T02:19:26Z, after the newest edit at 02:17:23Z), which re-ran every AC test; no code change.
- 2026-10-19: release round 2 stage 2. Convention PASS, silent-failure PASS (round-1 finding closed), workflow PASS (nit: a checkout ref from steps.*.outputs under issue_comment is not caught; out of scope per this plan), security FLAG with one blocking finding: the round-1 FOCUSED/SKIPPED regexes backtrack catastrophically on a long modifier chain with no call (a 16 KB .it.only file took over 30 s; any PR could stall CI until the job timeout). Fixed: a lookbehind starts a match only at a chain head, and a lookahead finds the marker, so matching is linear (about 10 ms on 320 KB); 3 timing tests and 3 ReDoS mutations added. The fix touches a *rules*.mjs file, so a full review round runs again (round 3), per the release rule.
- 2026-10-19: release round 3 (full, the fix touched *rules*.mjs). Stage 1 governance PASS; stage 2 convention, silent-failure, security and workflow PASS; ReDoS closed (new FOCUSED/SKIPPED linear up to the 1 MB cap). Decisions (Francis): accept that ns.it.only( and $it.only( are no longer flagged (the chain-head lookbehind keeps the regex linear) and list it as a PR nit; test.describe.only( is still flagged through the test head, and test.concurrent.only( already tests that shape, so no new test (avoids a round 4). One ESP sub-task under ESP-74 each for: the unchanged TEST_CALL regex, which is quadratic on a call head plus long whitespace (592 s at 1 MB, a CI stall); the three F10 env gaps; an issue_comment checkout ref taken from steps.*.outputs.

## Approved
- By: Francis · Date: 2026-10-18
- Route: large (override: 16 files, but the audit brief stands in for the spec and ESP-74/ESP-77 are the tickets, as for PR A and PR B)

## Final status
- Shipped on branch `feature/esp77-audit-pr-c` (PR to develop). AC1–AC9 shown (mutation run 19 of 19 CAUGHT, then Gate: PASS 2026-10-19T02:43:24Z).
- Deviations, all logged above:
  - AC4 also fails closed on the whole env object (toJSON(env), env.*, env[x]).
  - Round-1 fix: FOCUSED/SKIPPED allow any chain after the marker (test.only.failing).
  - Round-2 fix: FOCUSED/SKIPPED rewritten to be linear (ReDoS); namespaced calls such as ns.it.only( are no longer flagged.
  - Three full review rounds.
