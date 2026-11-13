// The gate's run record (ESP-162, ESP-161): the hash of the working tree a run checked, the hash of its config, and
// the steps that passed with the time each passed. `gate.mjs --resume` reuses the passed steps at an unchanged tree,
// and `--rerun-fix` reruns only what a fix changed since the last full pass. The record lives in the repo's git
// folder (`git rev-parse --git-path usiatech-gate`), so it is never committed and stays with the clone.
// Node built-ins, plus isPlainObject from workflow-rules.mjs (itself built-ins only).
import { execFileSync } from 'node:child_process'
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs'
import { createHash } from 'node:crypto'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { isPlainObject } from '../../templates/github/scripts/workflow-rules.mjs'

const RECORD_DIR = 'usiatech-gate'
export const LAST_RUN = 'last-run.json'
export const LAST_FULL_PASS = 'last-full-pass.json'
const HASH = /^[0-9a-f]{40,64}$/

const git = (root, args, env) => execFileSync('git', args, { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], env: env ?? process.env, maxBuffer: 64 * 1024 * 1024 }).trim()

/**
 * The tree hash of the working tree: tracked files as they are now, plus untracked files git doesn't ignore. Built in
 * a temporary copy of the index, so the real index and the staging area are left alone. Throws when git fails.
 * @returns {string}
 */
export const treeHash = (root) => {
  const dir = mkdtempSync(path.join(tmpdir(), 'usiatech-gate-index-'))
  try {
    const index = path.join(dir, 'index')
    // Starting from the real index keeps git's file-stat cache, so unchanged files aren't hashed again.
    const realIndex = path.resolve(root, git(root, ['rev-parse', '--git-path', 'index']))
    if (existsSync(realIndex)) copyFileSync(realIndex, index)
    const env = { ...process.env, GIT_INDEX_FILE: index }
    git(root, ['add', '-A', '--', '.'], env)
    return git(root, ['write-tree'], env)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
}

/** The sha256 of `.claude/engineering.json` as it is on disk, or of nothing when it is missing. */
export const configHash = (root) => {
  const file = path.join(root, '.claude', 'engineering.json')
  return createHash('sha256').update(existsSync(file) ? readFileSync(file) : '').digest('hex')
}

/**
 * The files that differ between two trees, relative to the repo root (renames as both paths). Throws when git fails,
 * for example when a tree is no longer in the object store.
 * @returns {string[]}
 */
export const changedBetween = (root, fromTree, toTree) => execFileSync('git', ['-c', 'core.quotePath=false', 'diff-tree', '-r', '--name-only', '--no-renames', '-z', fromTree, toTree], { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], maxBuffer: 64 * 1024 * 1024 })
  .split('\0').filter(Boolean)

const recordDir = (root) => path.resolve(root, git(root, ['rev-parse', '--git-path', RECORD_DIR]))

// A record is trusted only in the shape the gate writes; anything else reads as no record, so the gate runs in full.
const validRecord = (r) => isPlainObject(r)
  && HASH.test(r.tree) && typeof r.config === 'string' && typeof r.base === 'string'
  && isPlainObject(r.steps)
  && Object.values(r.steps).every((at) => typeof at === 'string')

/**
 * Reads one record file. A missing, unreadable or malformed record is null, with a note when it existed.
 * @returns {{ record: object|null, note: string|null }}
 */
export const readRecord = (root, name) => {
  let file
  try {
    file = path.join(recordDir(root), name)
    if (!existsSync(file)) return { record: null, note: null }
    const record = JSON.parse(readFileSync(file, 'utf8'))
    return validRecord(record) ? { record, note: null } : { record: null, note: `the run record ${name} is malformed` }
  } catch (e) {
    return { record: null, note: `the run record ${name} could not be read (${(e.stderr || e.message).replace(/\s+/g, ' ').trim()})` }
  }
}

/** Writes one record file, replacing it in one rename so a reader never sees half a file. Throws on failure. */
export const writeRecord = (root, name, record) => {
  const dir = recordDir(root)
  mkdirSync(dir, { recursive: true })
  const file = path.join(dir, name)
  const temp = `${file}.${process.pid}.tmp`
  try {
    writeFileSync(temp, JSON.stringify(record, null, 2), { mode: 0o600 })
    renameSync(temp, file)
  } catch (e) {
    rmSync(temp, { force: true })
    throw e
  }
}
