# Spec: Workflow checks hardening (roadmap step 4.3)

Status: approved · Date: 2026-10-02 · Author: Francis

## Problem
The B10 workflow checks (`docs/specs/2026-09-28-security-supply-chain.md`, R7–R12, R15) shipped in 0.8.0. Reviews of PR #12 then found 13 gaps, tracked on #13, where the checks miss a risky workflow, raise a false alarm, can be bypassed, or slow down badly:
- **Rule coverage:**
  - `secrets: inherit` into a reusable workflow under `pull_request_target` isn't flagged.
  - `git clone --branch <PR ref>` isn't seen as a PR checkout.
  - Computed indexes like `github.event[format(...)]` aren't normalised.
  - Rarer valid YAML escapes are rejected.
  - Two flow-syntax forms are read in ways that may differ from GitHub's own parser.
- **Enforcement:**
  - Workflow files written through Bash skip the guard's content checks.
  - On Windows, `x.yml.` and `x.yml::$DATA` get past the guard's workflow-path test.
  - Broad allowlist globs suppress a rule for every workflow.
  - A file renamed into `.github/workflows/` is compared against an unrelated old file.
  - Parse problems in the old version can drop `wf-permissions-widened` warnings.
- **Quality:**
  - `stripComment` and `splitFlow` disagree on when a quote opens.
  - `KEY_RE` and the expression regex can take quadratic time on large inputs.

CI still catches most of the enforcement gaps (the B10 gate runs on every PR), but the guard is meant to catch them at edit time (R11), and the rule gaps are missed in both places.

## Goals
- Every gap on #13 is either fixed, with a test that failed before the fix, or closed with written evidence that it isn't a real gap.
- The guard and the CI gate give the same results on the same workflow content, as before.
- Ships as 0.10.0, together with the #38 mutation-runner fix.

## Non-goals
- Automatically fixing findings.
- New reviewer agents, or changes to `workflow-reviewer`.
- Checking workflows that the change didn't touch.
- Adding a YAML library or any other dependency.
- The PR #28 nits (`persist-credentials`, `concurrency` in this repo's own `test.yml`), which get a separate plan.

## Requirements
**Rule coverage**
- R1: A job that calls a reusable workflow with `secrets: inherit` under `pull_request_target` or `workflow_run` is flagged `wf-privileged-secrets` (high risk), like other secrets reachable by PR-controlled code (B10 R9).
- R2: A `run` step that clones or fetches the PR head ref or SHA with `git` (`git clone --branch`, `git fetch … && git checkout`, and similar) in a privileged workflow is flagged `wf-privileged-checkout` (high risk), like `actions/checkout` with a PR ref (B10 R7).
- R3: Expressions that reach untrusted event fields through computed indexes (e.g. `github.event[format(...)]`, `github['event']['pull_request']…` with nested or computed keys) are flagged `wf-untrusted-input`. Where the field can't be worked out, the expression counts as untrusted.
- R4: Valid YAML double-quoted escapes (including `\b`, `\r`, `\e`, `\ `, `\/`, `\N`, `\_`, `\L`, `\P`, `\x..`, `\u....`, `\U........`) parse without `wf-unparsed`. Invalid escapes still give `wf-unparsed`.
- R5: For `on: [ pull_request_target: null ]` and `{name:'x, run: …'}`, the parser's reading matches GitHub's, or the form is reported `wf-unparsed`. Either way, the evidence (GitHub docs, the YAML spec, or a test-repo run) is recorded on #13.

**Enforcement**
- R6: After a Bash command, any `.github/workflows/*.yml`/`.yaml` file whose content changed during that command is checked with the workflow rules. That covers the working tree and, in a git repo, the index and every branch, tag and HEAD the command moved or created (a workflow committed or staged without changing the files on disk; added 2026-10-07 after the stage 2 security review). High-risk findings are shown to Claude and the user straight away and logged to `.claude/governance-log.jsonl`, as with an edit-time finding. The snapshot the hook compares against is trusted only when it is safe (added 2026-10-07 after the stage 2 security review): every git id in it must be a 40- or 64-character hex SHA, git is called with `--end-of-options` before any revision, and the snapshot folder must be a real folder (not a link) that, on POSIX, the user owns and no one else can write to. Snapshot files are written owner-only (0600). A snapshot that fails these checks is logged and the hook falls back to comparing against HEAD.
- R7: The guard treats a path as a workflow path even when it carries Windows trailing dots or spaces, or an alternate data stream suffix (`x.yml.`, `x.yml ` , `x.yml::$DATA`, `x.yml:stream`), so its content is checked. Dependency manifests and lockfiles (`package.json.`, `package.json::$DATA`) get the same treatment (added 2026-10-07).
- R8: An allowlist entry for a workflow rule suppresses findings only when its path names one literal file (no `*`, `?`, `[`, `{` or `**`) and its rule isn't `wf-unparsed`. Any other entry suppresses nothing and is reported as a warning that names the entry, in both the guard and CI. The config stays valid.
- R9: In CI, a file renamed into `.github/workflows/` from a non-workflow path is checked as a new workflow (no "before" version), so permission and other comparisons aren't made against the unrelated old file.
- R10: When the old version of a workflow can't be parsed, `wf-permissions-widened` is still evaluated: the old version counts as having no permissions granted, and the warning reports that the comparison was made against an unparsable version.

