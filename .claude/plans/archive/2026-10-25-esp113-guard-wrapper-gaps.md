# Plan: Guard rule gaps from the ESP-110 reviews (ESP-113)

## Goal
Close the 10 guard gaps listed in ESP-113 in the shared command rules and the guard's Bash and Edit decisions, test-first. Wrapper spellings (items 1–5) are handled by one fail-closed ask rule instead of more listed spellings. Update the README guard "Limits" bullet.

## Requirement references
- ESP-113 (parent ESP-105; follow-up from the ESP-110 reviews, `.claude/plans/archive/2026-10-20-esp110-guard-gaps.md`)

## Pre-plan checklist
- (a) New validation rules and format checks: DENY_COMMANDS / ASK_COMMANDS are used only by `hooks/scripts/governance-policy.mjs` (decideBash) and tested in `tests/governance-rules.test.mjs`; `decideBash`, `unescaped`, `MAX_COMMAND_CHARS`, `decideEdit` and `decideOutsideEdit` are used only in governance-policy.mjs and tested through `evaluate` in `tests/governance-policy.test.mjs`. CI doesn't use the command rules (README 0.18.3 row). `git grep` found no other callers or fixtures (other hits are archived plans and audits).
- (b) Database or infrastructure mechanisms: n/a: regex, string and `fs.realpathSync.native` checks only; no database, infrastructure or new runtime mechanism. The 8.3 expansion uses `realpathSync.native` through a new injectable `longName` option (`longPathOf`); it walks to the nearest existing parent like `realOf` but with its own error handling, so the two are not merged.
- (c) Docs and ADRs touched: `plugins/usiatech-engineering/README.md` (guard "Limits" bullet, line 135, the deletes bullet at line 136, and the 8.3 sentence in the Windows path bullet at line 137). The version-history row and version bump go in the release bump PR. No ADR covers the command rules (ADRs 0001–0003 are lookups, fake-pass, Jira). No docs reviewer is configured (`planning.preflightReviewers` is not set).

## Acceptance criteria
- AC1: a command that names a wrapper (`cmd`, `ComSpec`, `powershell`, `pwsh`, `iex`, `Invoke-Expression`, `Start-Process`, `saps`) and a delete alias (`rm`, `rmdir`, `remove-item`, `ri`, `rd`, `del`, `erase`) is asked whenever no deny rule matches it. This covers every ESP-113 item 1–5 example: `cmd /q /d /e:on /v:off /s /c rd /s /q C:\`, `cmd /c"rd /s /q C:\"`, `& $env:ComSpec /c rd /s /q C:\`, `$COMSPEC //c rd …`, `cmd /c cmd/c rd …`, `iex 'rd C:\ -r -fo'`, `Start-Process cmd -ArgumentList '/c rd /s /q C:\'`, `cmd /c rd/s/q C:\`. A command with neither word (`npm start`, `cmd /c echo hi`) is not asked by this rule. The rule is linear (anchored lookaheads).
  - Evidence: governance-policy.test.mjs "evaluate: guard gaps (ESP-113)" should ask: the 11 wrapper cases (cmd, ComSpec, iex, Invoke-Expression, Start-Process, saps) and should allow: npm start, cmd /c echo hi; all pass in the gate tests step (shown, 2026-10-25T05:51Z)
- AC2: `$null = ri C:\ -Recurse -Force` is denied: `=` starts a command for the short delete aliases (item 4).
  - Evidence: test "should deny: $null = ri C: -Recurse -Force" passes in the gate tests step (shown, 2026-10-25T05:51Z)
- AC3: the deny rules also run on a command over 16 KB, so padding can't turn a deny into an ask; a padded `rm -rf /` over 16 KB is denied, a padded harmless command is still asked, and the guard returns in under 1 s on a 176 KB adversarial command (item 6).
  - Evidence: tests should deny the three padded deletes over 16 KB, should still ask a command over 16 KB when one part is over 4 KB, and should decide a long worst-case command quickly pass; probe: padded echo (18,005 chars) asked in 2 ms (shown, 2026-10-25T05:51Z)
