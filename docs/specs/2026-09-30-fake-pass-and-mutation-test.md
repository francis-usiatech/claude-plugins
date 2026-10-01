# Spec: Fake-pass checks and mutation testing (roadmap step 4.2: A6, B26)

Status: approved (Francis, 2026-09-30) · Date: 2026-09-30 · Author: Francis

## Problem
The verification gate trusts a green test run. Some changes make a run green without proving anything:
- A `.only` silently drops the rest of the suite.
- A `.skip`, `xit` or `test.todo` turns a failing test into a pass.
- A test with an empty body, or with no assertion, passes whatever the code does.

An agent under pressure to finish can reach "Gate: PASS" this way, and so can a person. Today neither `verify` (`skills/verify/SKILL.md`) nor the CI gate (`templates/github/scripts/run-verify.mjs`) looks at what the tests contain. The acceptance-criteria half of roadmap A6 already shipped with A10 (verify step 6).

A second, quieter gap: a test can exist and pass without guarding the fix it was written for. During B9 and B10, every fix set was checked by hand-written `mutate*.cjs` scripts. Each script broke one fix point, ran the tests and confirmed that a test failed. Those scripts lived in session scratchpads and were rewritten eight times. The method works, but the plugin doesn't ship it.

## Goals
- `verify` locally and the CI gate both reject fake passes in JavaScript/TypeScript tests. They use one shared rule module, so both give the same result for the same files.
- A `mutation-test` skill plus a shipped runner turn the hand-run B9/B10 mutation method into a repeatable step with a per-mutation report.

## Non-goals
- Test ecosystems other than JS/TS: no C#/.NET, Python or Go in this version.
- Parsing tests into an AST. Detection is line and pattern based.
- Automatic mutation generation or third-party mutation frameworks such as Stryker.
- Enforcing mutation results in CI or blocking a commit on a surviving mutation.
- Rewriting or removing the offending tests automatically.
- Fake-pass checks in the edit-time guard hook.
- New runtime npm dependencies for the plugin.

## Requirements

**A6: fake-pass checks**
- R1: Scan every changed JS/TS test file in full: added, modified, and locally untracked files. Deleted files are not scanned. The test-file patterns are set in D4.
- R2: Flag a focused test or suite (`.only`, `fit`, `fdescribe`). **Fail.**
- R3: Flag a skipped or pending test or suite: `.skip`, `xit`, `xdescribe`, `xtest`, `.todo`, `test.fixme`, and the node:test `{ skip: … }` / `{ todo: … }` options. **Fail.**
- R4: Flag a test whose body is empty or contains only comments. **Fail.**
- R5: Flag a test whose body has no recognised assertion call. The recognised calls are set in D6. **Fail.**
- R6: Flag placeholder markers (`TODO`, `FIXME`, `XXX`, "not implemented") in changed JS/TS files, test or source. **Warning.**
- R7: A changed test file that can't be read is a finding. **Fail** (fail closed, as `wf-unparsed` does).
- R8: A `governance.allowlist` entry matching a finding's rule ID and path glob suppresses that finding. It doesn't block, but it still appears in the output with its reason. An entry that matches nothing changes nothing.
- R9: The local `verify` skill runs the check after its commands pass. Any unsuppressed fail finding makes the result **Gate: FAIL**, and every finding is listed in the report.
- R10: The CI gate runs the same check, loaded from the base branch. An unsuppressed fail finding fails the gate unless the approval label is present, the same tier model as B9/B10.
- R11: For the same files, the local check and the CI check produce identical findings and tiers.

**B26: mutation testing**
- R12: A `mutation-test` skill has Claude pick the fix points to break and write a mutation list. The fix points are conditions, guards and early returns that the diff adds or that the plan's acceptance criteria depend on. Each entry has a label, a file, an exact find string, its replacement and the test command.
- R13: A shipped runner first runs each distinct test command unmutated. If that baseline fails, it stops and mutates nothing.
- R14: For each mutation, the runner applies it, runs the tests and reports one of:
  - `CAUGHT`: tests failed
  - `SURVIVED`: tests passed
  - `NOT-FOUND`: the find string doesn't occur exactly once
  - `TIMEOUT`
  - `ERROR`
- R15: The runner restores every mutated file byte for byte, line endings included. It restores after each mutation, on error and on interrupt. It never commits, stages or touches files outside the mutation list.
- R16: The skill reports each `SURVIVED` mutation as a missing test and asks the user whether to add one. Survivors never block.
- R17: `release` stage 2 suggests `mutation-test` when the diff touches guard, rule or check code (the paths are set in D11). It is a suggestion, not a gate.

