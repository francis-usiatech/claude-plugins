# Step 2: Test-first and Review Depth Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add test-first and root-cause workflows (`tdd`, `debug` skills), two new read-only reviewers (silent failures, security), a guard rule that stops secrets being written into files, confidence scoring for every reviewer, and a two-stage review in `release`. Ships as usiatech-engineering 0.6.0.

**Architecture:** Skills and agents are Markdown with YAML frontmatter under `plugins/usiatech-engineering/`. A new structure test (`tests/plugin-structure.test.mjs`) makes them testable: frontmatter, read-only reviewers, confidence scoring, the two-stage release and README coverage. The secret-content rule is code. The patterns and `findSecret()` live in the shared `governance-rules.mjs`, and `governance-policy.mjs` calls it for every edit tool. So it's unit-tested like the other guard rules, and CI can reuse it later.

**Tech Stack:** Node ≥ 20 ES modules, `node:test`, no dependencies. Claude Code plugin format (skills, agents, hooks).

**Spec:** The step-2 section of the improvement roadmap (items B4, B5, B7, B8, A8 and A9, recorded in `~/.claude/session-data/2026-09-28-08a41718-session.tmp`). The design decisions below were made in this plan and need the user's approval.

## Global Constraints

- No new dependencies. Tests use `node:test` and `node:assert/strict` only.
- Code style: 2-space indent, single quotes, no semicolons, ES modules, sparse comments that explain *why*.
- Test names use `describe(...)` + `it('should …')`.
- Reviewer agents stay read-only: `tools: ["Read", "Grep", "Glob", "Bash"]`. No `Edit`, `Write`, `MultiEdit` or `NotebookEdit`.
- Guard reasons and log entries must never contain the secret itself.
- Test fixtures must never contain a literal secret-shaped string. Build them at runtime (`'AKIA' + 'Q'.repeat(16)`), or the new guard rule will stop Claude from writing the test file.
- Version 0.6.0 in `.claude-plugin/marketplace.json`, `plugins/usiatech-engineering/.claude-plugin/plugin.json`, the root `README.md` table and the plugin README changelog.
- Branch `feature/step-2-review-depth` off `main`. One commit per task. The PR goes into `main`.
- The full gate is `npm test` from the repo root, plus `claude plugin validate .` and `claude plugin validate plugins/usiatech-engineering`.

## Design decisions (for approval)

1. **Security hook = a content rule in the existing guard**, not a second hook. That keeps one PreToolUse hook, one log and one config path.
   - Provider-format secrets are **denied**: private key blocks, AWS, GitHub, Anthropic, OpenAI, Stripe live, Google and Slack keys.
   - Generic `password = "…"`-style assignments **ask**.
   - Matches containing `example`, `dummy`, `placeholder`, `your-`/`your_` or `xxxxxx` are ignored, so documentation examples still work.
2. **Confidence threshold 80, fixed, stated in each reviewer** (no config key; YAGNI). Findings at 80+ go in the main output. 50–79 go under "Low-confidence notes". Below 50 are dropped. A FAIL or BLOCK verdict needs at least one finding at 80+.
3. **Two-stage review:**
   - Stage 1: `governance-reviewer` runs alone, because scope problems can make the rest of the work throw-away.
   - Stage 2: the other reviewers run in parallel.
   - The template's default `reviewers` become `governance-reviewer`, `convention-reviewer`, `silent-failure-reviewer` and `security-reviewer`. Repos with their own list keep it, and the README upgrade note tells them to add the new two.
4. **`tdd` "logging"** is an evidence table in the final report (red failure line, green result, refactor), not a new log file.

## Out of scope

- Bash-written files (`>`, `tee`, `sed -i`) bypassing edit rules: the deferred step-1 item.
- A6/A7 (fake-pass detection and excuse tables in `verify`).
- A repo-configurable allowlist for secret patterns.
- Scanning in CI: `gitleaks` already covers PRs.

## Review Focus

1. **The plugin's own test files contain secret-shaped strings**, so the guard would deny Claude's edits. Build every fixture at runtime (Task 2 and Task 3 tests do this).
2. **Documented example keys** (`AKIAIOSFODNN7EXAMPLE`, `sk-ant-xxxxxxxx…`, `password = "your-password-here"`) must not be denied. Pinned by the Task 2 test "should ignore placeholders".
3. **The secret must never appear in the reason** that is logged to `governance-log.jsonl` and shown in the prompt. Pinned by the Task 3 test "should not echo the secret".
4. **Malformed tool input** (MultiEdit `edits` not an array, `content` not a string) must not throw. A throw makes the guard fail open. Pinned by the Task 3 test "should ignore non-string content".
5. **Secret into an exempt or ask path** (`.claude/plans/active.md`, `package.json`) must still be denied, so the secret check runs before the exemptions and asks. Pinned by the Task 3 test "should deny before plan and ask paths".

---

## File map

| File | Change | Responsibility |
|---|---|---|
| `plugins/usiatech-engineering/tests/plugin-structure.test.mjs` | Create | Frontmatter, read-only reviewers, confidence scoring, release stages, template/README coverage |
| `plugins/usiatech-engineering/templates/github/scripts/governance-rules.mjs` | Modify | `DENY_CONTENT`, `ASK_CONTENT`, `findSecret()` |
| `plugins/usiatech-engineering/tests/governance-rules.test.mjs` | Modify | `findSecret` tests |
| `plugins/usiatech-engineering/hooks/scripts/governance-policy.mjs` | Modify | `editedText()`; the secret check in `decideEdit` |
| `plugins/usiatech-engineering/tests/governance-policy.test.mjs` | Modify | Guard-level secret tests |
| `plugins/usiatech-engineering/hooks/hooks.json` | Modify | The description mentions secrets |
| `plugins/usiatech-engineering/agents/convention-reviewer.md` | Modify | Confidence scoring |
| `plugins/usiatech-engineering/agents/governance-reviewer.md` | Modify | Confidence scoring |
| `plugins/usiatech-engineering/agents/silent-failure-reviewer.md` | Create | B7 |
| `plugins/usiatech-engineering/agents/security-reviewer.md` | Create | B8 reviewer |
| `plugins/usiatech-engineering/skills/release/SKILL.md` | Modify | A9 two-stage review |
| `plugins/usiatech-engineering/templates/engineering.json` | Modify | Default reviewers |
| `plugins/usiatech-engineering/skills/setup-engineering/SKILL.md` | Modify | Reviewers check |
| `plugins/usiatech-engineering/skills/tdd/SKILL.md` | Create | B4 |
| `plugins/usiatech-engineering/skills/debug/SKILL.md` | Create | B5 |
| `plugins/usiatech-engineering/README.md`, `README.md`, `.claude-plugin/marketplace.json`, `plugins/usiatech-engineering/.claude-plugin/plugin.json` | Modify | Docs, changelog, 0.6.0 |

