// usiatech-engineering: governance guard decision logic. Pure apart from the injectable git probe,
// so tests can call evaluate() directly. The hook entry point is governance-guard.mjs.
//
// Decisions: deny (refused) · ask (user must confirm) · null (allow, normal permission flow continues)
// Repo config: .claude/engineering.json  (keys: protectedPaths, immutableWhenCommitted, allowEnvExample, governance{...})
// Approved plan: .claude/plans/active.md  ("## Files" section lists paths/globs in scope)
import { readFileSync, existsSync } from 'node:fs'
import { execFileSync } from 'node:child_process'
import path from 'node:path'
import {
  matchAny, isSecretEnvFile, escapeRegExp, isPlainObject, isStringArray, findSecret, DENY_COMMANDS, ASK_COMMANDS,
  DEFAULT_ASK_PATHS, DEFAULT_PROTECTED_PATHS, GUARD_EXEMPT_PATHS, PLAN_PATH,
} from '../../templates/github/scripts/governance-rules.mjs'

const EDIT_TOOLS = ['Edit', 'MultiEdit', 'Write', 'NotebookEdit']
const CASE_INSENSITIVE_FS = ['win32', 'darwin'].includes(process.platform)

// Arguments go to git directly (no shell), so file names can't inject commands.
export const gitProbe = {
  currentBranch: (root) => {
    try { return execFileSync('git', ['rev-parse', '--abbrev-ref', 'HEAD'], { cwd: root, stdio: ['ignore', 'pipe', 'ignore'] }).toString().trim() } catch { return '' }
  },
  isTracked: (root, rel) => {
    try { execFileSync('git', ['ls-files', '--error-unmatch', '--', rel], { cwd: root, stdio: 'ignore' }); return true } catch { return false }
  },
}

// Returns { cfg, error }. A missing file is not an error; an unreadable or malformed one is,
// because silently dropping repo rules would weaken the guard without anyone noticing.
export const loadConfig = (root) => {
  const cfgPath = path.join(root, '.claude', 'engineering.json')
  if (!existsSync(cfgPath)) return { cfg: {}, error: null }
  try {
    const cfg = JSON.parse(readFileSync(cfgPath, 'utf8'))
    if (!isPlainObject(cfg)) return { cfg: {}, error: 'not a JSON object' }
    return { cfg, error: null }
  } catch (e) {
    return { cfg: {}, error: `could not be parsed: ${e.message}` }
  }
}

/**
 * Checks the shape of the keys the guard reads. Invalid keys are dropped (so defaults apply) and
 * reported; invalid command rules are dropped one by one. Never throws.
 * @returns {{ cfg: object, gov: object, repoRules: { deny: string[][], ask: string[][] }, problems: string[] }}
 */
export const sanitizeConfig = (raw) => {
  const problems = []
  const cfg = isPlainObject(raw) ? { ...raw } : {}
  let gov = cfg.governance ?? {}
  if (!isPlainObject(gov)) { problems.push('"governance" must be an object'); gov = {} }
  gov = { ...gov }
  cfg.governance = gov
  if (cfg.git != null && !isPlainObject(cfg.git)) { problems.push('"git" must be an object'); delete cfg.git }
  if (cfg.git?.releaseBranch != null && (typeof cfg.git.releaseBranch !== 'string' || !cfg.git.releaseBranch)) {
    problems.push('"git.releaseBranch" must be a non-empty string')
    cfg.git = { ...cfg.git }
    delete cfg.git.releaseBranch
  }

  for (const [obj, key, label] of [[cfg, 'protectedPaths'], [cfg, 'immutableWhenCommitted'], [gov, 'askPaths', 'governance.askPaths'], [gov, 'protectedBranches', 'governance.protectedBranches']]) {
    if (obj[key] == null) continue
    if (!isStringArray(obj[key])) { problems.push(`"${label || key}" must be an array of strings`); delete obj[key] }
  }

  const compile = (key, fallback) => {
    const list = gov[key]
    if (list == null) return []
    if (!Array.isArray(list)) { problems.push(`"governance.${key}" must be an array of { pattern, reason } objects`); return [] }
    return list.flatMap((r, i) => {
      if (!isPlainObject(r) || typeof r.pattern !== 'string' || !r.pattern) {
        problems.push(`"governance.${key}[${i}]" needs a non-empty string "pattern"`)
        return []
      }
      try { new RegExp(r.pattern, 'i') } catch (e) {
        problems.push(`invalid command pattern "${r.pattern}": ${e.message}`)
        return []
      }
      return [[typeof r.reason === 'string' && r.reason ? r.reason : fallback, r.pattern]]
    })
  }
  const repoRules = { deny: compile('denyCommands', 'repo deny rule'), ask: compile('askCommands', 'repo ask rule') }
  return { cfg, gov, repoRules, problems }
}

