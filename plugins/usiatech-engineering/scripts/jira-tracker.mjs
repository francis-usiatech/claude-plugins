// Jira ticket tracker (spec docs/specs/2026-10-09-jira-ticket-tracker.md, R1–R4), shared by the to-tickets,
// approve-plan, verify and release skills. Run it as `node jira-tracker.mjs <command>`; see USAGE below.
// Exit codes: 0 done, 1 a Jira failure, 2 a problem with the arguments or the config.

import { readFileSync } from 'node:fs'
import path from 'node:path'
import { parseArgs } from 'node:util'
import { isMainModule } from '../templates/github/scripts/main-module.mjs'
import { isPlainObject, isNonEmptyString } from '../templates/github/scripts/workflow-rules.mjs'

const TRACKERS = ['github', 'jira']
const EVENTS = ['started', 'verified', 'merged', 'released']
const PROJECT_KEY = /^[A-Z][A-Z0-9_]+$/
const ISSUE_KEY = /^[A-Z][A-Z0-9_]+-\d+$/

// Why a site URL can't be used as a Jira base (not a URL, not https, or more than a host), or null.
// `check` and the client both use it, so a site `check` accepts never fails later as a Jira error.
const siteShapeProblem = (site) => {
  let url
  try {
    url = new URL(site)
  } catch {
    return 'is not a URL'
  }
  if (url.protocol !== 'https:') return 'must use https'
  if (url.username || url.password || url.port || url.pathname.replace(/\/+$/, '') || url.search || url.hash) {
    return 'must not have a user name, password, port, path, query or fragment'
  }
  return null
}

// "$comment" is the config's note key, allowed at every level and never treated as a setting.
const COMMENT_KEY = '$comment'
const TICKETS_KEYS = ['tracker', 'jira']
const JIRA_KEYS = ['site', 'project', 'issueType', 'parent', 'statuses']
const quoted = (keys) => keys.map((k) => `"${k}"`).join(', ')
const settingEntries = (obj) => Object.entries(obj).filter(([key]) => key !== COMMENT_KEY)

// An unknown key is reported, not ignored, so a typo such as "statues" or "trackr" can't silently change behaviour.
const unknownKeyProblems = (obj, where, known) =>
  settingEntries(obj).filter(([key]) => !known.includes(key)).map(([key]) => `"${where}.${key}" is not a known key; use ${quoted(known)}`)

const statusProblems = (statuses) => {
  if (statuses == null) return []
  if (!isPlainObject(statuses)) return ['"tickets.jira.statuses" must be an object mapping events to status names']
  return settingEntries(statuses).flatMap(([event, name]) =>
    !EVENTS.includes(event) ? [`"tickets.jira.statuses.${event}" is not an event; use ${quoted(EVENTS)}`]
      : !isNonEmptyString(name) ? [`"tickets.jira.statuses.${event}" must be a non-empty status name`]
      : [])
}

const jiraProblems = (j) => {
  if (!isPlainObject(j)) return ['"tickets.jira" must be an object']
  const siteProblem = isNonEmptyString(j.site) && siteShapeProblem(j.site)
  return [
    ...unknownKeyProblems(j, 'tickets.jira', JIRA_KEYS),
    !isNonEmptyString(j.site) ? '"tickets.jira.site" must be an https URL such as https://example.atlassian.net'
      : siteProblem && `"tickets.jira.site" ${siteProblem}; use an https URL such as https://example.atlassian.net`,
    !(isNonEmptyString(j.project) && PROJECT_KEY.test(j.project)) && '"tickets.jira.project" must be an upper-case project key such as "ESP"',
    !isNonEmptyString(j.issueType) && '"tickets.jira.issueType" must be a non-empty issue type name',
    j.parent != null && !(typeof j.parent === 'string' && ISSUE_KEY.test(j.parent)) && '"tickets.jira.parent" must be an issue key such as "ESP-27"',
    ...statusProblems(j.statuses),
  ].filter(Boolean)
}

