# AGENTS.md

Repo rules for the usiatech-claude-plugins marketplace. `convention-reviewer` checks every change against this file. The plugin's own procedures live in `plugins/usiatech-engineering/` (README and skills).

## Rules from the 2026-10-17 audit
These come from `docs/audits/2026-10-17-ponytail-audit.md`. Each one caused a real bug.

- **Git paths are read raw.** Call `git diff`, `git ls-files` and `git diff --name-only` with `-z` and `-c core.quotePath=false`, and split on `\0`. Without them, git quotes non-ASCII names and path checks miss them (F6).
- **Config values come from `engineering.json`.** Read settings such as `governance.approvalLabel` from the base-branch `.claude/engineering.json`, with the documented default. Don't hard-code them in a script, a workflow `env` or a message (F11).
- **Shared helpers are imported, not copied.** Take helpers like `isPlainObject`, `escapeRegExp` and `TIER` from `templates/github/scripts/governance-rules.mjs` (or the module that defines them). Hook scripts on the no-change path may import only Node built-ins plus the built-ins-only modules `governance-log.mjs`, `governance-state.mjs` and `templates/github/scripts/main-module.mjs` (AC6 timing test) (F15).
- **Git command rules start with `GIT_PREFIX`.** Build every regex that matches a git subcommand on `GIT_PREFIX` from `templates/github/scripts/workflow-rules.mjs`, never on `git\s+`. Otherwise a global option such as `git -C . push` gets past the rule (F3).
- **Entry scripts use `isMainModule`.** Check "started directly" with `isMainModule(import.meta.url)` from `templates/github/scripts/main-module.mjs`. Comparing `argv[1]` to `import.meta.url` as written fails through a link, and the script exits 0 without doing anything (F4).
- **Export only what another file imports.** Keep a symbol module-private unless another file or a test imports it (F15).
