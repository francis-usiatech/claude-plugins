# Spec: Fewer permission prompts and approval rounds

Status: approved · Date: 2026-11-07 · Author: Francis

## Problem
Planning and building still stop for prompts and approvals that don't protect anything:
- The large route asks for about seven separate approvals: clarify ×3, the spec, the tickets, the plan and the pre-flight decision (ESP-37).
- A pre-flight fix that only rewords the plan needs another approval round (ESP-46). So does a FLAG the repo has already decided the same way before (ESP-68).
- The small route's "5 files or fewer" counts tests, QA entries, docs and generated files, so almost every small fix needs "treat as small" (ESP-147).
- The guard denies a command that only names the database-drop phrase in a read-only command. `git log --grep="<phrase>"` was still denied on 2026-11-07. Since 0.19.3 (ESP-125), `grep` and `rg` searches are allowed (ESP-70).
- Every edit inside a linked git worktree asks, under `.claude/worktrees/<id>/` and elsewhere. The path matches `.claude/**`, or it falls outside the project folder. Reproduced on 2026-11-07 against the 0.22.0 guard (ESP-82).
- The `planning.preflightReviewers` check accepts a misleading agent name and leaves small code issues (ESP-73).

## Goals
- On the large route, the user approves three times: the understanding note, the spec with its tickets, and the plan with its pre-flight result.
- A wording-only pre-flight fix, and a FLAG a standing decision settles, need no decision round.
- The small route counts production code only.
- The guard's database-drop deny fires for commands that may run SQL, not for read-only commands that only name the phrase.
- Edits inside a linked worktree of this repo are checked like edits in the main checkout.

## Non-goals
- CI governance checks and the `governance-approved` label. CI still needs the label for a FLAG, settled or not. The shared deny rule text in `governance-rules.mjs` doesn't change.
- Standing decisions that settle a BLOCK or an Important finding.
- Review sizing in `release` (parallel stages, the governance-only re-review model). It keeps counting all files.
- Stream plans, orchestration and the after-Bash workflow check in a worktree (ESP-80 epic, ESP-85).
- Bash commands run from a worktree folder. They are checked as today.

## Requirements
### Batched large-route approvals (ESP-37)
- R1: `clarify` asks for one confirmation of the understanding note. The user gives all corrections in one answer. The note is shown again only when a correction changes it.
- R2: `to-spec` and `to-tickets` ask for one approval that covers the spec and the ticket list together, before any ticket is filed.
- R3: `approve-plan` shows the plan with its pre-flight result and asks once. All open pre-flight decisions go into that same question.
- R4: When `decisions.batch` is `false`, each skill asks about each item on its own, as today.

### Standing decisions (ESP-68, absorbs ESP-46)
- R5: This work implements R13–R15 and the SD-1 part of R20 of spec `docs/specs/2026-10-16-delivery-speedup.md`, unchanged.

### Small route counts production code (ESP-147)
- R6: The Small condition counts production code only. Tests, QA catalogue entries, docs and generated files don't count. Everything else counts, including config, migrations, CI workflows, hook and gate scripts, `infra/` and agent rule files (`AGENTS.md`, `CLAUDE.md`, `REVIEW.md`, `.claude/**`).
  - A generated file is one a tool regenerates and nobody edits by hand.
  - A doc is a Markdown or text file that only people read. A file that agents follow as instructions (a skill, an agent file or a rules file) is not a doc.
- R7: The other Small conditions don't change: the requirement reference, and no new skill, module, service or public interface. Nor do the "treat as small" and "treat as large" overrides.
- R8: Each "5 files" rule in `release`, and the `governance-reviewer` model rule in `approve-plan`, says it counts all files.

### Database-drop deny scoped to SQL (ESP-70)
- R9: The guard doesn't apply the database-drop deny to a command in which every simple command is read-only:
  - a search command: the grep family, `rg`, `Select-String`, `findstr`
  - a display command that writes no file: `cat`, `echo`, `printf`, `head`, `tail`, `wc`, `ls`, `pwd`, `diff`, `true`, `test`
  - `git log`, `git grep`, `git show` or `git diff` with no global option before the subcommand. Every option must be on a fixed allow-list of full option names (for example `--grep`, `-i`, `-E`, `-F`, `-n`, `-l`, `-e`, `-S`, `-G`, `--oneline`, `--all`, `--format`). Any other option fails closed, including an abbreviation, `-O`/`--open-files-in-pager` and `--output`.
  - Each simple command must also have no variable assignment before it (`GIT_PAGER=… git log`) and no output redirection. Output thrown away (`>/dev/null`, `2>&1`) is not a write.
