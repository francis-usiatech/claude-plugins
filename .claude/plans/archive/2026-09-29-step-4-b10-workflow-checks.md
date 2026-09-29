# Plan: Workflow checks and tiered enforcement (B10)

## Goal
Add rule-based GitHub Actions workflow checks (R7–R10) to the shared rule module and enforce them by tier at edit time (guard hook) and in the CI governance gate. Also add the allowlist, per-finding logging and a read-only `workflow-reviewer` agent. This builds the enforcement path that #11 (B9) will reuse.

## Requirement references
- Spec `docs/specs/2026-09-28-security-supply-chain.md` (Status: approved): R7–R12, R15–R17, R18/R19 (workflow-reviewer part)
- Issue #10
- Roadmap step 4: B10; A11 (fail-open logging), A12 (shared rule module)

## Acceptance criteria
- AC6: Fixture workflows using `pull_request_target` with `actions/checkout` at `ref: ${{ github.event.pull_request.head.sha }}`, and one that also uses `secrets.*` in that job, give high-risk findings. The same workflow on `pull_request` gives none.
  - Evidence: workflow-rules.test.mjs "checkWorkflow: privileged trigger with PR checkout" (head checkout, +secrets, workflow_run, gh pr checkout, casing/bracket-notation refs, same on pull_request → none, base checkout → none), all passing in npm test 359/359 (shown, 2026-09-29T05:28Z)
- AC7: A fixture with `run: echo "${{ github.event.issue.title }}"`, and one passing `github.event.comment.body` into an AI action's prompt input, each give a high-risk finding. Passing the value through `env:` and quoting it in the shell gives none.
  - Evidence: workflow-rules.test.mjs "checkWorkflow: untrusted input" (run injection high, AI prompt input high, env+quoted → none with assertParsed, github-script, casing/bracket/spacing variants, whole-object toJSON, safe fields → none), passing in npm test 359/359 (shown, 2026-09-29T05:28Z)
- AC8: `uses: some-org/action@v1` gives a warning, the same action pinned to a 40-character SHA gives none, `actions/checkout@v4` gives none, `permissions: write-all` gives a warning, and a job whose `contents: read` becomes `contents: write` compared with the base version gives a warning.
  - Evidence: workflow-rules.test.mjs "checkWorkflow: pinning and permissions" (8 tests, negatives now assertParsed) + governance-checks.test.mjs "should compare permissions with the base-branch version", passing in npm test 359/359 (shown, 2026-09-29T05:28Z)
- AC9: Guard tests show that a `Write` of a high-risk workflow fixture returns `ask` with the rule ID in the reason, even when `askPaths` is `[]`. A warning-only fixture never returns `deny`. The checks run on the post-edit content for both `Write` and `Edit`.
  - Evidence: governance-policy.test.mjs "evaluate: workflow content checks" (askPaths [] → ask with [wf-untrusted-input, high]; warning-only → decision null; Edit/MultiEdit post-edit content; Edit with empty old_string creating a file is checked; unresolvable post-edit content → ask), passing in npm test 359/359 (shown, 2026-09-29T05:28Z)
- AC10: Gate tests show that a high-risk workflow finding fails the checks job even when `askPaths` does not cover the workflow path. With `askPaths` not covering the path, a warning-only change passes and lists its warnings in the report. The `governance-approved` label turns a high-risk failure into a pass. The existing `.github/**` changed-files check is unchanged: with default `askPaths`, any workflow change still needs the label.
  - Evidence: governance-checks.test.mjs "workflow content": high fails with askPaths [], warning-only passes and lists ⚠️, label → pass, default askPaths still needs label, non-ASCII workflow name checked and labelled; passing in npm test 359/359 (shown, 2026-09-29T05:28Z)
- AC12: An allowlist entry in `engineering.json` that matches a finding's rule ID and workflow path marks it as suppressed: it doesn't block, and it still shows in the output and the log. An entry that doesn't match changes nothing.
  - Evidence: governance-rules.test.mjs "allowlist (R15)" (incl. wildcard-only paths rejected) + policy and checks tests: matching entry → suppressed, non-blocking, still reported; non-matching → unchanged; plugin-structure: template ships an empty allowlist; passing in npm test 359/359 (shown, 2026-09-29T05:28Z)
