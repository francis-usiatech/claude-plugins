# Plan: Detect secrets: inherit, git PR checkout, computed index (ESP-4, was #45)

## Goal
Three privileged or untrusted-input patterns that the workflow rules miss today get flagged:
- a reusable-workflow call that passes `secrets: inherit` under a privileged trigger;
- a `git clone`/`git pull` of the PR head in a privileged workflow;
- expressions that reach event fields through a computed or quoted-numeric index.

## Requirement references
- Spec `docs/specs/2026-10-02-workflow-checks-hardening.md` (Status: approved): R1, R2, R3; AC1, AC2, AC3, AC14
- Jira ESP-4 (was GitHub #45, closed 2026-10-05 as moved to Jira; spec ticket T3, parent ESP-2 / #13)
- #45 comment 2026-10-04 (from the #43 security review): `github.event.commits['0'].message` is not flagged. The #43 plan deferred it to this ticket (R3).

## Acceptance criteria
- AC1 (spec AC1): Fixture `tests/fixtures/workflows/prt-reusable-secrets.yml` has `on: pull_request_target` and a job with `uses: ./.github/workflows/x.yml` plus `secrets: inherit`. It gives `wf-privileged-secrets` (high) at the job's line. The job has no steps and no checkout: the called workflow can't be seen, so this fails closed. The same job gives the same finding under `workflow_run`, and no finding under `pull_request`. Each case is pinned by a test in `tests/workflow-rules.test.mjs`. A job that already checks out PR code and has `secrets: inherit` still gives exactly one `wf-privileged-secrets`.
  - Evidence: npm test 801/801 (scratchpad npmtest-45e1.log, 45e2.log): describe "checkWorkflow: reusable workflow call with secrets: inherit (ESP-4, R1; AC1)" 8/8 pass (fixture gives exactly one wf-privileged-secrets:high at line 4; workflow_run gives it; pull_request none; non-string uses fails closed; detail gives the fix; a job with uses + checkout + inherit gives exactly one). Mutation (T3 branch off) fails 3; (non-null uses → string only) fails 1; (fix hint removed) fails 1 (shown, 2026-10-06T18:35Z)
- AC2 (spec AC2): Fixture `tests/fixtures/workflows/prt-git-clone.yml` (on `pull_request_target`) has one job per step listed below. Each job gives `wf-privileged-checkout` (high), so the parity test covers all five. Tests pin `wf-privileged-checkout` for each of these under `pull_request_target`:
  - `git clone --branch ${{ github.head_ref }} <url>`
  - `git clone ${{ github.event.pull_request.head.repo.clone_url }}`
  - `git pull origin ${{ github.head_ref }}`
  - `git fetch origin ${{ github.event.pull_request.head.sha }} && git checkout FETCH_HEAD`
  - `gh pr checkout ${{ github.event.number }}`

  The same steps under `pull_request` give no `wf-privileged-checkout`. The `wf-untrusted-input` that `${{ github.head_ref }}` in a `run` already gives on any trigger is unchanged. `git clone https://github.com/o/r` with no PR ref gives no `wf-privileged-checkout`. A 1 MB `run` made of repeated `git clone ` and `git pull ` runs in under 1 s.
  - Evidence: npm test 801/801: describe "checkWorkflow: git clone and pull of the PR head (ESP-4, R2; AC2)" all pass (prt-git-clone.yml gives 5 wf-privileged-checkout:high; clone --branch / clone_url / pull / fetch / gh pr checkout each flagged under prt, none under pull_request; head_ref still wf-untrusted-input; plain clone unflagged; git -C / -c / --git-dir= / quoted, part-quoted (-c http.extraheader="…") and $(…) option values before the subcommand flagged; 1 MB clone/pull run, 1 MB "git -c k=v" and 1 MB unclosed-quote option runs each under 1 s). Mutation (clone|pull removed) fails 4; (global-option group removed) fails 4; (chunked option values → previous form) fails 3 (shown, 2026-10-06T18:35Z)
- AC3 (spec AC3): Each of these in a `run` step gives `wf-untrusted-input` (high):
  - `${{ github.event[format('{0}', 'pull_request')].title }}`
  - `${{ github['event']['pull_request']['body'] }}`
  - `${{ github.event[inputs.key] }}`
  - `${{ github[matrix.ctx].pull_request.title }}`
  - `${{ github.event.commits['0'].message }}`

  The fixture `tests/fixtures/workflows/computed-index.yml` holds the first three. `github.event[format(...)]` used only in a step's `if:` gives nothing. Wide rule (Francis, 2026-10-05): any non-literal index (not a number, a quoted string or `*`) on a `github` or `github.event…` path is flagged, whatever field follows. So `github.event.commits[inputs.i].id` and `github.event.pull_request.labels[matrix.i].name` are both flagged, pinned by a test. A literal index stays as today: `github.event.commits[0].id` gives nothing, and `github.event.commits[0].message` is flagged. A 1 MB worst case for each new or changed pattern (an unclosed `github.event[`, or a long chain of `github.event.a.a.a…`) runs in under 1 s, in the same style as the #43 timing tests.
  - Evidence: npm test 783/783: describe "checkWorkflow: computed and quoted-numeric index into event fields (ESP-4, R3; AC3)" all pass (format / quoted keys / inputs.key / github[matrix.ctx] / commits['0'] / wide commits[inputs.i].id and labels[matrix.i].name flagged; if-only gives nothing; commits[0].id nothing, commits[0].message flagged; computed-index.yml 3 findings; github[ inside a string literal gives nothing; a computed index between literals holding "[" and "]" is flagged; quoted-key and spaced literal paths give nothing; a computed index after an unclosed quote is still flagged; 1 MB unclosed github[' flagged under 1 s; 1 MB unclosed github.event[ flagged and a.a.a chain clean, each under 1 s). Mutation (computedIndex off) fails 9, (dotted numeric index removed) fails 1, (literal skip removed) fails 3, (scan the normalized text) fails 1 (shown, 2026-10-06T18:35Z)
- AC4 (spec AC14): `npm test` passes with 0 failures and 0 skipped/todo. `node plugins/usiatech-engineering/templates/github/scripts/fake-pass-check.mjs` exits 0. `claude plugin validate .` and `claude plugin validate plugins/usiatech-engineering` both exit 0. `tests/workflow-parity.test.mjs` (which reads every fixture in the folder) gives the same tiers from the guard and CI for the three new fixtures.
  - Evidence: npm test exit 0, 801/801 (two consecutive runs), 0 fail/cancelled/skipped/todo; fake-pass-check exit 0 (repo template and installed 0.9.0); claude plugin validate . exit 0; claude plugin validate plugins/usiatech-engineering exit 0; workflow-parity 45/45 incl. "should give the same tiers for" computed-index / prt-git-clone / prt-reusable-secrets (shown, 2026-10-06T18:35Z)

## Tasks
- [x] T1: Branch `fix/workflow-detect-gaps-45` off `develop`; move ESP-4 to In Progress (ESP-4)
- [x] T2: Red: AC1 tests + `prt-reusable-secrets.yml`; confirm they fail today (no finding) (covers AC1; ESP-4)
- [x] T3: Green: in `privilegedRules`, a job with a string `uses` and `secrets: inherit` under a privileged trigger gives `wf-privileged-secrets`, without a duplicate when the job also checks out PR code (covers AC1; ESP-4)
- [x] T4: Red: AC2 tests + `prt-git-clone.yml`; confirm the clone/pull cases fail today (covers AC2; ESP-4)
- [x] T5: Green: add `clone` and `pull` to the git commands that `runChecksOutPr` scans, keeping its single-pass linear scan (covers AC2; ESP-4)
- [x] T6: Red: AC3 tests + `computed-index.yml` + timing tests; confirm the computed and quoted-numeric cases fail today (covers AC3; ESP-4)
- [x] T7: Green: (a) a non-literal index (not a number, a quoted string or `*`) anywhere on a `github` / `github.event…` path counts as untrusted (fail closed); (b) `ANY_INDEX` also accepts the dotted numeric index that `normalizeExpr` produces from `['0']`. No backtracking pattern (covers AC3; ESP-4)
- [x] T8: Run the full gate: npm test, fake-pass-check, both plugin validate runs (covers AC4; ESP-4)
- [x] T9: Stage 1 + stage 2 reviews; release into `develop` via PR (Francis merges); ESP-4 → In Testing (covers AC1–AC4; ESP-4)

## Files
- `plugins/usiatech-engineering/templates/github/scripts/workflow-rules.mjs`
- `plugins/usiatech-engineering/tests/workflow-rules.test.mjs`
- `plugins/usiatech-engineering/tests/workflow-parity.test.mjs`
- `plugins/usiatech-engineering/tests/fixtures/workflows/prt-reusable-secrets.yml`
- `plugins/usiatech-engineering/tests/fixtures/workflows/prt-git-clone.yml`
- `plugins/usiatech-engineering/tests/fixtures/workflows/computed-index.yml`

## Commands and actions
- Standard gate (npm test, fake-pass-check, claude plugin validate) and release flow (branch, commit, PR into develop; Francis merges)
- Jira ESP-4 transitions and comments (In Progress at start, In Testing after the PR opens)

## Out of scope
- An explicit secrets mapping passed to a reusable workflow (`secrets: { t: ${{ secrets.X }} }`). R1 names only `inherit`. A follow-up Jira item can be filed if Francis wants it.
- Other git forms (`git worktree add`, `git reset --hard <PR sha>`, `git remote add` + fetch, `curl` of the PR archive)
- R4–R13 (ESP-3, ESP-5–ESP-7); README, version bump, release notes (ESP-7 / R13)
- ESP-17 items (nested-flow depth cap, flow-key misreads)
- Changing which event fields count as untrusted when reached by a literal index (the wide computed-index rule in AC3 is the only exception)

## Final status
- **Shipped:** commit `5c4f468`, PR #56 merged into `develop` (`4746a76`). Promotion to `main` is pending in PR #55. Jira ESP-4 → Ready for Release (comment 10782).
- AC1: met (evidence shown, 2026-10-06T18:35Z).
- AC2: met (evidence shown, 2026-10-06T18:35Z).
- AC3: met (evidence shown, 2026-10-06T18:35Z; the 801/801 run in AC4 covers it).
- AC4: met (evidence shown, 2026-10-06T18:35Z).
- **Deviations:**
  - `tests/workflow-parity.test.mjs` was added to Files during the red phase (approved by Francis).
  - Two #43 test cases that pinned the old behaviour were updated to the wide computed-index rule (approved by Francis).
  - The review findings and both security re-review gaps were fixed inside ESP-4 (approved by Francis; see the change log).
  - Claude merged PR #56 at Francis's explicit request (a one-off), instead of Francis merging it.
  - Deferred to Jira ESP-18: an explicit secrets map / `with: ref` on reusable calls, `secrets: Inherit` casing, line continuations or a 9th git option, env-var refs, `gh repo clone`, `git remote add` + fetch, `git worktree add`, `git reset --hard`, and pointing the finding at the `secrets` line.
  - Possible timing flakes under load: the 1 MB clone/pull test (1.4 s once in a full run) and the AC11 1000 ms lookup timeout on CI windows/Node 20 (passed on rerun). Neither is changed by ESP-4.
  - No version bump: ships with 0.10.0 (ESP-7).

## Approved
- By: Francis · Date: 2026-10-05
- Route: large (ESP-4 is one ticket from the approved large-route spec, already through clarify → to-spec → to-tickets)

## Change log
- 2026-10-05: plan drafted for ESP-4 (#45). Baseline probe on develop `de55a3f`:
  - AC1 inherit (prt) gives no finding.
  - `git clone --branch head_ref` gives only `wf-untrusted-input`.
  - `git fetch` and `gh pr checkout` are already flagged.
  - `github['event']['pull_request']['body']` is already flagged.
  - The format / `inputs.key` / `commits['0']` indexes give no finding.
- 2026-10-05: pre-flight FLAG (governance-reviewer):
  1. The breadth of the computed-index rule: Francis chose **wide**. Any non-literal index on a github/event path is flagged, whatever field follows. Written into AC3 and Out of scope.
  2. All five AC2 steps go in `prt-git-clone.yml` so parity covers them; the Files list doesn't change.
  3. Low note: AC2 adds a 1 MB timing case for the git-command scan.
- 2026-10-05: red phase (T2/T4/T6) found that the parity full-parse check requires steps in every job, so the stepless AC1 fixture fails it.
  - Francis approved adding `tests/workflow-parity.test.mjs` to Files: a job passes that check if it has non-empty steps or a string `uses`.
  - Francis also chose to flag an unclosed `github.event[` as `wf-untrusted-input` under the wide rule; the timing test expects that finding.
- 2026-10-05: green phase broke 2 #43 tests that pinned the old behaviour, both in `workflow-rules.test.mjs`. Francis approved updating them to expect `wf-untrusted-input:high`, in line with the wide rule and the unclosed-`[` decision:
  - `commits[fromJSON('[0]')[0]].id`
  - the 1 MB unclosed `github.event.commits[` timing test
- 2026-10-06: fake-pass-check flagged the two parse-only tests (assertParsed alone); folded each into its fixture's findings test (existing pattern). Gate rerun 2026-10-06T03:35Z: npm test 783/783, fake-pass 0 (both), validates 0.
- 2026-10-06: Francis approved fixing the review findings in ESP-4, all inside Files:
  - Conventions: the reusable-call finding detail gives a fix; the GITHUB_PATH comment reworded; `checkContent` moved up with the other test helpers.
  - Silent-failure: any non-null `uses` with `secrets: inherit` gives the finding (fail closed); the parity check requires `steps === undefined` for a uses-only job; the "exactly one" test now has `uses`.
  - Security 1 (Medium): up to 8 git global options may come before the subcommand (`git -C d clone`, `git -c k=v fetch`). The bounded group reads each token one way and stays linear (1 MB test).
  - Security 2 (Low): string literals are blanked before the computed-index scan, so `'github[bot]'` isn't flagged; an unclosed quote still fails closed.
  - Francis also approved filing a Jira follow-up (child of ESP-2) for the out-of-scope gaps.
  - Gate rerun 2026-10-06T16:59Z: npm test 794/794, fake-pass 0 (both), validates 0.
- 2026-10-06: security re-review of the fix delta: PASS WITH NITS, two gaps in the new fixes. Francis approved fixing both:
  - Medium: an option value with a quote partway through (`git -c http.extraheader="AUTHORIZATION: basic $T" fetch …`) broke the option chain. Each value is now a run of quoted and unquoted chunks; still bounded to 8 options and linear. Continuations and a 9th option stay a gap (Jira follow-up).
  - Low: `format('{0}', 'x[', github[inputs.k], ']')` was hidden by normalizeExpr's ['key'] rewrite. computedIndex now reads the expression as written (lowercased), skipping closed literals token by token.
  - Released for review 2026-10-06: commit 5c4f468, PR #56 into develop; ESP-4 → In Testing (comment 10781); follow-up filed as ESP-18 (child of ESP-2).
  - Gate 2026-10-06T18:35Z: npm test 801/801 on two consecutive runs (one earlier run had the 1 MB clone/pull timing test at 1.4 s under full-suite load; alone it takes ~60 ms, and that input is unchanged by this fix). fake-pass 0 (both), validates 0.
