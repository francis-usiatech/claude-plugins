# Plan (archived): Audit PR A — CI gate fixes (ESP-75)

## Goal
Close the CI gate bypasses from the 2026-10-17 ponytail audit: a forged verdict marker (F1), a skipped AI review on PR edits and label events (F2), a governance file renamed out of its folder (F5), and an immutable file turned into a symlink (F7). Read the approval label from config in every script that uses it (F11). Commit the audit, and add a root `AGENTS.md` so `convention-reviewer` keeps enforcing the audit's recurring-bug rules.

## Requirement references
- `docs/audits/2026-10-17-ponytail-audit.md` F1, F2, F5, F7, F11, and its "How to use this brief" rules (test-first, smallest fix, no new dependencies)
- ESP-75 (sub-task of ESP-74)

## Pre-plan checklist
- (a) New validation rules and format checks:
  - F2: the gate's skipped-review rule. Its only caller is `pr-governance.yml` (gate job env). Fixtures: `tests/governance-gate.test.mjs` `:93` ("should not demand or fetch a verdict when the AI review was skipped"), which changes to the opt-out case. `tests/workflow-parity.test.mjs` doesn't read the gate env.
  - F5 and F7: the changed-files loop in `governance-checks.mjs` `:131-139`. Fixtures: `tests/governance-checks.test.mjs`, which uses `makeRepo` with `headFiles`. The rename and type-change cases need git operations in the fixture repo.
  - F11: `approvalLabel` is read in `governance-checks.mjs:101` (via `stringValue`), in `governance-gate.mjs:12` (env) and in `post-verdict.mjs:35` (hard-coded text). Tests set `APPROVAL_LABEL: ''` at `governance-gate.test.mjs:24`. `makeGovTree(config)` in `tests/helpers.mjs` already builds a base tree with a config, so the gate and post-verdict tests can use it.
  - F1: the gate's marker regex at `governance-gate.mjs:35` and `post-verdict.mjs` `esc`. The `marker()` helper in `post-verdict.test.mjs` reads the real marker, which `esc` doesn't touch.
- (b) Database or infrastructure mechanisms the design relies on:
  - F11 reads `<script dir>/../../.claude/engineering.json`, the same base-branch root that `governance-checks.mjs` uses (`SCRIPT_GOV_ROOT`). The gate and post-verdict jobs already check out `_gov`, so no spike is needed.
  - F2 relies on the `vars`, `draft` and `head.repo.full_name` expressions that the `ai-governance-review` `if:` already uses.
  - F2 was not run end to end on GitHub (the audit says so too). It is proven by unit tests only.
- (c) Docs and ADRs touched: searched the README, the docs and the ADRs for `governance-gate`, `APPROVAL_LABEL`, `governance-approved` and "skipped".
  - Touched: `plugins/usiatech-engineering/README.md`. Line 107 (gate rules) gets the skipped-review rule and "the configured approval label". The 0.18.1 Versioning row gets the fixes and an upgrade note: re-copy `templates/github/` (workflow and scripts).
  - `setup-engineering/SKILL.md:24` and `pull_request_template.md` name the default label, which stays correct as the default, so they're unchanged.
  - No ADR covers these rules. No docs reviewer is configured.

## Acceptance criteria
- AC1 (F1): a summary or finding that contains `<!-- governance-verdict {...} -->` is posted with `<` escaped as `&lt;`. A bot comment with a forged PASS marker before the real BLOCK marker is read as BLOCK, and the gate exits 1.
  - Evidence: governance-gate.test.mjs "should read the last verdict marker in a comment, so a forged marker in the AI text is ignored (F1)" and post-verdict.test.mjs "should escape a verdict marker in the AI text so it cannot pose as the real one (F1)": red before the fix, green after; mutations "F1 esc keeps <" and "F1 gate reads first marker" CAUGHT (shown, 2026-10-18T03:36Z)
- AC2 (F2): a skipped `ai-governance-review` with no opt-out (`GOVERNANCE_AI_REVIEW` not `off`, not a draft, not a fork) and no verdict for the head SHA fails the gate. With a FLAG verdict for the head SHA and the approval label, it passes (the label-event flow). An opt-out, a draft or a fork with a skipped review still passes without a verdict, as today. The workflow passes `GOVERNANCE_AI_REVIEW`, `PR_DRAFT` and `PR_FORK` to the gate step.
  - Evidence: governance-gate.test.mjs "should demand a verdict when the AI review was skipped by an edit or label event (F2)", "should pass a skipped review on a label event when the head commit has a FLAG verdict and the label (F2)" and "should not demand or fetch a verdict when the AI review was skipped by an opt-out, a draft or a fork"; workflow gate step env added; 4 F2 mutations CAUGHT (shown, 2026-10-18T03:36Z)
- AC3 (F5): `git mv .github/workflows/sec.yml old/sec.yml` without the approval label fails `governance-checks` and names the source path.
  - Evidence: governance-checks.test.mjs "should require the approval label when a governance file is renamed out of its folder (F5)": red, then green; mutation "F5 rename checks target only" CAUGHT (shown, 2026-10-18T03:36Z)
- AC4 (F7): replacing a committed immutable file with a symlink (status `T`) fails `governance-checks`.
  - Evidence: governance-checks.test.mjs "should reject a committed immutable file turned into a symlink (F7)": red, then green; mutation "F7 type change ignored" CAUGHT (shown, 2026-10-18T03:36Z)