---

### Task 1: Plugin structure test (baseline)

**Files:**
- Create: `plugins/usiatech-engineering/tests/plugin-structure.test.mjs`

**Interfaces:**
- Produces: the helpers `read(...segments)`, `frontmatter(text)` → `{ name, description, tools }`, `body(text)`, and the arrays `skills` (folder names) and `agents` (file names without `.md`). Later tasks add `it` blocks to this file and reuse the helpers.

This is a characterization test: it describes the current tree and passes immediately. Later tasks add failing assertions to it first.

- [ ] **Step 1: Write the test file**

```js
// Plugin structure: every skill and agent has valid frontmatter, reviewers stay read-only,
// and the README and engineering.json template only name components that exist.
import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, readdirSync } from 'node:fs'
import path from 'node:path'
import { PLUGIN_ROOT } from './helpers.mjs'

const read = (...p) => readFileSync(path.join(PLUGIN_ROOT, ...p), 'utf8')
const FRONTMATTER = /^---\r?\n([\s\S]*?)\r?\n---\r?\n/
const frontmatter = (text) => {
  const m = text.match(FRONTMATTER)
  assert.ok(m, 'missing frontmatter')
  const field = (k) => m[1].match(new RegExp(`^${k}:[ \\t]*(.*)$`, 'm'))?.[1].trim()
  return { name: field('name'), description: field('description'), tools: field('tools') }
}
const body = (text) => text.replace(FRONTMATTER, '')
const skills = readdirSync(path.join(PLUGIN_ROOT, 'skills'))
const agents = readdirSync(path.join(PLUGIN_ROOT, 'agents')).filter((f) => f.endsWith('.md')).map((f) => f.replace(/\.md$/, ''))
const reviewers = agents.filter((a) => a.endsWith('-reviewer'))

describe('plugin structure: skills', () => {
  for (const s of skills) {
    it(`should give skill "${s}" a matching name and a description`, () => {
      const fm = frontmatter(read('skills', s, 'SKILL.md'))
      assert.equal(fm.name, s)
      assert.ok(fm.description && fm.description.length > 40, 'description too short to trigger reliably')
    })
  }
})

describe('plugin structure: agents', () => {
  for (const a of agents) {
    it(`should give agent "${a}" a matching name and read-only tools`, () => {
      const fm = frontmatter(read('agents', `${a}.md`))
      assert.equal(fm.name, a)
      for (const t of ['Edit', 'Write', 'MultiEdit', 'NotebookEdit']) {
        assert.ok(!new RegExp(`"${t}"`).test(fm.tools || ''), `${a} must not have ${t}`)
      }
    })
  }
})

describe('plugin structure: references', () => {
  it('should only list existing agents as template reviewers', () => {
    const cfg = JSON.parse(read('templates', 'engineering.json'))
    for (const r of cfg.reviewers) assert.ok(agents.includes(r), `unknown reviewer ${r}`)
  })

  it('should list every skill and agent in the README components table', () => {
    const readme = read('README.md')
    for (const n of [...skills, ...agents]) assert.match(readme, new RegExp(`\\| \`${n}\` \\|`), n)
  })
})
```

- [ ] **Step 2: Run it and check it passes**

Run: `node --test plugins/usiatech-engineering/tests/plugin-structure.test.mjs`
Expected: all tests pass (5 skills, 2 agents, 2 reference checks).

- [ ] **Step 3: Commit**

```bash
git add plugins/usiatech-engineering/tests/plugin-structure.test.mjs
git commit -m "test(plugin): add structure test for skills, agents and references"
```

---

### Task 2: Secret-content rules (`findSecret`)

**Files:**
- Modify: `plugins/usiatech-engineering/templates/github/scripts/governance-rules.mjs` (append after `GUARD_EXEMPT_PATHS`)
- Test: `plugins/usiatech-engineering/tests/governance-rules.test.mjs`

**Interfaces:**
- Produces: `export const DENY_CONTENT: [reason, regexSource][]`, `export const ASK_CONTENT: [reason, regexSource][]`, and `export const findSecret = (text: string) => ({ decision: 'deny'|'ask', why: string } | null)`.

- [ ] **Step 1: Write the failing tests** (add `findSecret` to the import list and append this block)

```js
describe('findSecret', () => {
  // Built at runtime so this file never holds a secret-shaped literal (the guard would block writing it).
  const deny = {
    'private key': '-----BEGIN ' + 'RSA PRIVATE KEY-----\nMIIE',
    'AWS access key': 'key = ' + 'AKIA' + 'Q'.repeat(16),
    'GitHub token': 'ghp_' + 'a'.repeat(36),
    'Anthropic API key': 'sk-ant-api03-' + 'b'.repeat(40),
    'OpenAI API key': 'sk-proj-' + 'c'.repeat(40),
    'Stripe live key': 'sk_' + 'live_' + 'd'.repeat(24),
    'Google API key': 'AIza' + 'e'.repeat(35),
    'Slack token': 'xoxb-' + '1'.repeat(12),
  }
  for (const [why, text] of Object.entries(deny)) {
    it(`should deny a ${why}`, () => {
      assert.deepEqual(findSecret(text), { decision: 'deny', why })
    })
  }

  it('should ask on a hard-coded credential assignment', () => {
    assert.deepEqual(findSecret('const apiKey = "' + 'f'.repeat(16) + '"'), { decision: 'ask', why: 'hard-coded credential' })
    assert.equal(findSecret("password: '" + 'g'.repeat(14) + "'").decision, 'ask')
  })

  it('should ignore placeholders and documented examples', () => {
    for (const t of [
      'AKIA' + 'IOSFODNN7EXAMPLE',
      'sk-ant-' + 'x'.repeat(30),
      'password = "' + 'your-password-here' + '"',
      'api_key: "' + 'placeholder-value-1' + '"',
    ]) assert.equal(findSecret(t), null, t)
  })

  it('should ignore env lookups, short values and ordinary code', () => {
    assert.equal(findSecret('const password = process.env.DB_PASSWORD'), null)
    assert.equal(findSecret('password = "hunter2"'), null)
    assert.equal(findSecret('export const add = (a, b) => a + b'), null)
    assert.equal(findSecret(''), null)
  })

  it('should find a secret after an earlier placeholder match', () => {
    assert.equal(findSecret('AKIA' + 'IOSFODNN7EXAMPLE and ' + 'AKIA' + 'R'.repeat(16)).decision, 'deny')
  })
})
```

- [ ] **Step 2: Run the tests and check they fail**

Run: `node --test plugins/usiatech-engineering/tests/governance-rules.test.mjs`
Expected: FAIL with `SyntaxError: The requested module ... does not provide an export named 'findSecret'`.

- [ ] **Step 3: Implement** (append to `governance-rules.mjs`)

```js
// Secrets in edited content: [reason, regex source]. Provider formats are near-certain and denied (case-sensitive);
// generic credential assignments are fuzzier and ask (case-insensitive).
export const DENY_CONTENT = [
  ['private key', String.raw`-----BEGIN (?:RSA |EC |DSA |OPENSSH |PGP |ENCRYPTED )?PRIVATE KEY(?: BLOCK)?-----`],
  ['AWS access key', String.raw`\b(?:AKIA|ASIA)[0-9A-Z]{16}\b`],
  ['GitHub token', String.raw`\b(?:gh[pousr]_[A-Za-z0-9]{36,}|github_pat_[A-Za-z0-9_]{60,})`],
  ['Anthropic API key', String.raw`\bsk-ant-[A-Za-z0-9_-]{20,}`],
  ['OpenAI API key', String.raw`\bsk-(?:proj-)?[A-Za-z0-9]{32,}`],
  ['Stripe live key', String.raw`\b[sr]k_live_[A-Za-z0-9]{20,}`],
  ['Google API key', String.raw`\bAIza[0-9A-Za-z_-]{35}`],
  ['Slack token', String.raw`\bxox[abposr]-[A-Za-z0-9-]{10,}`],
]
export const ASK_CONTENT = [
  ['hard-coded credential', String.raw`\b(?:password|passwd|secret|api[_-]?key|access[_-]?token|auth[_-]?token)\b["']?\s*[:=]\s*["'][^"'\s$]{12,}["']`],
]
// Documentation examples and templates use these; they are not real secrets.
const PLACEHOLDER = /example|dummy|placeholder|your[_-]|x{6,}/i