- AC13: After a guard run with findings, `.claude/governance-log.jsonl` has one entry per finding with `rule`, `tier`, `file` and `detail`. `governance-reviewer`'s instructions include counting them.
  - Evidence: governance-guard.test.mjs "workflow findings (R16; AC13)": one decision "finding" entry per finding with rule/tier/file/detail, also when allowed; plugin-structure: governance-reviewer counts `finding`; passing in npm test 359/359 (shown, 2026-09-29T05:28Z)
- AC14: One table-driven test runs every B10 fixture through the guard entry point and the CI check entry point and asserts identical tiers.
  - Evidence: workflow-parity.test.mjs: all 10 fixtures give identical rule:tier sets through evaluate() and governance-checks.mjs; every fixture parses with no problems and non-empty jobs/steps; high-risk fixtures non-empty; passing in npm test 359/359 (shown, 2026-09-29T05:28Z)
- AC15: A structure test confirms that `agents/workflow-reviewer.md` exists, is read-only (no Edit or Write tools), uses the confidence-scoring output, and that `release` names its `.github/workflows/` trigger. `security-reviewer` references it.
  - Evidence: plugin-structure.test.mjs "step-4 workflow checks (B10)" + agents read-only/confidence loops + README components row, passing in npm test 359/359 (shown, 2026-09-29T05:28Z)
- AC16: `npm test` passes, `claude plugin validate` passes, and no `package.json` in the repo gains `dependencies`. The version is unchanged (0.7.1); the 0.8.0 bump lands with #11.
  - Evidence: npm test exit 0 (359/359, 0 skipped/todo); claude plugin validate exit 0 (plugin + marketplace); git diff shows no package.json change; plugin.json version still 0.7.1 (shown, 2026-09-29T05:28Z)