/**
 * Checks the `tickets` section of .claude/engineering.json (R1). A missing section means the GitHub tracker.
 * Any problem makes the whole section unusable (tickets null), so a skill never files to a half-configured tracker.
 * @param {unknown} raw the `tickets` value, or undefined when the section is missing
 * @returns {{ tickets: { tracker: string, jira?: object }|null, problems: string[] }}
 */
export const validateTicketsConfig = (raw) => {
  if (raw == null) return { tickets: { tracker: 'github' }, problems: [] }
  if (!isPlainObject(raw)) return { tickets: null, problems: ['"tickets" must be an object'] }
  const tracker = raw.tracker ?? 'github'
  // Every level is checked in one run, so fixing one typo doesn't reveal the next only on a rerun.
  const problems = [
    ...unknownKeyProblems(raw, 'tickets', TICKETS_KEYS),
    ...(!TRACKERS.includes(tracker) ? ['"tickets.tracker" must be "github" or "jira"'] : tracker === 'jira' ? jiraProblems(raw.jira) : []),
  ]
  if (problems.length) return { tickets: null, problems }
  if (tracker === 'github') return { tickets: { tracker }, problems: [] }
  const { site, project, issueType, parent, statuses } = raw.jira
  return {
    tickets: { tracker, jira: { site: site.replace(/\/+$/, ''), project, issueType, parent: parent ?? null, statuses: Object.fromEntries(settingEntries(statuses ?? {})) } },
    problems: [],
  }
}

/**
 * Finds the keys of one project in commit-message text (R7), so a release can move them to the released status.
 * A key inside a longer word (XESP-1, ESP-1a, foo_ESP-1, bar-ESP-1) is not a key.
 * @param {string} text commit subjects and bodies
 * @param {string} project the project key, e.g. "ESP"
 * @returns {string[]} the unique keys, in the order first seen
 */
export const findJiraKeys = (text, project) => {
  if (typeof project !== 'string' || !PROJECT_KEY.test(project)) throw new TypeError(`"${project}" is not a project key such as "ESP"`)
  if (typeof text !== 'string') throw new TypeError('text must be a string')
  const pattern = new RegExp(`(?<![A-Za-z0-9_-])${project}-\\d+(?![A-Za-z0-9_])`, 'g')
  return [...new Set(text.match(pattern) ?? [])]
}

/**
 * Reads the Jira credentials and the optional trusted site from the environment (R2, R11). Nothing else is a
 * source of credentials. Unset values stay undefined; the client reports them on first use.
 * @param {Record<string, string|undefined>} env usually process.env
 */
export const credentialsFromEnv = (env) => ({ email: env.JIRA_EMAIL, token: env.JIRA_API_TOKEN, trustedSite: env.JIRA_SITE })

const DEFAULT_TIMEOUT_MS = 30000
const TRUSTED_SUFFIX = '.atlassian.net'
const hostOf = (url) => url.hostname.toLowerCase().replace(/\.$/, '')

// The site comes from the repo's own config, so the token goes only to an Atlassian host or the host the user
// set in JIRA_SITE (R11). Returns the API base URL, or throws the reason the site isn't trusted.
const trustedApiBase = (site, trustedSite) => {
  const problem = siteShapeProblem(site)
  if (problem) throw new Error(`site "${site}" ${problem}`)
  const host = hostOf(new URL(site))
  if (trustedSite != null && trustedSite !== '') {
    let trusted
    try {
      trusted = hostOf(new URL(trustedSite))
    } catch {
      throw new Error(`JIRA_SITE "${trustedSite}" is not a URL`)
    }
    if (host !== trusted) throw new Error(`site host "${host}" does not match JIRA_SITE host "${trusted}"`)
  } else if (!(host.endsWith(TRUSTED_SUFFIX) && host.length > TRUSTED_SUFFIX.length)) {
    throw new Error(`site host "${host}" is not trusted; use an ${TRUSTED_SUFFIX.slice(1)} site or set JIRA_SITE to it`)
  }
  return `https://${host}/rest/api/2`
}