// Returns the first secret-like match as { decision, why }, or null. Never returns the matched text,
// so callers can't leak it into prompts or logs.
export const findSecret = (text) => {
  for (const [rules, decision, flags] of [[DENY_CONTENT, 'deny', 'g'], [ASK_CONTENT, 'ask', 'gi']]) {
    for (const [why, re] of rules) {
      for (const m of text.matchAll(new RegExp(re, flags))) {
        if (!PLACEHOLDER.test(m[0])) return { decision, why }
      }
    }
  }
  return null
}
```

- [ ] **Step 4: Run the tests and check they pass**

Run: `node --test plugins/usiatech-engineering/tests/governance-rules.test.mjs`
Expected: PASS, 0 failures.

- [ ] **Step 5: Commit**

```bash
git add plugins/usiatech-engineering/templates/github/scripts/governance-rules.mjs plugins/usiatech-engineering/tests/governance-rules.test.mjs
git commit -m "feat(guard): add secret-content rules shared by guard and CI"
```

---

### Task 3: Guard checks edited content for secrets

**Files:**
- Modify: `plugins/usiatech-engineering/hooks/scripts/governance-policy.mjs` (import, new `editedText`, `decideEdit` signature and body, the `evaluate` call site)
- Modify: `plugins/usiatech-engineering/hooks/hooks.json` (description)
- Test: `plugins/usiatech-engineering/tests/governance-policy.test.mjs`

**Interfaces:**
- Consumes: `findSecret(text)` from Task 2.
- Produces: `decideEdit(file, safe, git, root, p, ic, text)`. The new last parameter is the text the edit writes.

- [ ] **Step 1: Write the failing tests** (append a new `describe` to `governance-policy.test.mjs`)

```js
describe('evaluate: secrets in edited content', () => {
  // Built at runtime so this file never holds a secret-shaped literal.
  const awsKey = 'AKIA' + 'Q'.repeat(16)
  const run = (tool_name, tool_input, opts = {}) => evaluate({ tool_name, tool_input }, { root: opts.root || tempDir(), git: fakeGit(), ...opts })

  it('should deny writing a provider key with any edit tool', () => {
    assert.equal(run('Write', { file_path: 'src/a.ts', content: `const k = '${awsKey}'` }).decision, 'deny')
    assert.equal(run('Edit', { file_path: 'src/a.ts', old_string: 'x', new_string: awsKey }).decision, 'deny')
    assert.equal(run('MultiEdit', { file_path: 'src/a.ts', edits: [{ old_string: 'a', new_string: 'b' }, { old_string: 'c', new_string: awsKey }] }).decision, 'deny')
    assert.equal(run('NotebookEdit', { notebook_path: 'n.ipynb', new_source: awsKey }).decision, 'deny')
  })

  it('should ask on a hard-coded credential assignment', () => {
    assert.match(run('Write', { file_path: 'src/db.ts', content: 'const password = "' + 'h'.repeat(16) + '"' }).reason, /hard-coded credential/)
  })

  it('should not echo the secret in the reason', () => {
    const r = run('Write', { file_path: 'src/a.ts', content: awsKey })
    assert.match(r.reason, /AWS access key/)
    assert.ok(!r.reason.includes(awsKey))
    assert.equal(r.target, 'src/a.ts')
  })

  it('should deny before plan and ask paths', () => {
    assert.equal(run('Write', { file_path: '.claude/plans/active.md', content: awsKey }).decision, 'deny')
    assert.equal(run('Edit', { file_path: 'package.json', old_string: 'x', new_string: awsKey }).decision, 'deny')
  })

  it('should ignore non-string content and malformed edits', () => {
    assert.equal(run('Write', { file_path: 'src/a.ts', content: 42 }), null)
    assert.equal(run('MultiEdit', { file_path: 'src/a.ts', edits: 'nope' }), null)
    assert.equal(run('MultiEdit', { file_path: 'src/a.ts', edits: [null, { new_string: 7 }] }), null)
  })

  it('should allow ordinary content and placeholders', () => {
    assert.equal(run('Write', { file_path: 'src/a.ts', content: 'export const x = 1' }), null)
    assert.equal(run('Write', { file_path: 'docs/aws.md', content: 'AKIA' + 'IOSFODNN7EXAMPLE' }), null)
  })
})
```

- [ ] **Step 2: Run the tests and check they fail**

Run: `node --test plugins/usiatech-engineering/tests/governance-policy.test.mjs`
Expected: FAIL. The deny and ask tests get `null`, and the "not echo" test throws `Cannot read properties of null`.

- [ ] **Step 3: Implement**

In the import from `governance-rules.mjs`, add `findSecret`:

```js
import {
  matchAny, isSecretEnvFile, escapeRegExp, isPlainObject, isStringArray, findSecret, DENY_COMMANDS, ASK_COMMANDS,
  DEFAULT_ASK_PATHS, DEFAULT_PROTECTED_PATHS, GUARD_EXEMPT_PATHS, PLAN_PATH,
} from '../../templates/github/scripts/governance-rules.mjs'
```

Add below `const decision = ...`:

```js
// The text an edit would write, so content rules can check it. Non-string parts are ignored rather than thrown on.
const editedText = (tool, ti) => {
  const parts = tool === 'Write' ? [ti.content]
    : tool === 'Edit' ? [ti.new_string]
    : tool === 'MultiEdit' ? (Array.isArray(ti.edits) ? ti.edits.map((e) => e?.new_string) : [])
    : tool === 'NotebookEdit' ? [ti.new_source]
    : []
  return parts.filter((s) => typeof s === 'string').join('\n')
}
```

Change the `decideEdit` signature to `(file, { cfg, gov }, git, root, p, ic, text = '')`. Insert this right after the `immutableWhenCommitted` loop and before the `PLAN_PATH` check:

```js
  // Before the plan/exempt/ask checks: a secret is never fine, wherever it is written.
  const secret = findSecret(text)
  if (secret?.decision === 'deny') return decision('deny', `The edit writes what looks like a ${secret.why}. Keep secrets in env files or a secret manager.`, rel)
  if (secret) return decision('ask', `The edit looks like it hard-codes a ${secret.why}. Confirm it is not a real secret.`, rel)
