# Review page (ESP-154)

One HTML page that collects every open approval and decision of a step, so the user accepts them in as few rounds as possible and sees each file once. The skills `clarify`, `approve-plan`, `to-tickets` (the spec and its tickets together) and `release` use it.

## When to use it

- The step has two or more open decisions, or any decision shows file content (an ADR, spec, plan, design note or a file diff).
- A single yes/no with no file content stays a plain question in chat.
- When `.claude/engineering.json` sets `decisions.batch` to `false`, don't build a page: ask about each item on its own.

## What goes on the page

1. **Title and one line** saying how to answer: "accept all", or "accept all except D2.1: …".
2. **Evidence** (optional): the facts the decisions rest on, such as log counts or test results, in a short table.
3. **Groups by theme**, `G1`, `G2`, …, each with its decisions `D1.1`, `D1.2`, …. The ids stay the same for the whole review, so the user can name them in the reply.
4. **Each decision** has:
   - what is decided, in one or two sentences;
   - the **recommended** default, marked as such, with its reason;
   - at most one or two alternatives, each with its trade-off;
   - the files it changes.
5. **Each file once.** Show a changed file's diff or new text under the first decision that needs it. Later decisions refer to it by name. An ADR, spec or plan under review is shown whole, once.
6. **Reply line** at the bottom, repeating how to answer.

Group related questions together, even when they come from different reviewers or skills of the same step. Put the plan approval, pre-flight `FLAG`s and scope questions on one page; don't ask them in separate rounds.

## How to deliver it

1. Copy `${CLAUDE_PLUGIN_ROOT}/templates/review-page.html` and fill it in. Keep its colour tokens and dark-mode block. Escape `&`, `<`, `>`, `"` and `'` in every piece of file content, diff text or reviewer output you put on the page, in text and in attributes. The page is static: add no `<script>`, no `on…` event attributes, no `javascript:` links and no remote URLs (images, fonts, stylesheets).
2. Write the page to the session scratchpad, named `<ticket-or-topic>-review.html`. With no scratchpad (a plain CLI session), use `$TMP/claude/{project}/review/`, which the guard already trusts. Never write it into the repo.
3. Send it to the user so it opens rendered (in the desktop app, `SendUserFile` with `display: "render"`; otherwise give its full path).
4. Ask once with `AskUserQuestion`: "Accept all (Recommended)" / "Accept with changes" (the user names the exceptions by id).
5. Don't publish the page anywhere unless the user asks.

## After the answer

- **Accept all:** apply every recommended default and record the approval where the skill says (for example the plan's Approved section and Change log).
- **Accept with changes:** apply the named changes. Re-show only the items a correction changed, as a smaller page or, for one or two items, in chat. Never re-show the whole page.
- Aim for one round. A second round is only for items a correction changed.
