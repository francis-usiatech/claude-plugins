#!/usr/bin/env node
// Runs the fp-* fake-pass rules over the repo's changed files, for the local `verify` skill (R9).
// Changed files are the ones verify sees: `git diff HEAD` plus untracked files, from the repo root.
// Exits 1 on any unsuppressed high finding, and 2 when git or the repo's .claude/engineering.json can't be used: a
// check that can't read its inputs fails closed rather than pass.
import { execFileSync } from 'node:child_process'
import { readFileSync, existsSync, lstatSync } from 'node:fs'
import path from 'node:path'
import { isMainModule } from './main-module.mjs'
import { checkFakePasses, parseAllowlist, applyAllowlist, blockingFindings, formatFinding, isPlainObject } from './governance-rules.mjs'

// Same as the CI checks: developers check out on case-insensitive file systems.
const IGNORE_CASE = true

// The allowlist entries from <cwd>/.claude/engineering.json → governance.allowlist; throws on a config that can't be used.
const loadAllowlist = (cwd) => {
  const configPath = path.join(cwd, '.claude/engineering.json')
  if (!existsSync(configPath)) return []
  let cfg
  try {
    cfg = JSON.parse(readFileSync(configPath, 'utf8'))
  } catch (e) {
    throw new Error(`.claude/engineering.json could not be parsed: ${e.message}`)
  }
  if (!isPlainObject(cfg)) throw new Error('.claude/engineering.json is not a JSON object.')
  const gov = cfg.governance ?? {}
  if (!isPlainObject(gov)) throw new Error('.claude/engineering.json "governance" is not an object.')
  const { entries, problems } = parseAllowlist(gov.allowlist)
  if (problems.length) throw new Error(`.claude/engineering.json: ${problems.join('; ')}.`)
  return entries
}

// -z keeps non-ASCII and unusual paths unquoted.
const gitOutput = (cwd, args) => execFileSync('git', [...args, '-z'], { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], maxBuffer: 64 * 1024 * 1024 })
  .split('\0').filter(Boolean)

// Every changed file relative to the repo root, with git's verdict on whether it was deleted. Renames are listed as a
// delete plus an add, so each status has exactly one path.
const changedFiles = (root) => {
  const fields = gitOutput(root, ['diff', '--name-status', '--no-renames', 'HEAD'])
  const changed = new Map()
  for (let i = 0; i + 1 < fields.length; i += 2) changed.set(fields[i + 1], fields[i] === 'D' ? 'deleted' : 'changed')
  for (const file of gitOutput(root, ['ls-files', '--others', '--exclude-standard'])) changed.set(file, 'changed')
  return changed
}

// The file's text, or null when it isn't a regular file or can't be read; the rules report null as fp-unreadable for a
// test file, as the CI checks do for a file git can't show.
const readChangedFile = (full) => {
  try {
    return lstatSync(full).isFile() ? readFileSync(full, 'utf8') : null
  } catch {
    return null
  }
}

/**
 * Checks the changed files of the repo that contains cwd, from its root, so running from a subdirectory checks the
 * same files. Throws when git or the repo config can't be read.
 * @returns {{ exitCode: number, findings: object[], lines: string[] }}
 */
const runFakePassCheck = ({ cwd = process.cwd() } = {}) => {
  const root = execFileSync('git', ['rev-parse', '--show-toplevel'], { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim()
  const allow = loadAllowlist(root)
  const findings = applyAllowlist([...changedFiles(root)].flatMap(([file, status]) => status === 'deleted'
    ? []
    : checkFakePasses({ file, content: readChangedFile(path.join(root, file)) })), allow, IGNORE_CASE)
  const blocking = blockingFindings(findings)
  return { exitCode: blocking.length ? 1 : 0, findings, lines: findings.map(formatFinding) }
}

if (isMainModule(import.meta.url)) {
  try {
    const { exitCode, lines } = runFakePassCheck()
    for (const l of lines) console.log(l)
    process.exitCode = exitCode
  } catch (e) {
    console.error(`fake-pass check could not run: ${e.message}`)
    process.exitCode = 2
  }
}