```

In `evaluate`, change the call to:

```js
    } else result = decideEdit(target, safe, git, root, pathApi, caseInsensitive, editedText(tool, ti))
```

In `hooks/hooks.json`, replace the description with:

```json
"description": "Governance guard: denies catastrophic or rule-breaking actions and edits that write secrets, asks for confirmation on risky commands, likely hard-coded credentials, governance/CI/dependency files and edits outside the approved plan; logs every decision to .claude/governance-log.jsonl."
```

- [ ] **Step 4: Run the tests and check they pass**

Run: `npm test`
Expected: PASS, 0 failures (the Task 1 and Task 2 tests included).

- [ ] **Step 5: Commit**

```bash
git add plugins/usiatech-engineering/hooks/scripts/governance-policy.mjs plugins/usiatech-engineering/hooks/hooks.json plugins/usiatech-engineering/tests/governance-policy.test.mjs
git commit -m "feat(guard): deny edits that write secrets, ask on hard-coded credentials"
```

---

### Task 4: Confidence scoring in the existing reviewers (A8)

**Files:**
- Modify: `plugins/usiatech-engineering/agents/convention-reviewer.md` (Output section)
- Modify: `plugins/usiatech-engineering/agents/governance-reviewer.md` (Output section)
- Test: `plugins/usiatech-engineering/tests/plugin-structure.test.mjs`

**Interfaces:**
- Produces: the exact rubric block below. Tasks 5 and 6 paste the same block into the new reviewers.

- [ ] **Step 1: Write the failing test** (append to `plugin-structure.test.mjs`)

```js
describe('plugin structure: reviewers', () => {
  for (const r of reviewers) {
    it(`should make "${r}" score each finding's confidence`, () => {
      const text = body(read('agents', `${r}.md`))
      assert.match(text, /\*\*Confidence:\*\*/)
      assert.match(text, /Low-confidence notes/)
      assert.match(text, /\b80\b/)
    })
  }
})
```

- [ ] **Step 2: Run it and check it fails**

Run: `node --test plugins/usiatech-engineering/tests/plugin-structure.test.mjs`
Expected: FAIL for `convention-reviewer` and `governance-reviewer` ("does not match /\*\*Confidence:\*\*/").

- [ ] **Step 3: Add the rubric**

The shared rubric block:

```markdown
**Confidence:** score every finding 0–100 for how sure you are that it is a real problem in this change.
- 100: reproduced, or certain from the code.
- 80: clear from the code with one small assumption.
- 50: plausible but unverified.
- Below 50: speculation.

