# Plan: Guard rule gaps from the ESP-106 reviews (ESP-110)

## Goal
Close the 11 guard gaps listed in ESP-110 (description items 1–8, comment 10907 items 9–11) in the shared command rules and the guard's Bash and Edit decisions, test-first, and update the README Limits bullet.

## Requirement references
- ESP-110 (parent ESP-105; re-audit `docs/audits/2026-10-19-ponytail-audit.md` follow-up from the ESP-106 reviews)

## Pre-plan checklist
- (a) New validation rules and format checks: DENY_COMMANDS / ASK_COMMANDS are used only by `hooks/scripts/governance-policy.mjs` (decideBash) and tested in `tests/governance-rules.test.mjs`; `decideBash`/`decideEdit`/`windowsCanonical` are used only in governance-policy.mjs and tested through `evaluate` in `tests/governance-policy.test.mjs`. CI doesn't use the command rules (README 0.18.3 row). No other callers or fixtures found by grep.
- (b) Database or infrastructure mechanisms: n/a: regex and string checks only; no database, infrastructure or new runtime mechanism.
- (c) Docs and ADRs touched: `plugins/usiatech-engineering/README.md` (guard "Limits" bullet, line 135, and the Windows path bullet after it). The version-history row and version bump go in the release bump PR, not this plan. No ADR covers the command rules (ADRs 0001–0003 are lookups, fake-pass, Jira). No docs reviewer is configured (`planning.preflightReviewers` is not set).

## Acceptance criteria
- AC1: `git branch --d x` and `git branch --de x` are asked (item 1); `git push --d` behaviour unchanged.
  - Evidence: governance-policy.test.mjs "ESP-110 … should ask: git branch --d x / --de x"; "should not deny: git push --dry-run origin x"; mutation M11 CAUGHT (shown, 2026-10-20T19:39Z)
