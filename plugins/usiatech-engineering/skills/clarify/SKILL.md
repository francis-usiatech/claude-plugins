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