- R10: Every other command that contains the phrase is still denied: anything that may run SQL, and any program the guard doesn't know. This covers:
  - database CLIs, `docker`/`kubectl exec`, inline scripts (`node -e`, `python -c`)
  - SQL piped or redirected into a program, and a pipe into a shell
  - a write to a file (`echo … >> ~/.bashrc`, `tee`)
  - a pager or other git option that runs a program
  
  It fails closed: a command the scan can't read is denied.
- R11: The shared rule in `governance-rules.mjs` and the CI checks don't change.

### Worktree edits (ESP-82)
- R12: For an edit under `.claude/worktrees/<id>/`, or outside the project folder, the guard asks git whether the file's folder is in a linked worktree of this repository. That holds when three things are true:
  - the worktree's git common directory is the main checkout's
  - its top level isn't the main checkout
  - its top level is one of the worktrees that `git worktree list --porcelain` lists from the main checkout, so a hand-made `.git` file isn't enough
- R13: In a linked worktree, the guard checks the path relative to the worktree's top level with the same rules as a project path. Ask paths (`.claude/**`, CI, `AGENTS.md`, dependency files, ...) still ask inside the worktree. The plan is the worktree's own `.claude/plans/active.md` if it has one, otherwise the main checkout's. The config is always the main checkout's `.claude/engineering.json`.
- R14: A folder git doesn't confirm (no git, another repository, a plain folder, a git error) is handled as today: `.claude/**` asks, and so does "outside the project folder". A git failure never allows the edit.
- R15: Each log entry for a worktree edit goes to the main checkout's governance log, with a `worktree` field that holds the worktree's top level.

### Pre-flight reviewer tidy-ups (ESP-73)
- R16: A `planning.preflightReviewers` entry whose `agent` doesn't match `^[A-Za-z0-9._:-]+$` is invalid. It is reported as advisory and skipped. `approve-plan` states the rule.
- R17: `quoteKey` escapes DEL (U+007F), and shares its code-point list with `hasControlChar` from `governance-rules.mjs`. The unused `when` binding goes, and the `checkPlanning` comment says that only a null `when` makes an entry run on every plan.

### Docs
- R18: The plugin README describes each change and has a Versioning row. ADR-0004 records the R9–R11 decision.

## Acceptance criteria
- AC1 (R1–R4): `clarify`, `to-spec`, `to-tickets` and `approve-plan` describe the single confirmation, the joint spec-and-tickets approval and the plan-with-pre-flight question. Each also says what happens when `decisions.batch` is `false`.
- AC2 (R5): The delivery-speedup spec's AC10 and AC11 hold. `governance-reviewer.md` describes the Standing decisions section, the 10-entry cap and its note, "FLAG, settled by SD-n" and the fixed never-settles list. `approve-plan` and `release` log settled FLAGs and leave them out of the decision. `templates/governance.md` has SD-1 as R15 of that spec words it. This repo's `.claude/governance.md` has SD-1.
- AC3 (R6, R7): The `approve-plan` Small condition says the count is production code only. It names the four excluded categories, defines generated files and docs, lists what still counts, and says the other conditions and overrides are unchanged.
- AC4 (R8): Every "5 files" or "5 paths" rule in `release` and `approve-plan` says what it counts.
- AC5 (R9): Guard tests: `git log --grep="<phrase>"`, `git grep "<phrase>"`, `grep`/`rg` searches and `cat notes | grep "<phrase>"` are not denied.
- AC6 (R10): Guard tests: these are each denied:
  - `psql -c`, `mysql -e`, `sqlite3`, `sqlcmd`
  - `docker exec … psql`, `kubectl exec`
  - `echo … | psql`, `psql < file` together with the phrase
  - `node -e`, `python -c`, an unknown program
  - `git -c core.pager=sh log --grep=…`, `git log --grep=… | sh`
  - `git grep -O'psql -c "…"' x`, `git grep --open-files-in-pager=… x`, `git grep --o… x`
  - `GIT_PAGER='psql -c "…"' git log`
  - `echo "…" >> ~/.bashrc`, `echo "…" | tee hook.sh`
  - a backtick or `$(` the scan can't read
  - an unquoted wildcard, as in `git grep "…" -- *`
