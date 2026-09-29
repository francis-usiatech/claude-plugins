# Step 3: Requirements Flow Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add the front of the process: `clarify`, `to-spec` and `to-tickets` skills, size-based routing and acceptance criteria/tasks in `approve-plan`, an acceptance-criteria table in `verify`, and spec-consistency and acceptance-criteria checks in `governance-reviewer`. Ships as usiatech-engineering 0.7.0.

**Architecture:** Everything here is Markdown (skills, agent, templates). The guard hook's decisions don't change. `tests/plugin-structure.test.mjs` pins each behaviour as required text in the skill, agent or template, so a later edit can't drop it silently. One guard regression test pins that spec files and plan task text don't change the edit scope.

**Tech Stack:** Node ≥ 20 ES modules, `node:test`, no dependencies. Claude Code plugin format (skills, agents, templates).

**Spec:** `docs/superpowers/specs/2026-09-28-step-3-requirements-flow-design.md` (approved 2026-09-28). Requirement IDs R1–R11 and AC1–AC7 below refer to it.

## Global Constraints

- No new dependencies. Tests use `node:test` and `node:assert/strict` only.
- Code style: 2-space indent, single quotes, no semicolons, ES modules, sparse comments that explain *why*.
- Test names use `describe(...)` + `it('should …')`.
- Reviewer agents stay read-only: `tools: ["Read", "Grep", "Glob", "Bash"]`.
- New skills are about 30–45 lines, one job each, in the style of `skills/tdd/SKILL.md`.
- No change to `hooks/scripts/*.mjs` or `templates/github/scripts/*.mjs`. Consuming repos don't re-copy CI scripts.
- No new `engineering.json` keys. The small/large threshold (≤ 5 files) is guidance text in `approve-plan`.
- Version 0.7.0 in `.claude-plugin/marketplace.json`, `plugins/usiatech-engineering/.claude-plugin/plugin.json`, the root `README.md` table and the plugin README version table.
- Branch `feature/step-3-requirements-flow` off `main` (already created; holds the spec commit). One commit per task. The PR goes into `main`.
- The full gate is `npm test` from the repo root, plus `claude plugin validate .` and `claude plugin validate plugins/usiatech-engineering`.

## Out of scope

- CI gating on acceptance criteria.
- An `engineering.json` threshold setting.
- A6/A7 (fake-pass detection, excuse tables), B6 (over-engineering reviewer).
- Creating GitHub labels.
- Any change to the guard's allow/ask/deny decisions.

## Review Focus

1. **Paths written under a plan's `## Tasks` must not widen the edit scope.** Only `## Files` counts. Pinned by the Task 8 test "should not take scope from the Tasks section".
2. **Plans written before 0.7.0 (no Acceptance criteria section)** must not get AC findings or an AC table. Pinned by the Task 6 and Task 7 tests that require the "only if … Acceptance criteria section" wording.
3. **`to-tickets` must not file issues or create labels without confirmation.** Filing is outward-facing. Pinned by the Task 4 test "should confirm once before filing and never create labels".
4. **A spec must not be approved with an unanswered open question.** Pinned by the Task 3 test requiring `deferred: <why>`.
5. **`clarify` must not write files.** Pinned by the Task 2 test requiring "Write no files".

---

## File map

| File | Change | Responsibility | Spec |
|---|---|---|---|
| `plugins/usiatech-engineering/templates/plan.md` | Modify | Acceptance criteria, Tasks, Route line | R7 |
| `plugins/usiatech-engineering/templates/spec.md` | Create | Spec skeleton | R5 |
| `plugins/usiatech-engineering/skills/clarify/SKILL.md` | Create | B1 | R4 |
| `plugins/usiatech-engineering/skills/to-spec/SKILL.md` | Create | B2 spec | R5 |
| `plugins/usiatech-engineering/skills/to-tickets/SKILL.md` | Create | B2 tickets | R6 |
| `plugins/usiatech-engineering/skills/approve-plan/SKILL.md` | Modify | Routing, ACs, tasks, pre-flight | R1–R3, R7 |
| `plugins/usiatech-engineering/skills/verify/SKILL.md` | Modify | AC table and warning | R8, R9 |
| `plugins/usiatech-engineering/agents/governance-reviewer.md` | Modify | Checks 7 and 8 | R8, R10, R11 |
| `plugins/usiatech-engineering/tests/plugin-structure.test.mjs` | Modify | Pins for all of the above, version consistency | AC1–AC5, AC7 |
| `plugins/usiatech-engineering/tests/governance-policy.test.mjs` | Modify | Guard regression | AC6 |
| `plugins/usiatech-engineering/README.md`, `README.md`, `.claude-plugin/marketplace.json`, `plugins/usiatech-engineering/.claude-plugin/plugin.json`, `docs/roadmap.md` | Modify | Docs, 0.7.0 | AC7 |

