// usiatech-engineering: advice at the start of release and approve-plan. Warns when this session runs an older plugin
// version than the newest one installed (ESP-120), and recommends a fresh session once per session when the context
// is above session.contextAdvisoryTokens (ESP-121). Advice only: it never blocks. Node built-ins only.
import { execFileSync } from 'node:child_process'
import { closeSync, existsSync, openSync, readdirSync, readFileSync, readSync, statSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { checkedStateDir, stateDir } from '../hooks/scripts/governance-state.mjs'
import { isMainModule } from '../templates/github/scripts/main-module.mjs'
import { isPlainObject } from '../templates/github/scripts/governance-rules.mjs'

export const DEFAULT_CONTEXT_TOKENS = 300000
const SEMVER = /^(\d+)\.(\d+)\.(\d+)$/
// The last usage record sits near the end; reading only the tail keeps a long session's transcript cheap.
const TAIL_BYTES = 4 * 1024 * 1024

const readJson = (file) => JSON.parse(readFileSync(file, 'utf8'))
const compareVersions = (a, b) => {
  const [x, y] = [a.match(SEMVER), b.match(SEMVER)]
  for (let i = 1; i <= 3; i++) if (Number(x[i]) !== Number(y[i])) return Number(x[i]) - Number(y[i])
  return 0
}
const kTokens = (n) => `${Math.round(n / 1000)}k`

/**
 * A warning naming the running and newest cached versions when the plugin at pluginRoot is older than the newest
 * version folder next to it (the plugin cache keeps one folder per version), or null. A source checkout has no
 * version folders, so it gets null.
 */
export const pluginVersionWarning = ({ pluginRoot }) => {
  const manifest = path.join(pluginRoot, '.claude-plugin', 'plugin.json')
  if (!existsSync(manifest)) return null
  const running = readJson(manifest).version
  if (typeof running !== 'string' || !SEMVER.test(running)) return null
  const newest = readdirSync(path.dirname(pluginRoot)).filter((n) => SEMVER.test(n)).sort(compareVersions).at(-1)
  if (!newest || compareVersions(newest, running) <= 0) return null
  return `This session runs usiatech-engineering ${running}, but ${newest} is installed. Save the session and start a new session so the newer rules load.`
}

/** Claude Code's transcript folder name for a working directory: every character other than a letter or digit becomes "-". */
export const projectSlug = (cwd) => cwd.replace(/[^A-Za-z0-9]/g, '-')

const findProjectDir = (projectsDir, cwd) => {
  if (!existsSync(projectsDir)) return null
  const want = projectSlug(cwd).toLowerCase()
  const name = readdirSync(projectsDir).find((n) => n.toLowerCase() === want)
  return name ? path.join(projectsDir, name) : null
}

const newestTranscript = (dir) => readdirSync(dir)
  .filter((n) => n.endsWith('.jsonl'))
  .map((n) => ({ file: path.join(dir, n), mtime: statSync(path.join(dir, n)).mtimeMs }))
  .sort((a, b) => b.mtime - a.mtime)[0]?.file ?? null

const readTail = (file) => {
  const size = statSync(file).size
  const length = Math.min(size, TAIL_BYTES)
  const buf = Buffer.alloc(length)
  const fd = openSync(file, 'r')
  try {
    readSync(fd, buf, 0, length, size - length)
  } finally {
    closeSync(fd)
  }
  return buf.toString('utf8')
}

// Context of the last assistant call: input plus cache write plus cache read tokens.
const lastContextTokens = (file) => {
  const lines = readTail(file).split('\n').reverse()
  for (const line of lines) {
    if (!line.includes('"usage"')) continue
    let rec
    try {
      rec = JSON.parse(line)
    } catch {
      continue // the first line of the tail can be cut in half
    }
    const u = rec?.type === 'assistant' ? rec.message?.usage : null
    if (u) return (u.input_tokens || 0) + (u.cache_creation_input_tokens || 0) + (u.cache_read_input_tokens || 0)
  }
  return null
}

/**
 * A recommendation to compact or start a fresh session when the current session's last context is above threshold,
 * or null. Shown once per session: a marker file in the folder markerDir() returns records that it was shown. It is
 * called only when the advisory is due, so a run below the threshold creates no folder.
 */
export const contextAdvisory = ({ projectsDir, cwd, threshold, markerDir }) => {
  const dir = findProjectDir(projectsDir, cwd)
  const file = dir && newestTranscript(dir)
  if (!file) return null
  const tokens = lastContextTokens(file)
  if (tokens == null || tokens <= threshold) return null
  const folder = markerDir()
  const marker = path.join(folder, `session-check-${path.basename(file, '.jsonl')}.context`)
  if (existsSync(marker)) return null
  writeFileSync(marker, new Date().toISOString())
  return `This session's context is ${kTokens(tokens)}, above the ${kTokens(threshold)} advisory threshold. Compact, or save the session and continue in a fresh session, before the review round: every call re-reads the whole context.`
}

// The config text and a warning when it came from the working copy instead of the base branch.
const readConfigText = (cwd) => {
  let base = 'develop'
  const local = path.join(cwd, '.claude', 'engineering.json')
  if (existsSync(local)) {
    try {
      const b = readJson(local)?.git?.baseBranch
      if (typeof b === 'string' && b.trim()) base = b
    } catch {
      // a broken working copy still lets the base-branch copy decide
    }
  }
  try {
    // --end-of-options: a base such as "--output=x" is a revision, never an option.
    const text = execFileSync('git', ['show', '--end-of-options', `${base}:.claude/engineering.json`], { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] })
    return { text, warning: null }
  } catch {
    if (!existsSync(local)) return { text: null, warning: null }
    return { text: readFileSync(local, 'utf8'), warning: `the base branch "${base}" has no readable .claude/engineering.json; using the working copy` }
  }
}

