---
name: user-guide-update
description: Updates the end-user guide and its changelog after any subscriber- or user-visible change (screens, workflows, menu paths, plans, providers). Use when the user says "update the help docs", "update the user guide", or after a UI or workflow change.
---

# User guide update

Paths come from `.claude/engineering.json` → `userGuide`: `dir`, `changelog`, and an optional `manifest` (the file that registers pages). If no guide exists yet, tell the user and stop.

1. Identify the visible change: screen names, menu paths, labels, workflow steps, states, plan names, error messages.
2. Search `userGuide.dir` for every one of those terms. List each page that references the changed surface.
3. Draft the edits in plain, task-oriented language (what the user does and what they see). Use bulleted steps, with a blank line before every list. Don't copy numeric plan limits unless the guide renders them from code.
4. For a new page, create it in `userGuide.dir` and register it in `userGuide.manifest` (if set).
5. Add a dated entry to `userGuide.changelog` for anything users will notice, in one or two plain sentences.
6. Show the proposed edits and apply them after approval (repo golden rule). Then run the `verify` skill if the guide is built into the app.