---

### Task 1: Plan and spec templates

**Files:**
- Modify: `plugins/usiatech-engineering/templates/plan.md`
- Create: `plugins/usiatech-engineering/templates/spec.md`
- Test: `plugins/usiatech-engineering/tests/plugin-structure.test.mjs`

**Interfaces:**
- Produces: plan headings `## Acceptance criteria` (items `- AC1: …` with a nested `- Evidence: …`) and `## Tasks` (items `- [ ] T1: … (covers AC1; …)`), and a `- Route: <small | large> …` line under `## Approved`. Spec headings: `## Problem`, `## Goals`, `## Non-goals`, `## Requirements`, `## Acceptance criteria`, `## Constraints & decisions`, `## Open questions`, `## Tickets`, and a `Status: draft | approved` line. Tasks 3–7 refer to these names exactly.

- [ ] **Step 1: Write the failing tests** (append to `plugin-structure.test.mjs`)

```js
describe('plugin structure: step-3 templates', () => {
  it('should give the plan template acceptance criteria, tasks and a route line', () => {
    const text = read('templates', 'plan.md')
    const at = (h) => text.indexOf(h)
    assert.ok(at('## Requirement references') < at('## Acceptance criteria'), 'AC after requirement references')
    assert.ok(at('## Acceptance criteria') < at('## Tasks') && at('## Tasks') < at('## Files'), 'AC, then Tasks, then Files')
    assert.match(text, /^- AC1: .+\r?\n\s+- Evidence: /m)
    assert.match(text, /^- \[ \] T1: .+\(covers AC1/m)
    assert.match(text, /^- Route: <small \| large>/m)
  })

  it('should give the spec template every required section', () => {
    const text = read('templates', 'spec.md')
    for (const h of ['## Problem', '## Goals', '## Non-goals', '## Requirements', '## Acceptance criteria',
      '## Constraints & decisions', '## Open questions', '## Tickets']) {
      assert.match(text, new RegExp(`^${h}\\b`, 'm'), h)
    }
    assert.match(text, /Status: draft \| approved/)
  })
})
```

- [ ] **Step 2: Run them and check they fail**

Run: `node --test plugins/usiatech-engineering/tests/plugin-structure.test.mjs`
Expected: the plan test fails on the heading order (`## Acceptance criteria` is missing, `indexOf` = -1), and the spec test fails with `ENOENT … templates/spec.md`.

- [ ] **Step 3: Rewrite `templates/plan.md`**

```markdown
# Plan: <short title>

## Goal
<one or two sentences>

## Requirement references
- <intent §, capability ID (e.g. C22), FR/AC, ADR-NNNN, D-item, spec path (docs/specs/…), #issue>

## Acceptance criteria
- AC1: <measurable outcome: an observable behaviour, a command and its expected result, or a metric>
  - Evidence: <filled by verify: passing test name, command output or observed result>

## Tasks
- [ ] T1: <task> (covers AC1; ticket #NN or spec T1)

## Files
- `<path or narrow glob>`

## Commands and actions
- <e.g. pnpm db:generate (new migration), pnpm add zod (approved dependency)>

## Out of scope
- <explicit exclusions>

## Approved
- By: <name> · Date: <YYYY-MM-DD>
- Route: <small | large> (<the rule that decided it, or "override: …">)

## Change log
- <YYYY-MM-DD: scope change and who approved it>
```

- [ ] **Step 4: Create `templates/spec.md`**

```markdown
# Spec: <title>

Status: draft | approved · Date: <YYYY-MM-DD> · Author: <name>

## Problem
<who is affected, what goes wrong, how we know>

## Goals
- <outcome>

## Non-goals
- <explicitly not doing>

## Requirements
- R1: <what the system must do, not how; testable>

## Acceptance criteria
- AC1 (R1): <measurable check: an observable behaviour, a command and its expected result, or a metric>

## Constraints & decisions
- <ADR-NNNN that applies; a new hard-to-reverse decision → suggest an ADR>

## Open questions
- <question> (must be answered, or marked "deferred: <why>", before the spec is approved)

## Tickets
<!-- Filled by to-tickets only when GitHub issues aren't available. -->
- T1: <title> · Covers: R1, AC1 · Blocked by: none · Done when: <checks>
```

- [ ] **Step 5: Run the tests and check they pass**

Run: `node --test plugins/usiatech-engineering/tests/plugin-structure.test.mjs`
Expected: all pass.

- [ ] **Step 6: Commit**

```bash
git add plugins/usiatech-engineering/templates/plan.md plugins/usiatech-engineering/templates/spec.md plugins/usiatech-engineering/tests/plugin-structure.test.mjs
git commit -m "feat(templates): add acceptance criteria and tasks to plans, add spec template"
```

---

### Task 2: `clarify` skill