- AC4: on Windows, an in-project 8.3 path that exists is decided as its long name (`fs.realpathSync.native`), so a short name for `.env` is denied and one for a protected path is denied; a short name that doesn't exist yet, or can't be resolved, is still asked (item 7).
  - How it is shown: the long-name lookup is passed into the decision (the native `realOf` by default), so `governance-policy.test.mjs` tests the deny with a stub resolver on any OS; one native test reads a real short name and skips, with the reason printed, when the volume has none. The stub tests are the evidence.
  - Evidence: stub-resolver tests should deny a short name for an env file or a protected folder, should still ask a short name that does not resolve, should ask when the lookup fails pass; native 8.3 test skipped (8.3 names off on this volume) (shown, 2026-10-25T05:51Z)
- AC5: a listing of a root or home target with a stage before the delete (`gci ~ | % { ri $_ -r }`, `ls ~ | ? {$_} | Remove-Item -Recurse`) and `xargs` into a delete (`ls ~ | xargs rm -rf`, `find / | xargs rm -rf`) are denied; `ls ~ | Select-String x` is allowed (item 8).
  - Evidence: tests should deny gci ~ | % { ri $_ -r }, ls ~ | ? {$_} | Remove-Item, ls ~ | xargs, find / | xargs pass; probe: ls ~ | Select-String x allowed (shown, 2026-10-25T05:51Z)
