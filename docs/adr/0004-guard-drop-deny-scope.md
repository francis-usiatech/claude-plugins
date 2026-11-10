# ADR 0004: The database-drop deny skips read-only commands, failing closed

Status: Accepted (Francis, 2026-11-07) · Date: 2026-11-07 · Author: Francis

References: spec `docs/specs/2026-11-07-permission-prompts.md` (R9–R11, AC5–AC8), Jira ESP-70.

## Context

The guard denies any Bash or PowerShell command whose text names dropping a database or schema. Since 0.19.3 (ESP-125), the guard blanks quoted search patterns of `grep`, `rg` and similar tools before its rules run. Other read-only commands are still denied when they name the phrase. On 2026-11-07, `git log --grep="<phrase>"` was denied, and so was a read command with a pipe the scanner gives up on. Each deny stops the session and needs the user.

The ticket asked for the deny to apply "only when the command runs SQL". The guard can't tell whether a program it doesn't know runs SQL. A script, an inline `node -e` or a custom CLI may all run SQL.

## Decision

Keep the rule text, which the CI checks share, unchanged. In the guard, skip this one rule when every simple command in the command is on a fixed read-only list:
- a search command
- a display command that writes no file
- `git log`, `git grep`, `git show` or `git diff` with no global option and only allow-listed, fully spelled options

The skip also needs each of these, or the deny stays:
- no variable assignment before a command
- no output redirection, apart from output thrown away
- nothing the split can't read: a `$`, a backtick, an escape outside quotes, a line break, a comment, a heredoc or input redirect, or a PowerShell block, group or call
- no unquoted wildcard (`*`, `?`, `[`), which can expand to a file named like an option such as `-O<pager>`
- only printable ASCII outside quotes, because PowerShell also splits words on NBSP, vertical tab, form feed and other spaces
- in PowerShell, no `"` or `\` inside quotes, because Windows PowerShell 5.1 rebuilds the argument and git can read it as several
- in git, a per-subcommand list of options that always take a value; an option that may take none (`git grep -G`, a bare `--pretty`) never skips the next word

Anything not on the list counts as a command that may run SQL, so the deny stays.

## Consequences

- Searches and git history reads that name the phrase run without a prompt.
- Every program the list doesn't name keeps the deny. Among them are git options that run a program (`-O`/`--open-files-in-pager`, `-c`, `--config-env`), `GIT_PAGER=…` and git's abbreviated long options. That costs a deny on some harmless commands, such as `sed` over a notes file, but it can't let an SQL run through.
- New read-only commands or git options are added to the list one at a time, each with a deny test for its program-running neighbours. A mutation test of the list's checks is part of each change.
- The CI rules and other repos' `denyCommands` are unaffected. Only the built-in rule is skipped.

## Addendum (2026-11-10, ESP-150, ESP-151)

- `sleep` joins the read-only list, and in Bash the keywords `until`, `while`, `do`, `done`, `if`, `then`, `elif`, `else`, `fi` and `!` are skipped at the start of a simple command, so a wait loop such as `until test -f x; do sleep 1; done` reads as read-only. Deny tests cover a loop or `sleep` beside a program and a `$(…)` in the loop condition, and a mutation test covers both changes.
- The after-Bash workflow check reuses the same split: a background command made only of read-only commands is not logged as an unchecked `error` (ESP-151).
- The guard's trusted `git branch -d` and `governance.trustedDeletePaths` deletes (ESP-150) reuse the split too: every other simple command in such a command must be on this list, or it asks.