**Files:**
- Create: `plugins/usiatech-engineering/skills/clarify/SKILL.md`
- Modify: `plugins/usiatech-engineering/README.md` (components table)
- Test: `plugins/usiatech-engineering/tests/plugin-structure.test.mjs`

**Interfaces:**
- Consumes: nothing.
- Produces: the skill name `clarify` and its output, an "understanding note" with the fields Outcome, You said, I'm assuming, Done when, Not doing, Open. `to-spec` (Task 3) reads that note.

The existing test "should list every skill and agent in the README components table" fails as soon as the skill folder exists. That's why the README row lands in this task.

- [ ] **Step 1: Write the failing tests** (append to `plugin-structure.test.mjs`)

```js
describe('plugin structure: step-3 skills', () => {
  it('should ship skill "clarify" that asks one question at a time and writes nothing', () => {
    assert.ok(skills.includes('clarify'))
    const text = body(read('skills', 'clarify', 'SKILL.md'))
    assert.match(text, /one question at a time/i)
    assert.match(text, /understanding note/i)
    assert.match(text, /You said/)
    assert.match(text, /I'm assuming/)
    assert.match(text, /Write no files/)
  })
})
```

- [ ] **Step 2: Run it and check it fails**

Run: `node --test plugins/usiatech-engineering/tests/plugin-structure.test.mjs`
Expected: FAIL at `assert.ok(skills.includes('clarify'))`.

- [ ] **Step 3: Create `skills/clarify/SKILL.md`**

```markdown
---
name: clarify
description: Turns a vague request into clear requirements by asking one question at a time about purpose, users, constraints and what "done" looks like, then writing back an understanding note for the user to correct. Use when the user says "clarify", "grill me" or "help me think this through", when approve-plan routes work to the large route, or when a request has no requirement reference.
---

# Clarify requirements

Understanding comes before the spec. This skill works in the conversation only. Its output is an understanding note that `to-spec` turns into a spec.

## 1. Read first
1. Read what already exists: the request, `AGENTS.md`, the intent docs and ADRs it touches, and any issue it mentions (`gh issue view <n>` when available).
2. Don't ask what the repo already answers. Note those facts and where they came from.

## 2. Ask
1. Ask **one question at a time**. Prefer multiple choice with a recommended option. Open questions are fine when the answer is free-form.
2. Cover these in order, moving on once each is clear:
   - **Purpose:** what problem, for whom, and how we know it's a problem.
   - **Success:** what the user would check to call it done. These become acceptance criteria.
   - **Constraints:** deadlines, platforms, ADRs, non-negotiables, things that must not change.
   - **Scope edges:** what it won't do.
3. If the request is really several independent pieces, say so and ask which to clarify first. Each piece gets its own spec.
4. Stop when another answer wouldn't change the spec.

## 3. Understanding note
Write back, in under 200 words:
- **Outcome:** one or two sentences.
- **You said:** facts the user stated.
- **I'm assuming:** everything else, each item correctable.
- **Done when:** draft success checks, each observable.
- **Not doing:** the scope edges.
- **Open:** questions still unanswered.

Ask the user to correct it. Repeat until they confirm, then hand off to `to-spec`.

## Rules
- Write no files and change no code.
- Don't design the solution while clarifying. Record ideas the user raises as constraints or open questions.
```

- [ ] **Step 4: Add the README components row** (after the `debug` row in `plugins/usiatech-engineering/README.md`)

```markdown
| Skill | `clarify` | One question at a time until purpose, success, constraints and scope edges are clear; ends with an understanding note the user corrects. Writes no files |
```

- [ ] **Step 5: Run the tests and check they pass**

Run: `node --test plugins/usiatech-engineering/tests/plugin-structure.test.mjs`
Expected: all pass.

- [ ] **Step 6: Commit**

```bash
git add plugins/usiatech-engineering/skills/clarify/SKILL.md plugins/usiatech-engineering/README.md plugins/usiatech-engineering/tests/plugin-structure.test.mjs
git commit -m "feat(skills): add clarify skill"
```

---

### Task 3: `to-spec` skill

**Files:**
- Create: `plugins/usiatech-engineering/skills/to-spec/SKILL.md`
- Modify: `plugins/usiatech-engineering/README.md` (components table)
- Test: `plugins/usiatech-engineering/tests/plugin-structure.test.mjs`

**Interfaces:**
- Consumes: the `clarify` understanding note (Task 2); `templates/spec.md` and its headings (Task 1).
- Produces: a spec at `docs/specs/YYYY-MM-DD-<slug>.md` with `Status: approved`, requirements `R1…` and acceptance criteria `AC1…`. `to-tickets` (Task 4) and `approve-plan` (Task 5) read it.

- [ ] **Step 1: Write the failing test** (add inside `describe('plugin structure: step-3 skills', …)`)