Report findings at 80 or above in the main output. List 50–79 briefly under **Low-confidence notes**, each with what would confirm it. Drop anything below 50. A blocking verdict needs at least one finding at 80 or above.
```

In `convention-reviewer.md`:
- Insert the rubric block directly above `**Output:**`.
- Change the blocking-issues bullet to: `- **Blocking issues:** numbered, each with \`file:line\`, confidence, the rule (quote AGENTS.md briefly) and a suggested fix`
- Add after the Nits bullet: `- **Low-confidence notes:** short list (confidence 50–79)`

In `governance-reviewer.md`:
- Insert the rubric block directly above `## Output`.
- Change the table header to:

```markdown
| # | Severity | Confidence | Finding | Evidence (`file:line`, log entry, command) | Rule / requirement | Recommended action |
|---|---|---|---|---|---|---|
```

- Add to the "Then add" list: `- **Low-confidence notes:** findings scored 50–79, each with what would confirm it.`
- A missing baseline is certain (100), so the existing "return `FLAG`" rule still holds.

- [ ] **Step 4: Run it and check it passes**

Run: `node --test plugins/usiatech-engineering/tests/plugin-structure.test.mjs`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add plugins/usiatech-engineering/agents/convention-reviewer.md plugins/usiatech-engineering/agents/governance-reviewer.md plugins/usiatech-engineering/tests/plugin-structure.test.mjs
git commit -m "feat(reviewers): score finding confidence and report only 80+"
```

---

### Task 5: `silent-failure-reviewer` agent (B7)

**Files:**
- Create: `plugins/usiatech-engineering/agents/silent-failure-reviewer.md`
- Modify: `plugins/usiatech-engineering/README.md` (a components-table row, so the Task 1 README test passes)
- Test: `plugins/usiatech-engineering/tests/plugin-structure.test.mjs`

**Interfaces:**
- Produces: agent name `silent-failure-reviewer`. Verdict `PASS` / `PASS WITH NITS` / `FAIL`.

- [ ] **Step 1: Write the failing test** (append)

```js
describe('plugin structure: step-2 components', () => {
  for (const a of ['silent-failure-reviewer']) {
    it(`should ship agent "${a}"`, () => assert.ok(agents.includes(a)))
  }
})
```

- [ ] **Step 2: Run it and check it fails**

Run: `node --test plugins/usiatech-engineering/tests/plugin-structure.test.mjs`
Expected: FAIL with `should ship agent "silent-failure-reviewer"`.

- [ ] **Step 3: Create the agent**

`plugins/usiatech-engineering/agents/silent-failure-reviewer.md`:

```markdown
---
name: silent-failure-reviewer
description: |
  Read-only reviewer that finds errors a change hides instead of surfacing: empty or log-and-continue catch blocks, fallbacks that mask failures, unawaited promises, ignored exit codes and tests that can't fail. Use before commit (stage 2 of the release review) and whenever a change adds error handling, retries, fallbacks or catch blocks.

  <example>
  Context: Claude has added error handling to an API client
  user: "Commit it"
  assistant: "Stage 1 passed; I'll run silent-failure-reviewer with the other stage-2 reviewers on the diff."
  <commentary>
  Error-handling changes are where failures get swallowed.
  </commentary>
  </example>

  <example>
  Context: User is suspicious of a bug that produced no error
  user: "Why didn't this fail loudly?"
  assistant: "I'll use the silent-failure-reviewer agent to look for swallowed errors in the related code."
  <commentary>
  Direct request to find hidden failures.
  </commentary>
  </example>
model: inherit
color: yellow
tools: ["Read", "Grep", "Glob", "Bash"]
---

You find failures that a change hides. A hidden failure is worse than a crash, because nobody learns about it. **Never edit files, commit, push or start servers.**

**Gather:**
1. Run `git diff --stat`, `git diff` and `git status --short`, or review the files you were given.
2. Read enough of each changed file to see how errors reach the caller. Read the repo's `AGENTS.md` for its error-handling and logging rules.

**Check (cite `file:line` for each finding):**
- **Swallowed errors:** empty `catch`, `catch` that only logs and then continues as if it had succeeded, `catch { return null/[]/{} }` where the caller can't tell failure from "no data", and `.catch(() => {})`.
- **Masking fallbacks:** `?? default`, `|| []` or optional chaining on data that must exist, so a bug turns into a silently wrong result. Defaults for truly optional values are fine.
- **Lost async errors:** promises that are neither awaited nor returned, `forEach(async …)`, fire-and-forget calls with no error handler, and event emitters with no `error` listener.
- **Ignored results:** unchecked exit codes, `2>/dev/null` or `|| true` in scripts and CI, `continue-on-error: true`, HTTP responses used without checking status, and ignored `{ error }` returns.
- **Retry and timeout loops** that give up without surfacing the last error.
- **Broad catches** that turn programming errors (TypeError, ReferenceError) into "expected" failures.
- **Tests that can't fail:** assertions inside a `catch` that never runs, missing `await` on async assertions, `expect` with no matcher, `.skip`/`.only`, and snapshot updates that hide a change.
- **Logging:** errors logged without the context needed to act (id, input, cause), or logged at a level nobody watches. Secrets or personal data in logs.

For each finding, say what the user or operator sees when it happens, and the smallest fix that surfaces the error: rethrow, return a typed error, fail the job, or log with context and stop.

**Confidence:** score every finding 0–100 for how sure you are that it is a real problem in this change.
- 100: reproduced, or certain from the code.
- 80: clear from the code with one small assumption.
- 50: plausible but unverified.
- Below 50: speculation.

Report findings at 80 or above in the main output. List 50–79 briefly under **Low-confidence notes**, each with what would confirm it. Drop anything below 50. A blocking verdict needs at least one finding at 80 or above.

**Output:**
- **Verdict:** PASS / PASS WITH NITS / FAIL (FAIL when a hidden failure could lose data, corrupt state or mislead a user)
- **Blocking issues:** numbered, each with `file:line`, confidence, what goes wrong silently, and the fix
- **Nits:** short list
- **Low-confidence notes:** short list (confidence 50–79)
- **Checks run:** each command with its result

