# Plan: Re-audit PR 1 — guard bypasses (ESP-106)

**Final status: shipped** on branch `feature/esp106-guard-bypasses` (closed 2026-10-19). AC1–AC7 all shown: see the Evidence lines (last Gate: PASS at 2026-10-19T22:30:36Z). Reviews: pre-flight FLAG (fixed, decisions in the Change log); stage 1 FLAG (decided by Francis: AC4 reworded, ri/rd anchored); stage 2 convention, silent-failure and security all PASS, nits only; README fix re-reviewed governance-only: PASS. Mutation test: 25 mutations, all CAUGHT after the added tests and the redundant lookahead removal. Deviations: `switch -f`/`--discard-changes` added beside `checkout -f`; ri/rd anchored to the start of a command; code gaps from the reviews filed as ESP-110.

## Goal
Close re-audit findings R1–R5: the guard also checks the PowerShell tool, a Windows `::$DATA` stream suffix no longer gets an edit past the path checks, and the hook-bypass, recursive-delete and destructive-git rules catch the abbreviated, separate-flag and long-flag spellings the audit proved.

## Requirement references
- `docs/audits/2026-10-19-ponytail-audit.md` R1, R2, R3, R4, R5 (lines 56–96) and its "How to use this brief" rules (test-first, smallest fix, keep validation)
- ESP-106 (sub-task of ESP-105)
- `AGENTS.md`: "Git command rules start with `GIT_PREFIX`", "Shared helpers are imported, not copied", the no-change-path import limit for hook scripts (AC6 timing test), "Export only what another file imports"

## Pre-plan checklist
- (a) New validation rules and format checks: the command rules in `templates/github/scripts/governance-rules.mjs` (`DENY_COMMANDS`, `ASK_COMMANDS`) change. Searched with an uncapped `grep -rn` over the plugin, `docs/` and `AGENTS.md`:
  - `DENY_COMMANDS` / `ASK_COMMANDS` are used only by `decideBash` (`hooks/scripts/governance-policy.mjs:465-484`) and the "rule tables" test (`tests/governance-rules.test.mjs:61`). CI does not run them, so consumers need not re-copy `templates/github/scripts/`.
  - Fixtures: `tests/governance-policy.test.mjs` "Bash deny rules" (`:16`), "Bash ask rules" (`:53`), "protected branches" (`:97`), "repo command rules" (`:151`). Every existing case must keep its decision (AC6).
  - The tool-name checks: `evaluate` (`governance-policy.mjs:642`, `tool === 'Bash'`), the guard's snapshot (`governance-guard.mjs:42`), `checkAfterBash` (`bash-workflow-check.mjs:290`) and four log calls that hard-code the Bash tool (`bash-workflow-check.mjs:263, 292, 329, 358`; `:329` writes the finding entries). The hook matchers are in `hooks/hooks.json:6, 14, 22`; `tests/bash-workflow-check.test.mjs:58` asserts the PostToolUse matcher is `'Bash'`.
  - The list of shell tools goes in `hooks/scripts/governance-state.mjs` (built-ins only), so the guard, the policy and the after-Bash check import one copy without breaking the no-change-path import limit.
  - `windowsCanonical` (`governance-policy.mjs:29`) is used only for `contentRel` in `decideEdit` (`:523`). It is reused for every check in `decideEdit`; it is not applied to paths outside the project (`decideOutsideEdit`), where the drive letter's `:` would be stripped.
- (b) Database or infrastructure mechanisms: n/a: no new mechanism. The PowerShell tool's input carries `command` like Bash (seen in this session's `.omc` tool-error state files with `"tool_name": "PowerShell"`), and Claude Code hook matchers are regexes over the tool name, as the existing `Bash|Edit|…` matcher shows.
- (c) Docs and ADRs touched: searched the README, `docs/`, the ADRs, the skills and `AGENTS.md` for the rule spellings, "matcher" and "PowerShell".
  - Touched: `plugins/usiatech-engineering/README.md` "Default guard rules" (`:113-134`: the deny and ask bullets, plus a limits bullet naming MCP tools that write files or push), the Windows path-variant sentence (`:136`: it now covers every in-project path check), the after-Bash check paragraph (`:151`: it also follows PowerShell), and a new 0.18.3 Versioning row.
  - Not touched: no ADR covers the command rules; `AGENTS.md` rules already cover this work. No docs reviewer is configured (`planning.preflightReviewers` is unset).