```js
  it('should ship skill "to-spec" that writes a numbered spec from the template', () => {
    assert.ok(skills.includes('to-spec'))
    const text = body(read('skills', 'to-spec', 'SKILL.md'))
    assert.match(text, /docs\/specs\/YYYY-MM-DD-<slug>\.md/)
    assert.match(text, /templates\/spec\.md/)
    assert.match(text, /R1, R2/)
    assert.match(text, /AC1, AC2/)
    assert.match(text, /deferred: <why>/)
  })
```

- [ ] **Step 2: Run it and check it fails**

Run: `node --test plugins/usiatech-engineering/tests/plugin-structure.test.mjs`
Expected: FAIL at `assert.ok(skills.includes('to-spec'))`.

- [ ] **Step 3: Create `skills/to-spec/SKILL.md`**

```markdown
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
```

- [ ] **Step 4: Add the README components row** (after the `clarify` row)

```markdown
| Skill | `to-spec` | Writes the confirmed understanding to `docs/specs/YYYY-MM-DD-<slug>.md`: requirements R1…, measurable acceptance criteria AC1…, open questions answered or deferred before approval |
```

- [ ] **Step 5: Run the tests and check they pass**

Run: `node --test plugins/usiatech-engineering/tests/plugin-structure.test.mjs`
Expected: all pass.

- [ ] **Step 6: Commit**

```bash
git add plugins/usiatech-engineering/skills/to-spec/SKILL.md plugins/usiatech-engineering/README.md plugins/usiatech-engineering/tests/plugin-structure.test.mjs
git commit -m "feat(skills): add to-spec skill"
```

---

### Task 4: `to-tickets` skill

**Files:**
- Create: `plugins/usiatech-engineering/skills/to-tickets/SKILL.md`
- Modify: `plugins/usiatech-engineering/README.md` (components table)
- Test: `plugins/usiatech-engineering/tests/plugin-structure.test.mjs`

**Interfaces:**
- Consumes: an approved spec (Task 3) and its `## Tickets` heading (Task 1).
- Produces: GitHub issue numbers `#NN`, or spec ticket IDs `T1…`. `approve-plan` (Task 5) uses them as requirement references and task links.

- [ ] **Step 1: Write the failing tests** (add inside `describe('plugin structure: step-3 skills', …)`)

```js
  it('should ship skill "to-tickets" that files blocker-aware tickets with a no-GitHub fallback', () => {
    assert.ok(skills.includes('to-tickets'))
    const text = body(read('skills', 'to-tickets', 'SKILL.md'))
    assert.match(text, /gh auth status/)
    assert.match(text, /Blocked by #NN/)
    assert.match(text, /## Tickets/)
  })

  it('should confirm once before filing and never create labels', () => {
    const text = body(read('skills', 'to-tickets', 'SKILL.md'))
    assert.match(text, /ask the user once to confirm before filing/i)
    assert.match(text, /Never create labels/)
  })
```

- [ ] **Step 2: Run them and check they fail**

Run: `node --test plugins/usiatech-engineering/tests/plugin-structure.test.mjs`
Expected: FAIL at `assert.ok(skills.includes('to-tickets'))`, and `ENOENT` for the second test.

- [ ] **Step 3: Create `skills/to-tickets/SKILL.md`**

```markdown
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
```

- [ ] **Step 4: Add the README components row** (after the `to-spec` row)

```markdown
| Skill | `to-tickets` | Splits an approved spec into small tickets (covers R/AC, blocked by, done when); files GitHub issues after one confirmation, or writes a Tickets section into the spec without `gh` |
```

- [ ] **Step 5: Run the tests and check they pass**

Run: `node --test plugins/usiatech-engineering/tests/plugin-structure.test.mjs`
Expected: all pass.

- [ ] **Step 6: Commit**

```bash
git add plugins/usiatech-engineering/skills/to-tickets/SKILL.md plugins/usiatech-engineering/README.md plugins/usiatech-engineering/tests/plugin-structure.test.mjs
git commit -m "feat(skills): add to-tickets skill"
```

---

### Task 5: `approve-plan` routing, acceptance criteria and pre-flight

**Files:**
- Modify: `plugins/usiatech-engineering/skills/approve-plan/SKILL.md` (full rewrite below)
- Modify: `plugins/usiatech-engineering/README.md` (the `approve-plan` components row)
- Test: `plugins/usiatech-engineering/tests/plugin-structure.test.mjs`

**Interfaces:**
- Consumes: `clarify`, `to-spec`, `to-tickets` (Tasks 2–4); the plan template headings and the `Route:` line (Task 1); `governance-reviewer` pre-flight mode (Task 7 adds the spec checks; this task only invokes it).
- Produces: `.claude/plans/active.md` with `## Acceptance criteria`, `## Tasks` and `Route:`. `verify` (Task 6) and `governance-reviewer` (Task 7) read them.

- [ ] **Step 1: Write the failing test** (append to `plugin-structure.test.mjs`)

