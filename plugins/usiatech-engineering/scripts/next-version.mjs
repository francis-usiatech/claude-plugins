// usiatech-engineering: works out the next semver version for a release (ESP-23). The release skill runs it, shows the
// result and edits the listed files; this script only computes and checks, so it needs no parser per file format.
// Prints one JSON object. Exits 2, with the reason on stderr and nothing on stdout, when it can't give a safe answer.
// Usage: node next-version.mjs [--level patch|minor|major]
import { execFileSync } from 'node:child_process'
import path from 'node:path'
import { compareVersions, readConfigText, SEMVER } from './session-check.mjs'
import { isPlainObject } from '../templates/github/scripts/governance-rules.mjs'
import { isMainModule } from '../templates/github/scripts/main-module.mjs'
import { escapeRegExp } from '../templates/github/scripts/workflow-rules.mjs'

const SEMVER_TAG_FORMAT = 'vX.Y.Z'
const DEFAULT_BASE_BRANCH = 'develop'
const LEVELS = ['patch', 'minor', 'major']
const FEAT_SUBJECT = /^feat(\([^)]*\))?:/i
const BREAKING_SUBJECT = /^\w+(\([^)]*\))?!:/
const BREAKING_FOOTER = /^BREAKING[ -]CHANGE:/m
const RELEASE_SUBJECT = /^chore\(release\): (\d+\.\d+\.\d+)(?=\s|$)/
const GIT_MAX_BYTES = 64 * 1024 * 1024

const gitText = (cwd, args) => execFileSync('git', args, {
  cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'], maxBuffer: GIT_MAX_BYTES,
})

const parseLevelArg = (args) => {
  if (args.length === 0) return null
  if (args[0] !== '--level') throw new Error(`unknown argument "${args[0]}"`)
  if (args.length !== 2 || !LEVELS.includes(args[1])) throw new Error(`--level takes one of ${LEVELS.join(', ')}`)
  return args[1]
}

const isRepoPath = (p) => typeof p === 'string' && p !== ''
  && !path.win32.isAbsolute(p) && !path.posix.isAbsolute(p) && !p.split(/[\\/]/).includes('..')

// The git section of the base-branch config, or null when the repo hasn't opted in. A config it can't parse is an
// error, never "not opted in": that would ship a release with no bump, which is what this script exists to stop.
// With no config on the base branch or in the working copy, the repo can't show it opted in, so that reads as not.
const readSemverConfig = (cwd) => {
  const { text, warning, base } = readConfigText(cwd)
  if (text == null) return null
  // Settings come from the base branch (AGENTS.md F11). A working copy can't show the repo opted in, or that it didn't.
  if (warning) throw new Error(`${warning} isn't enough: the semver settings must be on the base branch`)
  let cfg
  try {
    cfg = JSON.parse(text)
  } catch (e) {
    throw new Error(`.claude/engineering.json is not valid JSON (${e.message})`)
  }
  if (!isPlainObject(cfg)) throw new Error('.claude/engineering.json must hold a JSON object')
  const git = cfg.git ?? {}
  if (!isPlainObject(git)) throw new Error('"git" in .claude/engineering.json must be an object')
  const config = validateGitSection(git)
  if (!config) return null
  if (config.baseBranch !== base) throw new Error(`the config on "${base}" names "${config.baseBranch}" as "git.baseBranch". Check out a branch whose config agrees.`)
  return config
}

/** The checked semver settings from the git section of the config, or null when it lists no version files. */
export const validateGitSection = (git) => {
  const { versionFiles, changelogFile, tagFormat, baseBranch = DEFAULT_BASE_BRANCH } = git
  if (versionFiles !== undefined && !(Array.isArray(versionFiles) && versionFiles.every(isRepoPath))) {
    throw new Error('"git.versionFiles" must be a list of paths inside the repo')
  }
  if (!versionFiles?.length) {
    if (tagFormat === SEMVER_TAG_FORMAT) throw new Error(`"git.tagFormat" is ${SEMVER_TAG_FORMAT}, so "git.versionFiles" must list the version files`)
    return null
  }
  if (tagFormat !== SEMVER_TAG_FORMAT) throw new Error(`"git.versionFiles" is set, so "git.tagFormat" must be ${SEMVER_TAG_FORMAT}`)
  if (changelogFile !== undefined && !isRepoPath(changelogFile)) throw new Error('"git.changelogFile" must be a path inside the repo')
  if (typeof baseBranch !== 'string' || !baseBranch.trim()) throw new Error('"git.baseBranch" must be a non-empty string')
  return { versionFiles, changelogFile: changelogFile ?? null, baseBranch }
}

// Listed from all tags, not `git describe`: tags sit on promotion merges the base branch may not contain.
const lastVersionTag = (cwd) => {
  const versions = gitText(cwd, ['tag', '-l', 'v*']).split('\n').map((t) => t.trim().slice(1)).filter((v) => SEMVER.test(v))
  if (versions.length === 0) throw new Error('no vX.Y.Z tag found. Create the first one by hand, on the last release.')
  return versions.sort(compareVersions).at(-1)
}