export const planFiles = (root) => {
  const f = path.join(root, ...PLAN_PATH.split('/'))
  if (!existsSync(f)) return null
  const globs = []
  let inFiles = false
  for (const l of readFileSync(f, 'utf8').split(/\r?\n/)) {
    if (/^#{1,6}\s/.test(l)) { inFiles = /^#{1,6}\s+files\b/i.test(l); continue }
    if (!inFiles) continue
    const m = l.match(/^\s*[-*]\s+`?([^`\s]+)`?/)
    if (m) globs.push(m[1].replace(/^\.\//, ''))
  }
  return globs
}

const decision = (d, reason, target) => ({ decision: d, reason, target })

// The text an edit would write, so content rules can check it. Non-string parts are ignored rather than thrown on.
const editedText = (tool, ti) => {
  const parts = tool === 'Write' ? [ti.content]
    : tool === 'Edit' ? [ti.new_string]
    : tool === 'MultiEdit' ? (Array.isArray(ti.edits) ? ti.edits.map((e) => e?.new_string) : [])
    : tool === 'NotebookEdit' ? [ti.new_source]
    : []
  return parts.filter((s) => typeof s === 'string').join('\n')
}

// A branch is targeted when it appears as a whole refspec token: `origin main`, `HEAD:main`, `refs/heads/main`,
// optionally quoted (`"main"`, `HEAD:"main"`). Forced refspecs (`+main`) fall through to the force-push ask rule.
// A quoted push option that equals the branch name (`-m "main"`) also matches; that only adds a prompt.
const pushTargets = (cmd, branch) =>
  new RegExp(String.raw`\bgit\s+push\b[^;&|]*(\s["']?|:["']?|refs/heads/)${escapeRegExp(branch)}["']?(?=\s|$|[;&|])`).test(cmd)

const decideBash = (cmd, { cfg, gov, repoRules }, git, root) => {
  for (const [why, re] of [...DENY_COMMANDS, ...repoRules.deny]) {
    if (new RegExp(re, 'i').test(cmd)) return decision('deny', `Blocked: ${why}.`, cmd)
  }
  const protectedBranches = gov.protectedBranches || [cfg.git?.releaseBranch || 'main', 'master']
  const gitAction = cmd.match(/\bgit\s+(commit|merge|push)\b/)
  if (gitAction) {
    const branch = git.currentBranch(root)
    if (branch && protectedBranches.includes(branch)) return decision('ask', `Git ${gitAction[1]} while on protected branch "${branch}". Work should happen on a feature branch.`, cmd)
    for (const b of protectedBranches) {
      if (pushTargets(cmd, b)) return decision('ask', `Push to protected branch "${b}".`, cmd)
    }
  }
  for (const [why, re] of [...ASK_COMMANDS, ...repoRules.ask]) {
    if (new RegExp(re, 'i').test(cmd)) return decision('ask', `Risky action: ${why}. Confirm it is part of the approved plan.`, cmd)
  }
  return null
}

const decideEdit = (file, { cfg, gov }, git, root, p, ic, text = '') => {
  const relNative = p.relative(root, p.resolve(root, file))
  // On Windows a path on another drive comes back absolute rather than starting with "..".
  if (relNative.startsWith('..') || p.isAbsolute(relNative)) return decision('ask', `Edit outside the project folder (${file}).`, file)
  const rel = relNative.split(p.sep).join('/')

  if (isSecretEnvFile(path.posix.basename(rel), cfg.allowEnvExample !== false, ic)) return decision('deny', 'Env files hold secrets.', rel)
  const prot = matchAny(rel, cfg.protectedPaths || DEFAULT_PROTECTED_PATHS, ic)
  if (prot) return decision('deny', `Protected path "${prot}" (generated or managed file; regenerate instead).`, rel)
  for (const g of cfg.immutableWhenCommitted || []) {
    if (matchAny(rel, [g], ic) && existsSync(p.join(root, rel)) && git.isTracked(root, rel)) {
      return decision('deny', `"${rel}" matches "${g}" and is already committed; create a new file instead.`, rel)
    }
  }

  // Before the plan/exempt/ask checks: a secret is never fine, wherever it is written.
  const secret = findSecret(text)
  if (secret?.decision === 'deny') return decision('deny', `The edit writes what looks like a ${secret.why}. Keep secrets in env files or a secret manager.`, rel)
  if (secret) return decision('ask', `The edit looks like it hard-codes a ${secret.why}. Confirm it is not a real secret.`, rel)

  // Otherwise a plan could widen its own Files list (e.g. to `**`) and unlock every later edit.
  if (matchAny(rel, [PLAN_PATH], ic)) return decision('ask', `The approved plan sets the edit scope. Changing ${PLAN_PATH} needs explicit confirmation.`, rel)
  if (matchAny(rel, GUARD_EXEMPT_PATHS, ic)) return null
  const hit = matchAny(rel, gov.askPaths || DEFAULT_ASK_PATHS, ic)
  if (hit) return decision('ask', `"${rel}" is a governance, CI or dependency file (${hit}). Changes need explicit confirmation.`, rel)
  const plan = planFiles(root)
  if (plan && plan.length && !matchAny(rel, plan, ic)) return decision('ask', `"${rel}" is not in the approved plan (.claude/plans/active.md → Files). Confirm the scope change or update the plan.`, rel)
  if (!plan && gov.requirePlan) return decision('ask', 'No approved plan is active (.claude/plans/active.md). Run the approve-plan skill first.', rel)
  return null
}

/**
 * Decides what the guard does with one PreToolUse event.
 * @param {object} input  hook stdin payload ({ tool_name, tool_input, cwd })
 * @param {object} opts
 * @param {string} opts.root              project directory
 * @param {object} [opts.cfg]             parsed .claude/engineering.json
 * @param {string|null} [opts.configError] load problem reported by loadConfig
 * @param {typeof gitProbe} [opts.git]    git access (injectable for tests)
 * @param {typeof path} [opts.pathApi]    path module (path.win32 in tests)
 * @param {boolean} [opts.caseInsensitive] match paths ignoring case (defaults to true on Windows/macOS)
 * @returns {{ decision: 'deny'|'ask', reason: string, target: string } | null}  null means allow
 */
export const evaluate = (input, { root, cfg = {}, configError = null, git = gitProbe, pathApi = path, caseInsensitive = CASE_INSENSITIVE_FS }) => {
  const tool = input.tool_name || ''
  const ti = input.tool_input || {}
  const safe = sanitizeConfig(cfg)
  const problems = configError ? [`.claude/engineering.json ${configError}`, ...safe.problems] : safe.problems

  let result = null
  let target = ''
  if (tool === 'Bash') {
    target = String(ti.command || '')
    result = decideBash(target, safe, git, root)
  } else if (EDIT_TOOLS.includes(tool)) {
    target = ti.file_path || ti.notebook_path || ''
    if (!target) return null
    if (typeof target !== 'string') {
      target = JSON.stringify(target)
      result = decision('ask', 'The edit target is not a file path string. Confirm the edit.', target)
    } else result = decideEdit(target, safe, git, root, pathApi, caseInsensitive, editedText(tool, ti))
  } else return null

  // Default deny rules still hold with a broken config; anything else becomes a confirmation.
  if (!problems.length || result?.decision === 'deny') return result
  const warn = `Config problem: ${problems.join('; ')}. Repo-specific rules are not fully applied until it is fixed.`
  return decision('ask', result ? `${result.reason} ${warn}` : warn, result?.target ?? target)
}
