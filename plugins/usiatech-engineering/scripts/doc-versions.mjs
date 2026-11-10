// usiatech-engineering: assigns a docs-set version at release time (ESP-153). A repo lists its docs sets in
// .claude/engineering.json → docVersions. Feature PRs add their changelog row with the "unreleased" marker; the
// release runs this script on its bump branch, which gives each such row the next version in table order, dates it,
// and sets each version file to the last version given. The `after` command is printed for the release to run.
// Prints one JSON object. Exits 2, with the reason on stderr and nothing written, when it can't give a safe answer.
// Usage: node doc-versions.mjs [--date YYYY-MM-DD]
import { readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { readConfigText } from './session-check.mjs'
import { isRepoPath } from './next-version.mjs'
import { isPlainObject } from '../templates/github/scripts/governance-rules.mjs'
import { isMainModule } from '../templates/github/scripts/main-module.mjs'

const FORMATS = { 'major.minor': /^(\d+)\.(\d+)$/ }
const DEFAULT_MARKER = 'Unreleased'
const DATE = /^\d{4}-\d{2}-\d{2}$/
const SEPARATOR = /^\s*\|(?:\s*:?-+:?\s*\|)+\s*$/

/**
 * The checked docVersions list, with the defaults filled in. Throws on the first bad value, since a release must not
 * guess at a version.
 * @param {unknown} list engineering.json → docVersions
 * @returns {{ changelog: string, format: string, unreleased: string, versionFiles: { path: string, pattern: string }[], after?: string }[]}
 */
export const validateDocVersions = (list) => {
  if (!Array.isArray(list)) throw new Error('"docVersions" must be a list of { changelog, versionFiles } objects')
  return list.map((e, i) => {
    const at = `"docVersions[${i}]`
    if (!isPlainObject(e) || !isRepoPath(e.changelog)) throw new Error(`${at}.changelog" must be a path inside the repo`)
    const format = e.format ?? 'major.minor'
    if (!Object.hasOwn(FORMATS, format)) throw new Error(`${at}.format" must be one of ${Object.keys(FORMATS).join(', ')}`)
    const unreleased = e.unreleased ?? DEFAULT_MARKER
    if (typeof unreleased !== 'string' || !unreleased.trim() || unreleased.includes('|')) throw new Error(`${at}.unreleased" must be a non-empty string with no "|"`)
    const versionFiles = e.versionFiles ?? []
    if (!Array.isArray(versionFiles)) throw new Error(`${at}.versionFiles" must be a list of { path, pattern } objects`)
    versionFiles.forEach((f, j) => {
      const fat = `${at}.versionFiles[${j}]`
      if (!isPlainObject(f) || !isRepoPath(f.path) || typeof f.pattern !== 'string') throw new Error(`${fat}" needs a "path" inside the repo and a string "pattern"`)
      let groups
      try {
        groups = new RegExp(`${f.pattern}|`).exec('').length - 1
      } catch (err) {
        throw new Error(`${fat}.pattern" is not a valid regex: ${err.message}`)
      }
      if (groups !== 1) throw new Error(`${fat}.pattern" must have exactly one capture group, around the version`)
    })
    if (e.after !== undefined && (typeof e.after !== 'string' || !e.after.trim())) throw new Error(`${at}.after" must be a non-empty command string`)
    return { ...e, format, unreleased, versionFiles }
  })
}

// A table row split into its cells at each "|" that isn't escaped; the first and last pieces are what lies outside.
const cellsOf = (line) => line.split(/(?<!\\)\|/)
// A cell's new text, keeping its padding (and a trailing \r).
const setCell = (cell, value) => cell.replace(/^(\s*)[\s\S]*?(\s*)$/, `$1${value}$2`)
const compare = (a, b) => a[0] - b[0] || a[1] - b[1]

/**
 * The edits one docs set needs. `read(path)` returns a file's text; nothing is written here.
 * @returns {{ changelog: string, assigned: string[], version: string | null, changes: Record<string, string>, after: string | null }}
 */
export const planDocVersions = (entry, read, date) => {
  const text = read(entry.changelog)
  const lines = text.split('\n')
  // The first table row whose cells name both a Date and a Version column; other tables (a legend) are skipped.
  const namesOf = (i) => cellsOf(lines[i]).map((c) => c.trim().toLowerCase())
  const header = lines.findIndex((l, i) => l.trimStart().startsWith('|') && namesOf(i).includes('version') && namesOf(i).includes('date'))
  if (header === -1) throw new Error(`"${entry.changelog}" has no table with a Date and a Version column`)
  if (!SEPARATOR.test(lines[header + 1] ?? '')) throw new Error(`"${entry.changelog}"'s version table has no |---| separator row under its header`)
  const versionCol = namesOf(header).indexOf('version')
  const dateCol = namesOf(header).indexOf('date')
  const shape = FORMATS[entry.format]
  const rows = []
  for (let i = header + 2; i < lines.length && lines[i].trimStart().startsWith('|'); i++) rows.push(i)
  const released = rows.map((i) => cellsOf(lines[i])[versionCol]?.trim().match(shape)).filter(Boolean).map((m) => [Number(m[1]), Number(m[2])])
  const unreleased = rows.filter((i) => cellsOf(lines[i])[versionCol]?.trim() === entry.unreleased)
  if (!unreleased.length) return { changelog: entry.changelog, assigned: [], version: null, changes: {}, after: null }
  if (!released.length) throw new Error(`"${entry.changelog}" has no released version to count from. Give the first row a version by hand.`)
  const last = released.sort(compare).at(-1)
  const current = `${last[0]}.${last[1]}`
  const assigned = unreleased.map((i, n) => {
    const version = `${last[0]}.${last[1] + n + 1}`
    const cells = cellsOf(lines[i])
    cells[versionCol] = setCell(cells[versionCol], version)
    cells[dateCol] = setCell(cells[dateCol], date)
    lines[i] = cells.join('|')
    return version
  })
  const version = assigned.at(-1)
  const changes = { [entry.changelog]: lines.join('\n') }
  // Every match is set, so a version named twice (a header and a footer) can't be left behind. A file listed by an
  // earlier set is read with that set's edit.
  for (const f of entry.versionFiles) {
    const fileText = changes[f.path] ?? read(f.path)
    const matches = [...fileText.matchAll(new RegExp(f.pattern, 'g'))].filter((m) => m[0] !== '')
    if (!matches.length) throw new Error(`"${f.path}" does not match its pattern ${JSON.stringify(f.pattern)}`)
    let out = ''
    let from = 0
    for (const m of matches) {
      if (m[1] !== current) throw new Error(`"${f.path}" holds version ${m[1]}, but the last released version in "${entry.changelog}" is ${current}. Fix the file before releasing.`)
      const at = m.index + m[0].indexOf(m[1])
      out += `${fileText.slice(from, at)}${version}`
      from = at + m[1].length
    }
    changes[f.path] = out + fileText.slice(from)
  }
  return { changelog: entry.changelog, assigned, version, changes, after: entry.after ?? null }
}

const today = () => {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

const parseDate = (args) => {
  if (args.length === 0) return today()
  if (args[0] !== '--date' || args.length !== 2 || !DATE.test(args[1])) throw new Error('usage: doc-versions.mjs [--date YYYY-MM-DD]')
  return args[1]
}

// Settings come from the base branch (AGENTS.md F11); every file is planned before any is written.
const run = (cwd, args) => {
  const date = parseDate(args)
  const { text, warning } = readConfigText(cwd)
  if (text == null) return { enabled: false }
  if (warning) throw new Error(`${warning} isn't enough: docVersions must be set on the base branch`)
  let cfg
  try {
    cfg = JSON.parse(text)
  } catch (e) {
    throw new Error(`.claude/engineering.json is not valid JSON (${e.message})`)
  }
  if (!isPlainObject(cfg)) throw new Error('.claude/engineering.json must hold a JSON object')
  if (cfg.docVersions === undefined) return { enabled: false }
  const read = (p) => {
    try {
      return readFileSync(path.join(cwd, p), 'utf8')
    } catch {
      throw new Error(`can't read "${p}"`)
    }
  }
  // Each set reads the files as the sets before it left them, so two sets can share a version file.
  const changes = {}
  const sets = validateDocVersions(cfg.docVersions).map((entry) => {
    const set = planDocVersions(entry, (p) => changes[p] ?? read(p), date)
    Object.assign(changes, set.changes)
    return set
  })
  for (const [p, body] of Object.entries(changes)) writeFileSync(path.join(cwd, p), body)
  return { enabled: true, date, sets: sets.map(({ changes: _, ...s }) => s), changedFiles: Object.keys(changes) }
}

if (isMainModule(import.meta.url)) {
  try {
    console.log(JSON.stringify(run(process.cwd(), process.argv.slice(2))))
  } catch (e) {
    console.error(`doc-versions: ${e.message}`)
    process.exitCode = 2
  }
}