Be concise. Don't restate the code or praise.
```

In `plugins/usiatech-engineering/README.md`, add after the `convention-reviewer` row:

```markdown
| Agent | `silent-failure-reviewer` | Read-only review for swallowed errors, masking fallbacks, lost async errors, ignored exit codes and tests that can't fail |
```

- [ ] **Step 4: Run it and check it passes**

Run: `node --test plugins/usiatech-engineering/tests/plugin-structure.test.mjs`
Expected: PASS. This includes the read-only, confidence and README checks for the new agent.

- [ ] **Step 5: Commit**

```bash
git add plugins/usiatech-engineering/agents/silent-failure-reviewer.md plugins/usiatech-engineering/README.md plugins/usiatech-engineering/tests/plugin-structure.test.mjs
git commit -m "feat(reviewers): add silent-failure-reviewer agent"
```

---

### Task 6: `security-reviewer` agent (B8)

**Files:**
- Create: `plugins/usiatech-engineering/agents/security-reviewer.md`
- Modify: `plugins/usiatech-engineering/README.md` (a components-table row)
- Test: `plugins/usiatech-engineering/tests/plugin-structure.test.mjs`

**Interfaces:**
- Produces: agent name `security-reviewer`. Verdict `PASS` / `PASS WITH NITS` / `FAIL`.

- [ ] **Step 1: Write the failing test.** Change the Task 5 list to `['silent-failure-reviewer', 'security-reviewer']`.

- [ ] **Step 2: Run it and check it fails**

Run: `node --test plugins/usiatech-engineering/tests/plugin-structure.test.mjs`
Expected: FAIL with `should ship agent "security-reviewer"`.

- [ ] **Step 3: Create the agent**

`plugins/usiatech-engineering/agents/security-reviewer.md`:

```markdown
---
name: security-reviewer
description: |
  Read-only security reviewer for a diff: injection, broken access control, secrets, unsafe input handling, SSRF and path traversal, weak crypto, risky dependencies and CI workflow risks. Use before commit (stage 2 of the release review), and whenever a change touches auth, input handling, file or network access, dependencies or CI workflows.

  <example>
  Context: Claude has added a new API route that reads a file named in the request
  user: "Commit it"
  assistant: "Stage 1 passed; I'll run security-reviewer with the other stage-2 reviewers on the diff."
  <commentary>
  User input reaching the file system needs a security review.
  </commentary>
  </example>

  <example>
  Context: User wants a security pass on a branch
  user: "Is this branch safe to merge?"
  assistant: "I'll use the security-reviewer agent to check the diff."
  <commentary>
  Direct request for a security review.
  </commentary>
  </example>
model: inherit
color: magenta
tools: ["Read", "Grep", "Glob", "Bash"]
---

You review a change for security problems. **Never edit files, commit, push, install packages, start servers or send requests to external hosts.**

**Gather:**
1. Run `git diff --stat`, `git diff` and `git status --short`, or review the files you were given.
2. Read `REVIEW.md` (severity definitions) and the security sections of `AGENTS.md` and `.claude/governance.md` if they exist.
3. For each changed entry point (route, handler, job, CLI, workflow), trace where its input comes from and where it goes.

**Check (cite `file:line` for each finding):**
- **Injection:**
  - SQL/NoSQL built with string concatenation or interpolation
  - shell commands with interpolated input (`exec`, `execSync`, `spawn` with `shell: true`)
  - `eval` or `new Function`
  - template or header injection
- **Access control:**
  - new routes or handlers without an auth check
  - missing owner or tenant scoping, so one user can reach another's records (IDOR)
  - weakened RLS or policies
  - admin actions reachable by normal users
- **Input at trust boundaries:**
  - request bodies, query params, headers, uploads and webhooks without validation (schema, size, type)
  - webhooks without a signature check
- **Output:**
  - XSS (`dangerouslySetInnerHTML`, `innerHTML`, unescaped templates)
  - open redirects
  - permissive CORS with credentials
  - verbose errors or stack traces sent to clients
- **Secrets and personal data:**
  - hard-coded keys or tokens
  - secrets or personal data in logs, errors, analytics or client bundles
  - `.env` handling
- **SSRF and path traversal:** URLs, hosts or file paths taken from user input without an allowlist or normalisation.
- **Crypto and randomness:**
  - fast or unsalted hashes for passwords
  - `Math.random` for tokens or IDs that must be unguessable
  - disabled TLS verification
  - home-made crypto
- **Dependencies:**
  - new packages (typosquats, unmaintained, install scripts, broad permissions)
  - lockfile changes with no manifest change
  - version ranges that widen
- **CI and automation:**
  - `pull_request_target` or `workflow_run` that checks out PR code
  - untrusted text (`github.event.*.title/body`, branch names) in `run:` steps or AI prompts
  - unpinned third-party actions
  - broader `permissions`
  - secrets exposed to fork PRs

For each finding, give a concrete attack: who sends what, and what they get. Then give the smallest fix. Use `REVIEW.md` severities if they exist, otherwise Critical / High / Medium / Low.

**Confidence:** score every finding 0–100 for how sure you are that it is a real problem in this change.
- 100: reproduced, or certain from the code.
- 80: clear from the code with one small assumption.
- 50: plausible but unverified.
- Below 50: speculation.

Report findings at 80 or above in the main output. List 50–79 briefly under **Low-confidence notes**, each with what would confirm it. Drop anything below 50. A blocking verdict needs at least one finding at 80 or above.

**Output:**
- **Verdict:** PASS / PASS WITH NITS / FAIL (FAIL on any Critical or High finding at confidence 80+)
- **Findings:** numbered, each with severity, confidence, `file:line`, the attack, and the fix
- **Nits:** hardening suggestions that aren't vulnerabilities
- **Low-confidence notes:** short list (confidence 50–79)
- **Checks run:** each command with its result