// Jira's error text: errorMessages plus field errors, e.g. "Issue does not exist" or "summary: Summary is required".
const jiraErrorText = (body) => {
  if (!isPlainObject(body)) return ''
  const messages = Array.isArray(body.errorMessages) ? body.errorMessages.filter(isNonEmptyString) : []
  const fields = isPlainObject(body.errors) ? Object.entries(body.errors).map(([field, msg]) => `${field}: ${msg}`) : []
  return [...messages, ...fields].join('; ')
}

const parseJson = (text) => {
  try {
    return JSON.parse(text)
  } catch {
    return null
  }
}

// Node's fetch says only "fetch failed" and keeps the reason (DNS, TLS, refused) in `cause`.
const networkCause = (err) => {
  const cause = err.cause?.code ?? err.cause?.message
  return cause ? `${err.message} (${cause})` : err.message
}

// Runs one fetch with a timeout that also covers reading the body, never following redirects, and turns every
// failure into a plain cause.
const sendRequest = async (doFetch, url, init, timeoutMs) => {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)
  let res
  let text
  try {
    res = await doFetch(url, { ...init, redirect: 'manual', signal: controller.signal })
    text = await res.text()
  } catch (err) {
    throw new Error(controller.signal.aborted ? `timed out after ${timeoutMs} ms` : `network error: ${networkCause(err)}`)
  } finally {
    clearTimeout(timer)
  }
  if (res.status >= 300 && res.status < 400) throw new Error(`HTTP ${res.status} (redirects are not followed)`)
  if (!res.ok) {
    const detail = jiraErrorText(parseJson(text))
    throw new Error(`HTTP ${res.status}${detail ? `: ${detail}` : ''}`)
  }
  if (!text) return null
  const body = parseJson(text)
  if (body == null) throw new Error(`HTTP ${res.status} with a response that is not JSON`)
  return body
}

/**
 * A Jira Cloud REST client (R3, R4, R11), on API v2 so descriptions and comments can be plain text. `fetch` is
 * injected so tests never touch the network (ADR-0001's testing rule). Every method rejects with
 * `Jira <action> <issue key or "title"> failed: <cause>` and sends nothing after the first failure.
 * @param {{ site: string, email?: string, token?: string, trustedSite?: string, fetch?: typeof fetch, timeoutMs?: number }} opts
 */