**Both**
- R18: The plugin README documents the new rule IDs, the `mutation-test` skill, the runner's report format and the upgrade steps for consumer repos.

## Acceptance criteria
- AC1 (R1): Unit tests over fixture file sets:
  - A changed `*.test.mjs`, `*.spec.ts` or `__tests__/x.js` file is scanned.
  - A changed `src/x.js` is scanned for R6 only.
  - A deleted test file is not scanned.
  - A non-JS/TS file is not scanned.
- AC2 (R2, R3): Each pattern gives exactly one fail finding with the right rule ID:
  - `.only`, `fit`, `fdescribe`
  - `.skip`, `xit`, `xdescribe`, `xtest`, `.todo`, `test.fixme`
  - `{ skip: true }`, `{ skip: 'reason' }`, `{ todo: true }`

  A file without them gives none. The word `skip` inside a string or comment gives none.
- AC3 (R4): `it('x', () => {})` and a body with only a comment each give an `fp-empty-test` fail. A body with one statement gives none.
- AC4 (R5): A body without a recognised assertion gives an `fp-no-assert` fail. Each of these gives none: `assert.equal(`, `assert(`, `expect(`, `t.assert.`, `.should.` and `await expect(`.
- AC5 (R6): `// TODO`, `FIXME`, `XXX` and `throw new Error('not implemented')` in a changed file each give an `fp-placeholder` warning. The same text in an unchanged file gives nothing.
- AC6 (R7): An unreadable changed test file gives an `fp-unreadable` fail.
- AC7 (R8): An allowlist entry with a matching rule and path marks the finding suppressed: it doesn't fail, and it appears in the output with its reason. A non-matching entry leaves the finding unchanged.
- AC8 (R9): A test drives the local check entry point over a fixture repo with a `.only`. The exit code is non-zero and the output names the file, line and rule. `skills/verify/SKILL.md` has a step that runs the check and reports Gate: FAIL on a fail finding (checked by a structure test).
- AC9 (R10): Gate tests:
  - A fail finding fails the CI gate.
  - Warnings alone pass it, with the warnings reported.
  - The approval label turns the failure into a pass.
  - The check module is loaded from the base-branch copy (`_gov/`), not from the PR checkout.
- AC10 (R11): One table-driven test runs every fake-pass fixture through the local entry point and the CI entry point and asserts identical rule IDs and tiers.
- AC11 (R13): When the baseline test command fails, the runner exits non-zero, reports "baseline failed" and leaves every file unmodified. A byte comparison runs before and after.
- AC12 (R14): Against a fixture module and its tests:
  - Removing a tested guard gives `CAUGHT`.
  - A no-op mutation (for example, replacing a comment) gives `SURVIVED`.
  - A find string that occurs zero or two times gives `NOT-FOUND`.
  - A command that sleeps past the timeout gives `TIMEOUT`.
- AC13 (R15): After runs over CRLF and LF fixture files, including one where the test command crashes, every file matches its original byte for byte. `git status --porcelain` in the fixture repo is unchanged.
- AC14 (R12, R16, R17): Structure tests confirm:
  - `skills/mutation-test/SKILL.md` exists, with frontmatter and a description naming its triggers.
  - It documents the mutation list format and reporting survivors as missing tests.
  - `skills/release/SKILL.md` mentions `mutation-test` for guard/rule/check paths.
- AC15 (R18, all):
  - `npm test` passes on Node 20 and 22, ubuntu and windows.
  - `claude plugin validate .` and `claude plugin validate plugins/usiatech-engineering` exit 0.
  - `package.json` gains no `dependencies`.
  - The README has the `fp-*` rule table, the `mutation-test` component row and a 0.9.0 version row with upgrade steps.
  - Marketplace, plugin manifest and both READMEs say 0.9.0.

## Constraints & decisions
Decisions made while clarifying on 2026-09-30 (Francis):
- **D1: The check runs in two places, from one shared module.** It runs locally in `verify` (to catch an agent claiming done) and in the CI gate (to catch anyone merging). The module follows A12 (one shared rule module) and sits next to `workflow-rules.mjs` and `supply-chain-rules.mjs`. The CI gate reads rules from the base branch, so a PR can't weaken the check that judges it.
- **D2: Whole changed files are scanned, not just added lines.** Touching an old test file with a legacy `.skip` blocks until it is fixed or allowlisted. Unchanged files are never scanned, so old debt in untouched files doesn't block adoption.
- **D3: Findings are tiered.**
  - Fail: focused, skipped, empty, no-assertion and unreadable tests.
  - Warning: placeholder text.
  - Escape hatch: `governance.allowlist`, which needs a rule ID, path glob and reason. Suppressed findings are reported, never hidden.