Be concise. Don't restate the code or praise. Don't report issues in code the change didn't touch unless the change makes them reachable.
```

In `plugins/usiatech-engineering/README.md`, add after the `silent-failure-reviewer` row:

```markdown
| Agent | `security-reviewer` | Read-only security review of a diff: injection, access control, input handling, secrets, SSRF/path traversal, crypto, dependencies and CI workflows |
```

- [ ] **Step 4: Run it and check it passes**

Run: `node --test plugins/usiatech-engineering/tests/plugin-structure.test.mjs`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add plugins/usiatech-engineering/agents/security-reviewer.md plugins/usiatech-engineering/README.md plugins/usiatech-engineering/tests/plugin-structure.test.mjs
git commit -m "feat(reviewers): add security-reviewer agent"
```

---

### Task 7: Two-stage review in `release` (A9) and new default reviewers

**Files:**
- Modify: `plugins/usiatech-engineering/skills/release/SKILL.md` (step 1.4)
- Modify: `plugins/usiatech-engineering/templates/engineering.json` (`reviewers`)
- Modify: `plugins/usiatech-engineering/skills/setup-engineering/SKILL.md` (step 4, the reviewers bullet)
- Test: `plugins/usiatech-engineering/tests/plugin-structure.test.mjs`

**Interfaces:**
- Consumes: the agent names from Tasks 5 and 6.

- [ ] **Step 1: Write the failing tests** (append inside the `plugin structure: references` describe)

```js
  it('should default to all four reviewers, governance first', () => {
    const cfg = JSON.parse(read('templates', 'engineering.json'))
    assert.deepEqual(cfg.reviewers, ['governance-reviewer', 'convention-reviewer', 'silent-failure-reviewer', 'security-reviewer'])
  })

  it('should review in two stages in release: scope first, then code quality', () => {
    const text = body(read('skills', 'release', 'SKILL.md'))
    const s1 = text.indexOf('Stage 1')
    const s2 = text.indexOf('Stage 2')
    assert.ok(s1 > -1 && s2 > s1, 'Stage 1 must come before Stage 2')
    assert.match(text, /confidence/i)
  })
```

- [ ] **Step 2: Run the tests and check they fail**

Run: `node --test plugins/usiatech-engineering/tests/plugin-structure.test.mjs`
Expected: FAIL on both new tests.

- [ ] **Step 3: Implement**

In `release/SKILL.md`, replace step 4 of section 1 (the four lines starting `4. Launch every agent in \`reviewers\``) with:

```markdown
4. Review in two stages, using the agents in `reviewers`:
   - **Stage 1 (scope and requirements):** run `governance-reviewer` on its own first. A `BLOCK` stops here. A `FLAG` needs the user's explicit decision, recorded in the plan's change log, before stage 2. Don't spend stage 2 on work that may be thrown away.
   - **Stage 2 (code quality):** run the other reviewers in parallel (default `convention-reviewer`, `silent-failure-reviewer`, `security-reviewer`; repos may add their own, e.g. `security-tenancy-auditor`). Resolve every blocking finding before committing. List nits in the PR.
   - Reviewers only report findings with confidence 80 or above. Check a low-confidence note yourself before acting on it.
   - If `reviewers` doesn't include `governance-reviewer`, say in the PR that stage 1 was skipped.
```

In `templates/engineering.json`, set:

```json
  "reviewers": [
    "governance-reviewer",
    "convention-reviewer",
    "silent-failure-reviewer",
    "security-reviewer"
  ],
```

In `setup-engineering/SKILL.md` step 4, replace `- Confirm \`reviewers\` includes \`governance-reviewer\`.` with:

```markdown
   - Confirm `reviewers` starts with `governance-reviewer` (stage 1) and includes `silent-failure-reviewer` and `security-reviewer`. For an existing config, propose adding any that are missing; don't add them silently.
```

- [ ] **Step 4: Run the tests and check they pass**

Run: `node --test plugins/usiatech-engineering/tests/plugin-structure.test.mjs`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add plugins/usiatech-engineering/skills/release/SKILL.md plugins/usiatech-engineering/templates/engineering.json plugins/usiatech-engineering/skills/setup-engineering/SKILL.md plugins/usiatech-engineering/tests/plugin-structure.test.mjs
git commit -m "feat(release): review in two stages with four default reviewers"
```

---

### Task 8: `tdd` skill (B4)

**Files:**
- Create: `plugins/usiatech-engineering/skills/tdd/SKILL.md`
- Modify: `plugins/usiatech-engineering/README.md` (a components-table row)
- Test: `plugins/usiatech-engineering/tests/plugin-structure.test.mjs`

- [ ] **Step 1: Write the failing test** (append inside `plugin structure: step-2 components`)

```js
  for (const s of ['tdd']) {
    it(`should ship skill "${s}"`, () => assert.ok(skills.includes(s)))
  }
```

- [ ] **Step 2: Run it and check it fails**

Run: `node --test plugins/usiatech-engineering/tests/plugin-structure.test.mjs`
Expected: FAIL with `should ship skill "tdd"`.

- [ ] **Step 3: Create the skill**

`plugins/usiatech-engineering/skills/tdd/SKILL.md`:

```markdown
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
```

In `plugins/usiatech-engineering/README.md`, add after the `approve-plan` row:

```markdown
| Skill | `tdd` | Test-first cycles (red → green → refactor) with the failing and passing evidence for each cycle, then the verify gate |
```

- [ ] **Step 4: Run it and check it passes**

Run: `node --test plugins/usiatech-engineering/tests/plugin-structure.test.mjs`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add plugins/usiatech-engineering/skills/tdd/SKILL.md plugins/usiatech-engineering/README.md plugins/usiatech-engineering/tests/plugin-structure.test.mjs
git commit -m "feat(skills): add tdd skill"
```

---

### Task 9: `debug` skill (B5)

**Files:**
- Create: `plugins/usiatech-engineering/skills/debug/SKILL.md`
- Modify: `plugins/usiatech-engineering/README.md` (a components-table row)
- Test: `plugins/usiatech-engineering/tests/plugin-structure.test.mjs`