export const createJiraClient = ({ site, email, token, trustedSite, fetch: doFetch = globalThis.fetch, timeoutMs = DEFAULT_TIMEOUT_MS }) => {
  const issuePath = (key) => `/issue/${encodeURIComponent(key)}`

  const request = async (method, pathname, body) => {
    if (!isNonEmptyString(email)) throw new Error('JIRA_EMAIL is not set')
    if (!isNonEmptyString(token)) throw new Error('JIRA_API_TOKEN is not set')
    const api = trustedApiBase(site, trustedSite)
    return sendRequest(doFetch, api + pathname, {
      method,
      headers: {
        Authorization: `Basic ${Buffer.from(`${email}:${token}`).toString('base64')}`,
        Accept: 'application/json',
        ...(body ? { 'Content-Type': 'application/json' } : {}),
      },
      body: body ? JSON.stringify(body) : undefined,
    }, timeoutMs)
  }

  // Prefixes any failure with the action and the issue it was for, so the skill can report exactly what failed.
  const action = (what, fn) => fn().catch((err) => {
    throw new Error(`Jira ${what} failed: ${err.message}`, { cause: err })
  })

  const lookupTransition = async (key, statusName) => {
    const { transitions = [] } = (await request('GET', `${issuePath(key)}/transitions`)) ?? {}
    const want = statusName.toLowerCase()
    return transitions.find((t) => t.to?.name?.toLowerCase() === want)?.id ?? null
  }

  return {
    /** Creates an issue and returns its key. */
    createIssue: ({ project, issueType, parent, summary, description }) => action(`create "${summary}"`, async () => {
      const fields = { project: { key: project }, issuetype: { name: issueType }, summary, description }
      if (parent) fields.parent = { key: parent }
      const created = await request('POST', '/issue', { fields })
      if (!isNonEmptyString(created?.key)) throw new Error('the response has no issue key')
      return created.key
    }),
    /** Records that `blocker` blocks `blocked`. */
    linkBlocks: (blocker, blocked) => action(`link ${blocker} blocks ${blocked}`, async () => {
      await request('POST', '/issueLink', { type: { name: 'Blocks' }, inwardIssue: { key: blocker }, outwardIssue: { key: blocked } })
    }),
    /** Adds a plain-text comment. */
    addComment: (key, text) => action(`comment on ${key}`, async () => {
      await request('POST', `${issuePath(key)}/comment`, { body: text })
    }),
    /** The ID of the transition that moves `key` to `statusName` (any case), or null. Read-only. */
    findTransition: (key, statusName) => action(`transition lookup for ${key}`, () => lookupTransition(key, statusName)),
    /** Moves `key` to `statusName` through the matching transition; fails before posting when none matches. */
    transitionTo: (key, statusName) => action(`transition ${key}`, async () => {
      const id = await lookupTransition(key, statusName)
      if (id == null) throw new Error(`no transition to status "${statusName}"`)
      await request('POST', `${issuePath(key)}/transitions`, { transition: { id } })
    }),
  }
}

const DEFAULT_CONFIG = '.claude/engineering.json'
const USAGE = `Usage: node jira-tracker.mjs <command> [options]
  check
  create --summary <text> --body-file <path> [--parent <KEY>]
  link --blocker <KEY> --blocked <KEY>
  comment --issue <KEY> --body-file <path>
  find-transition --issue <KEY> (--status <name> | --event <event>)
  transition --issue <KEY> (--status <name> | --event <event>)
  keys --messages-file <path>   (the project's keys in commit messages; sends nothing)
Every command takes --config <path> (default ${DEFAULT_CONFIG}) and prints one line of JSON.
Credentials come from JIRA_EMAIL and JIRA_API_TOKEN only; events are ${EVENTS.join(', ')}.`

const CLI_OPTIONS = Object.fromEntries(
  ['config', 'summary', 'body-file', 'messages-file', 'parent', 'blocker', 'blocked', 'issue', 'status', 'event'].map((name) => [name, { type: 'string' }]))

// A problem with the arguments or the config (exit 2), as opposed to a Jira failure (exit 1).
class UsageError extends Error {}

// The first argument that looks like an option but isn't one, skipping the value that follows a known option.
const unknownOption = (argv) => {
  for (let i = 0; i < argv.length; i++) {
    if (!argv[i].startsWith('-')) continue
    const name = argv[i].split('=')[0]
    if (!(name.startsWith('--') && Object.hasOwn(CLI_OPTIONS, name.slice(2)))) return name
    if (!argv[i].includes('=')) i++
  }
  return null
}

// Unknown options are refused by name only and parse errors aren't echoed, so a value typed after an option
// (say a token) is never printed.
const parseCliArgs = (argv) => {
  const unknown = unknownOption(argv)
  if (unknown != null) throw new UsageError(`unknown option ${unknown.startsWith('--') ? unknown : 'starting with "-"'}\n${USAGE}`)
  let parsed
  try {
    parsed = parseArgs({ args: argv, options: CLI_OPTIONS, allowPositionals: true, strict: true })
  } catch (err) {
    const option = /'(--[a-z-]+)/.exec(err.message)?.[1]
    throw new UsageError(`${option ?? 'an option'} needs a value; write a value that starts with "-" as --option=value\n${USAGE}`)
  }
  const [command, ...extra] = parsed.positionals
  if (command == null) throw new UsageError(USAGE)
  if (extra.length) throw new UsageError(`"${command}" takes options only, not ${extra.length} more argument(s)\n${USAGE}`)
  return { command, values: parsed.values }
}