- **D4: JS/TS only in this version.** Supported: node:test, Jest, Vitest, Mocha and Playwright. The extensions are `.js .mjs .cjs .jsx .ts .mts .cts .tsx`. A file counts as a test file when:
  - its name matches `*.test.*` or `*.spec.*`, or
  - it sits under a `__tests__/`, `test/` or `tests/` directory.

  Other ecosystems are later roadmap items.
- **D5: An empty test and a test with no assertion both fail.** Detecting "no assertion" is heuristic: a test that asserts through a helper can be a false positive. The allowlist is the documented way through, and the README says so.
- **D6: The recognised assertion calls are:**
  - `assert` / `assert.*`, and `t.assert.*` (node:test)
  - `expect(` (Jest, Vitest, Playwright, including `await expect(`)
  - `.should`
  - `t.plan(`

  The list lives in the shared module so it is one edit to extend.
- **D7: Detection is line and pattern based, with no AST parser and no dependencies.** It is matched after stripping comments and string literals, so `'skip'` in a message doesn't match. This is the same trade-off B9/B10 made for YAML and lockfiles.
  - **Known limits (accepted in the #20 review, fix set 1):** aliases (`const o = it.only`), computed access (`it['only']`) and conditional calls (`(c ? it.skip : it)(…)`) aren't detected.
  - **Fail closed:** these give `fp-unreadable` rather than a silent miss:
    - a comment, string or template that never closes
    - a test file over 1,000,000 characters
  - **Linear time:** bracket pairs and line numbers are computed once per file, so a crafted file can't stall CI.
  - **Output safety:** formatted findings are one line with control characters removed, and detail and reason text are capped.
- **D8: Rule IDs use the `fp-` prefix:** `fp-only`, `fp-skip`, `fp-empty-test`, `fp-no-assert`, `fp-placeholder` and `fp-unreadable`.
- **D9: Mutations are targeted, not generated.** Claude picks the fix points and writes the list. A zero-dependency runner shipped in the plugin applies them. This formalises the `mutate*.cjs` pattern from B9/B10: exact find and replace, CAUGHT or SURVIVED per mutation, restore in `finally`, CRLF preserved. The runner runs from the plugin and is not copied into consumer repos.
- **D10: Mutation testing runs on demand.** Survivors are reported as missing tests and the user decides what to do. It is not a CI gate and never blocks a commit.
- **D11: `release` stage 2 suggests `mutation-test` for sensitive paths.** It does so when the diff touches files matching `**/*rules*.mjs`, `**/*checks*.mjs`, `**/*policy*.mjs` or `**/*guard*.mjs`, or the repo's `governance.askPaths`.
- **D12: The approval label can override a fake-pass failure in CI**, using the same tier model as B9/B10 (R10). The finding is still reported. Confirmed at spec review (Francis, 2026-09-30).
- **New decision, suggest an ADR:** the CI gate now fails on heuristic findings about test *content* (D3, D5). Consumer repos take that on when they re-copy the scripts, and backing it out means another release to every repo. Recorded in [ADR 0002](../adr/0002-fake-pass-checks-fail-the-gate.md).
- Constraints from earlier steps:
  - Node ≥ 20, built-ins only (A12, B9/B10)
  - no network for either feature
  - tests use `node --test` with no dependencies
  - CI must pass on ubuntu and windows

## Open questions
- Should the approval label override a fake-pass failure (D12)? Resolved: yes, as for B9/B10 (Francis, 2026-09-30).
- Should the fake-pass check also run in the edit-time guard? Deferred: the user chose `verify` + CI. The guard can be added later without changing the rules.
- C#/.NET and Python patterns? Deferred: out of scope for this version (D4). Add them as a roadmap item when a consumer repo needs them.

## Tickets
<!-- Filled by to-tickets only when GitHub issues aren't available. -->
- #20 · Add fake-pass rule module (fp-*) · Covers: R1–R8; AC1–AC7 · Blocked by: none
- #21 · Run fake-pass checks in verify and the CI gate · Covers: R9–R11, R18 (fp-* docs); AC8–AC10 · Blocked by: #20
- #22 · Add mutation-test skill and runner · Covers: R12–R17, R18 (skill docs); AC11–AC15 (incl. 0.9.0 bump) · Blocked by: #21 (release ordering only)