/** session.contextAdvisoryTokens from the base-branch .claude/engineering.json (F11), else the working copy, else the default. */
export const readThreshold = ({ cwd }) => {
  const { text, warning: source } = readConfigText(cwd)
  const result = (threshold, problem) => ({ threshold, warning: [source, problem].filter(Boolean).join('; ') || null })
  if (text == null) return result(DEFAULT_CONTEXT_TOKENS, null)
  let cfg
  try {
    cfg = JSON.parse(text)
  } catch (e) {
    return result(DEFAULT_CONTEXT_TOKENS, `.claude/engineering.json is not valid JSON (${e.message}); using the ${DEFAULT_CONTEXT_TOKENS} default`)
  }
  const session = isPlainObject(cfg) ? cfg.session : undefined
  if (!isPlainObject(session) || !('contextAdvisoryTokens' in session)) return result(DEFAULT_CONTEXT_TOKENS, null)
  const v = session.contextAdvisoryTokens
  if (Number.isSafeInteger(v) && v > 0) return result(v, null)
  return result(DEFAULT_CONTEXT_TOKENS, `"session.contextAdvisoryTokens" must be a positive whole number; using the ${DEFAULT_CONTEXT_TOKENS} default`)
}

/** Runs each check on its own, so one that throws doesn't hide another's advice. */
export const runChecks = (checks) => {
  const lines = []
  const errors = []
  for (const check of checks) {
    try {
      const line = check()
      if (line) lines.push(line)
    } catch (e) {
      errors.push(e.message)
    }
  }
  return { lines, errors }
}

if (isMainModule(import.meta.url)) {
  const cwd = process.cwd()
  const pluginRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
  const projectsDir = path.join(process.env.CLAUDE_CONFIG_DIR || path.join(homedir(), '.claude'), 'projects')
  // The guard's private per-project state folder, not a name any local user could create first in a shared /tmp.
  const markerDir = () => checkedStateDir(stateDir(cwd), { create: true, what: 'session-check marker' })
  const { lines, errors } = runChecks([
    () => pluginVersionWarning({ pluginRoot }),
    () => {
      const { threshold, warning } = readThreshold({ cwd })
      if (warning) console.error(`session-check: ${warning}`)
      return contextAdvisory({ projectsDir, cwd, threshold, markerDir })
    },
  ])
  for (const l of lines) console.log(l)
  for (const e of errors) console.error(`session-check: ${e}`)
  if (errors.length) process.exitCode = 1
}