const readFromBase = (cwd, baseBranch, file) => {
  try {
    return gitText(cwd, ['show', '--end-of-options', `${baseBranch}:${file}`])
  } catch {
    throw new Error(`"${file}" isn't on the base branch "${baseBranch}"`)
  }
}

// A digit or dot on either side means a different version: 1.2.3 is not in 11.2.3, 1.2.34 or 1.2.3.4.
const assertHoldsVersion = (text, version, file, baseBranch, role) => {
  if (new RegExp(`(?<![\\d.])${escapeRegExp(version)}(?![\\d]|\\.\\d)`).test(text)) return
  throw new Error(`"${file}" on "${baseBranch}" doesn't contain ${version}, ${role}. Fix the file before releasing.`)
}

// The newest version a chore(release) commit since the last tag set, or null. The commit is the record that a bump
// merged: a version file can't show that, since it may hold the old version in other text, such as a dependency.
const mergedBumpVersion = (messages, current) => messages
  .map((m) => m.match(RELEASE_SUBJECT)?.[1])
  .filter((v) => v && compareVersions(v, current) > 0)
  .sort(compareVersions)
  .at(-1) ?? null

const commitMessagesSince = (cwd, tag, baseBranch) => {
  let out
  try {
    out = gitText(cwd, ['log', '--no-merges', '--format=%B%x00', '--end-of-options', `${tag}..${baseBranch}`])
  } catch {
    throw new Error(`can't read the commits in ${tag}..${baseBranch}`)
  }
  return out.split('\0').map((m) => m.trim()).filter(Boolean)
}

// Commits on the base branch that the bump commit can't reach. Counted from the graph, not log order: a commit written
// before the bump and merged after it dates earlier, but the bumped version doesn't account for it.
const countCommitsAfterBump = (cwd, tag, baseBranch, version) => {
  const bumpLine = gitText(cwd, ['log', '--no-merges', '--format=%H %s', '--end-of-options', `${tag}..${baseBranch}`])
    .split('\n')
    .find((line) => line.slice(line.indexOf(' ') + 1).match(RELEASE_SUBJECT)?.[1] === version)
  const sha = bumpLine.slice(0, bumpLine.indexOf(' '))
  return Number(gitText(cwd, ['rev-list', '--count', '--no-merges', '--end-of-options', `${sha}..${baseBranch}`]).trim())
}

const levelOf = (message) => {
  if (BREAKING_SUBJECT.test(message) || BREAKING_FOOTER.test(message)) return 'major'
  return FEAT_SUBJECT.test(message) ? 'minor' : 'patch'
}

/** The largest change across commit messages: patch, minor or major. */
export const largestLevel = (messages) => LEVELS[messages.reduce((top, m) => Math.max(top, LEVELS.indexOf(levelOf(m))), 0)]

/** The version after a bump at the given level, with the lower numbers reset. */
export const bump = (version, level) => {
  const [major, minor, patch] = version.split('.').map(Number)
  if (level === 'major') return `${major + 1}.0.0`
  if (level === 'minor') return `${major}.${minor + 1}.0`
  return `${major}.${minor}.${patch + 1}`
}

const planRelease = (cwd, args) => {
  const levelOverride = parseLevelArg(args)
  const config = readSemverConfig(cwd)
  if (!config) return { enabled: false }
  const { versionFiles, changelogFile, baseBranch } = config
  const current = lastVersionTag(cwd)
  const previousTag = `v${current}`
  const messages = commitMessagesSince(cwd, previousTag, baseBranch)
  const merged = mergedBumpVersion(messages, current)
  const expected = merged ?? current
  const role = merged ? 'the version the merged bump set' : "the last tag's version"
  for (const file of versionFiles) assertHoldsVersion(readFromBase(cwd, baseBranch, file), expected, file, baseBranch, role)
  if (merged) {
    const commitsAfterBump = countCommitsAfterBump(cwd, previousTag, baseBranch, merged)
    return { enabled: true, bumpMerged: true, previousTag, version: merged, nextTag: `v${merged}`, commitsAfterBump }
  }
  if (changelogFile) readFromBase(cwd, baseBranch, changelogFile)
  if (messages.length === 0) throw new Error(`no commits on "${baseBranch}" since ${previousTag}, so there is nothing to release`)
  const computedLevel = largestLevel(messages)
  const level = levelOverride ?? computedLevel
  const next = bump(current, level)
  return {
    enabled: true, bumpMerged: false, previousTag, current, computedLevel, level, override: levelOverride !== null, next, nextTag: `v${next}`,
    commitCount: messages.length, versionFiles, changelogFile,
  }
}

if (isMainModule(import.meta.url)) {
  try {
    console.log(JSON.stringify(planRelease(process.cwd(), process.argv.slice(2))))
  } catch (e) {
    console.error(`next-version: ${e.message}`)
    process.exitCode = 2
  }
}
