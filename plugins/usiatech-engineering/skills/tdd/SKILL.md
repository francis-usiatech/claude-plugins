---
name: tdd
description: Drives a change test-first. Red (a test that fails for the right reason), green (the smallest change that passes), refactor (clean up with tests green), with evidence for every cycle. Use when the user says "tdd", "test first" or "write the test first", when fixing a bug (the reproducing test comes first), or when an approved plan says to work test-first.
---

# Test-driven change

The failing test is the specification. No production code is written until a test has been seen to fail for the right reason.

## 0. Set up
1. Find the targeted test command.
   - Look first in `.claude/engineering.json` → `verify` (the unit-test entry).
   - Otherwise use AGENTS.md "Testing policy" or "Definition of done".
   - Prefer running a single file or test name. If you can't tell how, ask.
2. List the behaviours to add as a short checklist, one per cycle, simplest first.

## 1. Red
1. Write one test for the next behaviour. Follow the repo's test conventions for location, naming and helpers.
2. Run it. It must **fail**, and for the expected reason: an assertion about the missing behaviour, not a syntax error, import error or missing fixture. Fix the test until it fails for the right reason.
3. If it passes straight away, either the behaviour already exists or the test is wrong. Say which, and don't count it as a cycle.

## 2. Green
1. Write the smallest production change that makes the test pass. No extra features, options or refactors.
2. Run the test, then the whole related test file. Everything must pass.

## 3. Refactor
1. Remove duplication and clarify names in the code touched this cycle. Behaviour stays the same.
2. Re-run the related tests. They must stay green. If one fails, undo the refactor rather than change the test.

## Rules
- Never weaken, delete, `.skip` or `.only` a test to get to green. If a test is wrong, say why and get approval before changing it.
- A bug fix starts with a test that reproduces the bug. Use the `debug` skill first if the cause isn't known.
- Tests assert behaviour the user cares about, not implementation details or mocks of the code under test.
- Edits still follow the repo's approval rules: the approved plan must cover the files.

## Report
After the last cycle, run the `verify` skill, then report:

| # | Behaviour | Red (test, failure line) | Green (result) | Refactor |
|---|---|---|---|---|

Include the verify gate table. Don't claim a cycle you didn't run in this session.
