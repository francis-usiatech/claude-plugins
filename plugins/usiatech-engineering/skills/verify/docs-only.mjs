// The `release` skill's **Docs-only diff** rule as code, so the gate decides it the same way every time instead of a
// model reading the rule. A docs-only diff skips the gate commands and the reviewer round; the user's docs review
// replaces them. Every comparison ignores case: on a case-insensitive file system `Skills/` or `agents.MD` is the
// same file, and an extra match only makes a diff count as code, which runs the gate.
import { readFileSync, statSync } from 'node:fs'
import path from 'node:path'
import { DEFAULT_ASK_PATHS, isStringArray, matchAny } from '../../templates/github/scripts/governance-rules.mjs'
import { isPlainObject } from '../../templates/github/scripts/workflow-rules.mjs'

// Folders whose Markdown is instructions or rules (skills, agents, commands, hooks, templates, output styles, CI and
// Claude settings), at any depth.
const CODE_FOLDERS = ['skills', 'agents', 'commands', 'hooks', 'templates', 'scripts', 'output-styles', '.github', '.claude']
// Instruction and review-rule files, at any depth.
const INSTRUCTION_FILES = ['claude.md', 'claude.local.md', 'agents.md', 'review.md']
const DEFAULT_RULES_FILE = '.claude/governance.md'
// Claude follows `@path` imports up to five levels deep.
const MAX_IMPORT_DEPTH = 5
// An `@path` import: `@` at the start of a line or after whitespace, up to the next space or quote-like character.
const IMPORT = /(?:^|\s)@([^\s`'"()<>[\]]+)/g

const isInstructionFile = (file) => INSTRUCTION_FILES.includes(file.toLowerCase().split('/').at(-1))

// The repo-relative paths one file imports with `@path`. Home (`~`) and absolute imports point outside the repo, and
// a path that climbs out of it is dropped; neither can be in the diff.
const importsOf = (root, file) => {
  const text = readFileSync(path.join(root, file), 'utf8')
  const dir = path.posix.dirname(file)
  return [...text.matchAll(IMPORT)]
    .map((m) => m[1].replace(/[.,;:!?]+$/, '').replace(/\\/g, '/'))
    .filter((p) => !p.startsWith('~') && !p.startsWith('/') && !/^[a-z]:/i.test(p))
    .map((p) => path.posix.normalize(path.posix.join(dir, p)))
    .filter((p) => p !== '..' && !p.startsWith('../'))
}

/**
 * Every file the repo's instruction files (CLAUDE.md, CLAUDE.local.md, AGENTS.md, REVIEW.md at any depth) pull in with
 * `@path` imports, followed as deep as Claude follows them. Those files are instructions, so a change to one is code.
 * A file that can't be read throws, so the gate runs rather than skip on a list it couldn't build.
 * @param {string} root the repo root
 * @param {string[]} tracked repo-relative paths of every file in the working tree (tracked plus untracked)
 * @returns {string[]} repo-relative paths of the imported files
 */
export const instructionImports = (root, tracked) => {
  const seen = new Set()
  let frontier = tracked.filter(isInstructionFile)
  for (let depth = 0; depth < MAX_IMPORT_DEPTH && frontier.length; depth++) {
    // A missing target still counts: the branch may have deleted or renamed it. A folder is no file, so it is skipped.
    // Only a file that exists can be read and followed further.
    const next = []
    for (const p of frontier.flatMap((file) => importsOf(root, file))) {
      if (seen.has(p)) continue
      const stat = statSync(path.join(root, p), { throwIfNoEntry: false })
      if (stat?.isDirectory()) continue
      seen.add(p)
      if (stat?.isFile()) next.push(p)
    }
    frontier = next
  }
  return [...seen]
}

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
  if (isInstructionFile(lower) || codeFiles.includes(lower)) return false
  if (parts.slice(0, -1).some((dir) => CODE_FOLDERS.includes(dir))) return false
  return !matchAny(file, askPaths, true)
}

/**
 * Whether a diff is docs-only under the `release` skill's rule. An empty list is not: a gate that saw no change
 * still runs. The caller must pass the whole branch diff; gate.mjs asks only when its list covers the branch.
 * @param {string[]} changed repo-relative paths of every changed file, renames listed as both paths
 * @param {object} cfg the parsed .claude/engineering.json
 * @param {string[]} [imported] files the instruction files import (instructionImports); each counts as code
 * @returns {boolean}
 */
export const isDocsOnly = (changed, cfg, imported = []) => {
  const inputs = ruleInputs(cfg)
  inputs.codeFiles.push(...imported.map(normalPath))
  return changed.length > 0 && changed.every((file) => isPlainDoc(file, inputs))
}
