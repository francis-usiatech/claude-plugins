---
name: to-spec
description: Writes a confirmed understanding into a numbered spec at docs/specs/YYYY-MM-DD-<slug>.md (problem, goals, non-goals, requirements R1…, acceptance criteria AC1…, open questions) that plans cite as their requirement reference. Use after the clarify skill, when the user says "write a spec", "spec this" or "to-spec", or when approve-plan routes work to the large route.
---

# Write the spec

## 1. Inputs
- The understanding note the user confirmed in `clarify`. If there isn't one, run `clarify` first.
- The template `${CLAUDE_PLUGIN_ROOT}/templates/spec.md`.

## 2. Write
1. Path: `docs/specs/YYYY-MM-DD-<slug>.md`, with today's date and a 2–5 word kebab-case slug. Create `docs/specs/` if needed. If the file exists, ask whether to update it or pick a new slug.
2. Fill every section:
   - **Requirements:** R1, R2… Each says *what*, not *how*, and can be tested.
   - **Acceptance criteria:** AC1, AC2… Each names the R it proves (`AC1 (R1)`) and is measurable: an observable behaviour, a command and its expected result, or a metric. Someone other than the author must be able to check it without a judgement call. Rewrite vague ones ("fast", "works well") with the user.
   - **Constraints & decisions:** the ADRs that apply. A new decision that would be hard to reverse gets a note suggesting an ADR.
   - **Open questions:** each one answered, or marked `deferred: <why>`.
   - **Tickets:** leave empty. `to-tickets` fills it only when GitHub issues aren't available.
3. Keep `Status: draft`.

## 3. Review
1. Self-check: no placeholders, every R has an AC, every AC names an R, goals and non-goals don't contradict.
2. Show the user the path and a short summary: goal, number of Rs and ACs, open questions.
3. When the user approves, set `Status: approved` and the date. Don't approve while an open question is neither answered nor marked `deferred: <why>`.
4. Hand off to `to-tickets`.

## Rules
- The spec is committed with the work it describes (through `release`), not on its own.
- One spec per independent piece of work.
