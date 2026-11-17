# Plan: Output level option (output.level)

## Goal
Add a per-repo `output.level` setting (`low`, `medium`, `high`; default `low`) that sets how much progress detail Claude shows for each step. Specs, plans, approval questions to the user and HTML review pages always keep full detail, whatever the level.

## Requirement references
- User request 2026-11-16 (Francis, this session): output level option, Low/Medium/High, default Low; exempt spec, plan, approvals and review pages, and enforce that exemption.
- ESP-167 (sub-task of ESP-27)

## Pre-plan checklist
- (a) New validation rule: `output` must be an object and `output.level` one of `"low"`, `"medium"`, `"high"`, reported once as an advisory config problem (ESP-35), dropped so the default applies. Callers searched: `sanitizeConfig` in `hooks/scripts/governance-policy.mjs` (the only place that validates `engineering.json` keys the guard does not read, as for `decisions` and `planning`), `readConfigText` in `scripts/session-check.mjs` (base-branch reader, reused by the new hook). Fixtures: `tests/governance-policy.test.mjs` (decisions-key tests at ~2488 and the advisory list at ~2622), `templates/engineering.json`, this repo's `.claude/engineering.json` (no `output` key; unchanged).
- (b) Mechanism: a `SessionStart` hook (matcher `startup|resume|clear|compact`) that prints `hookSpecificOutput.additionalContext`. This is a documented Claude Code hook output; the `compact` source re-adds the rule after compaction. n/a spike: the test runs the script with a temp repo and checks its JSON output; a manual check in a fresh session confirms the context arrives (AC5).
- (c) Docs and ADRs touched: `plugins/usiatech-engineering/README.md` (config table row, new "Output level" subsection, changelog row), `templates/review-page.md` (exemption line). Searched `docs/adr/` (0001–0005): none covers output or verbosity; none changes. No spec or plan template text changes (they are exempt by the hook rule; their text has no level wording).

## Acceptance criteria
- AC1: with no `output` key, or `output.level` `"low"`, the hook prints valid JSON whose `additionalContext` states the low rule (one line per step) and the exemption list (specs, plans, approval and decision questions, review pages); exit 0 (test).
  - Evidence: gate run passed `output-level: SessionStart hook` "should print SessionStart JSON with the low rule when nothing is set (AC1)", `output-level: reading output.level` "should default to low with no config or no output key (AC1)", `output-level: rule text` "should give the low rule with the exemption list (AC1)"; Gate tree: c90b025fb59999dd9f0e23295b1096988cad207e (shown, 2026-11-17T02:51Z)
- AC2: `"medium"` prints the medium rule (the one-line description plus at most two lines of the command, when there is one) with the same exemption list; `"high"` prints nothing and exits 0 (test).
  - Evidence: gate run passed "should print the medium rule for medium and nothing for high (AC2)", "should give the medium rule with the same exemption list (AC2)", "should give nothing for high (AC2)", "should read each valid level from the base branch, not an edited working copy (AC1, AC2)"; Gate tree: c90b025fb59999dd9f0e23295b1096988cad207e (shown, 2026-11-17T02:51Z)
- AC3: an invalid `output` (not an object) or `output.level` (any other value) is reported by `sanitizeConfig` as one advisory problem, `"output" must be an object` or `"output.level" must be "low", "medium" or "high"`, and the hook falls back to `low`; a missing or unreadable config never makes the hook fail (exit 0) (tests).
  - Evidence: gate run passed `evaluate: output.level (ESP-167 AC3)` (3 tests), the two advisory-not-escalate tests (ESP-167), "should use low and warn for an invalid output or output.level (AC3)", "should use low and warn for a config that is not valid JSON (AC3)", "should never fail: invalid config, bad stdin and a folder outside git all exit 0 with the low rule (AC3)"; Gate tree: c90b025fb59999dd9f0e23295b1096988cad207e (shown, 2026-11-17T02:51Z)
- AC4: `hooks/hooks.json` registers the hook under `SessionStart`; `templates/engineering.json` has `"output": { "level": "low" }`; the README config table has an `output` row; `templates/review-page.md` states the page is always full detail whatever `output.level` is (plugin-structure test).
  - Evidence: gate run passed `plugin structure: output level (ESP-167 AC4)` (3 tests: SessionStart registration incl. compaction, config template and README, review pages full detail); validate plugin exit 0; Gate tree: c90b025fb59999dd9f0e23295b1096988cad207e (shown, 2026-11-17T02:51Z)