**Quality**
- R11: Comment stripping and flow splitting use one shared rule for when a quote opens, and both give the same result on the same input.
- R12: Checking a workflow takes time roughly linear in its size. A 1 MB worst-case input built to trigger backtracking in the key and expression patterns is checked in under 1 s, both in the guard and in CI.

**Release**
- R13: The plugin ships as 0.10.0 with release notes covering this spec and #38. The README documents the new detections, the Bash after-check and the allowlist rule.

## Acceptance criteria
- AC1 (R1): A fixture workflow with `pull_request_target` and a job `uses: ./.github/workflows/x.yml` plus `secrets: inherit` gives `wf-privileged-secrets` (high). The same job under `pull_request` gives no finding.
- AC2 (R2): Fixtures with `git clone --branch ${{ github.head_ref }}`, `git fetch origin ${{ github.event.pull_request.head.sha }}` followed by a checkout, and `gh pr checkout` under `pull_request_target` each give `wf-privileged-checkout` (high). The same steps under `pull_request` give none.
- AC3 (R3): `github.event[format('{0}', 'pull_request')].title`, `github['event']['pull_request']['body']` and `github.event[inputs.key]` in a `run` step each give `wf-untrusted-input`. `github.event[format(...)]` used only inside an `if:` condition gives nothing.
- AC4 (R4): A fixture holding each listed escape in a double-quoted scalar parses with zero `wf-unparsed` findings, and the decoded values match the YAML 1.2 spec. `"\q"` still gives `wf-unparsed`.
- AC5 (R5): #13 has a comment with the evidence for each of the two forms. For each one, a test pins the parser's chosen behaviour (either the matching parsed shape or `wf-unparsed`).
- AC6 (R6): In a test that runs the after-Bash hook on a temp repo, writing a high-risk workflow via a shell command (heredoc and `cp`) gives output naming the rule ID and file, and a log entry. A Bash command that changes no workflow file gives no output and no workflow log entry, the snapshot plus the hook's check take under 100 ms timed inside the test process (median of 10 runs, in at least one of up to three rounds; ESP-41) on a repo with 20 workflow files and no git, the spawned hook loads no rules module, and in a git repo the no-change path runs exactly 4 git commands (2 in the guard, 2 in the hook). A workflow committed or staged by the command without changing the files on disk (`git update-index --cacheinfo` + `git commit` + `git checkout --`, or a commit on another branch) is reported like a written one. A command that writes a workflow and then fails (`PostToolUseFailure`) is checked too. A snapshot holding a ref like `--output=<path>`, or one that isn't JSON, is logged as not valid, git writes no file, and the HEAD fallback runs. A snapshot folder that is a link, or (POSIX) owned by another user or writable by group or others, is refused and logged.
- AC7 (R7): On Windows, guard tests for `Write` to `.github/workflows/x.yml.`, `x.yml ` and `x.yml::$DATA` with high-risk content each produce an ask naming the rule. The same paths are not treated as workflows on POSIX, where they are ordinary names.
- AC8 (R8): Allowlist entries `{rule: 'wf-unpinned-action', path: '.github/workflows/*'}`, `{…, path: '**/*.yml'}` and `{rule: 'wf-unparsed', path: '.github/workflows/ci.yml'}` suppress nothing, and each gives one warning naming the entry, in both the guard and CI tests. A literal-path entry still suppresses its finding and is logged as suppressed (B10 R15).
- AC9 (R9): A governance-checks test renames `docs/x.yml` (with `permissions: write-all`) to `.github/workflows/x.yml` and gets the findings of a newly added workflow, not a comparison with the old file.
- AC10 (R10): An old version with a parse problem and a new version that adds `contents: write` gives `wf-permissions-widened`, and its message says the old version couldn't be parsed.
- AC11 (R11): A shared quote test table (quotes at line start, after `:`, after `,`, inside plain scalars, after `#`) gives identical "quote opens here" answers from both functions.
- AC12 (R12): A test builds 1 MB worst-case inputs for each changed pattern and asserts that `checkWorkflow` finishes in under 1 s. Before the fix, the same test exceeds the limit (recorded in the PR).
- AC13 (R13): `plugin.json`, `marketplace.json` and the READMEs say 0.10.0. The README sections for R1–R3 and R6–R8 are updated. A release tag in the configured `DDMMMYYYY-XX` format exists on `main`, and `claude plugin update usiatech-engineering@usiatech` installs 0.10.0.
- AC14 (all): `npm test` passes with 0 failures and 0 skipped/todo, `fake-pass-check.mjs` exits 0, and both `claude plugin validate` runs exit 0. The guard and CI give the same findings on every new fixture.

