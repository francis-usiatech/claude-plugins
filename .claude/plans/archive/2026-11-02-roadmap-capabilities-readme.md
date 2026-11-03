# Plan: Roadmap, capabilities docs and public README

## Goal
Bring the roadmap up to date with every Jira epic (including ESP-8, ESP-80, ESP-117 and the new gstack-adoption epics ESP-126–129), add a capabilities document, add HTML versions of both with inline SVG diagrams, and rewrite the top-level README for the public repository with an MIT license.

## Requirement references
- ESP-91 (record the orchestration step in the roadmap; epic ESP-80)
- ESP-126, ESP-127, ESP-128, ESP-129 (new epics to document)
- ESP-8, ESP-117 (epics missing from the roadmap)
- User request 2026-11-02 (Francis): document all epics in the capabilities and roadmap docs, HTML versions with diagrams, a standard public README, MIT license, drop the "private" wording.

## Pre-plan checklist
- (a) n/a: no new validation rule or format check. The existing check that constrains this work, `plugins/usiatech-engineering/tests/plugin-structure.test.mjs:743-752`, requires the root README.md to keep a `| UsiaTech Engineering | <version> |` table row and the marketplace.json plugin version to match plugin.json. Both are kept.
- (b) n/a: no database or infrastructure mechanism. Static Markdown and standalone HTML with inline SVG, no scripts or external assets.
- (c) Docs touched (search of docs/ and the README files): docs/roadmap.md (edit), README.md (rewrite), docs/capabilities.md (new), docs/roadmap.html (new), docs/capabilities.html (new). Read but not changed: plugins/usiatech-engineering/README.md (source for capabilities and version history), docs/specs/*, docs/adr/0001–0003 (linked, unchanged). No ADR needed: no design decision changes. No docs reviewer is configured (`planning.preflightReviewers` absent), so none was treated as the docs reviewer.

## Acceptance criteria
- AC1: docs/roadmap.md has a row for every ESP epic (ESP-2, ESP-8, ESP-80, ESP-117, ESP-126, ESP-127, ESP-128, ESP-129) with its status, the steps table covers releases through 0.19.3, and an unassigned-backlog section lists the open ESP tasks with no parent epic. Check: grep each key in docs/roadmap.md.
  - Evidence: grep found ESP-2, ESP-8, ESP-80, ESP-117, ESP-126, ESP-127, ESP-128, ESP-129, 0.19.3 and "Unassigned backlog" in docs/roadmap.md (re-checked in verify run) (shown, 2026-11-02T18:53Z)
- AC2: docs/capabilities.md lists every skill under plugins/usiatech-engineering/skills/ and every agent under plugins/usiatech-engineering/agents/, plus the planned capabilities per open epic with Jira keys. Check: every skill directory name and agent file stem appears in the file.
  - Evidence: every skill dir name and agent file stem under plugins/usiatech-engineering/ appears backticked in docs/capabilities.md; check script printed no MISSING lines (passed-in evidence) (shown, 2026-11-02T18:53Z)
- AC3: docs/roadmap.html and docs/capabilities.html exist, are standalone (no `<script>`, no external URLs except links), contain at least 3 inline `<svg>` diagrams each, and load in Chrome (claude-in-chrome) with no console errors (screenshot as evidence).
  - Evidence: roadmap.html svg=4 script=0, capabilities.html svg=6 (5 diagrams + 1 marker defs) script=0 (re-checked in verify run); external=0; both loaded in Chrome at http://127.0.0.1:8799/docs/*.html with no page console errors (only chrome-extension:// errors); screenshots C:\Users\mfsar\AppData\Local\Temp\claude-chrome-screenshots-hpl7xd\screenshot-1793645435370-3.jpg, screenshot-1793644885546-1.jpg, screenshot-1793645028968-2.jpg (shown, 2026-11-02T18:53Z)
- AC4: README.md has the sections Overview, Features, Requirements, Installation, Quick start, Configuration, Documentation, Roadmap, Contributing (including the release steps from the old README), Security and License; it no longer says "private"; it keeps the `| UsiaTech Engineering | 0.19.3 |` row.
  - Evidence: README.md has all 11 sections (no MISSING), keeps the "| UsiaTech Engineering | 0.19.3 |" row; grep -ci private README.md = 0 (re-checked in verify run) (shown, 2026-11-02T18:53Z)
- AC5: LICENSE contains the MIT text with "Copyright (c) 2026 Francis Amalraj"; .claude-plugin/marketplace.json metadata.description no longer contains "private" and is still valid JSON.
  - Evidence: LICENSE contains "Copyright (c) 2026 Francis Amalraj"; marketplace.json parses with node, metadata.description = "UsiaTech Claude Code plugin marketplace" (re-checked in verify run) (shown, 2026-11-02T18:53Z)
- AC6: The verify gate passes: `npm test`, `claude plugin validate .` and `claude plugin validate plugins/usiatech-engineering` all exit 0.
  - Evidence: gate run 2026-11-02T18:53:06Z: tests exit 0, validate marketplace exit 0, validate plugin exit 0, fake-pass check exit 0, Gate: PASS (shown, 2026-11-02T18:53Z)

## Tasks
- [x] T1: Update docs/roadmap.md (covers AC1; user request 2026-11-02)
- [x] T2: Write docs/capabilities.md (covers AC2; user request 2026-11-02)
- [x] T3: Write docs/roadmap.html and docs/capabilities.html with inline SVG, check them in Chrome (covers AC3; user request 2026-11-02)
- [x] T4: Rewrite README.md, add LICENSE, fix the marketplace.json wording (covers AC4, AC5; user request 2026-11-02)
- [x] T5: Run verify (covers AC6)

## Files
- `docs/roadmap.md`
- `docs/capabilities.md`
- `docs/roadmap.html`
- `docs/capabilities.html`
- `README.md`
- `LICENSE`
- `.claude-plugin/marketplace.json`

## Commands and actions
- None beyond the verify gate and the release skill (commit, PR to develop), which the user asked for.

## Out of scope
- Plugin code, skills, agents, hooks and tests; a plugin version bump; plugins/usiatech-engineering/README.md; a `license` field in plugin.json; `"private": true` in package.json (the npm publish flag, not wording).
- Jira status changes: no ticket moves (user decision 2026-11-02).
- Implementing any epic.

## Approved
- By: Francis · Date: 2026-11-02
- Route: small (override: "treat as small", docs-only, no new skill, module or interface; the rule alone gave large because 7 files > 5)

## Change log
- 2026-11-02: plan drafted; pre-flight governance-reviewer FLAG (route, approval line), no BLOCK.
- 2026-11-02: Francis chose: treat as small; no Jira moves; AC3 checked in Chrome.
- 2026-11-02: /code-review high: 10 findings, all fixed inside the Files list (badge removed, base-branch config claim corrected, PowerShell coverage, reviewer wording, Security contact text, HTML links described as local-only, 4.1 timeline row, 4.8 mostly shipped, B15/B16 kept in step 5).
- 2026-11-02: release stage 1 FLAG acknowledged by Francis: the guard logged 2 errors and skipped its after-Bash workflow check while `python -m http.server 8799 --bind 127.0.0.1` ran in the background for the AC3 Chrome check (18:40–18:50Z); no `.github/` file changed and the server is stopped. Jira links to usiatech.atlassian.net kept in the public docs (Francis).
- 2026-11-02: stage 2: convention PASS, security PASS WITH NITS. silent-failure-reviewer spawn first denied by the auto-mode classifier; Francis allowed a retry. Francis chose to reword the public roadmap rows ESP-19, ESP-20 and ESP-82 generically (guard gap detail stays in Jira) and soften the README CI claim; fix gets a governance-only re-review.
- 2026-11-02: silent-failure PASS WITH NITS ("Docs-only" → "Markdown-only" applied); governance-only re-review of the fix PASS. plugin-structure tests 135/135 pass on the final files.

## Final status
- Status: shipped
- Branch: `docs/roadmap-capabilities` (PR into `develop`; commit and PR numbers added later only if needed)
- AC1–AC6: shown (evidence above; AC4 and AC1 wording edits after the gate were re-checked by the governance-only re-review and the plugin-structure tests)
- Deviations: none in scope. The AC3 Chrome check needed a temporary localhost server (`python -m http.server 8799`), recorded in the change log. Nits listed in the PR: enable GitHub private vulnerability reporting or add `SECURITY.md`; consider a `license` field in plugin.json; check `docs/audits/*` content now that the repo is public; README omits the instruction-file exceptions in the Markdown-only review rule.
- [x] Commit (release-steps phase commit)
- [x] PR into develop