## Acceptance criteria
- AC1 (R1): `hooks/hooks.json` PreToolUse matcher includes `PowerShell`, and the PostToolUse and PostToolUseFailure matchers are `Bash|PowerShell`. `evaluate` with `tool_name: 'PowerShell'` asks for `git push --force origin main` and denies `git commit --no-verify -m x`; the guard snapshots workflows for a PowerShell call, and `checkAfterBash` checks one and logs it with `tool: 'PowerShell'`. Tests in `tests/governance-policy.test.mjs` and `tests/bash-workflow-check.test.mjs` show it.
  - Evidence: hooks.json matchers Bash|PowerShell|Edit|… and Bash|PowerShell (x2); ESP-106 tests: PowerShell evaluate asks force push and denies the hook-skip flag; PowerShell after-Bash call reports the committed workflow and logs tool PowerShell; registration test asserts all three matchers (shown, 2026-10-19T22:05Z)
- AC2 (R2): with `pathApi: path.win32`, a Write to `.env::$DATA` is denied, and Writes to `AGENTS.md::$DATA`, `CLAUDE.md::$DATA` and `.claude/plans/active.md::$DATA` (with and without an active plan) are asked, each with the same decision as the plain name, and the logged target keeps the `::$DATA` spelling. Test in `tests/governance-policy.test.mjs`.
  - Evidence: the five "::$DATA stream suffix (R2)" tests pass: .env deny, AGENTS.md/CLAUDE.md/active.md ask like the plain name, target keeps ::$DATA, plan path asked with a plan active (shown, 2026-10-19T22:05Z)
- AC3 (R3): `git commit --no-verif -m x`, `git push --no-veri origin x`, `git -c core.hooksPath=/dev/null commit -m x` and `git config core.hooksPath /dev/null` are denied (any command naming `core.hooksPath` is denied, reads included); `git commit --no-verbose -m x` is not denied.
  - Evidence: the four R3 deny cases pass and the verbose flag is not denied (shown, 2026-10-19T22:05Z)
- AC4 (R4): `rm -f -r $HOME`, `rm --recursive --force ~`, `rm -rf -- ~` and `rm -rf "$HOME"` and `Remove-Item -Recurse -Force ~` are denied; `rm -r build/`, `Remove-Item -Recurse build` and `rm --recursive build/` are asked, and so is `rd -r build`; `docker run --rm img pytest -rA` and `ls src/rd -R` are not.
  - Evidence: R4 deny cases (incl. Remove-Item and `ri` after `;`) and ask cases pass; docker run --rm img pytest -rA, ls src/rd -R and Remove-Item -Force x.txt allowed; all re-run in the gate at 2026-10-19T22:30:36Z (shown, 2026-10-19T22:30Z)
- AC5 (R5): `git push --delete origin x`, `git push -d origin x`, `git push --mirror`, `git branch --delete --force x`, `git reset --har HEAD~1`, `git clean --force` and `git checkout -f main` are asked; `git push origin x`, `git push --dry-run origin x`, `git reset --soft HEAD~1` and `git checkout main` are not.
  - Evidence: the seven R5 ask cases pass; push, push --dry-run, reset --soft, checkout main, branch --merged allowed; a sweep of 24 everyday commands gave no false positive (shown, 2026-10-19T22:05Z)
- AC6 (no regressions): every existing test passes unchanged except the matcher assertion at `tests/bash-workflow-check.test.mjs:58`, and `node plugins/usiatech-engineering/skills/verify/gate.mjs` prints Gate: PASS (including the AC6 timing test).
  - Evidence: node plugins/usiatech-engineering/skills/verify/gate.mjs printed Gate: PASS at 2026-10-19T22:30:36Z, after the last code change (tests 123 s incl. the AC6 timing test and every AC1–AC5 test, both validations, fake-pass check); the only change to existing tests is the matcher assertion (shown, 2026-10-19T22:30Z)
