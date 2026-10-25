// usiatech-engineering: governance guard decision logic. Pure apart from the injectable git probe and
// dependency lookups, so tests can call evaluate() directly. The hook entry point is governance-guard.mjs.
//
// Decisions: deny (refused) · ask (user must confirm) · null (allow, normal permission flow continues)
// Repo config: .claude/engineering.json  (keys: protectedPaths, immutableWhenCommitted, allowEnvExample, governance{...})
// Approved plan: .claude/plans/active.md  ("## Files" section lists paths/globs in scope)
import { readFileSync, existsSync, lstatSync, statSync, realpathSync, writeFileSync, renameSync, rmSync } from 'node:fs'
import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import os from 'node:os'
import path from 'node:path'
import {
  matchAny, isSecretEnvFile, escapeRegExp, isPlainObject, isStringArray, findSecret, DENY_COMMANDS, ASK_COMMANDS,
  DEFAULT_ASK_PATHS, DEFAULT_PROTECTED_PATHS, GUARD_EXEMPT_PATHS, PLAN_PATH, parseAllowlist, allowlistWarnings,
  checkWorkflow, isWorkflowPath, checkDependencies, dependencyKind, applyAllowlist, blockingFindings, formatFinding, oneLine, TIER,
  isPathPrefix, hasControlChar, GIT_PREFIX,
} from '../../templates/github/scripts/governance-rules.mjs'
import { STATE_FOLDER, stateDir, checkedStateDir, SHELL_TOOLS } from './governance-state.mjs'
import { lookupTargets, runLookups, createLookups } from '../../templates/github/scripts/supply-chain-lookups.mjs'

const EDIT_TOOLS = ['Edit', 'MultiEdit', 'Write', 'NotebookEdit']
const PLAN_ARCHIVE_PATH = '.claude/plans/archive/**'
/** Whether this platform's file system ignores case (used for path matching here and in the after-Bash check). */
export const CASE_INSENSITIVE_FS = ['win32', 'darwin'].includes(process.platform)

// R7: Windows reads "name:stream" and "name::$DATA" as a stream of "name" and drops trailing dots and spaces from
// every folder and file name, so `.github./workflows/x.yml::$DATA` writes `.github/workflows/x.yml`. decideEdit
// runs every in-project path check on this name (ESP-106 R2); paths outside the project keep the raw name.
const windowsCanonical = (rel) => rel.split('/').map((seg) => seg.replace(/:.*$/, '').replace(/[. ]+$/, '')).join('/')