```js
describe('plugin structure: step-3 approve-plan', () => {
  it('should route work by size and record acceptance criteria, tasks and the route', () => {
    const text = body(read('skills', 'approve-plan', 'SKILL.md'))
    for (const s of ['clarify', 'to-spec', 'to-tickets', 'governance-reviewer']) assert.ok(text.includes(`\`${s}\``), s)
    assert.match(text, /5 files or fewer/)
    assert.match(text, /treat as small/)
    assert.match(text, /Route: small/)
    assert.match(text, /\*\*Acceptance criteria:\*\*/)
    assert.match(text, /\*\*Tasks:\*\*/)
    assert.match(text, /only the \*\*Files\*\* section/i)
  })
})
```

- [ ] **Step 2: Run it and check it fails**

Run: `node --test plugins/usiatech-engineering/tests/plugin-structure.test.mjs`
Expected: FAIL on the `clarify` assertion.

- [ ] **Step 3: Rewrite `skills/approve-plan/SKILL.md`**

```markdown
---
name: approve-plan
description: Records the plan the user has approved as .claude/plans/active.md, with measurable acceptance criteria and a task list, so governance can check scope and completion, and closes it when the work ships. Routes large work through clarify → to-spec → to-tickets first. Use when starting work that has no plan yet, right after the user approves a plan ("yes", "proceed", "approved"), when the user says "update the plan" or "change scope", or when work is finished ("close the plan").
---

# Approve, update or close a plan

The approved plan is the scope baseline. The governance guard asks for confirmation on any file edit outside the plan's **Files** list. The `governance-reviewer` agent checks the finished diff against it. Because the plan sets the scope, the guard also asks before every write to `.claude/plans/active.md`, so expect a confirmation prompt when you record or update it.

## Route (before drafting)
Pick the route and tell the user which rule decided it.
- **Small**, when all of these hold:
  - the work cites an existing requirement reference (intent §, capability ID, FR/AC, ADR, spec, `#issue`)
  - it touches 5 files or fewer
  - it adds no new skill, module, service or public interface
- **Large**, anything else. Run `clarify` → `to-spec` → `to-tickets` first. The spec path and ticket IDs become the requirement references, and the spec's acceptance criteria are copied into the plan with their IDs.
- The user can say "treat as small" or "treat as large". Record the override in the Change log.

## Record
1. If `.claude/plans/active.md` already exists and is unfinished, ask whether to close it or replace it.
2. Draft the plan from `${CLAUDE_PLUGIN_ROOT}/templates/plan.md`:
   - **Goal:** one or two sentences.
   - **Requirement references:** the intent sections, capability IDs, FR/AC numbers, ADRs, D-items, spec path and issues this work implements. Every plan needs at least one. If there isn't one, tell the user the work has no requirement basis and offer the large route.
   - **Acceptance criteria:** AC1, AC2…, at least one. Each is measurable: an observable behaviour, a command and its expected result, or a metric. Rewrite vague ones ("works well", "is fast") with the user. Leave each `Evidence:` line empty; `verify` fills it.
   - **Tasks:** a checklist. Each task names the AC it covers and its ticket (`#NN` or spec `T1`). Paths mentioned in tasks don't widen scope: only the **Files** section does.
   - **Files:** every path or glob to create or change (backticked, one per bullet). Keep globs as narrow as practical.
   - **Commands and actions:** any risky action the plan needs (migrations, dependency adds, deploys). Only include those the user agreed to.
   - **Out of scope:** what this plan explicitly doesn't do.
   - **Approved:** the user's name and today's date, and `Route: small` or `Route: large` with the rule that decided it.
3. Run the `governance-reviewer` agent on the draft in pre-flight mode. On the large route it also checks the plan against the spec and tickets. Fix a `BLOCK` before going on; a `FLAG` needs the user's decision.
4. Show the draft and the pre-flight verdict. After the user confirms, write `.claude/plans/active.md` and show it in one short message.

## Update (scope change)
When new work falls outside the plan:
1. Stop and explain what's needed and why.
2. After the user approves, add the new files, actions, acceptance criteria or tasks, with a dated Change log line.
3. Never widen the plan silently or with broad globs such as `**`.