## Constraints & decisions
- The B9/B10 spec constraints still apply: Node built-ins only, no YAML library, the same rule module is used by the guard and CI, and anything that can't be parsed fails closed (`wf-unparsed`).
- ADR-0001 (guard network lookups) isn't affected: everything here is offline.
- R6 adds a `PostToolUse` hook for Bash to the plugin. This is the plugin's first post-tool hook; it is registered on `PostToolUse` and `PostToolUseFailure` and runs after every Bash command. It isn't hard to reverse (it's one hook entry), so no ADR is needed. Its run time on a Bash command that touches no workflow file must stay under 100 ms beyond Node start-up. AC6 measures this as the snapshot plus the hook's check timed in-process, plus a check that the spawned hook loads no rules module. This was changed on 2026-10-07: Node start-up alone varied from 47 to 700 ms on Windows depending on load, so spawned timings, even against a bare `node` baseline, were too noisy to test. In a git repo the guard and the hook each add 2 git commands (about 17 ms each here); AC6 counts them rather than timing them, for the same reason. Changed again on 2026-10-12 (ESP-41): the in-process median went over 100 ms once (102.7 ms) on a busy machine and failed the whole gate, so the test takes up to three rounds of 10 runs and passes when one round's median is under 100 ms. This rides out a short busy moment, not sustained load.
- Known limitation of R6: a Bash command can still rewrite its own snapshot through a path the guard's ask on snapshot paths (`usiatech-governance`, `bash-wf-`) doesn't match. The R6 snapshot checks only stop a rewritten snapshot from passing options to git; they don't stop it from hiding a change. This is accepted for 0.10.0 and is stated in the PR.
- Known limitation of R6: a workflow pushed from a commit no local branch, tag or HEAD points to (built with `git commit-tree` and pushed as `<sha>:refs/heads/x`, or pushed to a URL) is not seen, because only remote-tracking refs move and the hook doesn't watch them (fetches would make every teammate's workflow a "change"). Accepted for 0.10.0 (2026-10-07), stated in the PR, with a follow-up ticket.
- R8 changes how existing configs behave: broad entries stop suppressing. This is intended (decided in clarify, 2026-10-02) and goes in the release notes.
- New rule detections (R1–R3) are high risk where they extend an existing high-risk rule, so they cause the guard to ask and the CI gate to fail.

## Open questions
- How does GitHub read the two flow-syntax forms in R5? (deferred: answered by the R5 investigation ticket; the AC requires the evidence before that ticket closes)
- Should a high-risk finding from the after-Bash check (R6) also make the next Bash or edit ask until the file is fixed? (deferred: R6 only requires the finding to be shown and logged at once; a sticky block can be a later item if it proves needed)

## Tickets
<!-- Filled by to-tickets only when GitHub issues aren't available. -->
- #43 · Unify quote rule and make patterns linear-time · Covers: R11, R12; AC11, AC12, AC14 · Blocked by: none
- #44 · Accept all YAML escapes; settle two flow forms · Covers: R4, R5; AC4, AC5, AC14 · Blocked by: #43
- #45 · Detect secrets: inherit, git PR checkout, computed index · Covers: R1, R2, R3; AC1, AC2, AC3, AC14 · Blocked by: #43
- #46 · Tighten allowlist, renames and widened-permission checks · Covers: R8, R9, R10; AC8, AC9, AC10, AC14 · Blocked by: none
- #47 · Guard: Windows path tricks and after-Bash workflow check · Covers: R6, R7; AC6, AC7, AC14 · Blocked by: none
- #48 · Release 0.10.0 with README and release notes · Covers: R13; AC13, AC14 · Blocked by: #43, #44, #45, #46, #47