- AC5: manual check: in a fresh session in a repo with `output.level` `"low"`, the session context contains the output-level rule (seen in the transcript's hook output).
  - Evidence: deferred to after release by Francis (Change log 2026-11-17); no fresh-session transcript yet. Pre-release only: the hooks.json command run with CLAUDE_PLUGIN_ROOT set to the source plugin and SessionStart input {"source":"compact"} exited 0 with hookEventName "SessionStart" and additionalContext starting "usiatech-engineering output level: low" plus the exemption line (not shown, 2026-11-17T02:51Z)

## Tasks
- [x] T1: TDD the hook `hooks/scripts/output-level.mjs`: read the level via `readConfigText` (base branch, else working copy), build the rule text for low/medium, print the SessionStart JSON; nothing at high; "started directly" via `isMainModule` (AGENTS.md F4) (covers AC1, AC2, AC3; ESP-167)
- [x] T2: register the hook in `hooks/hooks.json` under `SessionStart` (covers AC4, AC5; ESP-167)
- [x] T3: TDD the advisory check for `output` / `output.level` in `sanitizeConfig` (covers AC3; ESP-167)
- [x] T4: add `output` to `templates/engineering.json`, the exemption line to `templates/review-page.md`, plugin-structure assertions (covers AC4; ESP-167)
- [x] T5: README: config table row, "Output level" subsection, changelog row under the `Unreleased` marker (covers AC4; ESP-167) (docs-only)
- [ ] T6: manual check in a fresh session (covers AC5; ESP-167)

## Files
- `plugins/usiatech-engineering/hooks/scripts/output-level.mjs`
- `plugins/usiatech-engineering/hooks/hooks.json`
- `plugins/usiatech-engineering/hooks/scripts/governance-policy.mjs`
- `plugins/usiatech-engineering/templates/github/scripts/governance-rules.mjs`
- `plugins/usiatech-engineering/templates/engineering.json`
- `plugins/usiatech-engineering/templates/review-page.md`
- `plugins/usiatech-engineering/README.md`
- `plugins/usiatech-engineering/tests/output-level.test.mjs`
- `plugins/usiatech-engineering/tests/governance-policy.test.mjs`
- `plugins/usiatech-engineering/tests/plugin-structure.test.mjs`

## Commands and actions
- None beyond tests. Filed ESP-167 under ESP-27 (D1.2).

## Out of scope
- Reports that reviewer agents and forked skills (verify, release-steps) send back to the main agent: they reach the user only through the main agent, which applies the level when it relays them.
- The version bump: done by the release flow.
- Any change to the content of specs, plans, approval questions or review pages.

## Approved
- By: Francis · Date: 2026-11-16
- Route: small (override: "treat as small", D1.1; the large-route rule applied because of the new hook module and config key)
- Pre-flight: opus, full (Files lists 9 paths, more than 5; no planning.sensitivePaths)

## Change log
- 2026-11-16: draft.
- 2026-11-16: pre-flight nits applied as wording (SD-1): T1 names `isMainModule`, T5 uses the `Unreleased` changelog marker.
- 2026-11-16: governance pre-flight FLAGs settled by Francis ("accept all" on the review page): D1.1 treat as small; D1.2 ESP-167 filed; D2.1 SessionStart hook; D2.2 base-branch read with working-copy fallback; D2.3 exemption enforced as model context plus review-page.md; D2.4 high prints nothing.
- 2026-11-17: scope change approved by Francis ("Yes, move it"): add `templates/github/scripts/governance-rules.mjs`; the shared `output` check moves there so the guard no longer loads `session-check.mjs` (code-review finding).
- 2026-11-17: stage-1 FLAG (AC5 has no evidence) settled by Francis ("Defer to after release"): AC5 and T6 are checked in a fresh session once the released plugin is installed; the 0.30.1 plugin in the cache has no hook.

## Close
- Status: shipped (AC5 deferred to after release, as Francis decided on 2026-11-17)
- Branch: feature/output-level (commit and PR follow in this same change)
- AC1: shown · AC2: shown · AC3: shown · AC4: shown (full gate PASS, Gate tree c90b025fb59999dd9f0e23295b1096988cad207e, 2026-11-17T02:51Z)
- AC5: not shown. Check in a fresh session once the released plugin is installed (T6 open). Pre-release run of the registered hook command printed the low rule, exit 0.
- Deviations: `templates/github/scripts/governance-rules.mjs` added on 2026-11-17 (code-review finding, approved). Code review (/code-review high): 5 findings, all 5 fixed. Release review: governance FLAG (AC5, deferred), convention PASS, silent-failure PASS with 3 nits, security PASS with 2 nits; mutation-test suggestion skipped by Francis.
- Jira: ESP-167 stays In Testing until AC5 is shown.