const requireOption = (values, name) => {
  if (!isNonEmptyString(values[name])) throw new UsageError(`--${name} is required`)
  return values[name]
}

const requireIssueKey = (values, name) => {
  const key = requireOption(values, name)
  if (!ISSUE_KEY.test(key)) throw new UsageError(`--${name} must be an issue key such as "ESP-27"`)
  return key
}

// The text of the file a required option names, relative to cwd.
const readOptionFile = (cwd, values, name) => {
  const file = requireOption(values, name)
  let text
  try {
    text = readFileSync(path.resolve(cwd, file), 'utf8')
  } catch (err) {
    throw new UsageError(`cannot read --${name} ${file}: ${err.message}`)
  }
  // UTF-8 text has no NUL; a PowerShell 5.1 redirect writes UTF-16, which would silently match nothing.
  if (text.includes('\0')) throw new UsageError(`--${name} ${file} is not UTF-8; regenerate from a POSIX shell`)
  return { file, text }
}

const readBodyFile = (cwd, values) => {
  const { file, text } = readOptionFile(cwd, values, 'body-file')
  if (text.trim() === '') throw new UsageError(`--body-file ${file} is empty`)
  return text.trimEnd()
}

// The checked `tickets` section of the config file; any problem is a usage error naming the key.
const loadTickets = (cwd, file) => {
  let raw
  try {
    raw = readFileSync(path.resolve(cwd, file), 'utf8')
  } catch (err) {
    throw new UsageError(`cannot read the config ${file}: ${err.message}`)
  }
  let cfg
  try {
    cfg = JSON.parse(raw)
  } catch (err) {
    throw new UsageError(`${file} could not be parsed: ${err.message}`)
  }
  if (!isPlainObject(cfg)) throw new UsageError(`${file} is not a JSON object`)
  const { tickets, problems } = validateTicketsConfig(cfg.tickets)
  if (problems.length) throw new UsageError(`${file}: ${problems.join('; ')}`)
  return tickets
}

// The status to move to: --status by name, or --event through the configured map (null when none is configured).
const targetStatus = (values, statuses) => {
  if ((values.status == null) === (values.event == null)) throw new UsageError('exactly one of --status or --event is required')
  if (values.status != null) return { status: requireOption(values, 'status') }
  if (!EVENTS.includes(values.event)) throw new UsageError(`--event "${values.event}" is not an event; use ${EVENTS.join(', ')}`)
  return { event: values.event, status: statuses[values.event] ?? null }
}

const noStatusFor = (event) => `no status is configured for "${event}"`