- AC2: `rd /s /q dir`, `rmdir /s /q dir`, `del /s dir` and `erase -Recurse dir` at the start of a command are asked as a recursive delete; `rd /s /q C:\` is denied; a path such as `rm -f /srv` or `rm -f /s/x` is not read as `/s` (item 2).
  - Evidence: "should ask: rd /s /q build, rmdir /s build, del /s build, cd x; erase -Recurse build"; "should deny: rd /s /q C:\"; "should allow: rm -f /srv/x.txt", "should not deny: rm -f /s/x"; M1–M3 CAUGHT (shown, 2026-10-20T19:39Z)
- AC3: recursive forced deletes of `C:\`, `C:`, `\`, `.\`, `$env:HOMEDRIVE\`, `${env:HOME}`, `$PSHOME`, `$env:SystemDrive`, `$env:HOMEPATH` and `%USERPROFILE%` are denied (items 3, 11).
  - Evidence: "should deny" rows for each target; M4, M6–M9 CAUGHT (shown, 2026-10-20T19:39Z)
- AC4: `rm -r -f /;echo`, `rm -rf .;`, `rm -rf /*` and `(rm -rf /)` are denied (item 4).
  - Evidence: "should deny" rows for each, plus `rm -rf /|cat` and `rm -rf C:\*`; M5 CAUGHT (shown, 2026-10-20T19:39Z)
- AC5: a Bash or PowerShell command over 16 KB is asked without running the regex rules, and returns in under 1 s for a 176 KB command (item 5).
  - Evidence: "should ask on a command over 16 KB without running the rules (item 5)" (180 KB command, asserted < 1 s; 16 KB − 5 chars allowed); M14 CAUGHT (shown, 2026-10-20T19:39Z)
- AC6: `Get-ChildItem ~ | Remove-Item -Recurse -Force` (and `gci`/`ls`/`dir` on a root or home target piped into a recursive forced delete) is denied (item 6).
  - Evidence: "should deny: Get-ChildItem ~ | Remove-Item -Recurse -Force", "gci $HOME -Recurse | ri -r -fo", "dir C:\ | del -Recurse -Force"; "should allow: ls ~ | Select-String x"; M10 CAUGHT (shown, 2026-10-20T19:39Z)
- AC7: `echo x > .env`, `>> .env`, `tee .env`, `Set-Content .env x`, `Add-Content .env`, `Out-File .env` are asked in both shells; the same writes to `.env.example` are not asked by this rule (item 7).
  - Evidence: "should ask" rows for each write; "should allow: echo x > .env.example", "should not deny: Set-Content .env.example x"; M12, M13 CAUGHT (shown, 2026-10-20T19:39Z)
- AC8: tests cover `git config --get core.hooksPath` (denied), `git switch -f` and `--discard-changes` (asked), `rmdir -r -f ~` (denied) (item 8).
  - Evidence: "should deny: git config --get core.hooksPath", "should deny: rmdir -r -f ~", "should ask: git switch -f main / --discard-changes main" pass (shown, 2026-10-20T19:39Z)
- AC9: rules are also matched on a normalised copy of the command (backticks, quotes, `\` before a letter and a `.exe` suffix removed), so ``--no-ver`ify``, `'--for''ce'`, `--no-ver\ify`, `git.exe commit --no-verify` and `& 'git' push --force` get the same decision as the plain spelling (item 9).
  - Evidence: "should deny"/"should ask" item 9 rows (`git.exe commit -n` stands in for `--no-verify`, which the raw rule already denied); "should apply the protected-branch checks to an escaped git spelling (item 9)"; M15–M19 CAUGHT (shown, 2026-10-20T19:39Z)
- AC10: on Windows, an in-project edit whose path has a segment with `~` followed by a digit (`AGENTS~1.MD`, `.GITHU~1/workflows/x.yml`) is asked (item 10).
  - Evidence: "a Windows 8.3 short name (item 10)" suite: 4 asks, plus `~draft`, `x~.js` and the POSIX path allowed; M20, M21 CAUGHT (shown, 2026-10-20T19:39Z)
- AC11: `npm test` passes; a mutation test of the changed rules in governance-rules.mjs and governance-policy.mjs reports every mutation CAUGHT.
  - Evidence: gate.mjs Gate: PASS at 2026-10-20T19:38:45Z (tests, both validates, fake-pass); mutation runner: run 1 21/21 CAUGHT (M18/M19 after the escaped protected-branch test), round 2 N1–N7, N10, N11 CAUGHT, round 3 N8, N9, W1–W6 CAUGHT (shown, 2026-10-20T19:39Z)

## Tasks
- [x] T1: red tests for AC1–AC10 in `tests/governance-rules.test.mjs` and `tests/governance-policy.test.mjs` (covers AC1–AC10; ESP-110)
- [x] T2: rules: branch `--d`, `del`/`erase`, `/s` `/q`, shared deny-target constant with Windows targets and terminators, pipeline delete, `.env` write ask (covers AC1–AC4, AC6, AC7; ESP-110)
- [x] T3: decideBash: 16 KB cap and normalised-copy matching (covers AC5, AC9; ESP-110)
- [x] T4: decideEdit: ask on a `~digit` segment on Windows (covers AC10; ESP-110)
- [x] T5: README Limits bullet (covers AC1–AC10 docs; ESP-110)
- [x] T6: verify gate and mutation test (covers AC11; ESP-110)

## Files
- `plugins/usiatech-engineering/templates/github/scripts/governance-rules.mjs`
- `plugins/usiatech-engineering/hooks/scripts/governance-policy.mjs`
- `plugins/usiatech-engineering/tests/governance-rules.test.mjs`
- `plugins/usiatech-engineering/tests/governance-policy.test.mjs`
- `plugins/usiatech-engineering/README.md`

## Commands and actions
- None beyond the normal release flow (feature PR, then a patch bump to 0.18.7 in the release PR).

## Out of scope
- Version bump, version-history row and marketplace files (release bump PR).
- Resolving 8.3 names with realpath (Francis chose the ask).
- A deny (rather than ask) for shell writes to `.env`.
- ESP-111 CI rule gaps.

## Approved
- By: Francis · Date: 2026-10-20
- Route: small (cites ESP-110, 5 files, no new module or public interface)

## Change log
- 2026-10-20: plan approved by Francis; item 7 = ask rule, item 10 = ask on `~digit` segment.
- 2026-10-20: review round 1. Francis accepted the governance FLAG: the background mutation run skipped the after-Bash workflow check, but it touched only governance-rules.mjs and governance-policy.mjs, restored them byte for byte, and changed no workflow file. Blocking fixes: snapshot check on the unescaped form, pipeline-rule ReDoS, cmd/PowerShell wrappers, clustered `/s/q`. Francis also chose to fix these nits: the 8.3 ask after the denies, the pipeline delete whatever its flags, cp/mv/sed -i/Copy-Item/Move-Item .env writes, and `-Path:C:\`, `C:\\` and `/c/` root targets. All are within AC2–AC7 and AC10; no new files.
- 2026-10-20: review round 2. Blocking fixes: the 8.3 short-name reason now joins the ask reasons, so it can't turn a secret deny into an ask or hide another ask; wrapper starts `cmd` with switches before `/c` and `/r`, PowerShell options with values, `-Comm`, and the bare `powershell "…"`; cmd's `^` escape is removed in the unescaped form. Francis chose to add tests that catch N8 and N9 each on their own (timing on `\nls ~` padding, and a listing that doesn't start a command), not to accept them as survivors. Within AC2, AC6, AC9 and AC10; no new files.
- 2026-10-20: review round 3. Governance PASS; convention and silent-failure PASS with nits (a missing space, now fixed). Security found 5 more wrapper spellings, none a regression. Francis decided: ship; fix only the space; a one-off governance-only re-review of that one-character fix instead of a 4th full round (exception to the rule for `*policy*.mjs`, as in ESP-107); list the gaps in README Limits; file them as a new ESP-105 sub-task (filed as ESP-113). The governance-only re-review passed.

## Final status
- Shipped on branch `feature/esp110-guard-gaps` (PR into develop). Gate PASS 2026-10-20T19:38:45Z; AC1–AC11 shown (19:39Z).
- Deviations: `tests/governance-rules.test.mjs` is unchanged, since all new tests go through `evaluate` in `governance-policy.test.mjs`. Three review rounds, with Francis's decisions above. Remaining gaps are in ESP-113.
