# Plan: Re-audit nits (ESP-109: R13, R14, R16, R17)

**Final status: shipped** on branch `feature/esp109-audit-nits` (closed 2026-10-20). AC1–AC5 are all shown: see the Evidence lines (Gate: PASS at 2026-10-20T04:20:12Z). Reviews (one round; 8 files, so stage 1 ran first):
- Pre-flight FLAG (8 files > 5): Francis chose "treat as small".
- Stage 1: governance PASS.
- Stage 2: convention, silent-failure and security PASS. Nits: no `-z` in the by-hand list (Francis's decision); `check` warns even when `JIRA_SITE` already names the host, since it reads no environment (documented); `it/**/.only(` and `it['only'](` still get past (existing limit).
- Decisions (Francis): the skills don't yet pass on `check`'s stderr warning, deferred to ESP-111 (comment 10923); `skipIf`/`runIf` stay high-tier, like a non-false `{ skip }` option.

Mutation tests: 9 of 9 CAUGHT (R13, R14 ×4, R17 ×4).

Deviations: none. A timing case first exceeded `MAX_CHARS` (so it was never scanned); it was cut to 15k repeats before the gate run.


## Goal
Fix four small audit nits. The gate accepts `GOVERNANCE_AI_REVIEW` in any case (R13). `jira-tracker check` warns about a site the client won't trust (R14). The verify skill's by-hand file list matches the gate runner (R16). The fake-pass check catches `.only` chains split across lines, plus `skipIf`/`runIf` (R17).

## Requirement references
- ESP-109 (parent ESP-105)
- `docs/audits/2026-10-19-ponytail-audit.md` R13, R14, R16, R17. The audit R-numbers are the requirement reference (standing rule, no spec).

## Pre-plan checklist
- (a) New validation rules and format checks:
  - R14 adds a warning to `check` only. `jiraProblems`/`validateTicketsConfig` keep their results, and the exit code stays 0. Callers searched: `runCommand` (the `check` branch). The skills that parse `check` stdout (approve-plan, release, to-tickets and verify SKILL.md) read only stdout JSON, which stays unchanged. Fixtures: `tests/jira-tracker.test.mjs` `cliRepo`/`jira()` helpers, plus the `LOCAL_COMMANDS` stderr assertions at `:451-:490`. These are re-checked so that an `atlassian.net` site still gives an empty stderr.
  - R17 widens the `FOCUSED`/`SKIPPED` regexes in `fake-pass-rules.mjs`. Callers: `checkFakePasses` (`fake-pass-check.mjs`, used by `skills/verify/gate.mjs` and CI). Fixtures: `tests/fake-pass-rules.test.mjs`, `fake-pass-check.test.mjs` and `fake-pass-parity.test.mjs`. The existing linear-time test for a long chain must still pass.
  - R13 is a comparison change, not a new rule. Caller: the gate job env. Fixture: `tests/governance-gate.test.mjs`.
- (b) Database or infrastructure mechanisms: n/a: no database or infrastructure; plain Node scripts.
- (c) Docs and ADRs touched (search for skipIf, runIf, .only, GOVERNANCE_AI_REVIEW, JIRA_SITE, `name-only HEAD`):
  - `plugins/usiatech-engineering/README.md:189` (`fp-skip` row) gets `skipIf`/`runIf`.
  - `README.md:188` (`fp-only`) gets a note that the chain may span lines.
  - `README.md:77` (Jira environment) gets a line saying `check` warns on an untrusted host.
  - `README.md:107` (the `off` opt-out) gets "any case".
  - `skills/verify/SKILL.md:12` is the R16 fix itself.
  - ADR 0003 (Jira host rule) is unchanged: the warning restates its rule. ADR 0002 is unchanged.
  - Seen but out of scope: `agents/governance-reviewer.md:57` uses the same plain `git diff --name-only HEAD` (R16 named only verify; noted for ESP-111/110).

## Acceptance criteria
- AC1 (R13): when `GOVERNANCE_AI_REVIEW=OFF` and the AI review is skipped, the gate reports no missing-verdict problem. When the value is unset, the gate still needs a verdict.
  - Test: `tests/governance-gate.test.mjs`.
  - Evidence: test "should not demand or fetch a verdict when the AI review was skipped by an opt-out…" now includes OFF (red before: exit 1); the F2 unset-value test still passes (shown, 2026-10-20T04:20Z)
- AC2 (R14): `jira-tracker check` with `tickets.jira.site` `https://evil.example.com` and no `JIRA_SITE`:
  - exits 0;
  - prints the same stdout JSON as before;
  - writes a stderr warning that names the host and `JIRA_SITE`.
  - With an `*.atlassian.net` site, stderr is empty.
  - Test: `tests/jira-tracker.test.mjs`.
  - Evidence: test "should warn, with exit 0, when check sees a site the client will not trust without JIRA_SITE (R14)" passes (red before: no warning); the check test asserts an empty stderr for an atlassian.net site (shown, 2026-10-20T04:20Z)
- AC3 (R16): verify SKILL.md step 2 reads `git -c core.quotePath=false diff --name-only --no-renames HEAD` plus `git -c core.quotePath=false ls-files --others --exclude-standard`.
  - Evidence: skills/verify/SKILL.md step 2 now reads the two quotePath=false commands with --no-renames (shown, 2026-10-20T04:20Z)
- AC4 (R17):
  - `it\n  .only('x', …)` is flagged `fp-only`.
  - `it.skipIf(true)(…)` and `test.runIf(false)(…)` are flagged `fp-skip`.
  - The existing `fp-only`/`fp-skip` tests and the long-chain timing test still pass.
  - Test: `tests/fake-pass-rules.test.mjs`.
  - Evidence: the six R17 cases in "focused and skipped tests (AC2)" pass (red before: no finding); existing cases and the timing tests, plus two new whitespace timing cases, pass (shown, 2026-10-20T04:20Z)
- AC5: the `npm test` gate passes, and the mutation test on R13, R14 and R17 reports each fix point CAUGHT.
  - Evidence: gate run 2026-10-20T04:20:12Z Gate: PASS; mutation run 9 of 9 CAUGHT (R13 case, R14 ×4, R17 ×4) (shown, 2026-10-20T04:20Z)
## Tasks
- [x] T1: R13 test first (red), then compare `GOVERNANCE_AI_REVIEW?.toLowerCase() === 'off'` (AC1; ESP-109)
- [x] T2: R14 test first (red). Then:
  - share the `.atlassian.net` host test that `trustedApiBase` uses;
  - have `check` return a warning that `runCli` writes to stderr with exit 0;
  - leave stdout unchanged (AC2; ESP-109)
- [x] T3: R16 SKILL.md step 2 wording (AC3; ESP-109)
- [x] T4: R17 tests first (red). Then:
  - allow whitespace and newlines around `.` in the `FOCUSED`/`SKIPPED` chains, keeping them linear;
  - add `skipIf|runIf` to the skip modifiers (AC4; ESP-109)
- [x] T5: README rows 77, 107, 188 and 189 (AC2, AC4; ESP-109)
- [x] T6: gate and mutation test (AC5; ESP-109)

## Files
- `plugins/usiatech-engineering/templates/github/scripts/governance-gate.mjs`
- `plugins/usiatech-engineering/tests/governance-gate.test.mjs`
- `plugins/usiatech-engineering/scripts/jira-tracker.mjs`
- `plugins/usiatech-engineering/tests/jira-tracker.test.mjs`
- `plugins/usiatech-engineering/skills/verify/SKILL.md`
- `plugins/usiatech-engineering/templates/github/scripts/fake-pass-rules.mjs`
- `plugins/usiatech-engineering/tests/fake-pass-rules.test.mjs`
- `plugins/usiatech-engineering/README.md`

## Commands and actions
- None beyond the usual: branch `feature/esp109-audit-nits` off develop, then the release flow (0.18.6 in the release PR).

## Out of scope
- R15 (shipped with ESP-108), ESP-110, ESP-111.
- `agents/governance-reviewer.md:57` (same plain diff command; not named by R16).
- The version bump: that's the release PR's job.

## Change log
- 2026-10-19: drafted. Pre-flight governance FLAG (8 files > 5): Francis chose "treat as small" (four one-line nits with tests and docs, no new public interface). R16: no `-z` in the by-hand list (Francis), since NUL output is not readable by eye; the gate runner already uses `-z`.

## Approved
Francis, 2026-10-19. Route: small (user override: 8 files, no new public interface)
