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
  matchAny, isSecretEnvFile, escapeRegExp, isPlainObject, isStringArray, findSecret, DENY_COMMANDS, DROP_DATABASE_RULE, ASK_COMMANDS,
  DEFAULT_ASK_PATHS, DEFAULT_PROTECTED_PATHS, GUARD_EXEMPT_PATHS, PLAN_PATH, parseAllowlist, allowlistWarnings,
  checkWorkflow, isWorkflowPath, checkDependencies, dependencyKind, applyAllowlist, blockingFindings, formatFinding, oneLine, TIER,
  isPathPrefix, CONTROL_CODE_POINTS, GIT_PREFIX,
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
// A-Z, a-z, 0-9 becomes "-"). Memory and the scratchpad are trusted for this project only. ESP-125: {uid} is the
// user's numeric id, since Claude Code on Linux keeps the scratchpad in /tmp/claude-<uid>; with no uid (Windows) an
// entry naming it trusts nothing.
const DEFAULT_TRUSTED_WRITE_PATHS = ['$TMP/claude/{project}/**', '$TMP/claude-{uid}/{project}/**', '~/.claude/projects/{project}/memory/**', '~/.claude/session-data/**', '~/.claude/plans/**']
const PLACEHOLDERS = /\{(project|uid)\}/g
// A repo list may only name folders under these roots, with at least minLiteral plain folder names after the root,
// so it can't trust Claude Code's own config (~/.claude/**), keys (~/.ssh) or the whole temp folder.
const TRUSTED_ROOTS = [{ prefix: '$TMP/', place: 'tmpDir', minLiteral: 1 }, { prefix: '~/.claude/projects/', place: 'homeDir', minLiteral: 1 }, { prefix: '~/.claude/session-data/', place: 'homeDir', minLiteral: 0 }, { prefix: '~/.claude/plans/', place: 'homeDir', minLiteral: 0 }]
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
  const literal = segs.findIndex((s) => GLOB_CHARS.test(s.replace(PLACEHOLDERS, '')))
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
    if (entry.includes('{uid}') && !Number.isInteger(places.uid)) continue
    const { prefix, place } = TRUSTED_ROOTS.find((r) => entry.startsWith(r.prefix))
    // The entry after its "$TMP/" or "~/" marker, relative to the temp or home folder.
    const values = { project, uid: String(places.uid) }
    const segs = entry.slice(prefix.indexOf('/') + 1).replace(PLACEHOLDERS, (_, name) => values[name]).split('/')
    // The plain folders before the first glob are the base; an entry with no glob names one file in its last folder.
    const firstGlob = segs.findIndex((s) => GLOB_CHARS.test(s))
    const literal = firstGlob === -1 ? segs.length - 1 : firstGlob
    const base = p.join(realOf(places[place], p), ...segs.slice(0, literal))
    // ESP-125: in a shared temp folder another user could create the entry's first folder before Claude Code does.
    if (place === 'tmpDir' && p === path && Number.isInteger(places.uid)) {
      const owner = statSync(p.join(realOf(places.tmpDir, p), segs[0]), { throwIfNoEntry: false })?.uid
      if (owner !== undefined && owner !== places.uid) continue
    }
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
  // ESP-82 R12: the top level of the linked worktree of this repository that holds `file`, or null. A worktree counts
  // only when git confirms all three: its common directory is the main checkout's, it isn't the main checkout, and
  // `git worktree list` from the main checkout names it (a hand-made .git file isn't listed). Any git failure is null,
  // so the edit gets the asks it had before.
  linkedWorktree: (root, file) => {
    const read = (cwd, args) => execFileSync('git', args, { cwd, stdio: ['ignore', 'pipe', 'ignore'] }).toString()
    const dir = existingFolder(path.resolve(root, file))
    if (!dir) return null
    try {
      // Cheapest check first: a folder outside any repo fails here, after one git call.
      const top = read(dir, ['rev-parse', '--show-toplevel']).trim()
      if (samePath(top, root)) return null
      // The project folder can be a subfolder of its checkout (a monorepo), so a file in that same checkout is not
      // in another worktree even when `top` differs from root.
      if (samePath(top, read(root, ['rev-parse', '--show-toplevel']).trim())) return null
      const commonDir = (cwd) => read(cwd, ['rev-parse', '--path-format=absolute', '--git-common-dir']).trim()
      const fileCommon = commonDir(dir)
      if (!samePath(fileCommon, commonDir(root))) return null
      // The main checkout's git dir is the common dir: it is never a linked worktree, even from a project in one.
      if (samePath(read(dir, ['rev-parse', '--path-format=absolute', '--git-dir']).trim(), fileCommon)) return null
      // AGENTS.md F6: paths read raw, split on \0.
      const listed = read(root, ['-c', 'core.quotePath=false', 'worktree', 'list', '--porcelain', '-z']).split('\0')
        .filter((line) => line.startsWith('worktree ')).map((line) => line.slice('worktree '.length))
      if (!listed.some((w) => samePath(w, top))) return null
      return top
    } catch {
      return null
    }
  },
}

