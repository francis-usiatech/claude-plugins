# Plan: Fewer permission prompts and approval rounds

## Goal
Remove prompts and approval rounds that protect nothing. Batch the large-route approvals, honour standing decisions, count only production code on the small route, scope the guard's database-drop deny to SQL, and check worktree edits against the worktree. Ship all seven permission tickets in one PR.

## Requirement references
- Spec `docs/specs/2026-11-07-permission-prompts.md` (R1–R18, AC1–AC15)
- Spec `docs/specs/2026-10-16-delivery-speedup.md`: R13–R15, the SD-1 part of R20, AC10, AC11
- Jira ESP-37, ESP-68 (absorbs ESP-46), ESP-147, ESP-70, ESP-82, ESP-73
- AGENTS.md audit rules (F3, F6, F11, F15)

## Pre-plan checklist
- (a) New validation rule: R16's agent-name pattern. Searched:
  - the guard and policy tests: fixtures `docs-sync`, `security-tenancy-auditor`, `a`, `b`, `x`, plus the space and control-character cases that are already rejected; all valid names still match
  - the repo's `.claude/engineering.json`: no `planning` key
  - the archived plans that mention `preflightReviewers`: no agent name outside the pattern
  - plugin agent names use `plugin:agent` (`usiatech-engineering:convention-reviewer`), so `:` is allowed
- (b) Infrastructure mechanism (R12, git worktree detection). Spike on 2026-11-07, in a scratch repo with one worktree under `.claude/worktrees/w1` and one outside it (`../ext`):
  - `git rev-parse --show-toplevel` gives each worktree's own root
  - `--path-format=absolute --git-common-dir` gives the main `.git` for both
  - a plain folder under `.claude/worktrees/` gives the main checkout as its top level, so it is rejected
- (c) Docs and ADRs touched:
  - plugin `README.md` (config table, guard section, Versioning row)
  - `templates/governance.md`, and this repo's new `.claude/governance.md`
  - skills: `approve-plan`, `release`, `clarify`, `to-spec`, `to-tickets`
  - `agents/governance-reviewer.md`
  - new ADR-0004
  - ADR-0001 and ADR-0002: searched, unaffected
  - `docs/roadmap.md`: no entry for these tickets

## Acceptance criteria
- AC1: `clarify`, `to-spec`, `to-tickets` and `approve-plan` describe the single confirmation, the joint spec-and-tickets approval and the plan-with-pre-flight question, and the `decisions.batch: false` behaviour (spec AC1).
  - Evidence: gate run 2026-11-08T20:36:44Z passed plugin-structure "fewer approval rounds" tests: "should confirm the understanding note once, with all corrections in one answer", "should approve the spec and the ticket list together before filing", "should show the plan with its pre-flight result and ask once" (AC1, R1–R4) (shown, 2026-11-08T20:37Z)
- AC2: Standing decisions are documented. `governance-reviewer.md` covers the section, the 10-entry cap and its note, "FLAG, settled by SD-n" and the fixed never-settles list. `approve-plan` and `release` log settled FLAGs and leave them out of the decision. `templates/governance.md` and `.claude/governance.md` have SD-1 (spec AC2).
  - Evidence: gate run passed "should describe standing decisions, the cap of 10 and the fixed never-settles list in governance-reviewer", "should log settled FLAGs with their SD number and leave them out of the decision", "should ship SD-1, the wording-only rule, in the template and in this repo" (shown, 2026-11-08T20:37Z)
- AC3: The `approve-plan` Small condition counts production code only, names the four excluded categories, defines generated files and docs, lists what still counts and keeps the other conditions and overrides (spec AC3).
  - Evidence: gate run passed "should count production code only on the small route (AC3, R6, R7)" (shown, 2026-11-08T20:37Z)
- AC4: Every "5 files" or "5 paths" rule in `release` and `approve-plan` says what it counts (spec AC4).
  - Evidence: gate run passed "should say what every 5-files or 5-paths rule counts (AC4, R8)" (shown, 2026-11-08T20:37Z)
- AC5: Guard tests show these are not denied: `git log --grep`, `git grep`, `grep`, `rg` and `cat | grep` with the database-drop phrase (spec AC5).
  - Evidence: gate run passed 18 "should not deny" cases in "evaluate: database-drop deny scoped to SQL" (git log/grep/show/diff incl. --pretty=, -S/-G, -n 5; grep, rg, rg -g quoted glob, cat | grep, echo, Select-String, PowerShell git log) (shown, 2026-11-08T20:37Z)