## Close (work shipped or abandoned)
1. Move the file to `.claude/plans/archive/YYYY-MM-DD-<short-slug>.md`.
2. Add the final status (shipped, partial or abandoned), the commit/PR reference, each acceptance criterion with its final evidence status, and any deviations.
3. Archived plans are committed for traceability. `active.md` itself is never committed.
```

- [ ] **Step 4: Update the README `approve-plan` row**

Replace the row with:

```markdown
| Skill | `approve-plan` | Routes work small (plan directly) or large (`clarify` → `to-spec` → `to-tickets` first); records the approved plan with acceptance criteria and tasks as the scope baseline (`.claude/plans/active.md`) after a governance pre-flight; updates it on approved scope changes; archives it when done |
```

- [ ] **Step 5: Run the tests and check they pass**

Run: `node --test plugins/usiatech-engineering/tests/plugin-structure.test.mjs`
Expected: all pass.

- [ ] **Step 6: Commit**

```bash
git add plugins/usiatech-engineering/skills/approve-plan/SKILL.md plugins/usiatech-engineering/README.md plugins/usiatech-engineering/tests/plugin-structure.test.mjs
git commit -m "feat(approve-plan): route by size, record acceptance criteria and tasks"
```

---

### Task 6: `verify` acceptance-criteria table

**Files:**
- Modify: `plugins/usiatech-engineering/skills/verify/SKILL.md` (description and steps 6–7)
- Modify: `plugins/usiatech-engineering/README.md` (the `verify` components row)
- Test: `plugins/usiatech-engineering/tests/plugin-structure.test.mjs`

**Interfaces:**
- Consumes: the plan's `## Acceptance criteria` and `Evidence:` lines (Tasks 1 and 5).
- Produces: AC status values `shown` / `not shown`. `governance-reviewer` check 7 (Task 7) reads them.

- [ ] **Step 1: Write the failing test** (append to `plugin-structure.test.mjs`)

```js
describe('plugin structure: step-3 verify and reviewer', () => {
  it('should make verify report acceptance criteria without changing the gate verdict', () => {
    const text = body(read('skills', 'verify', 'SKILL.md'))
    assert.match(text, /\| AC \| Criterion \| Evidence \| Status \|/)
    assert.match(text, /only if `\.claude\/plans\/active\.md` has an `## Acceptance criteria` section/)
    assert.match(text, /Gate: PASS \(N of M criteria not shown\)/)
    assert.match(text, /decided by the commands only/)
  })
})
```

- [ ] **Step 2: Run it and check it fails**

Run: `node --test plugins/usiatech-engineering/tests/plugin-structure.test.mjs`
Expected: FAIL on the table regex.

- [ ] **Step 3: Edit `skills/verify/SKILL.md`**

Replace the frontmatter description with:

```yaml
description: Runs the repository's verification gate (typecheck, tests, build and any conditional suites), checks the active plan's acceptance criteria against evidence from this session, and reports pass/fail with evidence. Use when the user says "verify", "run the gate", "is it done", "check before commit", or before reporting any code task as complete.
```

Replace step 6 (`6. **Report:**` through the end of the file) with:

```markdown
6. **Check acceptance criteria**, only if `.claude/plans/active.md` has an `## Acceptance criteria` section, and only after the commands pass:
   - For each AC, find evidence produced in this session: a named passing test, command output, or a result you observed. Earlier sessions, memory and "should work" don't count.
   - Mark it `shown` with that evidence, or `not shown`.
   - Write each evidence line under its AC in the plan (`- Evidence: <evidence> (shown)` or `(not shown)`). The guard asks before edits to the plan; that's expected.
7. **Report:**

| Check | Command | Result | Notes |
|---|---|---|---|

   If step 6 ran, add:

| AC | Criterion | Evidence | Status |
|---|---|---|---|

   End with **Gate: PASS** or **Gate: FAIL**, decided by the commands only. If any criterion is `not shown`, end with `Gate: PASS (N of M criteria not shown)` and list them. Never state that work is done unless the gate passed in this session.
