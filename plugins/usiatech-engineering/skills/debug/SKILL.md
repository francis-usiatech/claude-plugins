---
name: debug
description: Finds the root cause of a bug before fixing it. Reproduce, localize, reduce, fix, then add a guard test. Use when the user reports a bug, error, failing test, crash or "it doesn't work", or when a fix attempt has already failed once.
---

# Debug (root cause first)

Don't change production code until the root cause is stated and the user has approved the fix.

## 1. Reproduce
- Get the exact failing command, input, error text and environment (branch, OS, runtime version).
- Run it and capture the output. If you can't reproduce it, say so, list what you tried and ask for the missing detail. Don't guess-fix.

## 2. Localize
- Read the error from the top stack frame in this repo's code.
- Check recent changes: `git log --oneline -15 -- <paths>` and `git diff <base>...HEAD -- <paths>`.
- Write down 2–4 hypotheses, each with the evidence that would confirm or rule it out.
- Test the cheapest hypothesis first: a temporary log, a narrower case, or `git bisect` when a known-good commit exists.
- After three disproved hypotheses, stop. Summarise what's ruled out and re-plan with the user.

## 3. Reduce
- Shrink the reproduction to the smallest input or test that still fails. This becomes the guard test.

## 4. Fix (after approval)
- State the root cause in one or two sentences, with `file:line`, and explain why the symptom follows from it.
- Propose the smallest fix at the root cause, not at the symptom: no catch-and-ignore, no retry loops, no special-casing the failing input. Wait for approval.
- Implement it with the `tdd` skill. The reduced reproduction is the red test.

## 5. Guard
- The regression test stays in the suite and names the bug (and the issue number if there is one).
- Remove every temporary log or debug change. `git diff` must show only the fix and the test.
- Search for the same pattern elsewhere and list any other occurrences for the user. Don't fix them unasked.

## Report
**Symptom** · **Root cause** (`file:line`) · **Fix** · **Guard test** · **Other occurrences** · the `verify` gate table.