- AC6: Guard tests show every form in spec AC6 is denied: SQL-running, unknown program, git program option, `git grep -O`, a variable assignment, a file write, a pipe to a shell, and unreadable text.
  - Evidence: gate run passed 53 "should deny" cases in "evaluate: database-drop deny scoped to SQL": SQL clients, docker/kubectl exec, piped SQL, node -e, python -c, script, git -c/-C/--no-pager, git grep -O variants, bare --pretty/--format before --output/--ext-diff, -n -S --output, --output, --ext-diff, GIT_PAGER=, X=cat, writes, tee, backtick, $(, newline, comment, backslash, unquoted wildcard, VT/NBSP/FF/U+2002 outside quotes; PowerShell Invoke-Sqlcmd, ForEach-Object block, &, \" inside single quotes (shown, 2026-11-08T20:37Z)
- AC7: A mutation-test run on the R9 exemption has 0 survivors (spec AC7).
  - Evidence: passed evidence: mutation runner first run 14 mutations, 4 survivors fixed with tests, re-run 13/13 caught; code-review fixes 8/8; security fix round 1 5/5; security fix round 2 3/3 (one survivor fixed with the -n test, then re-run 3/3); 0 survivors overall (shown, 2026-11-08T20:37Z)
- AC8: The deny rule text in `templates/github/scripts/governance-rules.mjs` is unchanged, and the CI rule tests pass (spec AC8).
  - Evidence: `git diff HEAD` shows regex `\bdrop\s+(database|schema)\b` and reason 'dropping a database or schema' unchanged, only moved into exported DROP_DATABASE_RULE referenced from DENY_COMMANDS; full test suite passed in this gate run (2108 tests, 2104 pass, 0 fail, 4 platform skips) (shown, 2026-11-08T20:37Z)
- AC9: Worktree guard table tests with a real temporary repo pass: in-plan edits allowed under `.claude/worktrees/<id>/` and outside the project; ask paths ask; out-of-plan paths ask; the worktree plan wins; a looser worktree `engineering.json` has no effect (spec AC9).
  - Evidence: gate run passed "evaluate: edits in a linked worktree" AC9 tests: inner and outside worktree in-plan allow, ask paths ask, out-of-plan asks, worktree's own plan used, looser engineering.json ignored, worktree reached through a link allowed (shown, 2026-11-08T20:37Z)
- AC10: These each still ask: a plain folder, another repo's worktree, a hand-made `.git` file that isn't listed, and a throwing git probe (spec AC10).
  - Evidence: gate run passed AC10 tests: plain folder, another repository's worktree, hand-made .git file not listed, removed-but-listed path reused by another repo, throwing lookup (inner, and outside with reason) all ask (shown, 2026-11-08T20:37Z)
- AC11: A mutation-test run on the worktree check has 0 survivors. It includes the main-root and worktree-config mutations (spec AC11).
  - Evidence: passed evidence: mutation runner caught common-dir, worktree list, main-root, worktree-config, plan fallback, throwing-lookup, real-path and allow-fallback mutations, 0 survivors (shown, 2026-11-08T20:37Z)
- AC12: The log entry for a worktree edit has a `worktree` field and is written to the main checkout's log (spec AC12).
  - Evidence: gate run passed "should log a worktree decision with a worktree field (AC12; R15)"; governance-guard.mjs not in the diff, so the log still goes to CLAUDE_PROJECT_DIR (main checkout) (shown, 2026-11-08T20:37Z)
- AC13: The agent-name advisory tests cover U+202E, U+200B, U+FEFF and a space; DEL is quoted as `\u007f`; `approve-plan` states the name rule (spec AC13).
  - Evidence: gate run passed preflightReviewers tests for right-to-left override, zero-width space, byte-order mark, inner space and slash, "should escape DEL in an unknown key (ESP-73 item 2)", and plugin-structure "should state the pre-flight reviewer agent name rule (R16, AC13)" (shown, 2026-11-08T20:37Z)
- AC14: The README covers each change and has a Versioning row, and `docs/adr/0004-*.md` is Accepted (spec AC14).
  - Evidence: README has Database-drop deny and Worktree edits bullets, ADR 0004 row (Accepted) and 0.23.0 Versioning row; docs/adr/0004-guard-drop-deny-scope.md "Status: Accepted (Francis, 2026-11-07)", amended with the review fixes (shown, 2026-11-08T20:37Z)
- AC15: `node plugins/usiatech-engineering/skills/verify/gate.mjs` prints `Gate: PASS` (spec AC15).
  - Evidence: gate run 2026-11-08T20:36:44Z printed tests, validate marketplace, validate plugin and fake-pass check PASS, then `Gate: PASS` (exit 0) (shown, 2026-11-08T20:37Z)

## Tasks
- [x] T1: Batch the large-route approvals in clarify, to-spec, to-tickets and approve-plan, with plugin-structure text tests (covers AC1; ESP-37)
- [x] T2: Standing decisions in governance-reviewer, approve-plan, release and both governance files, with plugin-structure text tests (covers AC2; ESP-68, ESP-46)
- [x] T3: Small route counts production code; state the count in the review-sizing rules; update the plugin-structure assertions on the "5 files"/"5 paths" wording (covers AC3, AC4; ESP-147)
- [x] T4: Test-first, exempt read-only commands from the database-drop deny in governance-policy.mjs. git is detected with `GIT_PREFIX` (AGENTS.md F3); any global option, abbreviation or unlisted option fails closed. Then run a mutation test (covers AC5–AC8; ESP-70)
- [x] T5: Test-first, resolve linked worktrees in the guard (git probes in gitProbe: show-toplevel, common dir, worktree list; a worktree branch in decideEdit; config from the main checkout; a `worktree` log field). The worktree list is read with `--porcelain -z`, split on `\0` (AGENTS.md F6), and paths are compared after one slash and case normalisation (Windows). Then run a mutation test (covers AC9–AC12; ESP-82)
- [x] T6: preflightReviewers tidy-ups: the agent-name pattern, DEL escaping, a shared code-point constant, the unused binding and the comment; approve-plan text test (covers AC13; ESP-73)
- [x] T7: README, ADR-0004, spec Status: approved (covers AC14)
- [x] T8: /code-review high, fixes, then the full gate (covers AC15)
- [x] T9: Release: reviews, commit, PR (covers AC15)

## Files
- `docs/specs/2026-11-07-permission-prompts.md`
- `docs/adr/0004-guard-drop-deny-scope.md`
- `.claude/governance.md`
- `plugins/usiatech-engineering/README.md`
- `plugins/usiatech-engineering/agents/governance-reviewer.md`
- `plugins/usiatech-engineering/skills/approve-plan/SKILL.md`
- `plugins/usiatech-engineering/skills/release/SKILL.md`
- `plugins/usiatech-engineering/skills/clarify/SKILL.md`
- `plugins/usiatech-engineering/skills/to-spec/SKILL.md`
- `plugins/usiatech-engineering/skills/to-tickets/SKILL.md`
- `plugins/usiatech-engineering/templates/governance.md`
- `plugins/usiatech-engineering/hooks/scripts/governance-policy.mjs`
- `plugins/usiatech-engineering/hooks/scripts/governance-guard.mjs`
- `plugins/usiatech-engineering/templates/github/scripts/governance-rules.mjs` (shared code-point constant only; no rule text change)
- `plugins/usiatech-engineering/tests/governance-policy.test.mjs`
- `plugins/usiatech-engineering/tests/governance-guard.test.mjs`
- `plugins/usiatech-engineering/tests/plugin-structure.test.mjs`

## Commands and actions
- `git worktree add` inside temporary test repos created by the tests (OS temp folder, removed after)
- Mutation-test runs on the R9 exemption and the worktree check (the runner restores files byte for byte)

## Out of scope
- CI governance checks, the `governance-approved` label and the shared deny rule text
- Review sizing in `release` (it keeps counting all files)
- Stream plans, orchestration and the after-Bash workflow check in worktrees (ESP-80, ESP-85)
- Bash commands run from a worktree folder
- Version bump and release to main (a separate `chore(release)` PR afterwards)

## Approved
- By: Francis · Date: 2026-11-07
- Route: large (seven tickets, more than 5 production files, guard code)

## Change log
- 2026-11-07: Francis chose: one PR for all seven tickets; ESP-70 scopes the rule; ESP-82 covers worktrees outside the project; one spec-and-plan approval.
- 2026-11-07: Pre-flight BLOCK fixed:
  - R9 now uses a fail-closed git option allow-list (covers `git grep -O`)
  - variable assignments and file writes are excluded
  - AC6 and AC7 cases added
- 2026-11-07: Pre-flight FLAGs fixed:
  - plugin-structure.test.mjs added to Files and to T1–T3 and T6
  - a worktree-config test and a mutation (AC9, AC11)
  - a main-root mutation (AC11)
  - a `git worktree list` check against hand-made `.git` files (R12, AC10)
  - GIT_PREFIX named in T4
- 2026-11-07: Francis approved the spec and plan, including both loosened guard controls (pre-flight FLAG 5): the database-drop deny skips read-only commands, and linked-worktree edits no longer ask for location alone.
- 2026-11-07: Mutation run: 14 mutations. Results:
  - 9 caught first time.
  - 4 survivors fixed with new tests: `$(`/backtick in double quotes, other deny rules keep scope, a stale worktree entry reused by another repo, a valid looser worktree askPaths.
  - The separate variable-assignment check was removed as redundant: an assignment is a first word with "=", which no listed name has. GIT_PAGER and X=cat tests still deny.
  - Re-run: 13/13 caught.
- 2026-11-07: governance-guard.mjs needed no change: the log already goes to the main checkout (CLAUDE_PROJECT_DIR), and logEntries in governance-policy.mjs adds the worktree field.
- 2026-11-08: T4 wording: git is not matched with `GIT_PREFIX`. The read-only check splits the command into words and takes `git` only as the first word, with the subcommand right after it. Any global option (`-c`, `-C`, `--no-pager`) therefore fails closed, which is the purpose of F3.
- 2026-11-08: Fixes from `/code-review high`:
  - Worktree paths are compared through the real folder, so 8.3 names and links still match.
  - Unquoted wildcards keep the deny (ADR 0004 updated).
  - The git probes run only for an outside edit that would ask, cheapest check first.
  - A lookup that throws says why in the ask.
  - The read-only list reuses QUIET_COMMANDS and DISCARDED_OUTPUT, and the drop rule is the named DROP_DATABASE_RULE.
  - 8 more mutations, all caught.
  - Not in scope: other deny rules still match search text inside `git log --grep` (the shutdown case); left for a follow-up ticket.
- 2026-11-08: Stage 1 governance review returned FLAG. Francis accepted all four items:
  - One background mutation-runner command skipped the after-Bash workflow check. Acknowledged: no `.github` file changed.
  - governance-rules.mjs also exports `DROP_DATABASE_RULE`, beyond the code-point constant in Files. Confirmed: the rule text is unchanged (AC8).
  - The deferred finding and the leading `cd` gap are filed as ESP-148.
  - The spec's AC6 gained an unquoted-wildcard deny bullet, matching the ADR 0004 update.
- 2026-11-08: Stage 2 security review: one High blocking finding, now fixed. The read-only git check let an option that may take no value skip the next word (`git grep -G` is `--basic-regexp`; a bare `--pretty` is valid). That word could hide `-O`, `--output` or `--ext-diff`.
  - Fix: each subcommand now has its own list of options that always take a value. `--pretty` and `--format` are accepted only with "=".
  - Six deny tests and two allow tests were added. 5 mutations, all caught.
  - The fix touches `*policy*.mjs`, so a full review round and the full gate run again.
  - Nits left for the PR: bidi characters in quoteKey advisory text, and command-name case folding (in the ESP-125 scanner that runs first).
- 2026-11-08: Stage 2 security re-review: two High blocking findings (both reproduced), now fixed:
  - PowerShell splits words on NBSP, VT, FF and U+2002 too. The split now reads only printable ASCII outside quotes.
  - Windows PowerShell 5.1 splits a `\"` inside single quotes into several arguments. In PowerShell, a quoted part with `"` or `\` now fails closed.
  - From a low-confidence note: `-n` takes the next word in log and show, and value options are checked before flags.
  - Seven deny tests and one allow test added; 3 mutations, all caught (one after a test was added).
  - ADR 0004 updated. Another full review round and the full gate follow.
  - Round 3: all reviewers PASS. Security noted that it did not finish reviewing the non-git read-only words. I checked them instead and found nothing:
    - `rg --pre` and `--hostname-bin` are denied by REDEFINES.
    - None of grep, egrep, fgrep, findstr, Select-String, cat, echo, printf, head, tail, wc, ls, pwd, diff, true or test has an option that runs a program or writes a file.
    - ESP-125 already trusts the same words.
  - The security reviewer's reproduction probes (a scratch `git init`, `powershell.exe`/`pwsh` runs, scratch clean-up) ran only in the session scratchpad. Each asked and was approved at the prompt.

## Final status
- Status: shipped (2026-11-08), branch `feature/permission-prompts`, one PR into `develop`.
- Acceptance criteria: AC1–AC15 all shown (gate PASS 2026-11-08T20:36:44Z; evidence lines above).
- Deviations:
  - governance-rules.mjs also exports `DROP_DATABASE_RULE` (Francis confirmed; rule text unchanged).
  - Three review rounds: the security fixes tightened the read-only check (per-subcommand git value options, printable ASCII outside quotes, PowerShell quote rule). ADR 0004 was amended to match.
  - Out-of-scope follow-up filed as ESP-148: other deny rules still match search text, and a leading `cd` keeps the deny.
