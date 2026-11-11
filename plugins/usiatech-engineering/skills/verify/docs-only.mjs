// The `release` skill's **Docs-only diff** rule as code, so the gate decides it the same way every time instead of a
// model reading the rule. A docs-only diff skips the gate commands and the reviewer round; the user's docs review
// replaces them. Every comparison ignores case: on a case-insensitive file system `Skills/` or `agents.MD` is the
// same file, and an extra match only makes a diff count as code, which runs the gate.
import { DEFAULT_ASK_PATHS, isStringArray, matchAny } from '../../templates/github/scripts/governance-rules.mjs'
import { isPlainObject } from '../../templates/github/scripts/workflow-rules.mjs'

// Folders whose Markdown is instructions or rules (skills, agents, commands, hooks, templates, output styles, CI and
// Claude settings), at any depth.
const CODE_FOLDERS = ['skills', 'agents', 'commands', 'hooks', 'templates', 'scripts', 'output-styles', '.github', '.claude']
// Instruction and review-rule files, at any depth.
const INSTRUCTION_FILES = ['claude.md', 'claude.local.md', 'agents.md', 'review.md']
const DEFAULT_RULES_FILE = '.claude/governance.md'

// A config path or glob as git prints paths: `/` separators, no repeated `/`, no leading `./` or `/`.
const normalGlob = (p) => p.replace(/\\/g, '/').replace(/\/{2,}/g, '/').replace(/^(\.\/|\/)+/, '')
const normalPath = (p) => normalGlob(p).toLowerCase()

// The version files of each `docVersions` set ({ path, pattern } objects). Their changelog is left out: docs PRs add
// a row to it. A malformed entry is skipped here because doc-versions.mjs stops the release on it.
const docVersionFiles = (cfg) => (Array.isArray(cfg.docVersions) ? cfg.docVersions : [])
  .flatMap((set) => (isPlainObject(set) && Array.isArray(set.versionFiles) ? set.versionFiles : []))
  .map((f) => f?.path)
  .filter((p) => typeof p === 'string')

const stringList = (obj, key, label) => {
  const value = obj[key] ?? []
  if (!isStringArray(value)) throw new Error(`.claude/engineering.json "${label}" must be a list of strings.`)
  return value
}

const objectAt = (cfg, key) => {
  const value = cfg[key] ?? {}
  if (!isPlainObject(value)) throw new Error(`.claude/engineering.json "${key}" is not an object.`)
  return value
}

// The config values the rule reads; a wrong type throws, so a bad config runs no gate rather than skip it.
const ruleInputs = (cfg) => {
  const gov = objectAt(cfg, 'governance')
  const git = objectAt(cfg, 'git')
  const extra = stringList(gov, 'askPaths', 'governance.askPaths').map(normalGlob)
  const rulesFile = gov.rulesFile ?? DEFAULT_RULES_FILE
  if (typeof rulesFile !== 'string') throw new Error('.claude/engineering.json "governance.rulesFile" must be a string.')
  const changelog = git.changelogFile ?? []
  if (typeof changelog !== 'string' && !isStringArray(changelog)) throw new Error('.claude/engineering.json "git.changelogFile" must be a string or a list of strings.')
  // Version and changelog files are read by tests and release scripts, so a change to them is code.
  const codeFiles = [rulesFile, ...stringList(git, 'versionFiles', 'git.versionFiles'), ...[changelog].flat(), ...docVersionFiles(cfg)].map(normalPath)
  return { askPaths: [...DEFAULT_ASK_PATHS, ...extra], codeFiles }
}

// One changed file (repo-relative, `/` separators) that the rule allows: Markdown that is not instructions or rules.
const isPlainDoc = (file, { askPaths, codeFiles }) => {
  const lower = file.toLowerCase()
  const parts = lower.split('/')
  if (!lower.endsWith('.md')) return false
  if (INSTRUCTION_FILES.includes(parts.at(-1)) || codeFiles.includes(lower)) return false
  if (parts.slice(0, -1).some((dir) => CODE_FOLDERS.includes(dir))) return false
  return !matchAny(file, askPaths, true)
}

/**
 * Whether a diff is docs-only under the `release` skill's rule. An empty list is not: a gate that saw no change
 * still runs. The caller must pass the whole branch diff; gate.mjs asks only when its list covers the branch.
 * @param {string[]} changed repo-relative paths of every changed file, renames listed as both paths
 * @param {object} cfg the parsed .claude/engineering.json
 * @returns {boolean}
 */
export const isDocsOnly = (changed, cfg) => {
  const inputs = ruleInputs(cfg)
  return changed.length > 0 && changed.every((file) => isPlainDoc(file, inputs))
}