- [ ] **Step 1: Write the failing test.** Change the Task 8 list to `['tdd', 'debug']`.

- [ ] **Step 2: Run it and check it fails**

Run: `node --test plugins/usiatech-engineering/tests/plugin-structure.test.mjs`
Expected: FAIL with `should ship skill "debug"`.

- [ ] **Step 3: Create the skill**

`plugins/usiatech-engineering/skills/debug/SKILL.md`:

```markdown
---
name: debug
description: Finds the root cause of a bug before fixing it. Reproduce, localize, reduce, fix, then add a guard test. Use when the user reports a bug, error, failing test, crash or "it doesn't work", or when a fix attempt has already failed once.
---

# Debug (root cause first)

Don't change production code until the root cause is stated and the user has approved the fix.

## 1. Reproduce
- Get the exact failing command, input, error text and environment (branch, OS, runtime version).
- Run it and capture the output. If you can't reproduce it, say so, list what you tried and ask for the missing detail. Don't guess-fix.

## 2. Localize
- Read the error from the top stack frame in this repo's code.
- Check recent changes: `git log --oneline -15 -- <paths>` and `git diff <base>...HEAD -- <paths>`.
- Write down 2–4 hypotheses, each with the evidence that would confirm or rule it out.
- Test the cheapest hypothesis first: a temporary log, a narrower case, or `git bisect` when a known-good commit exists.
- After three disproved hypotheses, stop. Summarise what's ruled out and re-plan with the user.

## 3. Reduce
- Shrink the reproduction to the smallest input or test that still fails. This becomes the guard test.

## 4. Fix (after approval)
- State the root cause in one or two sentences, with `file:line`, and explain why the symptom follows from it.
- Propose the smallest fix at the root cause, not at the symptom: no catch-and-ignore, no retry loops, no special-casing the failing input. Wait for approval.
- Implement it with the `tdd` skill. The reduced reproduction is the red test.

## 5. Guard
- The regression test stays in the suite and names the bug (and the issue number if there is one).
- Remove every temporary log or debug change. `git diff` must show only the fix and the test.
- Search for the same pattern elsewhere and list any other occurrences for the user. Don't fix them unasked.

## Report
**Symptom** · **Root cause** (`file:line`) · **Fix** · **Guard test** · **Other occurrences** · the `verify` gate table.
```

In `plugins/usiatech-engineering/README.md`, add after the `tdd` row:

```markdown
| Skill | `debug` | Root cause before fix: reproduce → localize (hypotheses, bisect) → reduce → approved fix via `tdd` → regression guard test |
```

- [ ] **Step 4: Run it and check it passes**

Run: `node --test plugins/usiatech-engineering/tests/plugin-structure.test.mjs`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add plugins/usiatech-engineering/skills/debug/SKILL.md plugins/usiatech-engineering/README.md plugins/usiatech-engineering/tests/plugin-structure.test.mjs
git commit -m "feat(skills): add debug skill"
```

---

### Task 10: Docs, version 0.6.0, gate, PR

**Files:**
- Modify: `plugins/usiatech-engineering/README.md` (the guard row, the `reviewers` key, the Deny/Ask lists, the changelog)
- Modify: `README.md` (version table), `.claude-plugin/marketplace.json`, `plugins/usiatech-engineering/.claude-plugin/plugin.json`

- [ ] **Step 1: Update the plugin README**
  - Guard row (the `Hook` line in Components): after "**Deny:** catastrophic or rule-breaking actions" add `and edits that write secrets`. After "**Ask:** risky commands" add `, likely hard-coded credentials`.
  - `reviewers` row: `Agents \`release\` runs before committing, in two stages: \`governance-reviewer\` first, then the rest in parallel (default adds \`convention-reviewer\`, \`silent-failure-reviewer\`, \`security-reviewer\`; repo-specific ones allowed)`
  - Default guard rules, **Deny**: add `- edits whose content contains a private key or a provider API key/token (AWS, GitHub, Anthropic, OpenAI, Stripe live, Google, Slack); documented placeholders are ignored`
  - Default guard rules, **Ask**: add `- edits that look like a hard-coded credential (\`password = "…"\`, \`apiKey: "…"\`)`
  - Changelog row (above 0.5.1):

```markdown
| 0.6.0 | New `tdd` and `debug` skills; new read-only `silent-failure-reviewer` and `security-reviewer` agents; every reviewer scores finding confidence and reports only 80+ (50–79 as low-confidence notes); `release` reviews in two stages (governance first, then the rest in parallel); the guard denies edits that write private keys or provider API keys and asks on likely hard-coded credentials (rules and `findSecret()` in `governance-rules.mjs`); plugin structure test. **Upgrading repos:** add `silent-failure-reviewer` and `security-reviewer` to `reviewers` in `.claude/engineering.json`; re-copy `templates/github/scripts/` so `governance-rules.mjs` matches (CI behaviour is unchanged). |
```

- [ ] **Step 2: Bump the version to 0.6.0** in `.claude-plugin/marketplace.json`, `plugins/usiatech-engineering/.claude-plugin/plugin.json` and the root `README.md` table (`| 0.5.1   |` → `| 0.6.0   |`).

- [ ] **Step 3: Run the full gate**

Run: `npm test`, then `claude plugin validate .`, then `claude plugin validate plugins/usiatech-engineering`
Expected: 0 test failures, 0 skipped. Both validations print "✔ Validation passed".

- [ ] **Step 4: Commit**

```bash
git add README.md .claude-plugin/marketplace.json plugins/usiatech-engineering/.claude-plugin/plugin.json plugins/usiatech-engineering/README.md
git commit -m "docs: document step-2 skills, reviewers and secret guard (v0.6.0)"
```

- [ ] **Step 5: Release.** Use the `release` skill: the two-stage review (governance, then convention + silent-failure + security), a PR into `main` and the CI watch. After merge, run `claude plugin marketplace update usiatech` and `claude plugin update usiatech-engineering@usiatech`.
