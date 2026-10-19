# Spec: Security and supply chain (roadmap step 4: B9, B10)

Status: approved · Date: 2026-09-28 · Author: Francis

## Problem
Dependency and CI workflow changes are the easiest way to compromise a repo: a typosquatted or abandoned npm package, a package with a known advisory, or a workflow that runs untrusted PR text or checks out fork code with secrets. Today the plugin only notices that such files changed. The guard asks on `**/package.json` and `.github/**`, and the CI gate lists "Governance/CI/dependency files changed" (`templates/github/scripts/governance-checks.mjs:100`). Nothing inspects what the change contains. `security-reviewer` has a short checklist for both, but it reads only the diff, runs only when invoked, can't look up advisories or registry data, and gives judgement calls rather than repeatable results.

## Goals
- Rule-based checks that give the same result every time for npm dependency changes (B9) and GitHub Actions workflow changes (B10). They run at edit time (guard hook) and in the CI governance gate, so they can't be skipped.
- High-risk findings stop the change (the hook asks, the CI gate fails). Lower-risk findings are reported as warnings.
- Deeper focused review through two new agents, `supply-chain-reviewer` and `workflow-reviewer`.

## Non-goals
- Ecosystems other than npm, pnpm and yarn (no NuGet, Python, Go and so on).
- Automatically fixing findings (pinning actions, bumping versions, rewriting workflows).
- Auditing dependencies or workflows the change didn't touch.
- Providers other than GitHub Actions (GitLab CI, Azure Pipelines and so on).
- New runtime npm dependencies for the plugin.

## Requirements

**B9: npm supply chain**
- R1: Identify each dependency a change adds or changes, with its name and version or range, from `package.json` (`dependencies`, `devDependencies`, `optionalDependencies`, `peerDependencies`) and from `package-lock.json`, `pnpm-lock.yaml` and `yarn.lock`.
- R2: Flag a likely typosquat when an added package name is close to, but not the same as, a name on a bundled list of popular packages. **High risk.**
- R3: Flag an added or changed dependency version that has a known advisory. Critical or high severity is **high risk**; moderate or low is a **warning**.
- R4: Flag an added dependency that is deprecated on the registry, or whose latest release is more than 2 years old. **Warning.**
- R5: Flag an added dependency that declares `preinstall`, `install` or `postinstall` scripts. **Warning.**
- R6: Flag a lockfile change with no matching manifest change, and a version range that widens (for example `^1.2.3` to `*`, `latest` or `>=1`). **Warning.**

**B10: GitHub Actions workflows**
- R7: Flag a workflow triggered by `pull_request_target` or `workflow_run` that checks out PR-controlled code (the PR head ref or SHA). **High risk.**
  - Note (2026-10-18, ESP-77, audit F9): `issue_comment` runs with the base-repo token and secrets too, so it is treated as privileged here and in R9.
- R8: Flag untrusted event text (`github.event.*` title, body, head ref or branch name, comment body, commit message, and `github.head_ref`) placed inside a `run:` step or passed as input to an AI or agent action. **High risk.**
- R9: Flag secrets available to a job that runs PR-controlled code under `pull_request_target` or `workflow_run`. **High risk.**
- R10: Flag third-party actions not pinned to a full 40-character commit SHA (actions under `actions/*` and `github/*` are exempt), and `permissions` that are `write-all` or that widen compared with the base branch. **Warning.**

**Enforcement and operation**
- R11: At edit time, when a `Write` or `Edit` targets a manifest, lockfile or `.github/workflows/*` file, the guard evaluates the content that would result. Any high-risk finding makes the guard ask, even if the path isn't in `askPaths`. The ask reason lists every finding with its rule ID and tier. Warnings alone never produce a deny.
- R12: In CI, the governance gate runs the same checks on the PR diff. Any high-risk finding fails the gate. Warnings appear in the gate report and don't fail it. The existing `governance-approved` label overrides a failure.
- R13: When a network lookup fails (unreachable, error response, rate limit or timeout), the guard fails open: it logs a fail-open entry to `.claude/governance-log.jsonl`, the same way as A11, and still reports the offline findings. The CI gate fails closed with a reason that names the lookup that failed.
- R14: The guard's network lookups finish within the hook's timeout budget. Running out of time counts as a lookup failure (R13).
- R15: `engineering.json` can list allowlist entries (rule ID, plus a package name or workflow path) that suppress a matching finding. A suppressed finding is still reported and logged, marked as suppressed.
- R16: Every finding is recorded in `.claude/governance-log.jsonl` (guard) or the gate report (CI) with its rule ID, tier, file and detail. `governance-reviewer` counts high-risk findings and fail-opens from this log.
- R17: The guard and the CI gate take their B9 and B10 rules from the one shared rule module (A12), so both give the same verdict on the same input.

**Reviewers**
- R18: A read-only `supply-chain-reviewer` agent and a read-only `workflow-reviewer` agent review dependency changes and workflow changes in depth. They report findings in the same format as the existing reviewers (confidence scores, verdict).
- R19: `release` stage 2 runs `supply-chain-reviewer` only when the diff touches a manifest or lockfile, and `workflow-reviewer` only when it touches `.github/workflows/`. `security-reviewer` points to them for depth.