- AC7 (mutation test): the mutation-test runner breaks each fix point (the matcher, the shell-tool check, the canonical path, each widened regex) and a test fails for every mutation; survivors are reported.
  - Evidence: mutation runner: 21 mutations, 18 CAUGHT, 3 SURVIVED; Francis chose to add tests: the PreToolUse matcher and -Force survivors are now CAUGHT; the --merged survivor showed the (?!-) lookahead was redundant, so it was deleted (shown, 2026-10-19T22:15Z); after the ri/rd anchor, 4 more mutations on the RM pattern (incl. removing the anchor) all CAUGHT (shown, 2026-10-19T22:28Z)
## Tasks
- [x] T1: Failing tests first for AC1–AC5 in `tests/governance-policy.test.mjs` and `tests/bash-workflow-check.test.mjs` (covers AC1–AC5; ESP-106)
- [x] T2: R1: `SHELL_TOOLS` in `governance-state.mjs`; `hooks.json` matchers; `evaluate`, the guard snapshot and `checkAfterBash` use it; the after-Bash logs (`:263, 292, 329, 358`) name the real tool (covers AC1; ESP-106)
- [x] T3: R2: canonicalize `rel` once on win32 in `decideEdit`, for every path check, and keep the original spelling as the decision and log target (covers AC2; ESP-106)
- [x] T4: R3–R5: widen the rules in `governance-rules.mjs`, every git rule built on `GIT_PREFIX` (covers AC3–AC5; ESP-106)
- [x] T5: README guard rules, limits bullet, after-Bash paragraph and the 0.18.3 row (covers AC1–AC5; ESP-106)
- [x] T6: Mutation test on the fix points, then the gate (covers AC6, AC7; ESP-106)

## Files
- `plugins/usiatech-engineering/hooks/hooks.json`
- `plugins/usiatech-engineering/hooks/scripts/governance-state.mjs`
- `plugins/usiatech-engineering/hooks/scripts/governance-policy.mjs`
- `plugins/usiatech-engineering/hooks/scripts/governance-guard.mjs`
- `plugins/usiatech-engineering/hooks/scripts/bash-workflow-check.mjs`
- `plugins/usiatech-engineering/templates/github/scripts/governance-rules.mjs`
- `plugins/usiatech-engineering/README.md`
- `plugins/usiatech-engineering/tests/governance-policy.test.mjs`
- `plugins/usiatech-engineering/tests/bash-workflow-check.test.mjs`
- `.claude/plans/archive/2026-10-19-esp106-guard-bypasses.md`

## Commands and actions
- None beyond the gate and the mutation runner.

## Out of scope
- The `::$DATA` suffix on paths outside the project (`decideOutsideEdit`).
- MCP tools that write files or push (named as a known limit only).
- R6–R17 (ESP-107 to ESP-109).

## Approved
- Francis, 2026-10-19. Route: large by the file count (10 files), with the user's standing override for the audit batch: the audit R-numbers are the requirement reference, so no separate spec or tickets (ESP-106 is already filed).

## Change log
- 2026-10-19: drafted.
- 2026-10-19: route override (Francis, standing for the audit batches, restated for the R-batch): the audit R-numbers are the requirement reference; no separate spec or tickets.
- 2026-10-19: pre-flight FLAG (governance-reviewer): findings 2–5 and the low-confidence notes fixed in the draft; finding 1 decided by Francis: the R4 rules also match `Remove-Item`, `ri`, `rd` and `rmdir` (AC4). Francis also accepted denying every command that names `core.hooksPath`, reads included (AC3).
- 2026-10-19: the AC4 docker test case became `docker run --rm img pytest -rA`, because `pip install` is asked by the dependency rule (a test-setup error, not a rule change).
- 2026-10-19: mutation survivors: Francis chose to add tests (PreToolUse matcher assertion, two allow cases); the redundant (?!-) lookaheads were removed.
- 2026-10-19: stage-1 FLAG (governance-reviewer), decided by Francis: AC4 reworded to the `pytest -rA` command; `ri`/`rd` count only at the start of a command (so `ls src/rd -R` isn't asked), with tests in AC4; evidence restamped by the 22:30:36Z gate; later plan writes use Edit so they are logged.
- 2026-10-19: stage 2 (convention, silent-failure, security) all PASS with nits. Francis chose to narrow the README wording (`-` flags only; which git abbreviations count; Limits names what isn't matched yet) and file the code gaps as ESP-110. The README fix had a governance-only re-review: PASS.