- AC7 (R9, R10): A mutation-test run on the new exemption leaves no survivor. Each mutation that widens it fails a test. That includes accepting any command, accepting any git option, dropping the variable-assignment check and dropping the redirection check.
- AC8 (R11): `git diff` shows no change to the deny rule text in `templates/github/scripts/governance-rules.mjs`, and the CI rule tests pass unchanged.
- AC9 (R12, R13): Guard table tests, using a real temporary repository and worktrees:
  - In-plan edits are allowed both in a worktree under `.claude/worktrees/<id>/` and in one outside the project folder.
  - `<worktree>/.claude/settings.json` and `<worktree>/AGENTS.md` ask.
  - A path outside the plan asks.
  - The worktree's own plan wins over the main one.
  - A looser `engineering.json` in the worktree (for example `askPaths: []`) has no effect.
- AC10 (R12, R14): Guard tests: these each ask, as today:
  - a plain folder under `.claude/worktrees/`
  - a worktree of another repository
  - a folder with a hand-made `.git` file that `git worktree list` doesn't list
  - a git call that throws
- AC11 (R12, R13): A mutation of the worktree check fails a test. The mutations are:
  - accepting any top level
  - skipping the common-directory comparison
  - skipping the `git worktree list` check
  - checking the path against the main root instead of the worktree's top level
  - reading the worktree's config
- AC12 (R15): A guard test shows the log entry for a worktree edit has the `worktree` field and is written to the main checkout's log.
- AC13 (R16, R17): Advisory guard tests: an agent name with U+202E, U+200B, U+FEFF or a space is invalid and skipped. A quoted unknown key shows DEL as `\u007f`. `approve-plan` states the name rule.
- AC14 (R18): The README covers each item and has a Versioning row. `docs/adr/0004-*.md` exists with Status: Accepted.
- AC15 (all): The gate (`node plugins/usiatech-engineering/skills/verify/gate.mjs`) prints `Gate: PASS`. That includes `npm test` with 0 failures, the fake-pass check at 0 and both `claude plugin validate` runs at exit 0.

## Constraints & decisions
- Francis decided (2026-11-07):
  - All seven tickets go in one PR.
  - ESP-70 scopes the rule instead of only adding tests.
  - ESP-82 covers worktrees outside the project folder too.
  - One spec and plan with one approval; no separate clarify round.
- ESP-147 decision (Francis, 2026-11-05): count production code only; review sizing keeps all files.
- Fail-closed reading of "only when it runs SQL" (R9, R10). The guard can't tell whether an unknown program runs SQL, so an unknown program counts as one. Only the listed read-only commands are exempt. This follows ESP-111, which made the git log/show check a plain-text allow-list that fails closed.
- R13 takes the config from the main checkout, so a worktree branch can't loosen the guard for itself. The plan can come from the worktree, because a write to the worktree's plan asks (or is logged as trusted under `planEdits: "all"`) as it does in the main checkout.
- The AC6 timing rule: the extra git calls run only for paths that asked before (under `.claude/worktrees/` or outside the project). The no-change path imports nothing new.
- ADR-0004 (new) records the fail-closed SQL scoping. ADR-0001 (network lookups) and ADR-0002 are unaffected.

## Open questions
- Which folders count as outside-the-project worktrees? Answered: any folder git confirms as a linked worktree of this repository (R12).
- Where does a worktree edit's plan come from? Answered: the worktree's own plan, otherwise the main checkout's (R13).
- Does ESP-46 need its own text? Answered: no, SD-1 carries it (R5).

## Tickets
Already filed in Jira; mapped 2026-11-07:
- ESP-37 · Batch approvals on the large route · Covers: R1–R4, AC1 · Blocked by: none
- ESP-68 · Standing decisions in governance-reviewer (absorbs ESP-46) · Covers: R5, AC2 · Blocked by: none
- ESP-147 · Small route counts production code only · Covers: R6–R8, AC3, AC4 · Blocked by: none
- ESP-70 · Scope the database-drop deny to SQL · Covers: R9–R11, AC5–AC8 · Blocked by: none
- ESP-82 · Guard checks worktree edits against the worktree · Covers: R12–R15, AC9–AC12 · Blocked by: none
- ESP-73 · preflightReviewers tidy-ups · Covers: R16, R17, AC13 · Blocked by: none
- All · Docs, ADR-0004, gate · Covers: R18, AC14, AC15
