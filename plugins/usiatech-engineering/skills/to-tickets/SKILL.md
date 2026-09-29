---
name: to-tickets
description: Splits an approved spec into small tickets that each name the requirements and acceptance criteria they cover and the tickets that block them, filed as GitHub issues (or written into the spec's Tickets section when gh isn't available). Use after the to-spec skill, when the user says "make tickets", "break this down" or "to-tickets", or when approve-plan routes work to the large route.
---

# Spec to tickets

## 1. Split
1. Read the spec. It must say `Status: approved`. If it's a draft, stop and ask the user to approve it first.
2. Split it into tickets small enough for one reviewable PR each. Each ticket has:
   - a title (imperative, 60 characters or fewer)
   - **Covers:** the R and AC IDs it delivers
   - **Blocked by:** the tickets that must land first, or none
   - **Done when:** its ACs, restated as checks
3. Every R must be covered by at least one ticket. Order the tickets so blockers come first.
4. Show the list as a table (`# | Title | Covers | Blocked by`) and ask the user once to confirm before filing anything.

## 2. File
1. Check GitHub access: `gh auth status` and `gh repo view --json nameWithOwner`. Both must succeed.
2. **With GitHub:** create the issues in blocker order, so each `Blocked by #NN` names a real issue.
   - `gh issue create --title "<spec-slug>: <title>" --body-file <file>`
   - Body: the spec path, `Covers: R1, AC2`, `Blocked by #NN` (or "none") and the done-when checks.
   - Write each body to a temp file in the session scratchpad, not the repo.
   - Apply the `spec:<slug>` label only if it already exists (`gh label list`). Never create labels.
3. **Without GitHub** (either check failed): write the tickets into the spec's `## Tickets` section as T1, T2… with the same fields, and tell the user why issues weren't filed.
4. Report the issue numbers or T-IDs. They and the spec path become the plan's requirement references.

## Rules
- Filing issues is visible to others. Never file without the confirmation in step 1.4.
- If an issue fails to create, stop, report which issues were created, and don't retry silently.