- AC5 (F11): with `governance.approvalLabel: "owner-ok"` in the base config, the gate accepts `owner-ok` on a FLAG verdict and rejects `governance-approved`, and the FLAG comment from post-verdict names `owner-ok`. With no config, both use `governance-approved`. The workflow no longer sets `APPROVAL_LABEL`.
  - Evidence: governance-gate.test.mjs "should read the approval label from the base-branch config (F11)" and post-verdict.test.mjs "should name the approval label from the base-branch config in a FLAG comment (F11)"; APPROVAL_LABEL removed from pr-governance.yml; 2 F11 mutations CAUGHT (shown, 2026-10-18T03:36Z)
- AC6: the root `AGENTS.md` lists the four rules in T3, and the audit file is committed.
  - Evidence: AGENTS.md created at the repo root with the four rules; docs/audits/2026-10-17-ponytail-audit.md staged with this PR (shown, 2026-10-18T03:36Z)
- AC7: `node plugins/usiatech-engineering/skills/verify/gate.mjs` prints Gate: PASS. A mutation-test run on the changed gate and checks lines has no survivors.
  - Evidence: repo runner node plugins/usiatech-engineering/skills/verify/gate.mjs printed Gate: PASS at 2026-10-18T03:36:32Z, after the last file change (a 03:33Z run failed only on the load-sensitive after-Bash timing test, measured while four reviewers were running) (tests, both validations, fake-pass check); mutation run 10 of 10 CAUGHT, 0 SURVIVED (shown, 2026-10-18T03:36Z)
## Tasks
- [x] T1: Failing tests first (tdd): forged marker (gate and post-verdict), skipped review without an opt-out, the opt-out, draft and fork cases, the label-event pass, rename out of an ask path, type change on an immutable path, custom approval label (gate and post-verdict) (covers AC1–AC5; ESP-75)
- [x] T2: Fixes, all smallest-change (covers AC1–AC5; ESP-75):
  - `esc` also replaces `<` with `&lt;`.
  - The gate takes the last marker in each comment via `matchAll`.
  - `aiSkipped` counts as an opt-out only when `GOVERNANCE_AI_REVIEW === 'off'`, `PR_DRAFT === 'true'` or `PR_FORK === 'true'`. Otherwise the gate scans for a verdict.
  - `matchAny` runs on both `p1` and `p2`.
  - The immutable-file regex becomes `/^[MDRT]/`.
  - One shared `approvalLabel(govRoot)` reader in `governance-rules.mjs`, used by the gate and by post-verdict. A missing or bad config falls back to the default, because `governance-checks` already fails the PR on a bad config.
  - `pr-governance.yml`: drop the workflow-level `APPROVAL_LABEL` and add the three env lines to the gate step.
- [x] T3: Add the root `AGENTS.md` with the four rules that hold today: `git diff` and `git ls-files` with `-z` and `core.quotePath=false`; config values read from `engineering.json`, never hard-coded; shared helpers imported from `governance-rules.mjs`; export only what another file imports. The `isMainModule` and `GIT`-prefix rules wait for PR B (ESP-76). Update the README (gate rules line, 0.18.1 row) (covers AC6; ESP-75)
- [x] T4: Run the gate, then a mutation test on the changed lines (covers AC7; ESP-75)

## Files
- `docs/audits/2026-10-17-ponytail-audit.md`
- `AGENTS.md`
- `plugins/usiatech-engineering/templates/github/scripts/governance-gate.mjs`
- `plugins/usiatech-engineering/templates/github/scripts/post-verdict.mjs`
- `plugins/usiatech-engineering/templates/github/scripts/governance-checks.mjs`
- `plugins/usiatech-engineering/templates/github/workflows/pr-governance.yml`
- `plugins/usiatech-engineering/tests/governance-gate.test.mjs`
- `plugins/usiatech-engineering/tests/post-verdict.test.mjs`
- `plugins/usiatech-engineering/tests/governance-checks.test.mjs`
- `plugins/usiatech-engineering/README.md`

## Commands and actions
- None beyond the normal gate, mutation test and release flow.

## Out of scope
- The other audit findings (PRs B–E: ESP-76 to ESP-79).
- Running F2 end to end on GitHub.
- Re-copying the CI kit into subscriber repos (WaypointCareer, HEI). The README upgrade note tells them to.
- A lean or ponytail reviewer agent (Francis chose session mode only).

## Approved
- By: Francis · Date: 2026-10-17
- Route: large (override: 11 files, but the audit brief stands in for the spec and ESP-74/ESP-75 are the tickets; Francis chose to cite the audit directly rather than write a separate spec)

## Change log
- 2026-10-17: plan drafted. The requirement reference is the audit (Francis).
- 2026-10-17: pre-flight FLAG (governance-reviewer): two `AGENTS.md` rules named helpers that PR B creates. Francis chose four rules now and the other two in PR B. AC6 wording fixed. Plan approved.
- 2026-10-17: T2 deviation (found in stage 1 review): the approval-label reader went into `governance-checks.mjs` as `readApprovalLabel`, reusing `baseConfig`, not into `governance-rules.mjs`. That is less new code and no new file. `governance-rules.mjs` was removed from Files. The gate and post-verdict now import `governance-checks.mjs`, which is safe because its main guard stops it running its checks on import.
- 2026-10-17: stage 1 FLAG items fixed: the gate re-run and the T2 deviation logged. Stage 2 (convention, silent-failure, security, workflow): all PASS. Francis deferred three nits to ESP-77 (PR C): escape `f.line` in post-verdict, fix the stale "draft PR, fork PR" hint in the gate's no-verdict message, and pass 'governance.approvalLabel' as the label in readApprovalLabel.

## Final status
- Shipped on branch `feature/esp75-audit-ci-gate` (PR to develop). AC1–AC7 shown. Deviation: the T2 reader went into `governance-checks.mjs`, as logged above.