## Tasks
- [x] T1: `workflow-rules.mjs` with a limited, dependency-free workflow parser and rules R7–R10 (rule IDs, tiers, `{rule, tier, file, line, detail}` findings), the AI-action list, fixtures and unit tests (covers AC6, AC7, AC8; #10)
- [x] T2: re-export from `governance-rules.mjs`; add a `governance.allowlist` example to the `engineering.json` template, validate it in `sanitizeConfig` (policy) and `readConfig` (checks), and add the shared suppression logic with tests (covers AC12; #10)
- [x] T3: guard: for `Write`/`Edit`/`MultiEdit` on `.github/workflows/*`, build the post-edit content (the base is the file on disk before the edit), ask on high-risk findings whatever `askPaths` says, list findings (suppressed ones marked) in the reason, and log one entry per finding (covers AC9, AC12, AC13; #10)
- [x] T4: CI: `governance-checks.mjs` runs the shared rules on each changed workflow file (the base is the base-branch version, via `git show`), fails on unsuppressed high-risk findings unless labelled, and reports warnings and suppressed findings (covers AC8, AC10, AC12; #10)
- [x] T5: parity test: each fixture (with the same before and after content) goes through the guard `evaluate()` and a `governance-checks.mjs` subprocess run in a temporary git tree (`makeGovTree`), and the test asserts identical tiers (covers AC14; #10)
- [x] T6: `workflow-reviewer` agent; `release` stage 2 runs it when the diff touches `.github/workflows/`; `security-reviewer` points to it; `governance-reviewer` counts high-risk findings and fail-opens (covers AC13, AC15; #10)
- [x] T7: README (features and allowlist config), roadmap status, structure tests, full gate (covers AC16; #10)

## Files
- `docs/specs/2026-09-28-security-supply-chain.md`
- `docs/roadmap.md`
- `plugins/usiatech-engineering/README.md`
- `plugins/usiatech-engineering/templates/github/scripts/workflow-rules.mjs`
- `plugins/usiatech-engineering/templates/github/scripts/governance-rules.mjs`
- `plugins/usiatech-engineering/templates/github/scripts/governance-checks.mjs`
- `plugins/usiatech-engineering/templates/engineering.json`
- `plugins/usiatech-engineering/hooks/scripts/governance-policy.mjs`
- `plugins/usiatech-engineering/hooks/scripts/governance-guard.mjs`
- `plugins/usiatech-engineering/agents/workflow-reviewer.md`
- `plugins/usiatech-engineering/agents/security-reviewer.md`
- `plugins/usiatech-engineering/agents/governance-reviewer.md`
- `plugins/usiatech-engineering/skills/release/SKILL.md`
- `plugins/usiatech-engineering/tests/workflow-rules.test.mjs`
- `plugins/usiatech-engineering/tests/workflow-parity.test.mjs`
- `plugins/usiatech-engineering/tests/fixtures/workflows/*.yml`
- `plugins/usiatech-engineering/tests/governance-rules.test.mjs`
- `plugins/usiatech-engineering/tests/governance-policy.test.mjs`
- `plugins/usiatech-engineering/tests/governance-guard.test.mjs`
- `plugins/usiatech-engineering/tests/governance-checks.test.mjs`
- `plugins/usiatech-engineering/tests/plugin-structure.test.mjs`

## Commands and actions
- None beyond the normal gate (`npm test`, `claude plugin validate`). No dependency adds, no network calls.

## Out of scope
- B9 npm supply-chain checks, registry and advisory lookups, lookup-failure handling (R1–R6, R13, R14) and `supply-chain-reviewer`: all in #11
- Version bump and release notes for 0.8.0 (#11)
- Auto-fixing workflows; CI providers other than GitHub Actions
- The ADR for network calls from the hook (relevant only to #11)

## Approved
- By: Francis · Date: 2026-09-28
- Route: large (adds a new agent and a new rule module; went through clarify → to-spec → to-tickets)

## Change log
- 2026-09-28: plan drafted for ticket #10; pre-flight FLAG on AC10 (existing `.github/**` label check) resolved by rewording AC10; low-confidence notes applied to T2–T5 and Files
- 2026-09-28: added `tests/workflow-parity.test.mjs` to Files (T5 parity test in its own file); approved by Francis
- 2026-09-29: stage-2 security and silent-failure reviews FAILED (parser bypasses, quoted CI paths, silent parse fallback, Edit-create skip). Fixes F1–F8 approved by Francis; the pre-existing and out-of-scope items go to a follow-up issue.
- 2026-09-29: F1–F8 implemented test-first (NUL-separated diff paths; fail-closed `wf-unparsed` rule; quoted keys in sequence items; expression normalisation and whole-object detection; guard asks when post-edit content is unknown; template allowlist ships empty with the example in `$comment`, wildcard-only paths rejected; negative tests assert a full parse; README gate caveat). Evidence restamped.
- 2026-09-29: second-round security and silent-failure reviews FAILED on parser/GitHub read differences. Fixes G1–G5 approved by Francis and implemented test-first: unsupported double-quoted escapes, multi-line or unclosed quoted strings → `wf-unparsed`; `''` inside single quotes no longer starts a comment; content after a leading `---` parsed; `pull/<n>` fetches and `head.repo.*` checkouts flagged; `commits`/`pages`/`head.repo` whole-object passes flagged. Minor items (broad allowlist globs, rename-into-workflows base, base parse problems, Windows trailing-dot paths, computed indexes) go to the follow-up issue. Evidence restamped.
- 2026-09-29: third-round reviews FAILED on flow collections. Fixes H1–H5 approved by Francis and implemented test-first: quotes open only at the start of a flow value (plain `it's` no longer merges entries), unclosed quotes/brackets in flow collections and flow collections spanning lines → `wf-unparsed`; the multi-line test now reaches its check (mutation-checked); `.*` object filters over event objects flagged; leading BOM stripped. Evidence restamped.
- 2026-09-29: final combined review FAILED on an H2 gap (a "#" last line inside an open flow value skipped as a comment). Fix approved by Francis: a value left open on its line is checked against the next raw line, and an unclosed [ ] / { } is reported; regression tests mutation-checked. Evidence restamped. Remaining nit and low-confidence notes go to the follow-up issue.
- 2026-09-29: Windows CI failed one test (permission-removal fixture edit used an LF-only `replace`, a no-op on CRLF checkouts). Test-only fix `c27ec67` matches `\r?\n` and asserts the edit happened; reproduced and confirmed locally with a CRLF fixture. Within the plan's Files list.

## Final status
- Shipped: via PR #12 (merge commit 6674393), 2026-09-29. CI 4/4 green; npm test 359/359. Version unchanged at 0.7.1 (0.8.0 lands with #11).
- Acceptance criteria: AC6–AC10 and AC12–AC16 all shown (evidence stamped 2026-09-29T05:28Z; re-run after the CRLF test fix, 359/359).
- Deviations: four review rounds (F1–F8, G1–G5, H1–H5, H2 follow-up) hardened the parser and fail-closed paths, all approved by Francis and within the Files list; the CRLF test fix above.
- Deferred: remaining nits and low-confidence notes tracked in #13.