- AC6: `rm -rf ..`, `rm -rf ../`, `rm -rf "$PWD"`, `rm -rf $PWD`, `Remove-Item $PWD -Recurse -Force` are denied; `rm -rf ./build` and `rm -rf ../x` stay asked. Bash `$'…'` quoting is read: `$'rm' -rf /` is denied, and a `$'…'` holding a backslash escape is asked. `powershell -EncodedCommand <base64>` (and `-enc`, `-e`, `-ec`) is decoded from UTF-16LE base64 and the rules run on the decoded text, so an encoded `rd /s /q C:\` is denied; an undecodable value is asked (item 9).
  - Evidence: tests should deny the .., ../, $PWD, ${PWD}, $'rm' and four -EncodedCommand cases, should ask ../x, the $'rm' escape and three undecodable values pass; probe: ./build asked (shown, 2026-10-25T05:51Z)
- AC7: on Windows, an outside-project edit to a trusted write path whose path has an 8.3 segment is decided as its long name when it exists, and asked when it can't be resolved; a trusted long name is unchanged (item 10). Shown with the same stub resolver as AC4.
  - Evidence: stub-resolver tests should trust an outside write through a short name that resolves to a trusted path and should deny an outside short name for an env file, and ask one that does not resolve, pass (shown, 2026-10-25T05:51Z)
- AC8: `npm test` passes (the mutation test was waived on 2026-10-22, see the change log).
  - Evidence: gate tests step PASS (exit 0, 128 s) after both review fixes, validate steps and fake-pass check PASS, Gate: PASS; mutation test waived by Francis (change log) (shown, 2026-10-25T05:51Z)

## Tasks
- [x] T1: red tests for AC1–AC7 in `tests/governance-policy.test.mjs` (and `tests/governance-rules.test.mjs` where a rule is tested on its own) (covers AC1–AC7; ESP-113)
- [x] T2: rules: wrapper + delete-alias ask rule, `=` as a command start, pipeline/xargs delete deny, `..` and `$PWD` root targets (covers AC1, AC2, AC5, AC6; ESP-113)
- [x] T3: decideBash: deny rules before the 16 KB cap (made linear where needed), `$'…'` reading, `-EncodedCommand` decoding (covers AC3, AC6; ESP-113)
- [x] T4: decideEdit and decideOutsideEdit: expand an existing 8.3 path with `realOf`, keep the ask otherwise (covers AC4, AC7; ESP-113)
- [x] T5: README guard "Limits", deletes and Windows-path (8.3) bullets (covers AC1–AC7 docs; ESP-113)
- [x] T6: verify gate and mutation test (covers AC8; ESP-113)

## Files
- `plugins/usiatech-engineering/templates/github/scripts/governance-rules.mjs`
- `plugins/usiatech-engineering/hooks/scripts/governance-policy.mjs`
- `plugins/usiatech-engineering/tests/governance-rules.test.mjs`
- `plugins/usiatech-engineering/tests/governance-policy.test.mjs`
- `plugins/usiatech-engineering/README.md`
- `plugins/usiatech-engineering/tests/workflow-rules.test.mjs` (timing headroom only)

## Commands and actions
- None beyond the normal release flow (feature PR, then a patch bump to 0.18.9 in the release PR).

## Out of scope
- Parsing commands instead of matching text; any wrapper spelling the new ask rule doesn't name.
- Decoding other encodings (`-EncodedArguments`, `FromBase64String` in a script body) and full ANSI-C escape decoding (a `$'…'` with a backslash escape is asked instead).
- Version bump, version-history row and marketplace files (release bump PR).
- ESP-115 (git log/show gaps).

## Approved
- By: Francis · Date: 2026-10-22
- Route: small (cites ESP-113, 5 files, no new module or public interface)

## Change log
- 2026-10-22: plan drafted; Francis chose one fail-closed ask rule for items 1–5 and all 10 items in one PR.
- 2026-10-22: pre-flight FLAG (AC4/AC7 proof, README line 137) fixed in the draft; Francis approved.
- 2026-10-22: AC3 refined during build: commands over 16 KB are checked for denies in parts cut before ; & and line breaks (pieces up to 4 KB, since the rules are quadratic: 8–14 s at 150 KB); a single part over 4 KB stays unchecked and asked (README Limits). Within AC3; no new files.
- 2026-10-22: Francis skipped the AC8 mutation test (list ready: 20 mutations M1–M20); AC8 will show the gate only.
- 2026-10-22: the gate failed 3 times on the 1 s workflow-rules timing tests under load (1,001–1,140 ms; 599 ms alone). Francis chose to raise the headroom: `TIME_LIMIT_MS` 1000 → 2000 and `TIMING_CAP_MS` 3000 → 5000 in `tests/workflow-rules.test.mjs`, and the 19 test names now say "under 2 s". Spec R12's 1 s target is unchanged, and a quadratic pattern still fails. One file added; no code change.
- 2026-10-25: stage-1 governance review FLAG (one guard error: the after-Bash workflow check skipped the background gate run at 05:26Z; no `.github/workflows` changes). Francis acknowledged it and had AC8 reworded to match the mutation-test waiver.
- 2026-10-25: stage-2 review round 1: security BLOCK and silent-failure FLAG. Fixed test-first, within AC3 and AC6 and the same files: `-EncodedCommand` is now also read from the unescaped command (a quoted or split flag or name), with `--` and dash-character prefixes, whitespace inside a quoted value, and nested encoded commands up to 3 levels (deeper is asked). The pipe/xargs deny rule lets xargs take only dash options, which removes a 12.5 s ReDoS. Padding made of spaces or tabs is squeezed before the 16 KB pieces are cut. Deny pieces are computed once. README Limits updated. `tests/governance-rules.test.mjs` stays unchanged: the rules are tested through `evaluate`. The fix touches `*rules*.mjs` and `*policy*.mjs`, so a full second review round runs.
- 2026-10-25: round 2: convention PASS (an indent nit, fixed). Silent-failure found a nested encoded command with a quoted or split inner flag; fixed test-first, since the recursion now also reads unescaped(text). Security could not run probes; Claude ran 12 adversarial and bypass probes up to 176 KB, and each asked or denied in under 70 ms. Gate PASS 05:51Z. Francis approved a one-off governance + security re-review of the fix instead of a third full round.
- 2026-10-25: post-commit security pass on dc6ea14 (follow-up commit, same files, within AC3 and AC6; Francis kept the governance + security re-review exception). HIGH: `pwsh -ep -e <b64>` was allowed, since another -e flag took the encoded flag as its value; the value is now read in a lookahead. MEDIUM: commands still over 1 MB after squeezing space padding are asked before any rule, so a padded delete is still denied. The re-review found `pwsh @('-e','<b64>')` and `pwsh ('-e') <b64>` allowed; the flag may now start a group or array element. A second security check found `@('-e';'<b64>')` and `('-e')('<b64>')` allowed; `;` and `(` now also end a flag. All fixed test-first; gate PASS 06:13:38Z. A single part over 4 KB stays an accepted limit (README Limits).

## Final status
- Shipped on branch `feature/esp113-guard-wrapper-gaps` (PR into develop, to be released as 0.18.9).
- AC1–AC8: met, evidence above (gate PASS 2026-10-25T05:51Z).
- Deviations: the mutation test was waived (AC8 reworded). A single non-whitespace part over 4 KB in a command over 16 KB stays asked, not denied (README Limits). `tests/governance-rules.test.mjs` is unchanged. The worst-case timing test checks the decision only for commands over 16 KB. Review took two full rounds plus a governance and security re-review of the fix (Francis approved the exception).
- Open nit: `ENCODED_FLAG`'s unquoted value `S*` takes a trailing `;`/`&`/`|`, so `pwsh -e <b64>;…` is asked, not decoded (fails closed).