// The real path (long names, links followed). A path that can't be resolved (gone, no access) is kept as written,
// which can only make it not match.
const realPath = (p) => {
  const full = path.resolve(p)
  try { return realpathSync.native(full) } catch { return full }
}
// The nearest folder above `file` that exists, or null.
const existingFolder = (file) => {
  let dir = path.dirname(file)
  while (!existsSync(dir)) {
    if (path.dirname(dir) === dir) return null
    dir = path.dirname(dir)
  }
  return dir
}
// git prints forward slashes and the real path; the hook gets the project folder as Claude Code spells it.
const canonicalPath = (p) => {
  const slashed = realPath(p).split(path.sep).join('/')
  return CASE_INSENSITIVE_FS ? slashed.toLowerCase() : slashed
}
const samePath = (a, b) => canonicalPath(a) === canonicalPath(b)

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
 * ESP-72, ESP-73: the skill names the agent in its pre-flight report, so an agent name may hold only letters, digits,
 * ".", "_", ":" and "-"; any other name (a control, bidi or format character, a space) is a bad entry.
 * An unknown key is reported and the entry is kept. A null `when` is reported and the entry is kept without it, so it
 * runs on every plan.
 */
const ENTRY_KEYS = ['agent', 'when', '$comment']
const AGENT_NAME = /^[A-Za-z0-9._:-]+$/
// JSON.stringify leaves DEL, U+0085, U+2028 and U+2029 raw, and oneLine keeps some of them, so they are escaped here.
const quoteKey = (key) => [...JSON.stringify(key)]
  .map((c) => (CONTROL_CODE_POINTS.includes(c.codePointAt(0)) ? `\\u${c.codePointAt(0).toString(16).padStart(4, '0')}` : c))
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
    if (!AGENT_NAME.test(entry.agent)) {
      advise(`${label}.agent" may hold only letters, digits, ".", "_", ":" and "-"`)
      return []
    }
    if (entry.when === null) {
      advise(`${label}.when" is null, so the reviewer runs on every plan; remove it or list path prefixes`)
      const rest = { ...entry }
      delete rest.when
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
// PowerShell, or null for one the guard can't read: a value built at run time, or base64 that isn't clean UTF-16 text.
// The flag is looked for anywhere, so another tool's -e in the same command fails closed (asked). PowerShell also
// takes -- and dash characters as the flag prefix, a quoted value may hold whitespace (base64 decoding skips it),
// and a decoded text is read again for its own encoded command, up to MAX_ENCODED_DEPTH levels, then asked.
// The value is read in a lookahead, so another -e flag (`-ep -e …`) doesn't swallow the encoded flag as its value.
// A flag may also be a group or array element, ended by `,`, `;`, `)` or the next group: `@('-e';'…')`, `('-e')('…')`.
const ENCODED_FLAG = /[\s(,;](?:--?|[\/–—―])(e[a-z]*)(?=(\)?\s*[,;(]\s*|\)?\s+|:)("[^"]*"|'[^']*'|[^\s;&|),]*))/gi
// ESP-125: what makes a value one PowerShell builds at run time, by how it is quoted (cmd expands %VAR% in any quotes).
// In the unescaped form the quotes are gone, so a "(" there may have been quoted text; a group is still caught by
// its separator, and the command as written is checked with "(" too.
// Security review: bash drops a backslash before any character (and a line break after one), so a backslash outside
// single quotes can turn text that isn't base64 into base64 PowerShell runs.
// Code review: cmd with /v:on also expands !VAR!, in any quotes.
const runTimeValue = (raw, quotesKept) => (raw.startsWith("'") ? /[%!]/ : raw.startsWith('"') ? /[$`%!\\]/ : quotesKept ? /[$`%!(@{[<*?\\]/ : /[$`%!@{[<*?\\]/).test(raw)
const MAX_ENCODED_DEPTH = 3
const encodedCommands = (cmd, depth = 0, quotesKept = true) => {
  if (!/\b(?:powershell|pwsh)\b/i.test(cmd)) return []
  const values = [...cmd.matchAll(ENCODED_FLAG)]
    .filter(([, flag]) => 'encodedcommand'.startsWith(flag.toLowerCase()) || flag.toLowerCase() === 'ec')
    .map(([, , sep, raw]) => ({ raw, grouped: /[(),;]/.test(sep), b64: raw.replace(/^["']|["']$/g, '').replace(/\s+/g, '') }))
  if (values.length && depth >= MAX_ENCODED_DEPTH) return [null]
  return values.flatMap(({ raw, grouped, b64 }) => {
    // ESP-125: PowerShell refuses a literal value that isn't base64 (another tool's -e, such as node -e "…"), so it
    // runs nothing. A value built at run time, or one inside a group or array expression, can't be read: asked.
    if (!/^[a-z0-9+/]+={0,2}$/i.test(b64) || b64.length % 4) return grouped || runTimeValue(raw, quotesKept) ? [null] : []
    const bytes = Buffer.from(b64, 'base64')
    const text = bytes.toString('utf16le')
    if (bytes.length % 2 || /[\u0000-\u0008\u000e-\u001f�\ud800-\udfff]/.test(text)) return [null]
    return [text, ...encodedCommands(text, depth + 1), ...encodedCommands(unescaped(text), depth + 1, false)]
  })
}

// ESP-125: text no command runs is blanked before the command rules, so a word in a commit message, a note written
// with cat or a search pattern doesn't match them: the body of a quoted-delimiter heredoc fed to cat or tee (not
// piped), a `"$(cat <<'X' … X)"` git commit/tag or gh message, and the quoted arguments of a search command. Quotes,
// escapes and heredocs are read as the shell reads them. Anything the scan can't read leaves the command unchanged,
// so the rules see all of it: a backtick, any other $( or ${, an unquoted #, $' or $", <( or >(, a PowerShell
// here-string or --%, an unquoted-delimiter or unterminated heredoc, or a command that could redefine a name.
const SEARCH_WORDS = ['grep', 'egrep', 'fgrep', 'rg', 'select-string', 'sls', 'findstr']
const HEREDOC_WRITERS = ['cat', 'tee']
// rg --pre and --hostname-bin run a program, so that is no search; the rest could make "grep" or "cat" run something
// else.
const REDEFINES = /\b(?:alias|function|filter|set-alias|new-alias|sal|nal|enable|hash)\b|\w\s*\(\s*\)|\bpath\s*\+?=|\$env:path|--(?:pre|hostname-bin)\b/i
// A heredoc written where it runs later (a git or husky hook, a shell startup file, agent or editor config that runs
// commands, a home or system folder, any absolute path or any variable) stays visible.
const RUNS_LATER = /\.git\b|\bhooks\b|\.husky\b|\.claude\b|\.mcp\.json|\.vscode\b|\.envrc|\b(?:claude|agents)\.md\b|~|\$|(?:^|[\s"'=>&])(?:[\\/]|[a-z]:[\\/])|(?:^|[\s/])\.(?:bash|zsh|profile|config|git)/i
// Security re-review: a write target bash expands (a glob, a brace list, an extglob) can name a hooks folder that
// RUNS_LATER doesn't see as written; a cd with no folder, "-" or "..", or a path through "..", can leave the project.
const EXPANSION = /[*?[]|\{\S|[^\s;&|(<>]\(/
const LEAVES_FOLDER = /(?:^|[;&|(){}\n])[ \t]*cd(?:[ \t]*(?=$|[;&|)}\n])|[ \t]+-)|(?:^|[\s=>&/])\.\.(?=[\\/\s;&|)]|$)/
// Output sent nowhere (/dev/null, PowerShell's $null, or another stream) isn't a write. `>&file` is: bash sends both
// streams to the file.
const DISCARDED_OUTPUT = /\d*>>?[ \t]*(?:\/dev\/null|\$null)(?=[\s;&|)]|$)|\d*>&(?:\d+|-)(?=[\s;&|)]|$)/gi
// The simple command before a message heredoc: its text from the command start up to the opening quote.
const MESSAGE_COMMAND = new RegExp(String.raw`^\s*(?:${GIT_PREFIX}(?:commit|tag)\b[^;&|\n]*\s(?:-[a-z]*m|--message)|gh\s+(?:pr|issue|release)\s+(?:create|edit|comment|review)\b[^;&|\n]*\s(?:-[bt]|--body|--title|--notes))(?:=|\s+)$`, 'i')
// Governance and silent-failure reviews: a heredoc body stays unless every command beside it is one that can't run
// the file it wrote (any other program, such as psql -f, awk -f or go run, might).
// git is not one: bisect run, -c core.pager, submodule foreach and hooksPath all run a file.
const QUIET_COMMANDS = ['cat', 'tee', 'echo', 'printf', 'cd', 'pwd', 'ls', 'mkdir', 'touch', 'wc', 'head', 'tail', 'diff', 'true', 'test']
// Security re-review: beside a message, git and gh may also run, but only commands that can't run the message
// (git log | sh, git -c core.pager=sh log or git push --receive-pack could). git takes any unique prefix of a long
// option, so --e, --u and --rece are --exec, --upload-pack and --receive-pack.
const MESSAGE_PEERS = new RegExp(String.raw`^\s*(?:${GIT_PREFIX}(?:add|commit|push|status|tag)\b|gh\s+(?:pr|issue|release)\s+(?:create|edit|comment|review)\b)`, 'i')
const RUNS_PROGRAM = /(?:^|\s)(?:-c|--(?:e|u|rece|config-env))/
// Security review: PowerShell also reads typographic quotes as quotes; the scan only knows the ASCII ones.
const TYPOGRAPHIC_QUOTES = /[‘-„]/
// Security re-review: the delimiter is the whole word after <<, so a quoted part must end it, and a backslash, $ or
// backtick in it is read differently by bash (`<<'EOF'x` ends at EOFx, `<<"E\\"` at E\). Anything else fails closed.
const DELIMITER = String.raw`(?:'([^'\n]+)'|"([^"\\$` + '`' + String.raw`\n]+)"|\\([^\s;&|<>()'"\\$` + '`' + String.raw`]+))`
const HEREDOC_OP = new RegExp(String.raw`<<(-?)[ \t]*${DELIMITER}(?=[ \t\n;&|<>()]|$)`, 'y')
const MESSAGE_OP = new RegExp(String.raw`\$\([ \t]*cat[ \t]+<<(-?)[ \t]*${DELIMITER}[ \t]*\n`, 'y')
const MESSAGE_END = /\n[ \t]*\)"/y
const WORD = /[A-Za-z][\w.-]*/y
// Security re-review: (( is arithmetic in bash, so a heredoc operator inside it is no heredoc.
const UNREADABLE = ['`', '$(', '${', '$[', "$'", '$"', '<(', '>(', '((', "@'", '@"', '--%', '<#']
// A quoted redirect target is a file name the env-file and snapshot checks need to see, never a search pattern.
const REDIRECT_BEFORE = /[<>][ \t]*$/
// { and } open or close a command group only as words of their own; attached to text they are part of a word.
const groupBrace = (cmd, i) => /[\s;&|()]/.test(cmd[i - 1] ?? ' ') && /[\s;&|()]/.test(cmd[i + 1] ?? ' ')

// The heredoc body starting at `from`: where its terminator line starts and ends, or null if there is none.
// Security re-review: inside $( ) bash also ends the body at a line that starts with the delimiter and holds a ")"
// (`EOF)"; …`), so any line that starts with the delimiter without being it fails closed.
const heredocBody = (cmd, from, { delim, strip }) => {
  for (let pos = from; ;) {
    const eol = cmd.indexOf('\n', pos) === -1 ? cmd.length : cmd.indexOf('\n', pos)
    const line = strip ? cmd.slice(pos, eol).replace(/^\t+/, '') : cmd.slice(pos, eol)
    if (line === delim) return { terminator: pos, end: eol }
    if (line.startsWith(delim)) return null
    if (eol === cmd.length) return null
    pos = eol + 1
  }
}

const sticky = (re, cmd, at) => {
  re.lastIndex = at
  return re.exec(cmd)
}

// A `"$(cat <<'X' … X)"` message at `at` (the $), quoted from `quote`: its blanked text and the end of the closing
// quote, or null. The body stays when it starts with "-": an option before -m that takes a value (git commit -F -m)
// would leave it as an argument of its own, read as an option such as --no-verify. Leading space counts, since <<-
// strips tabs.
const messageHeredoc = (cmd, at, quote, cmdStart) => {
  const op = MESSAGE_COMMAND.test(cmd.slice(cmdStart, quote)) && sticky(MESSAGE_OP, cmd, at)
  if (!op) return null
  const from = at + op[0].length
  const body = heredocBody(cmd, from, { delim: op[2] ?? op[3] ?? op[4], strip: op[1] === '-' })
  const close = body && sticky(MESSAGE_END, cmd, body.end)
  if (!close) return null
  const kept = /^\s*-/.test(cmd.slice(from, body.terminator)) ? cmd.slice(from, body.terminator) : ''
  return { text: `${op[0]}${kept}${cmd.slice(body.terminator, body.end)}${close[0]}`, end: body.end + close[0].length }
}

// Governance review: Claude Code keeps the shell's folder between calls, so a cd in an earlier call can move a
// heredoc write into a hooks folder or out of the project. The hook input's cwd says where the shell is.
// Code review: the project folder stays put when Claude enters a worktree under .claude/worktrees, so the worktree
// itself is not read as .claude config; what is inside it still is.
const shellOutsideQuietFolder = (cwd, root, p) => {
  if (typeof cwd !== 'string' || !cwd) return false
  const rel = p.relative(root, cwd)
  const inWorktree = rel.split(p.sep).join('/').replace(/^\.claude\/worktrees\/[^/]+(?:\/|$)/, '')
  return rel.startsWith('..') || p.isAbsolute(rel) || RUNS_LATER.test(inWorktree)
}

// Security re-review: a command beside blanked text must be one that can't run it. Search output piped to sh, or
// PowerShell's iex, & and . on it, would run the pattern.
const quietPeer = ({ word, text }, blankedBody) => QUIET_COMMANDS.includes(word) || SEARCH_WORDS.includes(word) ||
  (!blankedBody && MESSAGE_PEERS.test(text) && !RUNS_PROGRAM.test(text))

// The command with data text blanked, or the command unchanged when the scan can't read it.
const withoutDataText = (cmd, tool, shellMoved = false) => {
  const bash = tool === 'Bash'
  // Security re-review: quotes and backslashes split a word only for the eye (rg --pr'e'=… is --pre).
  if (cmd.length > MAX_COMMAND_CHARS || [cmd, cmd.replace(/['"\\]/g, '')].some((c) => REDEFINES.test(c)) || (!bash && TYPOGRAPHIC_QUOTES.test(cmd))) return cmd
  const commands = [] // every simple command's first word and text, to check what runs beside blanked text
  let out = ''
  let cmdStart = 0
  let commandOut = 0 // where the current simple command starts in out
  let word = null // the current simple command's first word, '' when it isn't a plain word
  const heredocs = []
  let blankedBody = false
  let blankedOther = false // a search argument or a message
  scan: for (let i = 0; i < cmd.length;) {
    const ch = cmd[i]
    const search = SEARCH_WORDS.includes(word)
    if (ch === "'") {
      const end = cmd.indexOf("'", i + 1)
      if (end === -1) return cmd
      const blank = search && !REDIRECT_BEFORE.test(out)
      blankedOther ||= blank
      out += blank ? "''" : cmd.slice(i, end + 1)
      word ??= ''
      i = end + 1
      continue
    }
    if (ch === '"') {
      let j = i + 1
      let plain = true
      for (; j < cmd.length && cmd[j] !== '"'; j++) {
        if (cmd[j] === '`' || cmd.startsWith('${', j)) return cmd
        if (cmd.startsWith('$(', j)) {
          const message = bash && j === i + 1 && messageHeredoc(cmd, j, i, cmdStart)
          if (!message) return cmd
          out += `"${message.text}`
          blankedOther = true
          word ??= ''
          i = message.end
          continue scan
        }
        if (cmd[j] === '$') plain = false
        if (cmd[j] === '\\' && bash) {
          plain = false
          j++
        }
      }
      if (j >= cmd.length) return cmd
      const blank = search && plain && !REDIRECT_BEFORE.test(out)
      blankedOther ||= blank
      out += blank ? '""' : cmd.slice(i, j + 1)
      word ??= ''
      i = j + 1
      continue
    }
    if (UNREADABLE.some((s) => cmd.startsWith(s, i))) return cmd
    // Security re-review: PowerShell also starts a comment after , and {, so any unquoted # there fails closed.
    if (ch === '#' && (!bash || i === 0 || /[\s;&|()]/.test(cmd[i - 1]))) return cmd
    if (ch === '\\' && bash) {
      out += cmd.slice(i, i + 2)
      word ??= ''
      i += 2
      continue
    }
    if (cmd.startsWith('<<<', i)) {
      out += '<<<'
      i += 3
      continue
    }
    if (cmd.startsWith('<<', i)) {
      const op = bash && sticky(HEREDOC_OP, cmd, i)
      if (!op) return cmd
      const eol = cmd.indexOf('\n', i) === -1 ? cmd.length : cmd.indexOf('\n', i)
      const blank = HEREDOC_WRITERS.includes(word) && !RUNS_LATER.test(cmd.slice(cmdStart, eol))
      heredocs.push({ delim: op[2] ?? op[3] ?? op[4], strip: op[1] === '-', blank })
      out += op[0]
      i += op[0].length
      continue
    }
    // A pipe hands the heredoc text to the next command, which may run it.
    if (ch === '|') heredocs.forEach((h) => { h.blank = false })
    if (ch === '\n' && heredocs.length) {
      out += ch
      i++
      for (const h of heredocs.splice(0)) {
        const body = heredocBody(cmd, i, h)
        if (!body) return cmd
        blankedBody ||= h.blank
        out += `${h.blank ? '' : cmd.slice(i, body.terminator)}${cmd.slice(body.terminator, body.end)}`
        i = body.end
      }
      continue
    }
    // The & of a redirect (>&2, <&3, &>file) is part of the same command.
    // Security re-review: an escaped \> is text, so the & after it still ends the command.
    const redirect = ch === '&' && ((/[<>]/.test(cmd[i - 1] ?? '') && cmd[i - 2] !== '\\') || cmd[i + 1] === '>')
    // Security re-review: in PowerShell any { opens a script block, which a parameter bound from the pipeline runs.
    if ((/[;&|\n()]/.test(ch) && !redirect) || (/[{}]/.test(ch) && (!bash || groupBrace(cmd, i)))) {
      if (word !== null) commands.push({ word, text: out.slice(commandOut) })
      // PowerShell's & (not &&) runs whatever follows it.
      if (!bash && ch === '&' && cmd[i - 1] !== '&' && cmd[i + 1] !== '&') commands.push({ word: '', text: ch })
      out += ch
      i++
      word = null
      cmdStart = i
      commandOut = out.length
      continue
    }
    if (word === null && !/\s/.test(ch)) {
      const name = sticky(WORD, cmd, i)
      const after = name && cmd[i + name[0].length]
      word = name && (after === undefined || /[\s;&|()<>]/.test(after)) ? name[0].toLowerCase().replace(/\.exe$/, '') : ''
      if (name) {
        out += name[0]
        i += name[0].length
        continue
      }
    }
    out += ch
    i++
  }
  if (word !== null) commands.push({ word, text: out.slice(commandOut) })
  if (heredocs.length) return cmd
  if (!blankedBody && !blankedOther) return out
  if (!commands.every((c) => quietPeer(c, blankedBody))) return cmd
  const writes = blankedBody || commands.some((c) => c.word === 'tee') || />/.test(out.replace(DISCARDED_OUTPUT, ''))
  // The whole command, not only the heredoc's own: an earlier cd can move the write into a hooks or system folder.
  // Read with quotes and backslashes gone too, as bash reads `.hus''ky` or `\/usr`.
  const unquoted = out.replace(/['"\\]/g, '')
  return writes && (shellMoved || RUNS_LATER.test(out) || RUNS_LATER.test(unquoted) || EXPANSION.test(out) || LEAVES_FOLDER.test(unquoted)) ? cmd : out
}

// ESP-70: the database-drop deny skips a command made only of read-only commands, where the phrase can only be data:
// a search, a display command that writes nothing, or git log, grep, show or diff with listed options only. Any other
// program might run SQL, so it keeps the deny. The split fails closed: a $, a backtick, an escape outside quotes, a
// line break, a comment, a heredoc or input redirect, a write, a variable assignment, an unquoted wildcard, or a
// PowerShell block, group or call keeps the deny too.
// The quiet commands, less those that write a file or change the folder.
const READ_ONLY_WORDS = [...SEARCH_WORDS, ...QUIET_COMMANDS.filter((w) => !['tee', 'cd', 'mkdir', 'touch'].includes(w))]
// Full names only, since git takes any unique prefix of a long option. -O (open files in a pager), --output and
// --ext-diff are not listed, nor is any global option before the subcommand.
const GIT_FLAGS = ['-i', '-E', '-F', '-P', '-n', '-l', '-w', '-v', '-h', '-H', '-p', '--all', '--oneline', '--stat',
  '--name-only', '--name-status', '--ignore-case', '--regexp-ignore-case', '--fixed-strings', '--extended-regexp',
  '--perl-regexp', '--line-number', '--files-with-matches', '--all-match', '--invert-grep', '--no-merges', '--reverse',
  '--cached', '--patch', '--word-regexp', '--invert-match']
// Per subcommand: `values` always take a value, as the next word or attached; `equals` take one only after "=".
// An option that may take no value can't skip the next word, or that word could be -O or --output: in git grep -G
// is --basic-regexp, and a bare --pretty is valid in log and show.
const LOG_VALUES = ['-n', '-S', '-G', '--grep', '--author', '--committer', '--since', '--until', '--max-count']
const GIT_READS = {
  log: { values: LOG_VALUES, equals: ['--format', '--pretty'] },
  show: { values: LOG_VALUES, equals: ['--format', '--pretty'] },
  grep: { values: ['-e', '--max-count'], equals: [] },
  diff: { values: ['-S', '-G'], equals: [] },
}
// Output thrown away (>/dev/null, 2>&1) is not a write: DISCARDED_OUTPUT, read where the split stands.
const DISCARD_AT = new RegExp(`^(?:${DISCARDED_OUTPUT.source})`, 'i')

const readOnlyGit = (args) => {
  const read = Object.hasOwn(GIT_READS, args[0]) && GIT_READS[args[0]]
  if (!read) return false
  for (let i = 1; i < args.length; i++) {
    const arg = args[i]
    if (arg === '--') return true
    // Values first: -n is a flag in git grep but takes the count in log and show.
    if (read.values.includes(arg)) { i++; continue }
    if (!arg.startsWith('-') || GIT_FLAGS.includes(arg) || /^-\d+$/.test(arg)) continue
    if (/^-[^-]./.test(arg) && read.values.includes(arg.slice(0, 2))) continue
    if (arg.startsWith('--') && arg.includes('=') && [...read.values, ...read.equals].includes(arg.slice(0, arg.indexOf('=')))) continue
    return false
  }
  return true
}

const readOnlySimple = (words) => {
  if (!words.length) return true
  // A variable assignment before a command (GIT_PAGER=… git log) is a first word with "=", which no listed name has.
  const name = words[0].toLowerCase().replace(/\.exe$/, '')
  return name === 'git' ? readOnlyGit(words.slice(1)) : READ_ONLY_WORDS.includes(name)
}

// The command split into simple commands of unquoted words, or null when the split can't read it.
const simpleCommands = (cmd, bash) => {
  const commands = [[]]
  let word = null
  const endWord = () => {
    if (word !== null) commands.at(-1).push(word)
    word = null
  }
  for (let i = 0; i < cmd.length; i++) {
    const ch = cmd[i]
    if (ch === "'" || ch === '"') {
      const close = cmd.indexOf(ch, i + 1)
      if (close === -1) return null
      const body = cmd.slice(i + 1, close)
      // In bash double quotes a backslash can escape the closing quote; $ and the backtick expand in both shells.
      if (ch === '"' && (/[$`]/.test(body) || (bash && body.includes('\\')))) return null
      // Windows PowerShell 5.1 (and legacy argument passing) rebuilds a native argument with quotes, so a `\"` inside
      // single quotes reaches git as more than one argument.
      if (!bash && /["\\]/.test(body)) return null
      word = (word ?? '') + body
      i = close
      continue
    }
    if (ch === ' ' || ch === '\t') { endWord(); continue }
    // PowerShell also splits words on other whitespace (NBSP, vertical tab, form feed, U+2002), so outside quotes
    // only printable ASCII is read.
    if (ch < ' ' || ch > '~') return null
    if (ch === '>') {
      const discard = DISCARD_AT.exec(cmd.slice(i))
      if (!discard || (word !== null && !/^\d+$/.test(word))) return null
      word = null
      i += discard[0].length - 1
      continue
    }
    if (ch === '|' || ch === ';' || (ch === '&' && (bash || cmd[i + 1] === '&')) || (bash && (ch === '(' || ch === ')'))) {
      endWord()
      if ((ch === '|' || ch === '&') && cmd[i + 1] === ch) i++
      commands.push([])
      continue
    }
    // An unquoted wildcard can expand to a file named like an option (`-O<pager>`, `--pre=<program>`).
    if (/[\n\r`$#<{}()&*?[]/.test(ch) || (bash && ch === '\\') || (!bash && ch === '@')) return null
    word = (word ?? '') + ch
  }
  endWord()
  return commands
}

const readOnlyCommand = (cmd, tool) => {
  if (cmd.length > MAX_COMMAND_CHARS || [cmd, cmd.replace(/['"\\]/g, '')].some((c) => REDEFINES.test(c)) || TYPOGRAPHIC_QUOTES.test(cmd)) return false
  const commands = simpleCommands(cmd, tool === 'Bash')
  return commands !== null && commands.every(readOnlySimple)
}

const decideBash = (cmd, { cfg, gov, repoRules }, git, root, tool, cwd, p = path) => {
  if (squeezeSpaces(cmd).length > MAX_TOTAL_CHARS) return decision('deny', `Blocked: the command is over ${MAX_TOTAL_CHARS / 1024 / 1024} MB, too long for the guard to check. Write it to a script file and run that instead.`, cmd)
  const text = withoutDataText(cmd, tool, shellOutsideQuietFolder(cwd, root, p))
  // The unescaped form too, so a quoted or split flag or name (`'-enc'`, `-e''nc`, `p''owershell`) is still read.
  const encoded = [...encodedCommands(text), ...encodedCommands(unescaped(text), 0, false)]
  const decoded = encoded.filter((t) => t !== null)
  const forms = [text, ...decoded].flatMap((c) => [c, unescaped(c)])
  const matches = (re) => forms.some((c) => new RegExp(re, 'i').test(c))
  const pieces = forms.flatMap(denyPieces)
  for (const rule of [...DENY_COMMANDS, ...repoRules.deny]) {
    const [why, re] = rule
    if (!pieces.some((piece) => new RegExp(re, 'i').test(piece))) continue
    if (rule === DROP_DATABASE_RULE && readOnlyCommand(cmd, tool)) continue
    return decision('deny', `Blocked: ${why}.`, cmd)
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

// ESP-82: where Claude Code puts the worktrees of isolated agents.
const WORKTREES_PATH = '.claude/worktrees/**'

// ESP-82 R13: an edit in a linked worktree is decided as a project edit relative to the worktree's top level, with
// the main checkout's config, and the worktree's plan or else the main checkout's. Returns null when git doesn't
// confirm a linked worktree (R14), else { result } with the decision (null allows). `fallback` is the decision the
// edit gets otherwise; a lookup that throws keeps an ask and says why.
const decideWorktreeEdit = async (file, safe, git, root, p, ic, tool, ti, net, places, fallback) => {
  let top = null
  try {
    top = git.linkedWorktree?.(root, file) ?? null
  } catch (e) {
    const why = `The guard could not check whether it is in a linked worktree: ${e?.message || e}.`
    return { result: decision('ask', fallback?.decision === 'ask' ? `${fallback.reason} ${why}` : `Edit ${file}. ${why}`, file) }
  }
  if (!top) return null
  // git gives the real path; compare the file's real folder with it, so an 8.3 name (C:\Users\RUNNER~1) or a link
  // (/var as /private/var) in the spelling Claude Code passes still reads as inside the worktree.
  const abs = p.resolve(root, file)
  const folder = existingFolder(abs)
  const realAbs = folder ? p.join(realPath(folder), p.relative(folder, abs)) : abs
  const realTop = realPath(top)
  const inner = p.relative(realTop, realAbs)
  if (inner.startsWith('..') || p.isAbsolute(inner)) return null
  const result = await decideEdit(realAbs, safe, git, realTop, p, ic, tool, ti, net, { ...places, planRoot: places.planRoot ?? root })
  return { result: result && { ...result, target: file, worktree: top } }
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
  const outside = relNative.startsWith('..') || p.isAbsolute(relNative)
  const rel = relNative.split(p.sep).join('/')
  const worktreeEdit = (fallback) => decideWorktreeEdit(file, { cfg, gov }, git, root, p, ic, tool, ti, net, places, fallback)
  if (outside) {
    // The git probes run only for an outside edit that would ask: a trusted write or a deny needs no worktree check.
    const result = decideOutsideEdit(file, gov, root, p, ic, tool, ti, places, cfg)
    if (result?.decision !== 'ask') return result
    const worktree = await worktreeEdit(result)
    return worktree ? worktree.result : result
  }
  if (matchAny(rel, [WORKTREES_PATH], ic)) {
    const worktree = await worktreeEdit(null)
    if (worktree) return worktree.result
  }
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
      : decideScope(rel, gov, root, ic, places.planRoot)
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

// Plan, governance-file and plan-scope checks for a project-relative path. In a linked worktree with no plan of its
// own, the main checkout's plan (planRoot) sets the scope (ESP-82 R13).
const decideScope = (rel, gov, root, ic, planRoot) => {
  // Otherwise a plan could widen its own Files list (e.g. to `**`) and unlock every later edit.
  if (matchAny(rel, [PLAN_PATH], ic)) return decision('ask', `The approved plan sets the edit scope. Changing ${PLAN_PATH} needs explicit confirmation.`, rel)
  if (matchAny(rel, GUARD_EXEMPT_PATHS, ic)) return null
  const hit = matchAny(rel, gov.askPaths || DEFAULT_ASK_PATHS, ic)
  if (hit) return decision('ask', `"${rel}" is a governance, CI or dependency file (${hit}). Changes need explicit confirmation.`, rel)
  const plan = planFiles(root) ?? (planRoot ? planFiles(planRoot) : null)
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
export const evaluate = async (input, { root, cfg = {}, configError = null, git = gitProbe, pathApi = path, caseInsensitive = CASE_INSENSITIVE_FS, lookups, lookupDeadlineMs, homeDir = os.homedir(), tmpDir = os.tmpdir(), uid = process.getuid?.(), markerFile, longName = pathApi === path ? realpathSync.native : null }) => {
  const tool = input.tool_name || ''
  const ti = input.tool_input || {}
  const safe = sanitizeConfig(cfg)
  const problems = configError ? [`${CONFIG_FILE} ${configError}`, ...safe.problems] : safe.problems
  const escalating = !!configError || safe.escalating.length > 0

  let result = null
  let target = ''
  if (SHELL_TOOLS.includes(tool)) {
    target = String(ti.command || '')
    result = decideBash(target, safe, git, root, tool, input.cwd, pathApi)
  } else if (EDIT_TOOLS.includes(tool)) {
    target = ti.file_path || ti.notebook_path || ''
    if (!target) return null
    if (typeof target !== 'string') {
      target = JSON.stringify(target)
      result = decision('ask', 'The edit target is not a file path string. Confirm the edit.', target)
    } else result = await decideEdit(target, safe, git, root, pathApi, caseInsensitive, tool, ti, { lookups, deadlineMs: lookupDeadlineMs }, { homeDir, tmpDir, uid, longName })
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
  const at = { tool, target: result.target, ...(result.worktree && { worktree: result.worktree }) }
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