```

- [ ] **Step 4: Update the README `verify` row**

```markdown
| Skill | `verify` | Runs the repo's definition-of-done gate (from `.claude/engineering.json` or AGENTS.md) and reports PASS/FAIL; checks the active plan's acceptance criteria against evidence from this session (unshown criteria warn, they don't fail the gate) |
```

- [ ] **Step 5: Run the tests and check they pass**

Run: `node --test plugins/usiatech-engineering/tests/plugin-structure.test.mjs`
Expected: all pass.

- [ ] **Step 6: Commit**

```bash
git add plugins/usiatech-engineering/skills/verify/SKILL.md plugins/usiatech-engineering/README.md plugins/usiatech-engineering/tests/plugin-structure.test.mjs
git commit -m "feat(verify): report acceptance criteria with evidence"
```

---

### Task 7: `governance-reviewer` acceptance-criteria and spec-consistency checks

**Files:**
- Modify: `plugins/usiatech-engineering/agents/governance-reviewer.md` (Baseline 1, Evidence, Checks 7–8)
- Test: `plugins/usiatech-engineering/tests/plugin-structure.test.mjs`

**Interfaces:**
- Consumes: plan ACs and evidence status (Tasks 1, 5, 6); spec R/AC IDs and tickets (Tasks 3, 4).
- Produces: findings in the existing output table. The format doesn't change.

- [ ] **Step 1: Write the failing test** (add inside `describe('plugin structure: step-3 verify and reviewer', …)`)

```js
  it('should make governance-reviewer check acceptance criteria and spec consistency', () => {
    const text = body(read('agents', 'governance-reviewer.md'))
    assert.match(text, /7\. \*\*Acceptance criteria\*\* \(change review, only when the plan has an `## Acceptance criteria` section\)/)
    assert.match(text, /`not shown`/)
    assert.match(text, /Plans without the section get no acceptance-criteria findings/)
    assert.match(text, /8\. \*\*Spec consistency\*\* \(pre-flight, only when the plan references a spec\)/)
    assert.match(text, /non-goal/)
  })
```

- [ ] **Step 2: Run it and check it fails**

Run: `node --test plugins/usiatech-engineering/tests/plugin-structure.test.mjs`
Expected: FAIL on the check-7 regex.

- [ ] **Step 3: Edit `agents/governance-reviewer.md`**

Baseline item 1: replace

```markdown
1. **Approved plan:** `.claude/plans/active.md`. Note the goal, requirement references, Files, Commands and actions, Out of scope and Change log.
```

with

```markdown
1. **Approved plan:** `.claude/plans/active.md`. Note the goal, requirement references, acceptance criteria, tasks, Files, Commands and actions, Out of scope, Route and Change log.
```

Evidence: replace

```markdown
- **Plan review (pre-flight):** read the proposed plan text you were given.
```

with

```markdown
- **Plan review (pre-flight):** read the proposed plan text you were given. If it references a spec (`docs/specs/*.md`), read the spec and the tickets it names (`gh issue view <n>` when `gh` works, otherwise the spec's Tickets section).
```

Checks: after check 6, add

```markdown
7. **Acceptance criteria** (change review, only when the plan has an `## Acceptance criteria` section): flag every AC whose `Evidence:` line is empty or marked `not shown`, and every unchecked task whose files appear in the diff. Plans without the section get no acceptance-criteria findings.
8. **Spec consistency** (pre-flight, only when the plan references a spec):
   - every spec requirement (R…) is covered by a ticket or a plan task
   - every plan task traces to a spec R or AC
   - every plan File is needed by at least one task
   - no spec non-goal appears in the plan's Goal, Tasks or Files
   - nothing conflicts with an Accepted ADR
```

- [ ] **Step 4: Run the tests and check they pass**

Run: `node --test plugins/usiatech-engineering/tests/plugin-structure.test.mjs`
Expected: all pass, including the existing reviewer confidence and read-only tests.

- [ ] **Step 5: Commit**

```bash
git add plugins/usiatech-engineering/agents/governance-reviewer.md plugins/usiatech-engineering/tests/plugin-structure.test.mjs
git commit -m "feat(governance-reviewer): check acceptance criteria and spec consistency"
```

---

### Task 8: Guard regression tests (scope unchanged)

**Files:**
- Test: `plugins/usiatech-engineering/tests/governance-policy.test.mjs` (inside `describe('evaluate: approved plan scope', …)`)

**Interfaces:**
- Consumes: the existing `edit()`, `planRoot`-style setup, `writeFiles` and `tempDir` in that file; `planFiles()` in `governance-policy.mjs` (unchanged).
- Produces: nothing new.

These are characterization tests. They pin behaviour the new plan format relies on, so they pass straight away. If either fails, stop: the guard has a real bug to handle with the `debug` skill, not by editing the test.

- [ ] **Step 1: Add the tests**

```js
  it('should treat spec files like any other file: allowed with no plan, asked with requirePlan', () => {
    assert.equal(edit('docs/specs/2026-01-01-x.md'), null)
    assert.match(edit('docs/specs/2026-01-01-x.md', { cfg: { governance: { requirePlan: true } } }).reason, /No approved plan/)
  })

  it('should not take scope from the Tasks or Acceptance criteria sections', () => {
    const root = tempDir()
    writeFiles(root, { '.claude/plans/active.md': '# Plan\n\n## Acceptance criteria\n- AC1: `lib/a.ts` works\n  - Evidence: \n\n## Tasks\n- [ ] T1: edit `lib/b.ts` (covers AC1)\n\n## Files\n- `src/**`\n' })
    assert.equal(edit('src/x.ts', { root }), null)
    assert.match(edit('lib/b.ts', { root }).reason, /not in the approved plan/)
    assert.match(edit('lib/a.ts', { root }).reason, /not in the approved plan/)
  })
```

- [ ] **Step 2: Run them and check they pass**

Run: `node --test plugins/usiatech-engineering/tests/governance-policy.test.mjs`
Expected: all pass.

- [ ] **Step 3: Commit**

```bash
git add plugins/usiatech-engineering/tests/governance-policy.test.mjs
git commit -m "test(guard): pin that specs and plan tasks don't change edit scope"
```

---

### Task 9: Docs, version 0.7.0 and roadmap

**Files:**
- Modify: `plugins/usiatech-engineering/README.md` (version table)
- Modify: `README.md` (plugin table)
- Modify: `.claude-plugin/marketplace.json`, `plugins/usiatech-engineering/.claude-plugin/plugin.json`
- Modify: `docs/roadmap.md` (after rebasing on `main`)
- Test: `plugins/usiatech-engineering/tests/plugin-structure.test.mjs`

**Interfaces:**
- Consumes: all earlier tasks.
- Produces: release metadata.

- [ ] **Step 1: Write the failing test** (append to `plugin-structure.test.mjs`)

```js
describe('plugin structure: release metadata', () => {
  it('should keep plugin, marketplace and both README versions in step', () => {
    const version = JSON.parse(read('.claude-plugin', 'plugin.json')).version
    const repo = path.join(PLUGIN_ROOT, '..', '..')
    const market = JSON.parse(readFileSync(path.join(repo, '.claude-plugin', 'marketplace.json'), 'utf8'))
    assert.equal(market.plugins.find((p) => p.name === 'usiatech-engineering').version, version)
    const v = version.replace(/\./g, '\\.')
    assert.match(read('README.md'), new RegExp(`^\\| ${v} \\|`, 'm'), 'plugin README version row')
    assert.match(readFileSync(path.join(repo, 'README.md'), 'utf8'), new RegExp(`\\| UsiaTech Engineering \\| ${v}\\s*\\|`), 'root README table')
    assert.equal(version, '0.7.0')
  })
})
```

The last assertion makes the test fail until the bump. At the next release, replace it rather than bumping the literal (the consistency checks above it are the lasting part).

- [ ] **Step 2: Run it and check it fails**

Run: `node --test plugins/usiatech-engineering/tests/plugin-structure.test.mjs`
Expected: FAIL: `'0.6.0' !== '0.7.0'`.

- [ ] **Step 3: Bump versions**

- `plugins/usiatech-engineering/.claude-plugin/plugin.json`: `"version": "0.7.0"`
- `.claude-plugin/marketplace.json`: the `usiatech-engineering` entry `"version": "0.7.0"`
- `README.md`: `| UsiaTech Engineering | 0.7.0   | \`usiatech-engineering@usiatech\` |`

- [ ] **Step 4: Add the plugin README version row** (above the 0.6.0 row)

```markdown
| 0.7.0 | New `clarify`, `to-spec` and `to-tickets` skills; `approve-plan` routes work small (plan directly) or large (clarify → spec → tickets first), records measurable acceptance criteria, a task list and the route, and runs a governance pre-flight before approval; new `templates/spec.md`; `verify` reports each acceptance criterion as shown or not shown with evidence from the session (a warning, not a failure); `governance-reviewer` flags criteria without evidence and, in pre-flight, checks the plan against the spec and tickets. **Upgrading repos:** nothing required. Existing plans without acceptance criteria keep working. No CI changes; repos don't need to re-copy scripts. Specs go to `docs/specs/`, created on first use. |
```

- [ ] **Step 5: Run the full gate**

Run: `npm test && claude plugin validate . && claude plugin validate plugins/usiatech-engineering`
Expected: 0 failed; both validations pass.

- [ ] **Step 6: Commit**

```bash
git add plugins/usiatech-engineering/README.md README.md .claude-plugin/marketplace.json plugins/usiatech-engineering/.claude-plugin/plugin.json plugins/usiatech-engineering/tests/plugin-structure.test.mjs
git commit -m "docs: document step-3 requirements flow (v0.7.0)"
```

- [ ] **Step 7: Update the roadmap**

`docs/roadmap.md` arrives with PR #5. Check `gh pr view 5 --json state -q .state`.
- If `MERGED`: `git fetch -q origin && git rebase origin/main` (this branch isn't pushed yet, so the rebase rewrites nothing published). Then in `docs/roadmap.md`, set the step 3 row's status to `Shipped v0.7.0`, and set A10, B1, B2 and B3 to `Done (step 3)`. Run `npm test`, then commit with `git add docs/roadmap.md && git commit -m "docs(roadmap): mark step 3 done"`.
- Otherwise: stop and ask the user whether to merge PR #5 first or leave the roadmap update to a follow-up.

---

## Spec coverage

| Spec | Task |
|---|---|
| R1 routing, R2 small, R3 large | 5 |
| R4 clarify | 2 |
| R5 to-spec | 1 (template), 3 |
| R6 to-tickets | 4 |
| R7 plan template | 1, 5 |
| R8 backward compatibility | 6, 7 |
| R9 verify table | 6 |
| R10 pre-flight consistency | 7 (check), 5 (invocation) |
| R11 change-review AC check | 7 |
| AC1 | 2, 3, 4 |
| AC2 | 1 |
| AC3 | 5 |
| AC4 | 6 |
| AC5 | 7 |
| AC6 | 8 |
| AC7 | 9 |
