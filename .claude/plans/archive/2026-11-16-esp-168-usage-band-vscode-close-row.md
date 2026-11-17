# Plan: Usage band close button stays on the first row in VS Code

## Goal
Keep the usage band's `×` close button on the band's first row, at its top-right, in VS Code (and the desktop app), stepping the text down to caption size when the row is tight. Explain (no code change) why a new window and a cleared session show `–` and `$0.00`.

## Requirement references
- ESP-168 (Subtask under ESP-27): "Usage band: close button wraps to a second row in VS Code".
- User report (screenshots, 2026-11-16): close button drops to its own row in a normal-width VS Code panel; empty values in a new window; `ctx –` and `$0.00` after `/clear`.

## Pre-plan checklist
- (a) New validation rules and format checks: n/a: the change adds no validation rule or format check; it changes layout props and the width estimate only.
- (b) Database or infrastructure mechanisms the design relies on: the VS Code webview's Box style mapping, read from the installed extension 2.1.325 (`webview/index.js`, function `kAt`): a row Box with no `flexWrap` gets CSS `flex-wrap: wrap`, an explicit `"nowrap"` is honoured; `bodyColumns` for `AbovePrompt` is `viewport.columns` there. No spike beyond that read is needed: the fix sets a documented Box prop.
- (c) Docs and ADRs touched: `plugins/usiatech-usage-band/README.md` (section "Where it works" / "Limits": add that the close button stays on the first row and that `–` means no reading yet, also after `/clear`). No ADR covers the usage band (search of `docs/` for "usage band": none).

## Acceptance criteria
- AC1: On the `vscode` and `desktop` surfaces the band's outer row Box has `flexWrap: 'nowrap'`, so the close button cannot wrap below the segments. Test in `hooks/band.test.tsx` checks it.
  - Evidence: band.test.tsx "the close button stays on the first row: the outer row never wraps on desktop and VS Code" passed in `claude plugin test plugins/usiatech-usage-band` (7 pass, 0 fail) this run; diff: register.tsx outer row `flexWrap="nowrap"`; Gate tree: 37f583fc464f6a57f610886971fd48280f86aca2 (shown, 2026-11-17T03:55Z)
- AC2: The text size follows `e.props.bodyColumns` (falling back to `e.viewport.columns`) and counts the close button's cells: footnote at a wide body (200 columns), caption at a narrow one (80 columns) and at a width where only the close button's cells tip it over. Tests in `hooks/band.test.tsx`.
  - Evidence: band.test.tsx "the text size follows bodyColumns and leaves room for the close button" passed in this run's plugin test (7 pass, 0 fail); register.tsx `fitFor(e.props.bodyColumns || e.viewport?.columns, ...)`; Gate tree: 37f583fc464f6a57f610886971fd48280f86aca2 (shown, 2026-11-17T03:55Z)
- AC3: `claude plugin test plugins/usiatech-usage-band` passes and `claude plugin validate plugins/usiatech-usage-band` and `claude plugin validate .` report no errors.
  - Evidence: this run: `claude plugin test plugins/usiatech-usage-band` 7 pass 0 fail (exit 0); `claude plugin validate plugins/usiatech-usage-band` passed with warnings (ICON_MISSING only, exit 0); gate step "validate marketplace" (`claude plugin validate .`) PASS exit 0; Gate tree: 37f583fc464f6a57f610886971fd48280f86aca2 (shown, 2026-11-17T03:55Z)
- AC4: A reproduction of the VS Code webview's flex mapping (HTML in the browser pane, stated as a reproduction) shows the close button on the first row at a narrow (~420 px) and a normal (~680 px) panel width, before/after.
  - Evidence: caller evidence: browser reproduction of the VS Code webview flex mapping (scratchpad band-width-check.html): 420px before = close button on its own row, after = first row top right; 680px before and after = first row; Gate tree: 37f583fc464f6a57f610886971fd48280f86aca2 (shown, 2026-11-17T03:55Z)
- AC5: The usage-band plugin version is 0.3.2 in its `plugin.json` and in its `.claude-plugin/marketplace.json` entry.
  - Evidence: plugins/usiatech-usage-band/.claude-plugin/plugin.json "version": "0.3.2" and the usiatech-usage-band entry of .claude-plugin/marketplace.json "version": "0.3.2" (read this run); Gate tree: 37f583fc464f6a57f610886971fd48280f86aca2 (shown, 2026-11-17T03:55Z)

## Tasks
- [x] T1: Set `flexWrap="nowrap"` on the outer desktop/VS Code row in `register.tsx` (covers AC1; ESP-168)
- [x] T2: `fitFor` reads `bodyColumns` (fallback `viewport.columns`) and adds the close button's cells (covers AC2; ESP-168)
- [x] T3: Tests for AC1 and AC2 in `band.test.tsx` (covers AC1, AC2; ESP-168)
- [x] T4: README note on the first-row close button and on `–` before the first reading and after `/clear` (covers AC1; ESP-168) (docs-only)
- [x] T5: Bump the usage band to 0.3.2 (covers AC5; ESP-168)
- [x] T6: Width check in the browser pane and plugin test/validate (covers AC3, AC4; ESP-168)

## Files
- `plugins/usiatech-usage-band/hooks/register.tsx`
- `plugins/usiatech-usage-band/hooks/band.test.tsx`
- `plugins/usiatech-usage-band/.claude-plugin/plugin.json`
- `plugins/usiatech-usage-band/README.md`
- `.claude-plugin/marketplace.json`

## Commands and actions
- Create one Jira Subtask in ESP under ESP-27 for this work and move it per the repo's Jira flow.

## Out of scope
- Showing the last known 5h/weekly figures in a new window (would need a cross-session store; the engine has no reading until the first response).
- Changing what the band shows after `/clear` (accurate: rate limits are account-wide and keep their last reading; `/clear` starts cost and context over).
- The terminal band layout.
- Bumping the marketplace's own release version (done by the release PR).

## Approved
- By: Francis · Date: 2026-11-16
- Route: small (cites ESP-168; 3 production-code files: `register.tsx`, `plugin.json`, `marketplace.json` (tests and README do not count), 3 ≤ 5; no new skill, module or public interface)
- Pre-flight: sonnet, full (governance-reviewer PASS)

## Change log
- 2026-11-16: drafted.
- 2026-11-16: Route line reworded to state the production-code count (pre-flight nit, settled by SD-1).
- 2026-11-16: approved by Francis (accept all, review page D1.1–D3.2); ESP-168 created.
- 2026-11-17: release review accepted by Francis (accept all): D1.1 governance FLAG acknowledged (guard logged an error on the background `python -m http.server 8765` used for the AC4 reproduction, so its after-Bash check did not run from 03:33:58Z until the server stopped; server stopped, only the 5 planned files changed); D1.2 root README band row and changelog left to the next chore(release) PR; D1.3 delta-chip string nit listed in the PR.

## Final status
- Status: shipped
- Branch: fix/usage-band-vscode-close-row (PR into develop)
- AC1–AC5: shown (gate tree 37f583fc464f6a57f610886971fd48280f86aca2, 2026-11-17T03:55Z); AC4 is a browser reproduction of the VS Code webview flex mapping, not VS Code itself.
- Deviations: review fixes after /code-review (width estimate counts the delta chip's padding; threshold test 65/64) landed before the gate run.