## Acceptance criteria
- AC1 (R1): Unit tests over fixture pairs (before and after) for `package.json` and each of the three lockfile formats give the exact list of added and changed `{name, version}` entries. A change that doesn't touch dependencies gives an empty list.
- AC2 (R2): Given the bundled popular list, a fixture adding `expresss` or `lodahs` gives a high-risk typosquat finding, and fixtures adding `express` or `lodash` give none.
- AC3 (R3, R13): With the advisory lookup stubbed, a critical or high advisory gives a high-risk finding, a moderate or low advisory gives a warning, and no advisory gives no finding. With the lookup stubbed to fail, the guard returns its offline result and logs one fail-open entry, and the CI check exits non-zero with "lookup unavailable" in its output.
- AC4 (R4, R5): With the registry lookup stubbed, `deprecated` gives a warning, a latest release 2 years and 1 day old gives a warning, one 2 years minus 1 day old gives none, and a package with a `postinstall` script gives a warning.
- AC5 (R6): A lockfile-only change gives a lockfile-drift warning, and `^1.2.3` → `*` gives a range-widening warning.
- AC6 (R7, R9): Fixture workflows using `pull_request_target` with `actions/checkout` at `ref: ${{ github.event.pull_request.head.sha }}`, and one that also uses `secrets.*` in that job, give high-risk findings. The same workflow on `pull_request` gives none.
- AC7 (R8): A fixture with `run: echo "${{ github.event.issue.title }}"`, and one passing `github.event.comment.body` into an AI action's prompt input, each give a high-risk finding. Passing the value through `env:` and quoting it in the shell gives none.
- AC8 (R10): `uses: some-org/action@v1` gives a warning, the same action pinned to a 40-character SHA gives none, `actions/checkout@v4` gives none, `permissions: write-all` gives a warning, and a job whose `contents: read` becomes `contents: write` compared with the base version gives a warning.
- AC9 (R11): Guard tests show that a `Write` of a fixture with a high-risk finding returns `ask` with the rule ID in the reason, even when `askPaths` is `[]`. A warning-only fixture never returns `deny`. The checks run on the post-edit content for both `Write` and `Edit`.
- AC10 (R12): Gate tests show that a high-risk finding fails the gate, warnings only give a report that passes, and the approval label turns a failure into a pass.
- AC11 (R14): A guard test with a lookup stub that never resolves returns a decision within the hook timeout and logs a fail-open entry.
- AC12 (R15): An allowlist entry that matches a finding's rule ID and package or path marks it as suppressed: it doesn't block, and it still shows in the output and the log. An entry that doesn't match changes nothing.
- AC13 (R16): After a guard run with findings, `.claude/governance-log.jsonl` has one entry per finding with `rule`, `tier`, `file` and `detail`. `governance-reviewer`'s instructions include counting them.
- AC14 (R17): One table-driven test runs every B9 and B10 fixture through both the guard entry point and the CI check entry point and asserts identical tiers.
- AC15 (R18, R19): Structure tests confirm that `agents/supply-chain-reviewer.md` and `agents/workflow-reviewer.md` exist, are read-only (no Edit or Write tools), use the confidence-scoring output, and that `release` names their path triggers. `security-reviewer` references both.
- AC16 (all): `npm test` passes, plugin validation passes, `package.json` gains no new `dependencies`, and the version is 0.8.0 in the marketplace, the plugin manifest and both READMEs.

## Constraints & decisions
- A12: a single shared rule module used by the hook, the reviewer and the CI checks. The B9 and B10 rules live there, or in modules it re-exports.
- A11: guard fail-opens are logged to `governance-log.jsonl`. R13 reuses this.
- The CI gate reads its rules from the base branch. The new checks must follow the same rule, so a PR can't weaken the checks that judge it.
- The guard hook timeout is 10 s (`hooks/hooks.json`). The network lookups and the offline checks have to fit inside it.
- No new runtime dependencies: Node built-ins and global `fetch` only. Lockfile and workflow YAML parsing has to work without a YAML library, so parsing is limited to the structures the rules need.
- Lookups use public endpoints that need no API key (the npm registry and a public advisory database).
- **New decision, suggest an ADR:** the guard hook now makes outbound network calls at edit time. Until now it ran entirely offline, and this changes its trust and latency profile. Recorded in [ADR 0001](../adr/0001-guard-network-lookups.md).

## Open questions
- Which advisory source (npm bulk advisory endpoint, OSV or GitHub Advisory DB)? Resolved in #11 (plan D1): the npm bulk advisory endpoint, with full packuments from registry.npmjs.org for registry data (D2) and version selection per D4.
- Size and source of the bundled popular-package list, and the name-distance threshold? Resolved in #11 (plan D3): about 200 popular npm names kept in the shared module; an added unscoped name of 5+ characters at optimal-string-alignment distance 1 is high risk.
- Exact list of AI or agent actions R8 recognises (for example `anthropics/claude-code-action`, `openai/*`)? Deferred: set in the B10 ticket as a list kept in the shared rule module.

## Tickets
<!-- Filled by to-tickets only when GitHub issues aren't available. -->
- #10 · Add workflow checks and tiered enforcement (B10) · Covers: R7–R12, R15–R17, R18/R19 (workflow-reviewer); AC6–AC10, AC12–AC14, AC15 (workflow half), AC16 (tests, no deps) · Blocked by: none
- #11 · Add npm supply-chain checks with lookups (B9) · Covers: R1–R6, R13, R14, R18/R19 (supply-chain-reviewer); AC1–AC5, AC11, AC14 (B9 fixtures), AC15 (supply-chain half), AC16 (incl. 0.8.0 bump) · Blocked by: #10