// Each command checks its own options before the first request and returns the object to print.
const JIRA_COMMANDS = {
  create: async ({ client, jira, values, cwd }) => {
    const summary = requireOption(values, 'summary')
    const description = readBodyFile(cwd, values)
    const parent = values.parent == null ? jira.parent : requireIssueKey(values, 'parent')
    return { key: await client().createIssue({ project: jira.project, issueType: jira.issueType, parent, summary, description }) }
  },
  link: async ({ client, values }) => {
    const blocker = requireIssueKey(values, 'blocker')
    const blocked = requireIssueKey(values, 'blocked')
    await client().linkBlocks(blocker, blocked)
    return { blocker, blocked }
  },
  comment: async ({ client, values, cwd }) => {
    const issue = requireIssueKey(values, 'issue')
    await client().addComment(issue, readBodyFile(cwd, values))
    return { issue, commented: true }
  },
  'find-transition': async ({ client, jira, values }) => {
    const issue = requireIssueKey(values, 'issue')
    const { event, status } = targetStatus(values, jira.statuses)
    if (status == null) return { issue, event, transitionId: null, reason: noStatusFor(event) }
    const transitionId = await client().findTransition(issue, status)
    if (transitionId == null) throw new Error(`Jira transition lookup for ${issue} failed: no transition to status "${status}"`)
    return { issue, status, transitionId }
  },
  transition: async ({ client, jira, values }) => {
    const issue = requireIssueKey(values, 'issue')
    const { event, status } = targetStatus(values, jira.statuses)
    if (status == null) return { issue, event, transitioned: false, reason: noStatusFor(event) }
    await client().transitionTo(issue, status)
    return { issue, status, transitioned: true }
  },
  // Reads commit messages from a file (an empty one is fine: no commits since the last tag) and sends nothing.
  keys: async ({ jira, values, cwd }) => {
    const { text } = readOptionFile(cwd, values, 'messages-file')
    return { project: jira.project, keys: findJiraKeys(text, jira.project) }
  },
}

const runCommand = async (argv, { email, token, trustedSite, doFetch, cwd }) => {
  const { command, values } = parseCliArgs(argv)
  if (command !== 'check' && !Object.hasOwn(JIRA_COMMANDS, command)) throw new UsageError(`unknown command "${command}"\n${USAGE}`)
  const file = values.config ?? DEFAULT_CONFIG
  const tickets = loadTickets(cwd, file)
  if (command === 'check') return tickets
  if (tickets.tracker !== 'jira') throw new UsageError(`"tickets.tracker" is "${tickets.tracker}" in ${file}, so there is nothing for the Jira script to do`)
  const client = () => createJiraClient({ site: tickets.jira.site, email, token, trustedSite, fetch: doFetch })
  return JIRA_COMMANDS[command]({ client, jira: tickets.jira, values, cwd })
}

// Replaces the token and the Basic credential built from it, in case Jira or a proxy echoes them back (R2).
// A raw token under 16 characters isn't a real API token, and replacing it would corrupt ordinary output.
const MIN_REDACTED_TOKEN = 16
const redactor = (email, token) => {
  if (!isNonEmptyString(token)) return (text) => text
  const secrets = [Buffer.from(`${email}:${token}`).toString('base64'), ...(token.length >= MIN_REDACTED_TOKEN ? [token] : [])]
  return (text) => secrets.reduce((out, secret) => out.split(secret).join('***'), text)
}

/**
 * Runs one CLI command (R2–R4) and returns what to print and the exit code, so tests can call it without a
 * process. It writes no file, and takes credentials from `env` only, never from an option or the config.
 * @param {string[]} argv the arguments after the script name
 * @param {{ env?: Record<string, string|undefined>, fetch?: typeof fetch, cwd?: string }} [opts]
 * @returns {Promise<{ code: number, stdout: string, stderr: string }>}
 */
export const runCli = async (argv, { env = process.env, fetch: doFetch = globalThis.fetch, cwd = process.cwd() } = {}) => {
  const { email, token, trustedSite } = credentialsFromEnv(env)
  const redact = redactor(email, token)
  try {
    const result = await runCommand(argv, { email, token, trustedSite, doFetch, cwd })
    return { code: 0, stdout: redact(`${JSON.stringify(result)}\n`), stderr: '' }
  } catch (err) {
    return { code: err instanceof UsageError ? 2 : 1, stdout: '', stderr: redact(`jira-tracker: ${err.message}\n`) }
  }
}

if (isMainModule(import.meta.url)) {
  runCli(process.argv.slice(2)).then(({ code, stdout, stderr }) => {
    if (stdout) process.stdout.write(stdout)
    if (stderr) process.stderr.write(stderr)
    process.exitCode = code
  }, (err) => {
    console.error(`jira-tracker: ${err.message}`)
    process.exitCode = 2
  })
}