// ESP-9: writes outside the project that need no prompt (still logged, as decision "trusted"). $TMP is the OS temp
// folder, ~ the home folder, {project} the project folder as Claude Code names it (each character other than
// A-Z, a-z, 0-9 becomes "-"). Memory and the scratchpad are trusted for this project only.
const DEFAULT_TRUSTED_WRITE_PATHS = ['$TMP/claude/{project}/**', '~/.claude/projects/{project}/memory/**', '~/.claude/session-data/**']
// A repo list may only name folders under these roots, with at least minLiteral plain folder names after the root,
// so it can't trust Claude Code's own config (~/.claude/**), keys (~/.ssh) or the whole temp folder.
const TRUSTED_ROOTS = [{ prefix: '$TMP/', place: 'tmpDir', minLiteral: 1 }, { prefix: '~/.claude/projects/', place: 'homeDir', minLiteral: 1 }, { prefix: '~/.claude/session-data/', place: 'homeDir', minLiteral: 0 }]
// Never trusted inside a trusted folder: agent config, git internals, hooks, plugins and keys (compared lower-case).
const NEVER_TRUSTED_NAMES = ['settings.json', 'settings.local.json', '.mcp.json', '.claude.json', 'claude.md', 'agents.md']
const NEVER_TRUSTED_SEGMENTS = ['.git', 'hooks', 'plugins', '.ssh']
const GLOB_CHARS = /[*?[{]/
// ESP-21: the after-Bash snapshots live in $TMP/usiatech-governance (STATE_FOLDER in governance-state.mjs). Trusting
// that folder would let an Edit or Write rewrite a snapshot without a prompt and hide a workflow change, so
// trustedEntryProblem refuses it.
/** The repo config file, as named in messages and log entries. */
export const CONFIG_FILE = '.claude/engineering.json'
// A config value quoted in a problem reaches the user and, for an advisory problem, Claude's context, so it is cut
// short and JSON-quoted: a long value or one with line breaks can't pass for anything but a quoted string.
const QUOTED_VALUE_MAX = 60
const quoted = (value) => JSON.stringify(value.length > QUOTED_VALUE_MAX ? `${value.slice(0, QUOTED_VALUE_MAX)}…` : value)
// The most of a warning's problem list that is shown; the list is as long as the config makes it.
const ADVICE_MAX = 1000
// The advisory problems as shown: as many as fit in ADVICE_MAX characters (always the first), then how many more
// there are. The log entry names them all.
const adviceShown = (advisory) => {
  let named = 0
  let length = 0
  for (const problem of advisory) {
    length += problem.length + 2
    if (named && length > ADVICE_MAX) break
    named++
  }
  const more = advisory.length - named
  return `${oneLine(advisory.slice(0, named).join('; '), ADVICE_MAX)}${more ? `; … and ${more} more` : ''}`
}

const trustedEntryProblem = (e) => {
  if (typeof e !== 'string') return 'must be a string'
  const root = TRUSTED_ROOTS.find((r) => e.startsWith(r.prefix))
  if (!root) return `must start with ${TRUSTED_ROOTS.map((r) => r.prefix).join(', ')} (${quoted(e)})`
  // On Windows "\" also separates folders and a name ending in "." or a space loses it ("..." is ".."), so either
  // could climb out of the root once the entry is joined to a real path.
  if (/[\\:]/.test(e)) return `must use "/" only, with no "\\" or ":" (${quoted(e)})`
  const segs = e.slice(root.prefix.length).split('/')
  if (segs.some((s) => !s || /[. ]$/.test(s))) return `must not have an empty folder name or one ending in "." or a space (${quoted(e)})`
  const literal = segs.findIndex((s) => GLOB_CHARS.test(s.replaceAll('{project}', '')))
  if ((literal === -1 ? segs.length : literal) < root.minLiteral) return `must name a folder below ${root.prefix} (${quoted(e)})`
  if (root.place === 'tmpDir' && segs[0].toLowerCase() === STATE_FOLDER) return `must not name the after-Bash snapshot folder $TMP/${STATE_FOLDER} (${quoted(e)})`
  return null
}

// The real path of a file that may not exist yet: its nearest existing parent is resolved, so a link anywhere on
// the way is followed. With a non-native path module (tests), paths are compared as written.
const realOf = (target, p) => {
  if (p !== path) return target
  const tail = []
  let cur = target
  while (!existsSync(cur)) {
    // existsSync follows links, so a link to a missing target looks missing; writing through it creates the target.
    if (lstatSync(cur, { throwIfNoEntry: false })?.isSymbolicLink()) throw new Error(`${cur} is a link to a missing target`)
    const parent = p.dirname(cur)
    if (parent === cur) return target
    tail.unshift(p.basename(cur))
    cur = parent
  }
  return p.join(realpathSync.native(cur), ...tail)
}

// ESP-113 items 7, 10: the long name of a path with an 8.3 segment, through longName (realpathSync.native), or null.
// The nearest existing parent is resolved and the rest kept: a short name that doesn't exist yet is a literal one.
// Any lookup error other than a missing path gives null, so the caller asks.
const SHORT_NAME = /~\d/
const longPathOf = (target, p, longName) => {
  if (!longName) return null
  const tail = []
  for (let cur = target; ; cur = p.dirname(cur)) {
    try {
      return p.join(longName(cur), ...tail)
    } catch (e) {
      if (!['ENOENT', 'ENOTDIR'].includes(e?.code) || p.dirname(cur) === cur) return null
    }
    tail.unshift(p.basename(cur))
  }
}

// Why a plan or archive write can't be trusted under planEdits "all", or null. The file must really be under the
// project's .claude/plans: not reached through a link or junction, and not a hard link sharing content elsewhere.
const planLinkProblem = (rel, root, p) => {
  if (p !== path) return null
  try {
    const real = realOf(p.join(root, rel), p)
    const inside = p.relative(p.join(realOf(root, p), '.claude', 'plans'), real)
    if (inside.startsWith('..') || p.isAbsolute(inside)) return `"${rel}" resolves outside .claude/plans through a link or junction.`
    if ((statSync(real, { throwIfNoEntry: false })?.nlink ?? 1) > 1) return `"${rel}" is a hard link to another file.`
    return null
  } catch (e) {
    return `could not check "${rel}" for links: ${e?.message || e}.`
  }
}

// The trusted entry an outside-project write falls under, or null. Only the temp and home folders themselves are
// resolved to real paths, so a link inside them (e.g. session-data pointing at ~/.claude) is never trusted.
const trustedWriteEntry = (file, gov, root, p, ic, places) => {
  const real = realOf(p.resolve(root, file), p)
  // A hard link shares its content with a file elsewhere, which a write would change in place.
  if (p === path && (statSync(real, { throwIfNoEntry: false })?.nlink ?? 1) > 1) return null
  const project = root.replace(/[^A-Za-z0-9]/g, '-')
  for (const entry of gov.trustedWritePaths ?? DEFAULT_TRUSTED_WRITE_PATHS) {
    const { prefix, place } = TRUSTED_ROOTS.find((r) => entry.startsWith(r.prefix))
    // The entry after its "$TMP/" or "~/" marker, relative to the temp or home folder.
    const segs = entry.slice(prefix.indexOf('/') + 1).replaceAll('{project}', project).split('/')
    // The plain folders before the first glob are the base; an entry with no glob names one file in its last folder.
    const firstGlob = segs.findIndex((s) => GLOB_CHARS.test(s))
    const literal = firstGlob === -1 ? segs.length - 1 : firstGlob
    const base = p.join(realOf(places[place], p), ...segs.slice(0, literal))
    const rel = p.relative(base, real)
    if (!rel || rel.startsWith('..') || p.isAbsolute(rel)) continue
    const relPosix = rel.split(p.sep).join('/')
    const parts = relPosix.toLowerCase().split('/')
    // Windows drops a trailing "." or space and reads "name::$DATA" as name, so such a name could stand in for a
    // never-trusted one; it is never trusted either. Nor is a device name (CON, NUL, COM1…), which is not a file.
    const disguised = (s) => s.includes(':') || /[. ]$/.test(s) || /^(con|prn|aux|nul|com\d|lpt\d|conin\$|conout\$)(\..*)?$/.test(s)
    if (parts.some((s) => disguised(s) || NEVER_TRUSTED_SEGMENTS.includes(s)) || NEVER_TRUSTED_NAMES.includes(parts.at(-1))) return null
    if (matchAny(relPosix, [segs.slice(literal).join('/')], ic)) return entry
  }
  return null
}

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
 * ESP-67 (spec R9, R12): `planning.preflightReviewers` is read by the approve-plan skill, not by the guard, so every
 * problem is advisory. A bad `planning` or list is dropped; a bad entry is dropped on its own.
 * ESP-72: the skill names the agent in its pre-flight report, so a name with a control character or surrounding spaces
 * is a bad entry. A null `when` and an unknown key are reported, and the entry is kept (it then runs on every plan).
 */
const ENTRY_KEYS = ['agent', 'when', '$comment']
// JSON.stringify leaves U+0085, U+2028 and U+2029 raw, and oneLine keeps them, so they are escaped here.
const quoteKey = (key) => [...JSON.stringify(key)]
  .map((c) => ([133, 8232, 8233].includes(c.codePointAt(0)) ? `\\u${c.codePointAt(0).toString(16).padStart(4, '0')}` : c))
  .join('')

const checkPlanning = (cfg, advise) => {
  if (cfg.planning == null) return
  if (!isPlainObject(cfg.planning)) { advise('"planning" must be an object'); delete cfg.planning; return }
  const list = cfg.planning.preflightReviewers
  if (list == null) return
  cfg.planning = { ...cfg.planning }
  if (!Array.isArray(list)) {
    advise('"planning.preflightReviewers" must be an array of { agent, when } objects')
    delete cfg.planning.preflightReviewers
    return
  }
  cfg.planning.preflightReviewers = list.flatMap((entry, i) => {
    const label = `"planning.preflightReviewers[${i}]`
    if (isPlainObject(entry)) {
      for (const key of Object.keys(entry).filter((k) => !ENTRY_KEYS.includes(k))) {
        advise(`${label}" has an unknown key ${quoteKey(key)} (allowed: "agent", "when", "$comment")`)
      }
    }
    if (!isPlainObject(entry) || typeof entry.agent !== 'string' || !entry.agent.trim()) {
      advise(`${label}" needs a non-empty string "agent"`)
      return []
    }
    if (hasControlChar(entry.agent) || entry.agent !== entry.agent.trim()) {
      advise(`${label}.agent" must have no control characters and no spaces at either end`)
      return []
    }
    if (entry.when === null) {
      advise(`${label}.when" is null, so the reviewer runs on every plan; remove it or list path prefixes`)
      const { when, ...rest } = entry
      return [rest]
    }
    if (entry.when !== undefined && !(Array.isArray(entry.when) && entry.when.length && entry.when.every(isPathPrefix))) {
      advise(`${label}.when" must be a non-empty list of path prefixes, relative to the repo root with forward slashes (for example "src/")`)
      return []
    }
    return [entry]
  })
}

/**
 * Checks the shape of the keys the guard reads. Invalid keys are reported and dropped (so defaults apply), or
 * replaced by their strictest value where the default would be looser; invalid command rules are dropped one by one.
 * Never throws.
 * ESP-35 R1: a problem is advisory when the guard doesn't read the key or dropping the value makes the guard
 * stricter, and escalating when dropping it could weaken the guard. `problems` holds both, in the order found.
 * @returns {{ cfg: object, gov: object, repoRules: { deny: string[][], ask: string[][] }, problems: string[], advisory: string[], escalating: string[] }}
 */
export const sanitizeConfig = (raw) => {
  const problems = []
  const advisory = []
  const escalating = []
  const report = (list) => (...found) => { list.push(...found); problems.push(...found) }
  const advise = report(advisory)
  const escalate = report(escalating)
  const cfg = isPlainObject(raw) ? { ...raw } : {}
  let gov = cfg.governance ?? {}
  if (!isPlainObject(gov)) { escalate('"governance" must be an object'); gov = {} }
  gov = { ...gov }
  cfg.governance = gov
  if (cfg.git != null && !isPlainObject(cfg.git)) { escalate('"git" must be an object'); delete cfg.git }
  if (cfg.git?.releaseBranch != null && (typeof cfg.git.releaseBranch !== 'string' || !cfg.git.releaseBranch)) {
    escalate('"git.releaseBranch" must be a non-empty string')
    cfg.git = { ...cfg.git }
    delete cfg.git.releaseBranch
  }
  // ESP-12: read by the approve-plan and release skills, not by the guard; checked here so a typo is reported.
  if (cfg.decisions != null && !isPlainObject(cfg.decisions)) { advise('"decisions" must be an object'); delete cfg.decisions }
  for (const key of ['batch', 'nitsNeedDecision']) {
    if (cfg.decisions?.[key] == null || typeof cfg.decisions[key] === 'boolean') continue
    advise(`"decisions.${key}" must be true or false`)
    cfg.decisions = { ...cfg.decisions }
    delete cfg.decisions[key]
  }
  checkPlanning(cfg, advise)

  for (const [obj, key, label] of [[cfg, 'protectedPaths'], [cfg, 'immutableWhenCommitted'], [gov, 'askPaths', 'governance.askPaths'], [gov, 'protectedBranches', 'governance.protectedBranches']]) {
    if (obj[key] == null) continue
    if (!isStringArray(obj[key])) { escalate(`"${label || key}" must be an array of strings`); delete obj[key] }
  }

  const compile = (key, fallback) => {
    const list = gov[key]
    if (list == null) return []
    if (!Array.isArray(list)) { escalate(`"governance.${key}" must be an array of { pattern, reason } objects`); return [] }
    return list.flatMap((r, i) => {
      if (!isPlainObject(r) || typeof r.pattern !== 'string' || !r.pattern) {
        escalate(`"governance.${key}[${i}]" needs a non-empty string "pattern"`)
        return []
      }
      try { new RegExp(r.pattern, 'i') } catch (e) {
        escalate(`invalid command pattern "${r.pattern}": ${e.message}`)
        return []
      }
      return [[typeof r.reason === 'string' && r.reason ? r.reason : fallback, r.pattern]]
    })
  }
  const repoRules = { deny: compile('denyCommands', 'repo deny rule'), ask: compile('askCommands', 'repo ask rule') }
  const allow = parseAllowlist(gov.allowlist)
  // Dropping a bad entry only brings back the findings it would have hidden.
  advise(...allow.problems)
  // R8: named by their index in the raw list, so worked out before the invalid entries are dropped.
  gov.allowlistWarnings = allowlistWarnings(gov.allowlist)
  gov.allowlist = allow.entries
  if (gov.planEdits != null && !['allow', 'ask', 'all'].includes(gov.planEdits)) {
    // R2: "ask", the strictest value, so an unknown value can't make plan edits looser.
    advise('"governance.planEdits" must be "allow", "ask" or "all"')
    gov.planEdits = 'ask'
  }
  if (gov.trustedWritePaths != null) {
    if (!Array.isArray(gov.trustedWritePaths)) {
      // No path is trusted, the strictest value: the defaults would trust more than a valid empty list.
      advise('"governance.trustedWritePaths" must be an array of strings')
      gov.trustedWritePaths = []
    } else {
      gov.trustedWritePaths = gov.trustedWritePaths.filter((e, i) => {
        const why = trustedEntryProblem(e)
        if (why) advise(`"governance.trustedWritePaths[${i}]" ${why}`)
        return !why
      })
    }
  }
  return { cfg, gov, repoRules, problems, advisory, escalating }
}

/**
 * ESP-35 R5: where the guard remembers which advisory config problems it has already shown for a project: the
 * project's state folder (governance-state.mjs), which no trusted write path may name. The marker can only hide an
 * advisory warning; it never changes a decision.
 */
export const configMarkerPath = (root) => path.join(stateDir(root), 'config-warned')

// A sha256 in hex is 64 bytes; anything bigger, or not a regular file, was not written by recordAdvice.
const MARKER_MAX_BYTES = 64

// The hash of the set last shown, or null when there is no marker that can be used (R7: the warning is then shown).
// Checked before it is opened: in a shared POSIX /tmp another user could have put a pipe or a huge file there.
const readMarker = (markerFile) => {
  try {
    if (!checkedStateDir(path.dirname(markerFile), { create: false })) return null
    const st = lstatSync(markerFile)
    return st.isFile() && st.size <= MARKER_MAX_BYTES ? readFileSync(markerFile, 'utf8') : null
  } catch {
    // A missing or unusable marker means the warning is shown; one that stays unusable fails the write in recordAdvice.
    return null
  }
}

// Writes the marker in a private folder that can be trusted; throws when it can't.
const writeMarker = (markerFile, hash) => {
  checkedStateDir(path.dirname(markerFile), { create: true })
  // Written beside the marker and renamed over it, so a link left at either name is replaced, not followed.
  const draft = `${markerFile}.${process.pid}.tmp`
  rmSync(draft, { force: true })
  writeFileSync(draft, hash, { flag: 'wx', mode: 0o600 })
  try {
    renameSync(draft, markerFile)
  } catch (e) {
    try {
      rmSync(draft, { force: true })
    } catch (cleanup) {
      e.message = `${e.message} (and the draft could not be removed: ${cleanup.message})`
    }
    throw e
  }
}

/**
 * ESP-35 R4, R5, R7: whether the advisory config problems are due to be shown. They are due the first time a given
 * set is seen; the marker holds a hash of the last set shown. With no problems the marker is removed, so the same
 * problem warns again when it comes back. Nothing is recorded here: the caller logs the warning and then calls
 * recordAdvice, so a warning that couldn't be logged is due again next time. Never throws.
 * @param {string[]} advisory  from sanitizeConfig
 * @param {string} markerFile  from configMarkerPath
 * @returns {{ warning: string|null, logReason: string|null, hash: string|null, markerError: string|null }}
 *   warning: the message to show, its problem list capped. logReason: the same with every problem named, for the
 *   `warn` log entry. hash: what recordAdvice takes. markerError: an old marker couldn't be removed.
 */
export const pendingAdvice = (advisory, markerFile) => {
  const none = { warning: null, logReason: null, hash: null, markerError: null }
  if (!advisory.length) {
    try {
      // Removed only from a folder that can be trusted, like the read and the write; no folder means no marker.
      if (checkedStateDir(path.dirname(markerFile), { create: false })) rmSync(markerFile, { force: true })
      return none
    } catch (e) {
      return { ...none, markerError: `could not clear the config-warning marker ${markerFile}: ${e?.message || e}` }
    }
  }
  const hash = createHash('sha256').update([...advisory].sort().join('\n')).digest('hex')
  if (readMarker(markerFile) === hash) return none
  const text = (list) => `Config warning: ${list}. Each value is ignored or replaced by its strictest setting, and the guard doesn't ask because of it. Fix ${CONFIG_FILE} to clear this; it is shown once per change.`
  return { warning: text(adviceShown(advisory)), logReason: text(oneLine(advisory.join('; '))), hash, markerError: null }
}

/**
 * Records that the warning pendingAdvice returned was logged, so it isn't shown again for the same set. Never throws.
 * @returns {string|null} why the marker couldn't be written (the warning will be repeated), or null
 */
export const recordAdvice = (markerFile, hash) => {
  try {
    writeMarker(markerFile, hash)
    return null
  } catch (e) {
    return `could not record that the config warning was shown, so it will be repeated: ${e?.message || e}`
  }
}

// Splits a plan at each heading (# to ######). Lines before the first heading form a section with name null.
const planSections = (text) => {
  const sections = [{ heading: null, name: null, lines: [] }]
  for (const l of text.split(/\r?\n/)) {
    if (/^#{1,6}\s/.test(l)) sections.push({ heading: l, name: l.replace(/^#{1,6}\s+/, ''), lines: [] })
    else sections.at(-1).lines.push(l)
  }
  return sections
}
const isSection = (s, re) => s.name != null && re.test(s.name)

export const planFiles = (root) => {
  const f = path.join(root, ...PLAN_PATH.split('/'))
  if (!existsSync(f)) return null
  const globs = []
  for (const s of planSections(readFileSync(f, 'utf8')).filter((x) => isSection(x, /^files\b/i))) {
    for (const l of s.lines) {
      const m = l.match(/^\s*[-*]\s+`?([^`\s]+)`?/)
      if (m) globs.push(m[1].replace(/^\.\//, ''))
    }
  }
  return globs
}

// Drops each `Evidence:` bullet and the lines indented deeper than it.
const withoutEvidence = (lines) => {
  const out = []
  let indent = -1
  for (const l of lines) {
    const lead = l.match(/^\s*/)[0].length
    if (indent >= 0 && l.trim() && lead > indent) continue
    indent = -1
    const m = l.match(/^(\s*)[-*]\s+Evidence:/)
    if (m) { indent = m[1].length; continue }
    out.push(l)
  }
  return out
}

// ESP-9: the plan with the parts that don't set scope blanked out: the Change log, task tick state and the Evidence
// blocks under Acceptance criteria. Headings always stay, so an added or renamed section shows up as a change.
const scopeView = (text) => planSections(text).flatMap((s) => {
  if (isSection(s, /^change\s*log\b/i)) return [s.heading]
  if (isSection(s, /^tasks\b/i)) return [s.heading, ...s.lines.map((l) => l.replace(/^(\s*[-*]\s+)\[[ xX]\]/, '$1[ ]'))]
  if (isSection(s, /^acceptance criteria\b/i)) return [s.heading, ...withoutEvidence(s.lines)]
  return [s.heading, ...s.lines]
}).join('\n')

// True when an edit to an existing plan leaves its scope view unchanged. A new plan, or an edit whose result can't
// be worked out, is never evidence-only. Nor is a plan that can't be read: the edit goes on to the plan-scope ask.
const evidenceOnlyPlanEdit = (rel, tool, ti, root, p) => {
  let edit
  try {
    edit = readEdit(rel, tool, ti, root, p)
  } catch {
    return false
  }
  return edit.before != null && edit.content != null && scopeView(edit.before) === scopeView(edit.content)
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
  new RegExp(String.raw`${GIT_PREFIX}push\b[^;&|]*(\s["']?|:["']?|refs/heads/)${escapeRegExp(branch)}["']?(?=\s|$|[;&|])`).test(cmd)

const SNAPSHOT_COMMAND = /usiatech-governance|bash-wf-/i
// ESP-110 item 5: some rules are quadratic, and a guard timeout fails open, so a longer command is asked unchecked.
const MAX_COMMAND_CHARS = 16 * 1024
// Over this (after squeezing space padding, as denyPieces does), even the pieces and decoded forms are too many to
// check in time, so the command is denied unchecked: asking would let other padding turn a deny into an ask.
const MAX_TOTAL_CHARS = 64 * MAX_COMMAND_CHARS
// ESP-110 item 9: the command as the shell reads it, without backtick, caret or backslash escapes, quotes or a .exe
// suffix, so `--no-ver`ify`, `'--for''ce'`, cmd's `r^d` and `git.exe` match like the plain spelling.
const unescaped = (cmd) => cmd.replace(/[`'"^]|\\(?=[a-z])|(?<=\w)\.exe\b/gi, '')

// ESP-113 item 6: a longer command is still checked for denies, in pieces of up to 4 KB cut before ; & or a line
// break (the rules don't reach past those), so padding can't hide one; it is then asked whatever the result.
// shortcut: a single part over 4 KB is skipped unchecked; split it further if that is ever used to hide a delete.
const MAX_PART_CHARS = 4 * 1024
// Runs of spaces or tabs don't change what a rule matches, so padding made of them is squeezed out first.
const squeezeSpaces = (c) => c.replace(/[ \t]{2,}/g, ' ')
const denyPieces = (c) => {
  if (c.length <= MAX_COMMAND_CHARS) return [c]
  const squeezed = squeezeSpaces(c)
  if (squeezed.length <= MAX_COMMAND_CHARS) return [squeezed]
  const pieces = []
  let piece = ''
  for (const part of squeezed.split(/(?=[;&\n])/)) {
    const fits = part.length <= MAX_PART_CHARS
    if (piece && (!fits || piece.length + part.length > MAX_PART_CHARS)) {
      pieces.push(piece)
      piece = ''
    }
    if (fits) piece += part
  }
  return piece ? [...pieces, piece] : pieces
}

// ESP-113 item 9: the text of each `-EncodedCommand` (any prefix of the name, or -ec) in a command that names
// PowerShell, or null for one the guard can't read: a value that isn't literal base64 or clean UTF-16 text.
// The flag is looked for anywhere, so another tool's -e in the same command fails closed (asked). PowerShell also
// takes -- and dash characters as the flag prefix, a quoted value may hold whitespace (base64 decoding skips it),
// and a decoded text is read again for its own encoded command, up to MAX_ENCODED_DEPTH levels, then asked.
// The value is read in a lookahead, so another -e flag (`-ep -e …`) doesn't swallow the encoded flag as its value.
// A flag may also be a group or array element, ended by `,`, `;`, `)` or the next group: `@('-e';'…')`, `('-e')('…')`.
const ENCODED_FLAG = /[\s(,;](?:--?|[\/–—―])(e[a-z]*)(?=(?:\)?\s*[,;(]\s*|\)?\s+|:)("[^"]*"|'[^']*'|[^\s;&|),]*))/gi
const MAX_ENCODED_DEPTH = 3
const encodedCommands = (cmd, depth = 0) => {
  if (!/\b(?:powershell|pwsh)\b/i.test(cmd)) return []
  const values = [...cmd.matchAll(ENCODED_FLAG)]
    .filter(([, flag]) => 'encodedcommand'.startsWith(flag.toLowerCase()) || flag.toLowerCase() === 'ec')
    .map(([, , value]) => value.replace(/^["']|["']$/g, '').replace(/\s+/g, ''))
  if (values.length && depth >= MAX_ENCODED_DEPTH) return [null]
  return values.flatMap((b64) => {
    if (!/^[a-z0-9+/]+={0,2}$/i.test(b64) || b64.length % 4) return [null]
    const bytes = Buffer.from(b64, 'base64')
    const text = bytes.toString('utf16le')
    if (bytes.length % 2 || /[\u0000-\u0008\u000e-\u001f�\ud800-\udfff]/.test(text)) return [null]
    return [text, ...[text, unescaped(text)].flatMap((t) => encodedCommands(t, depth + 1))]
  })
}

const decideBash = (cmd, { cfg, gov, repoRules }, git, root) => {
  if (squeezeSpaces(cmd).length > MAX_TOTAL_CHARS) return decision('deny', `Blocked: the command is over ${MAX_TOTAL_CHARS / 1024 / 1024} MB, too long for the guard to check. Write it to a script file and run that instead.`, cmd)
  // The unescaped form too, so a quoted or split flag or name (`'-enc'`, `-e''nc`, `p''owershell`) is still read.
  const encoded = [cmd, unescaped(cmd)].flatMap((c) => encodedCommands(c))
  const decoded = encoded.filter((t) => t !== null)
  const forms = [cmd, ...decoded].flatMap((c) => [c, unescaped(c)])
  const matches = (re) => forms.some((c) => new RegExp(re, 'i').test(c))
  const pieces = forms.flatMap(denyPieces)
  for (const [why, re] of [...DENY_COMMANDS, ...repoRules.deny]) {
    if (pieces.some((piece) => new RegExp(re, 'i').test(piece))) return decision('deny', `Blocked: ${why}.`, cmd)
  }
  if (forms.some((c) => c.length > MAX_COMMAND_CHARS)) return decision('ask', `The command is over ${MAX_COMMAND_CHARS / 1024} KB, too long for the guard to check fully. Confirm it is part of the approved plan.`, cmd)
  if (encoded.includes(null)) return decision('ask', 'The command has a PowerShell -EncodedCommand the guard could not decode. Confirm it is part of the approved plan.', cmd)
  const protectedBranches = gov.protectedBranches || [cfg.git?.releaseBranch || 'main', 'master']
  const gitAction = forms.map((c) => c.match(new RegExp(String.raw`${GIT_PREFIX}(commit|merge|push)\b`))).find(Boolean)
  if (gitAction) {
    const branch = git.currentBranch(root)
    if (branch && protectedBranches.includes(branch)) return decision('ask', `Git ${gitAction[1]} while on protected branch "${branch}". Work should happen on a feature branch.`, cmd)
    for (const b of protectedBranches) {
      if (forms.some((c) => pushTargets(c, b))) return decision('ask', `Push to protected branch "${b}".`, cmd)
    }
  }
  for (const [why, re] of [...ASK_COMMANDS, ...repoRules.ask]) {
    if (matches(re)) return decision('ask', `Risky action: ${why}. Confirm it is part of the approved plan.`, cmd)
  }
  // R6: the after-Bash check trusts its snapshot, so a command that could rewrite one needs confirmation.
  if (forms.some((c) => SNAPSHOT_COMMAND.test(c))) return decision('ask', 'The command names the after-Bash workflow snapshots (usiatech-governance, bash-wf-*), which could hide a workflow change. Confirm it is part of the approved plan.', cmd)
  return null
}

// ESP-9: an edit outside the project asks, unless it falls under a trusted write path. A trusted write still gets
// the env-file and secret checks, and is returned as an allow (decision null) that logEntries records as "trusted".
const decideOutsideEdit = (file, gov, root, p, ic, tool, ti, places, cfg) => {
  if (p.sep === '\\' && SHORT_NAME.test(file)) {
    const long = longPathOf(p.resolve(root, file), p, places.longName)
    if (!long || SHORT_NAME.test(long)) return decision('ask', `Edit outside the project folder (${file}) through a Windows short name (8.3) the guard could not resolve.`, file)
    const result = decideOutsideEdit(long, gov, root, p, ic, tool, ti, places, cfg)
    return result && { ...result, target: file }
  }
  let entry
  // Fail closed: a lookup that throws (an unreadable folder, a link loop, a dangling link) must not reach the hook's
  // fail-open catch, since an outside edit asked before trusted write paths existed.
  try {
    entry = trustedWriteEntry(file, gov, root, p, ic, places)
  } catch (e) {
    return decision('ask', `Edit outside the project folder (${file}). The guard could not check it against the trusted write paths: ${e?.message || e}.`, file)
  }
  if (!entry) return decision('ask', `Edit outside the project folder (${file}).`, file)
  if (isSecretEnvFile(p.basename(file), cfg.allowEnvExample !== false, ic)) return decision('deny', 'Env files hold secrets.', file)
  const secret = findSecret(editedText(tool, ti))
  if (secret?.decision === 'deny') return decision('deny', `The edit writes what looks like a ${secret.why}. Keep secrets in env files or a secret manager.`, file)
  if (secret) return decision('ask', `The edit looks like it hard-codes a ${secret.why}. Confirm it is not a real secret.`, file)
  return { ...decision(null, `Trusted write path "${entry}".`, file), trusted: true }
}

const decideEdit = async (file, { cfg, gov }, git, root, p, ic, tool, ti, net, places) => {
  // ESP-113 item 7: an existing 8.3 path is decided as its long name, if that stays in the project; otherwise the
  // short-name asks below apply. The path as written is resolved, so a short spelling of the project folder itself
  // (`C:\REPO~1\x`) is still read as inside it.
  if (p.sep === '\\' && SHORT_NAME.test(file)) {
    const long = longPathOf(p.resolve(root, file), p, places.longName)
    const longRoot = long && longPathOf(root, p, places.longName)
    const longRel = longRoot && p.relative(longRoot, long)
    if (longRel && !longRel.startsWith('..') && !p.isAbsolute(longRel) && !SHORT_NAME.test(longRel)) {
      const result = await decideEdit(longRel, { cfg, gov }, git, root, p, ic, tool, ti, net, places)
      return result && { ...result, target: file }
    }
  }
  const relNative = p.relative(root, p.resolve(root, file))
  // On Windows a path on another drive comes back absolute rather than starting with "..".
  if (relNative.startsWith('..') || p.isAbsolute(relNative)) return decideOutsideEdit(file, gov, root, p, ic, tool, ti, places, cfg)
  const rel = relNative.split(p.sep).join('/')
  // R2 (ESP-106): decide a variant as the file it writes; the decision keeps the name as written, so the log shows it.
  if (p.sep === '\\' && windowsCanonical(rel) !== rel) {
    const result = await decideEdit(windowsCanonical(rel), { cfg, gov }, git, root, p, ic, tool, ti, net, places)
    return result && { ...result, target: rel }
  }

  if (isSecretEnvFile(path.posix.basename(rel), cfg.allowEnvExample !== false, ic)) return decision('deny', 'Env files hold secrets.', rel)
  const prot = matchAny(rel, cfg.protectedPaths || DEFAULT_PROTECTED_PATHS, ic)
  if (prot) return decision('deny', `Protected path "${prot}" (generated or managed file; regenerate instead).`, rel)
  for (const g of cfg.immutableWhenCommitted || []) {
    if (matchAny(rel, [g], ic) && existsSync(p.join(root, rel)) && git.isTracked(root, rel)) {
      return decision('deny', `"${rel}" matches "${g}" and is already committed; create a new file instead.`, rel)
    }
  }
  // ESP-110 item 10: an 8.3 short name (AGENTS~1.MD) may stand for any long name, so the path checks can't see it.
  // It is one of the ask reasons below, so it never turns a deny into an ask or hides another ask.
  const shortName = p.sep === '\\' && SHORT_NAME.test(rel)

  // Before the plan/exempt/ask checks: a secret is never fine, wherever it is written.
  const secret = findSecret(editedText(tool, ti))
  if (secret?.decision === 'deny') return decision('deny', `The edit writes what looks like a ${secret.why}. Keep secrets in env files or a secret manager.`, rel)
  const kind = isWorkflowPath(rel) ? 'workflow' : dependencyKind(rel) ? 'dependency' : null
  const { findings, failures } = kind === 'workflow' ? { findings: workflowFindings(rel, tool, ti, gov, root, p, ic), failures: [] }
    : kind === 'dependency' ? await dependencyFindings(rel, tool, ti, gov, root, p, ic, net)
    : { findings: [], failures: [] }
  const blocking = blockingFindings(findings)
  // ESP-24: under "all" every plan and archive write is trusted; the secret ask above and the denies before it still win.
  // A path that leaves .claude/plans through a link asks instead (R9).
  const allPlan = gov.planEdits === 'all' && matchAny(rel, [PLAN_PATH, PLAN_ARCHIVE_PATH], ic)
  const linkProblem = allPlan && planLinkProblem(rel, root, p)
  const scope = linkProblem ? decision('ask', `Plan or archive write not trusted by governance.planEdits "all": ${linkProblem}`, rel)
    : allPlan ? { ...decision(null, 'Plan or archive write trusted by governance.planEdits "all".', rel), trusted: true }
    : matchAny(rel, [PLAN_PATH], ic) && gov.planEdits !== 'ask' && evidenceOnlyPlanEdit(rel, tool, ti, root, p)
      ? { ...decision(null, 'The plan edit only changes evidence, task ticks or the change log.', rel), trusted: true }
      : decideScope(rel, gov, root, ic)
  // A credential or content ask must not hide a scope or governance ask; the user confirms them all at once.
  const reasons = [
    shortName && `"${rel}" has a Windows short name (8.3) segment, which may stand for a governance, plan or protected file. Confirm the edit.`,
    secret && `The edit looks like it hard-codes a ${secret.why}. Confirm it is not a real secret.`,
    blocking.length && `The ${kind} change has ${blocking.length} high-risk finding(s).`,
    scope?.decision && scope.reason,
  ].filter(Boolean)
  const result = reasons.length
    ? decision('ask', reasons.join(' Also: ') + (findings.length ? ` Findings: ${findings.map(formatFinding).join(' ')}` : ''), rel)
    : scope?.trusted ? scope
    : findings.length || failures.length ? decision(null, '', rel) : null
  if (result && findings.length) result.findings = findings
  if (result && failures.length) result.failures = failures
  return result
}

// The file as it would be after the edit, or null when that can't be worked out.
const postEditContent = (tool, ti, before) => {
  if (tool === 'Write') return typeof ti.content === 'string' ? ti.content : null
  const edits = tool === 'Edit' ? [ti] : tool === 'MultiEdit' && Array.isArray(ti.edits) ? ti.edits : []
  if (!edits.length) return null
  // An edit whose first old_string is empty creates the file from its new_string.
  let text = before ?? (edits[0]?.old_string === '' ? '' : null)
  if (text == null) return null
  for (const e of edits) {
    if (typeof e?.old_string !== 'string' || typeof e?.new_string !== 'string' || !text.includes(e.old_string)) return null
    text = e.replace_all ? text.split(e.old_string).join(e.new_string) : text.replace(e.old_string, () => e.new_string)
  }
  return text
}

// The file on disk before the edit (the base) and after it (null when that can't be worked out).
// An unreadable file throws: the hook logs it as a fail-open error rather than skipping the checks silently.
const readEdit = (rel, tool, ti, root, p) => {
  const abs = p.join(root, rel)
  const before = existsSync(abs) ? readFileSync(abs, 'utf8') : null
  return { before, content: postEditContent(tool, ti, before) }
}

// Fail closed: without the resulting file the rules can't run, so ask rather than let the edit through unchecked.
const unreadableEdit = (rule, rel, checks) =>
  ({ rule, tier: TIER.HIGH, file: rel, line: 1, suppressed: false, detail: `The guard could not work out the file content after this edit, so the ${checks} checks did not run.` })

// R11: the shared workflow rules run on the post-edit content; the base is the file on disk before the edit.
const workflowFindings = (rel, tool, ti, gov, root, p, ic) => {
  const { before, content } = readEdit(rel, tool, ti, root, p)
  const findings = content == null ? [unreadableEdit('wf-unparsed', rel, 'workflow')]
    : applyAllowlist(checkWorkflow({ file: rel, content, base: before }), gov.allowlist || [], ic)
  return [...findings, ...(gov.allowlistWarnings || [])]
}

// B9: offline dependency rules, then the registry and advisory lookups under the guard's deadline (R13, R14).
// A failed lookup is returned in `failures` for the hook to log; the offline findings stand either way.
// A lockfile edited on its own counts as drift here: the guard sees one file at a time.
const dependencyFindings = async (rel, tool, ti, gov, root, p, ic, net) => {
  const { before, content } = readEdit(rel, tool, ti, root, p)
  if (content == null) return { findings: [unreadableEdit('sc-unparsed', rel, 'dependency')], failures: [] }
  const file = { file: rel, content, base: before }
  const offline = checkDependencies(file)
  // lookupTargets skips a file the parser can't read, so an sc-unparsed file makes no lookups.
  const { findings, failures } = await runLookups({ targets: lookupTargets([file]), lookups: net.lookups ?? createLookups(), deadlineMs: net.deadlineMs })
  return { findings: applyAllowlist([...offline, ...findings], gov.allowlist || [], ic), failures }
}

// Plan, governance-file and plan-scope checks for a project-relative path.
const decideScope = (rel, gov, root, ic) => {
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
 * @param {{ registry: Function, advisories: Function }} [opts.lookups] dependency lookups (stubs in tests; npm by default)
 * @param {number} [opts.lookupDeadlineMs] shared deadline for the lookups (GUARD_DEADLINE_MS by default)
 * @param {string} [opts.markerFile]      the warn-once marker (configMarkerPath); without it advisory config problems aren't reported
 * @param {(p: string) => string} [opts.longName] long-name lookup for 8.3 paths (realpathSync.native with the native path module; a stub in tests)
 * @returns {Promise<{ decision: 'deny'|'ask'|null, reason: string, target: string, findings?: object[], failures?: object[], configWarning?: string, configLogReason?: string, configHash?: string, markerError?: string } | null>}
 *   null, or decision null, means allow. findings (workflow and dependency content checks) and failures (lookups
 *   that failed open) are set whenever there are any, so the hook can log them even when the edit is allowed.
 *   configWarning (advisory config problems due to be shown; the caller logs configLogReason, which names them all,
 *   then passes configHash to recordAdvice) and markerError never change the decision.
 */
export const evaluate = async (input, { root, cfg = {}, configError = null, git = gitProbe, pathApi = path, caseInsensitive = CASE_INSENSITIVE_FS, lookups, lookupDeadlineMs, homeDir = os.homedir(), tmpDir = os.tmpdir(), markerFile, longName = pathApi === path ? realpathSync.native : null }) => {
  const tool = input.tool_name || ''
  const ti = input.tool_input || {}
  const safe = sanitizeConfig(cfg)
  const problems = configError ? [`${CONFIG_FILE} ${configError}`, ...safe.problems] : safe.problems
  const escalating = !!configError || safe.escalating.length > 0

  let result = null
  let target = ''
  if (SHELL_TOOLS.includes(tool)) {
    target = String(ti.command || '')
    result = decideBash(target, safe, git, root)
  } else if (EDIT_TOOLS.includes(tool)) {
    target = ti.file_path || ti.notebook_path || ''
    if (!target) return null
    if (typeof target !== 'string') {
      target = JSON.stringify(target)
      result = decision('ask', 'The edit target is not a file path string. Confirm the edit.', target)
    } else result = await decideEdit(target, safe, git, root, pathApi, caseInsensitive, tool, ti, { lookups, deadlineMs: lookupDeadlineMs }, { homeDir, tmpDir, longName })
  } else return null

  // Advisory problems alone (ESP-35 R1) don't change the decision; they are reported beside it, once per change (R4).
  if (!escalating && markerFile) {
    const { warning, logReason, hash, markerError } = pendingAdvice(safe.advisory, markerFile)
    if (!warning && !markerError) return result
    return { ...(result ?? decision(null, '', target)), ...(warning && { configWarning: warning, configLogReason: logReason, configHash: hash }), ...(markerError && { markerError }) }
  }
  if (!escalating) return result
  // R5: beside an escalating problem the marker is left alone, unless the config was read and has no advisory problem
  // left. Then it is cleared, so a problem fixed now and reintroduced later warns again.
  const markerError = markerFile && !configError && !safe.advisory.length ? pendingAdvice([], markerFile).markerError : null
  // Default deny rules still hold with a broken config; anything else becomes a confirmation, naming every problem.
  if (result?.decision === 'deny') return markerError ? { ...result, markerError } : result
  const warn = `Config problem: ${problems.join('; ')}. Repo-specific rules are not fully applied until it is fixed.`
  const asked = decision('ask', result?.decision ? `${result.reason} ${warn}` : warn, result?.target ?? target)
  if (markerError) asked.markerError = markerError
  if (result?.findings) asked.findings = result.findings
  if (result?.failures) asked.failures = result.failures
  return asked
}

/**
 * The governance-log entries for one decision, in order: an advisory config warning shown now (ESP-35 R4; decision
 * "warn") and a marker that couldn't be cleared (R7; "error"), each content finding (R16), each lookup that failed
 * open (R13; logged as decision "error", like other fail-opens, A11), then the deny or ask itself.
 * @param {Awaited<ReturnType<typeof evaluate>>} result
 * @param {string} tool
 * @returns {object[]}
 */
export const logEntries = (result, tool) => {
  if (!result) return []
  const at = { tool, target: result.target }
  const atConfig = { tool, target: CONFIG_FILE }
  return [
    ...(result.configWarning ? [{ ...atConfig, decision: 'warn', reason: result.configLogReason ?? result.configWarning }] : []),
    ...(result.markerError ? [{ ...atConfig, decision: 'error', reason: result.markerError }] : []),
    ...(result.findings || []).map((f) => ({ ...at, decision: 'finding', rule: f.rule, tier: f.tier, file: f.file, line: f.line, detail: f.detail, suppressed: !!f.suppressed })),
    ...(result.failures || []).map((f) => ({ ...at, decision: 'error', lookup: f.lookup, reason: `lookup failed open (${f.lookup}): ${f.reason}` })),
    ...(result.decision ? [{ ...at, decision: result.decision, reason: result.reason }] : []),
    ...(!result.decision && result.trusted ? [{ ...at, decision: 'trusted', reason: result.reason }] : []),
  ]
}
