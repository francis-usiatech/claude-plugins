# ADR 0002: Fake-pass checks fail the CI gate

Status: Accepted (Francis, 2026-09-30) · Date: 2026-09-30 · Author: Francis

References: spec `docs/specs/2026-09-30-fake-pass-and-mutation-test.md` (R1–R11, D1–D8, D12), roadmap A6 (step 4.2).

## Context

The verification gate (`verify` locally, `run-verify.mjs` in CI) trusts a green test run. A `.only`, a `.skip`, an empty test body or a test with no assertion makes a run green without proving anything. An agent trying to reach "done" can produce such a change, and so can a person. Until now, the gate's result depended only on the exit codes of the commands in `.claude/engineering.json`, never on what the tests contain.

The B9/B10 checks set the pattern for content checks:
- one shared rule module
- read from the base branch in CI
- tiered findings
- `governance.allowlist` for justified exceptions
- the approval label to override a failure

## Decision

Add a shared fake-pass rule module (`fp-*` rules). It scans every changed JS/TS test file in full and fails on:
- focused tests
- skipped or pending tests
- empty test bodies
- test bodies with no recognised assertion
- unreadable test files

It warns on placeholder text (`TODO`, `FIXME`, `XXX`, "not implemented").

The local `verify` skill runs it after its commands pass. The CI gate runs the base-branch copy, and it fails on any unsuppressed fail finding unless the approval label is present. Detection is line and pattern based, with no parser and no dependencies.

## Consequences

- **The CI gate can now fail on a heuristic.** "No recognised assertion" can flag a test that asserts through a helper. The documented way through is an allowlist entry with a reason; the finding is still reported. The assertion list lives in one place in the module, so extending it is one edit.
- **Touching a file means owning its debt.** Whole changed files are scanned, so editing an old test file with a legacy `.skip` blocks until the skip is fixed or allowlisted. Unchanged files are never scanned.
- **Consumer repos opt in by re-copying.** Nothing changes in a repo until it re-copies `templates/github/scripts/`. After that, backing the rule out takes another plugin release and another re-copy in every repo, which is why this is recorded as an ADR.
- **Coverage is JS/TS only.** Repos in other languages get no fake-pass protection yet; the gate behaves as before for their files.
- **Local and CI parity.** A table-driven test runs every fixture through both entry points, so `verify` and CI can't drift apart.

## Alternatives considered

- **Added lines only.** This avoids blocking on old debt in touched files, but a new `.only` placed next to an old one, or code moved inside a file, could slip through with less signal. Rejected in favour of scanning whole changed files (spec D2).
- **Warn only.** This never blocks, but "Gate: PASS" would still be reachable with a skipped test, which is the failure A6 exists to stop.
- **Report no-assertion tests as warnings.** This has fewer false positives, but an assertion-free test is the most common way an agent fakes a pass. The allowlist handles real exceptions (spec D5).
- **An AST parser (for example TypeScript or Babel).** More precise, but it adds a runtime dependency and breaks the plugin's zero-dependency rule.
- **Guard hook enforcement at edit time.** Deferred. The user chose `verify` + CI, and the same module can be added to the guard later.
