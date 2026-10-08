// Shared governance rules for the usiatech-engineering plugin: the single source for the local
// guard hook (hooks/scripts/governance-policy.mjs) and the PR governance scripts in this folder.
// setup-engineering copies this folder into .github/scripts/, so CI reads the base-branch copy.
// Repos extend these defaults in .claude/engineering.json → governance.{denyCommands, askCommands, askPaths}.

// ignoreCase: set on case-insensitive file systems (Windows, macOS), where `.ENV` and `.env` are the same file.
export const globToRegExp = (g, ignoreCase = false) => new RegExp('^' + g
  .replace(/[.+^${}()|[\]\\]/g, '\\$&')
  .replace(/\*\*\//g, '\u0001')
  .replace(/\*\*/g, '\u0002')
  .replace(/\*/g, '[^/]*')
  .replace(/\?/g, '[^/]')
  .replace(/\u0001/g, '(?:.*/)?')
  .replace(/\u0002/g, '.*') + '$', ignoreCase ? 'i' : '')
export const matchAny = (rel, globs, ignoreCase = false) => globs.find((g) => globToRegExp(g, ignoreCase).test(rel))

// .env, .env.local, .env.production ... hold secrets. .env.example is allowed unless a repo opts out.
export const isSecretEnvFile = (basename, allowEnvExample = true, ignoreCase = false) => {
  const b = ignoreCase ? basename.toLowerCase() : basename
  return /^\.env(\..+)?$/.test(b) && !(b === '.env.example' && allowEnvExample)
}

export const escapeRegExp = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

// Config shape checks shared by the guard and CI.
export const isPlainObject = (v) => !!v && typeof v === 'object' && !Array.isArray(v)
export const isStringArray = (v) => Array.isArray(v) && v.every((s) => typeof s === 'string')

// Command rules: [reason, regex source], matched case-insensitively against the full Bash command.
export const DENY_COMMANDS = [
  ['destructive delete of root/home/workspace', String.raw`\brm\s+-[a-z]*(rf|fr)[a-z]*\s+(\/(\s|$)|~|\$HOME|\*|\.\/?(\s|$))`],
  ['piping a download into a shell', String.raw`\b(curl|wget)\b[^|;&]*\|\s*(sudo\s+)?(ba|z|da)?sh\b`],
  ['bypassing git hooks', String.raw`--no-verify\b`],
  ['disk/filesystem destruction', String.raw`\b(mkfs(\.\w+)?|dd\s+[^|]*of=\/dev\/|:\(\)\s*\{\s*:\|:&\s*\};:)`],
  ['dropping a database or schema', String.raw`\bdrop\s+(database|schema)\b`],
  ['machine shutdown/reboot', String.raw`\b(shutdown|reboot|halt|poweroff)\b`],
  ['world-writable recursive permissions', String.raw`\bchmod\s+-R\s+0?777\b`],
]
export const ASK_COMMANDS = [
  ['force push', String.raw`\bgit\s+push\b.*(\s--force(-with-lease)?\b|\s-f\b|\s["']?\+\S)`],
  ['discarding work (reset/clean/restore/checkout)', String.raw`\bgit\s+(reset\s+--hard|clean\s+-[a-z]*f|restore\s+\.|checkout\s+--\s+\.|stash\s+(drop|clear))`],
  ['deleting a branch', String.raw`\bgit\s+(branch\s+-D|push\s+\S+\s+--delete|push\s+\S+\s+:\S)`],
  ['rewriting history', String.raw`\bgit\s+(rebase|filter-branch|filter-repo|commit\s+--amend)\b`],
  ['recursive delete', String.raw`\brm\s+-[a-z]*r`],
  ['destructive SQL', String.raw`\b(drop\s+table|truncate\s+|delete\s+from\s+\w+\s*(;|$|"|'))`],
  ['weakening row-level security', String.raw`(disable\s+row\s+level\s+security|no\s+force\s+row\s+level\s+security|bypassrls)`],
  ['resetting/dropping a database', String.raw`\b(prisma\s+migrate\s+reset|drizzle-kit\s+drop|db:reset|db:drop)\b`],
  ['adding a dependency', String.raw`\b(npm\s+(i|install|add)\s+[^-\s]|pnpm\s+(add|install\s+[^-\s])|yarn\s+add|pip3?\s+install|npx\s+-y\s)`],
  ['publishing a package', String.raw`\b(npm|pnpm|yarn)\s+publish\b`],
  ['remote host / infrastructure change', String.raw`\b(ssh|scp|rsync)\s|\b(terraform\s+(apply|destroy)|kubectl\s+(apply|delete)|ansible-playbook\b(?!.*--check)|firebase\s+deploy|docker\s+(system\s+prune|volume\s+rm))`],
  ['reading secrets', String.raw`\b(cat|less|more|head|tail|type|bat)\s+[^|;&]*\.env(?!\.example)(\.[\w-]+)?(\s|$)|\bprintenv\b`],
  ['elevated privileges', String.raw`\bsudo\s`],
  ['world-writable permissions', String.raw`\bchmod\s+(-R\s+)?0?777\b`],
]

// Governance, CI and dependency files: the guard asks before editing them, CI requires the approval label.
export const DEFAULT_ASK_PATHS = ['.claude/**', 'AGENTS.md', '**/AGENTS.md', 'CLAUDE.md', 'REVIEW.md', '.github/**', '**/package.json']
// Generated or managed files: the guard denies edits (regenerate instead).
export const DEFAULT_PROTECTED_PATHS = ['generated/**', '**/generated/**']
// The approved plan sets the edit scope, so the guard always asks before it changes (checked before the exemptions).
export const PLAN_PATH = '.claude/plans/active.md'
// Files the guard's own bookkeeping writes; never subject to ask/plan checks.
export const GUARD_EXEMPT_PATHS = ['.claude/plans/**', '.claude/governance-log.jsonl']

// Content rules for workflow (B10) files. Findings are { rule, tier, file, line, detail, package? }; tier is 'high'
// (the guard asks, CI fails unless labelled) or 'warning' (reported only).
export { checkWorkflow, isWorkflowPath, TIER } from './workflow-rules.mjs'
// Content rules for npm manifests and lockfiles (B9), in the same finding shape; network lookups live in
// supply-chain-lookups.mjs.
export { checkDependencies, dependencyKind } from './supply-chain-rules.mjs'
// Content rules for changed JS/TS test files (A6): focused, skipped, empty and assertion-free tests, placeholders.
export { checkFakePasses, isTestFile, isJsTsFile } from './fake-pass-rules.mjs'

/**
 * Validates engineering.json → governance.allowlist. Each entry needs a rule ID plus a path glob or a package name,
 * so an entry can't switch a rule off everywhere (a path made only of wildcards, like `**`, is rejected for the same
 * reason). Invalid entries are dropped and reported.
 * @returns {{ entries: { rule: string, path?: string, package?: string }[], problems: string[] }}
 */
export const parseAllowlist = (list) => {
  if (list == null) return { entries: [], problems: [] }
  if (!Array.isArray(list)) return { entries: [], problems: ['"governance.allowlist" must be an array of { rule, path | package, reason } objects'] }
  const entries = []
  const problems = []
  list.forEach((e, i) => {
    const str = (k) => typeof e?.[k] === 'string' && e[k] !== ''
    if (!isPlainObject(e) || !str('rule') || !(str('path') || str('package'))) {
      problems.push(`"governance.allowlist[${i}]" needs a string "rule" and a string "path" or "package"`)
      return
    }
    if (str('path') && /^[*?/]+$/.test(e.path)) {
      problems.push(`"governance.allowlist[${i}]" has a path made of only wildcards ("${e.path}"); name the files it covers`)
      return
    }
    entries.push({ rule: e.rule, ...(str('path') && { path: e.path }), ...(str('package') && { package: e.package }), ...(str('reason') && { reason: e.reason }) })
  })
  return { entries, problems }
}

// R8: a workflow entry suppresses only when its path names one literal file, and never for wf-unparsed (the part of
// the file the checks couldn't read may hide anything). A package-only entry can't match either, since workflow
// findings have no package. Such entries stay valid config but suppress nothing.
const ignoredWorkflowEntry = (e) => e.rule.startsWith('wf-') && (e.path == null || /[*?[{]/.test(e.path) || e.rule === 'wf-unparsed')

// Marks each finding suppressed (true/false), copying the matching entry's reason. Suppressed findings are still
// reported and logged, but never block.
export const applyAllowlist = (findings, entries, ignoreCase = false) => findings.map((f) => {
  const match = entries.find((e) => e.rule === f.rule && !ignoredWorkflowEntry(e)
    && (!e.path || globToRegExp(e.path, ignoreCase).test(f.file))
    && (!e.package || e.package === f.package))
  return { ...f, suppressed: !!match, ...(typeof match?.reason === 'string' && match.reason && { reason: match.reason }) }
})

/**
 * One wf-allowlist-ignored warning for each valid allowlist entry that R8 ignores, naming it by its index in the
 * raw governance.allowlist. Invalid entries are left to parseAllowlist's problems.
 * @returns {{ rule: string, tier: 'warning', file: string, line: number, detail: string, suppressed: false }[]}
 */
export const allowlistWarnings = (list) => (Array.isArray(list) ? list : []).flatMap((raw, i) => {
  const [e] = parseAllowlist([raw]).entries
  if (!e || !ignoredWorkflowEntry(e)) return []
  const why = e.rule === 'wf-unparsed'
    ? 'wf-unparsed findings cannot be allowlisted, since the part of the file the checks could not read may hide anything'
    : e.path == null
      ? 'a workflow entry must name one file in "path"; workflow findings have no package'
      : 'a workflow entry must name one file, with no *, ?, [ or {'
  const target = e.path == null ? `package "${e.package}"` : `path "${e.path}"`
  return [{ rule: 'wf-allowlist-ignored', tier: 'warning', file: '.claude/engineering.json', line: 1, suppressed: false, detail: `"governance.allowlist[${i}]" (${e.rule}, ${target}) suppresses nothing: ${why}.` }]
})

export const blockingFindings = (findings) => findings.filter((f) => f.tier === 'high' && !f.suppressed)

// File names, detail and reason text can come from the PR, so each finding stays on one line (no newlines or control
// characters that could start a workflow command in CI logs) and is capped in length.
export const oneLine = (s, max) => String(s).replace(/[\u0000-\u001f\u007f]+/g, ' ').slice(0, max)

export const formatFinding = (f) => `[${f.rule}, ${f.tier}${f.suppressed ? `, suppressed${f.reason ? `: ${oneLine(f.reason, 200)}` : ''}` : ''}] ${oneLine(f.file, 300)}:${f.line} ${oneLine(f.detail, 300)}`

// Secrets in edited content: [reason, regex source]. Provider formats are near-certain and denied (case-sensitive);
// generic credential assignments are fuzzier and ask (case-insensitive).
export const DENY_CONTENT = [
  // Key material must follow the header, so code and docs that only mention the header are fine.
  ['private key', String.raw`-----BEGIN (?:RSA |EC |DSA |OPENSSH |PGP |ENCRYPTED )?PRIVATE KEY(?: BLOCK)?-----\s*(?:[A-Za-z-]+:[^\n]*\n\s*)*[A-Za-z0-9+/=]{64,}`],
  // No trailing \b: a key run straight into more characters must still be caught.
  ['AWS access key', String.raw`\b(?:AKIA|ASIA)[0-9A-Z]{16}`],
  ['GitHub token', String.raw`\b(?:gh[pousr]_[A-Za-z0-9]{36,}|github_pat_[A-Za-z0-9_]{60,})`],
  ['Anthropic API key', String.raw`\bsk-ant-[A-Za-z0-9_-]{20,}`],
  ['OpenAI API key', String.raw`\bsk-(?:proj-)?[A-Za-z0-9]{32,}`],
  ['Stripe live key', String.raw`\b[sr]k_live_[A-Za-z0-9]{20,}`],
  ['Google API key', String.raw`\bAIza[0-9A-Za-z_-]{35}`],
  ['Slack token', String.raw`\bxox[abposr]-\d{10,}-[A-Za-z0-9-]{10,}`],
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
