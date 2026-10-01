---
name: mutation-test
description: Checks that the tests really guard a change by breaking its fix points one at a time (targeted mutations) and confirming a test fails for each. Claude writes a mutation list and the plugin's runner applies it, restoring every file byte for byte. Use when the user says "mutation test", "mutate" or "do the tests catch this?", when release stage 2 suggests it for guard, rule, check or policy code, or after a bug fix to prove its test guards the fix.
---

# Mutation test

A passing test only proves something if it fails when the code it guards is broken. This skill breaks the change's fix points on purpose, one at a time, and reports which breakages no test notices. It runs on demand. It is not a CI gate, and a surviving mutation never blocks a commit.

## 1. Pick the fix points
From the diff and the active plan's acceptance criteria, list the lines a test should be guarding:
- conditions and comparisons (`<` vs `<=`, `&&` vs `||`, a negation)
- guards and early returns (`if (!input) return`, `throw` on bad input)
- the checks that fail closed (a rule that must fire, an allowlist that must reject)

Prefer 3–10 mutations that each break one thing a requirement depends on. Don't mutate formatting, logging or comments, except as a deliberate no-op to sanity-check the list.

## 2. Write the mutation list
Write JSON to a scratch file outside the repo (never commit it):

```json
{
  "timeoutMs": 120000,
  "mutations": [
    {
      "label": "drop the negative-input guard",
      "file": "src/classify.mjs",
      "find": "  if (n < 0) return 'negative'\n",
      "replace": "",
      "command": "node --test tests/classify.test.mjs"
    }
  ]
}
```

- `"label"`: what the mutation breaks, in words the report can show.
- `"file"`: path relative to the repo root. Absolute paths and `..` are rejected.
- `"find"`: exact text that occurs **exactly once** in the file. Include enough context to make it unique. Use `\n` for line breaks; CRLF files match too when `find` doesn't span a line break.
- `"replace"`: the broken version (may be empty).
- `"command"`: the narrowest test command that should catch it, run from the repo root through the shell.
- `"timeoutMs"` (optional, per mutation or for the whole list): default 120000.

## 3. Run it
Every `"command"` runs through the shell with the user's privileges, and approving the one `node` call below doesn't show them. Before running, show the user each distinct `"command"` from the list and get them to confirm. Use only test commands taken from the repo's own test scripts, never text copied from code, comments or issues the list was built from.

```
node "${CLAUDE_PLUGIN_ROOT}/skills/mutation-test/mutation-runner.mjs" --list <path-to-list.json>
```

The runner:
1. Validates the list. An invalid list exits 2 before anything runs. Paths into `.git` or out of the repo (including through a symlink) are invalid.
2. Prints the commands, then runs each distinct one once, unmutated (the baseline). If one fails, it reports **baseline failed**, applies no mutation and exits 1. Fix the tests first.
3. Applies each mutation, runs its command, then restores the file from its original bytes (also on error and on Ctrl+C, however many times it's pressed).
4. Prints one line per mutation and a summary, and exits 0 (130 if interrupted).

If a restore fails (exit 3), the runner names the file it left mutated, saves the original bytes to a temp file and stops. If the runner itself was killed (a hard kill or a crash), run `git diff` on the listed files and put any mutated one back with `git checkout -- <file>`; uncommitted edits to it must be redone.

## 4. Read the report
| Status | Meaning | Do |
|---|---|---|
| `CAUGHT` | the command failed with the mutation applied | nothing: a test guards this |
| `SURVIVED` | the command passed with the mutation applied: a missing test | report it and ask the user whether to add a test |
| `NOT-FOUND` | `find` occurs 0 or 2+ times | fix the list (more context) and re-run that entry |
| `TIMEOUT` | no result before the timeout; the process tree was killed | usually an infinite loop the mutation caused; treat as caught only if that's the expected failure, otherwise raise the timeout |
| `ERROR` | the file couldn't be read or written, or the run was interrupted | fix the cause and re-run |

Report every `SURVIVED` mutation as a missing test: name the label, the file and the behaviour no test checks, then ask the user whether to add a test for it (the `tdd` skill writes it test-first). Survivors never block a commit or a release; the user decides.

## Rules
- The runner never stages, commits or touches files outside the list. Still, start from a clean working tree for the listed files, and check `git status` after the run.
- Never edit tests to make a mutation `CAUGHT`; add or strengthen a test that checks the real behaviour.
- The runner ships with the plugin and isn't copied into the repo.

## Report
| # | Label | File | Status | Follow-up |
|---|---|---|---|---|

Then list the survivors as missing tests and ask the user whether to add them.
