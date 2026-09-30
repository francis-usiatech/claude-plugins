// Network lookups for the supply-chain rules (R3, R4, R5; D1, D2, D4, D5), shared by the guard and the CI check.
// The lookups are injected, so tests pass stubs and never touch the network. A failed or timed-out lookup is
// reported in `failures`; the guard logs it and fails open, CI fails closed (R13, R14).
import path from 'node:path'
import { diffDependencies, isNonRegistrySpec, lineOfName, TIER } from './supply-chain-rules.mjs'

export const LOOKUP = { ADVISORIES: 'advisories', REGISTRY: 'registry' }
// The guard's lookups share one deadline inside the 10 s hook timeout; CI gives each request its own timeout (D5)
// and bounds the whole run so a slow registry can't hold the job for long.
export const GUARD_DEADLINE_MS = 6000
export const CI_TIMEOUT_MS = 20000
export const CI_DEADLINE_MS = 120000
const REGISTRY_CONCURRENCY = 8
const REGISTRY_URL = 'https://registry.npmjs.org'
const ADVISORY_URL = `${REGISTRY_URL}/-/npm/v1/security/advisories/bulk`
const VALID_NAME = /^(?:@[a-z0-9~-][a-z0-9._~-]*\/)?[a-z0-9~-][a-z0-9._~-]*$/i
const SEVERITIES = ['low', 'moderate', 'high', 'critical']
const INSTALL_HOOKS = ['preinstall', 'install', 'postinstall']

// The lowest version a range names (`^1.2.3` → 1.2.3, `~1.2` → 1.2.0), or null for `*`, `latest` and other
// ranges without a number, which are looked up at dist-tags.latest (D4).
const baseVersion = (range) => {
  const m = /(\d+)(?:\.(\d+))?(?:\.(\d+))?(-[0-9A-Za-z.-]+)?/.exec(String(range))
  return m ? `${m[1]}.${m[2] ?? 0}.${m[3] ?? 0}${m[4] ?? ''}` : null
}

/**
 * The packages to look up for a set of changed dependency files (D4, D5, D9). Each file is { file, content, base }.
 * A manifest entry uses the exact version its lockfile in the same directory records in this change, otherwise
 * the base version of its range. Added manifest entries are `direct` and get registry lookups; every entry gets
 * an advisory lookup. Non-registry specifiers and files that don't parse (already `sc-unparsed`) are skipped.
 * @returns {{ name: string, version: string|null, direct: boolean, file: string, line: number }[]}
 */
export const lookupTargets = (files) => {
  const diffs = files.map((f) => ({ ...f, ...diffDependencies(f) })).filter((d) => d.kind && !d.problems.length)
  const locked = new Map()
  for (const d of diffs) {
    // Only a registry version may stand in for the manifest range; a URL or git version would skip the lookup.
    if (d.kind !== 'manifest') for (const c of d.changes) if (!isNonRegistrySpec(c.version)) locked.set(`${path.posix.dirname(d.file)}\0${c.name}`, c.version)
  }
  const targets = []
  const seen = new Set()
  const add = (t) => {
    const key = `${t.name}@${t.version}`
    if (seen.has(key)) return
    seen.add(key)
    targets.push(t)
  }
  for (const d of diffs.filter((x) => x.kind === 'manifest')) {
    for (const c of d.changes) {
      if (isNonRegistrySpec(c.version)) continue
      const version = locked.get(`${path.posix.dirname(d.file)}\0${c.name}`) ?? baseVersion(c.version)
      add({ name: c.name, version, direct: c.previous == null, file: d.file, line: lineOfName(d.content, c.name) })
    }
  }
  for (const d of diffs.filter((x) => x.kind !== 'manifest')) {
    // A git or URL version (pnpm keys such as `gh@git+https://…#sha`) isn't on the registry; sc-resolved checks its source.
    for (const c of d.changes) if (!isNonRegistrySpec(c.version)) add({ name: c.name, version: c.version, direct: false, file: d.file, line: lineOfName(d.content, c.name) })
  }
  return targets
}

/**
 * Advisory findings (R3): one per package with advisories, at the first target naming it. Critical or high is
 * high risk, moderate or low a warning. A severity the rules don't know is treated as high, so it isn't missed.
 * `advisories` is the bulk endpoint's response: { name: [{ severity, title, ... }] }.
 */
export const advisoryFindings = ({ targets, advisories }) => {
  const findings = []
  const done = new Set()
  for (const t of targets) {
    // Own properties only, so a package named `constructor` or `__proto__` can't read from the prototype.
    const list = advisories != null && typeof advisories === 'object' && Object.hasOwn(advisories, t.name) ? advisories[t.name] : undefined
    if (done.has(t.name) || !Array.isArray(list) || !list.length) continue
    done.add(t.name)
    const rank = (a) => (SEVERITIES.includes(a.severity) ? SEVERITIES.indexOf(a.severity) : SEVERITIES.length)
    const worst = list.reduce((a, b) => (rank(b) > rank(a) ? b : a))
    const tier = rank(worst) >= SEVERITIES.indexOf('high') ? TIER.HIGH : TIER.WARNING
    const count = list.length === 1 ? '1 known advisory' : `${list.length} known advisories`
    findings.push({ rule: 'sc-advisory', tier, file: t.file, line: t.line, package: t.name, detail: `"${t.name}" has ${count}; the most severe is ${worst.severity ?? 'of unknown severity'}: ${worst.title ?? 'untitled'}${worst.url ? ` (${worst.url})` : ''}.` })
  }
  return findings
}

/**
 * Registry findings for one added direct dependency (R4, R5, D9). `result` is { found: false } for a registry 404,
 * otherwise { found: true, version, deprecated, latestTime, scripts } for the version looked up.
 */
export const registryFindings = ({ target, result, now = Date.now() }) => {
  const at = { file: target.file, line: target.line, package: target.name }
  if (!result.found) {
    return [{ rule: 'sc-not-found', tier: TIER.WARNING, ...at, detail: `"${target.name}" is not on the public npm registry; if it is meant to come from a private registry, this is a dependency confusion risk.` }]
  }
  const findings = []
  if (result.deprecated) findings.push({ rule: 'sc-deprecated', tier: TIER.WARNING, ...at, detail: `"${target.name}@${result.version}" is deprecated: ${result.deprecated}` })
  const cutoff = new Date(now)
  cutoff.setUTCFullYear(cutoff.getUTCFullYear() - 2)
  const latest = Date.parse(result.latestTime)
  if (latest < cutoff.getTime()) findings.push({ rule: 'sc-stale', tier: TIER.WARNING, ...at, detail: `"${target.name}" has had no release since ${result.latestTime.slice(0, 10)}, more than 2 years ago.` })
  const hooks = INSTALL_HOOKS.filter((h) => result.scripts?.[h])
  if (hooks.length) findings.push({ rule: 'sc-install-script', tier: TIER.WARNING, ...at, detail: `"${target.name}@${result.version}" runs ${hooks.join(', ')} script(s) when installed; check what they do.` })
  return findings
}

const eachLimited = async (items, limit, fn) => {
  let next = 0
  const worker = async () => {
    while (next < items.length) await fn(items[next++])
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker))
}

/**
 * Runs the registry lookups (added direct dependencies, 8 at a time) and then one bulk advisory lookup, under one
 * shared deadline (D5). Open ranges are advised at the registry's latest version: a target with no version gets a
 * registry lookup to find it even when it isn't direct, with only a 404 reported for it. A lookup that throws or misses
 * the deadline becomes one failure per lookup, and the other lookup's findings are still returned (R13, R14).
 * @param {{ targets: object[], lookups: { registry: Function, advisories: Function }, deadlineMs?: number, now?: number }} opts
 * @returns {Promise<{ findings: object[], failures: { lookup: string, reason: string }[] }>}
 */
export const runLookups = async ({ targets, lookups, deadlineMs = GUARD_DEADLINE_MS, now = Date.now() }) => {
  const findings = []
  const failures = []
  if (!targets.length) return { findings, failures }
  const controller = new AbortController()
  const { signal } = controller
  const timedOut = () => new Error(`timed out after ${deadlineMs} ms`)
  let timer
  const expired = new Promise((resolve, reject) => {
    timer = setTimeout(() => {
      controller.abort()
      reject(timedOut())
    }, deadlineMs)
  })
  expired.catch(() => {}) // Observed through each race below; this only stops an unhandled-rejection warning.
  // Races a lookup against the deadline, so a lookup that ignores the abort signal can't hold the hook open.
  const call = (fn) => (signal.aborted ? Promise.reject(timedOut()) : Promise.race([Promise.resolve().then(fn), expired]))
  try {
    // Keyed by name and version, so a widened entry (no version) can't replace a direct add of the same name.
    const registryTargets = [...new Map(targets.filter((t) => t.direct || t.version == null).map((t) => [`${t.name}@${t.version ?? ''}`, t])).values()]
    const latest = new Map()
    const errors = []
    await eachLimited(registryTargets, REGISTRY_CONCURRENCY, async (t) => {
      try {
        const result = await call(() => lookups.registry(t.name, t.version, { signal }))
        if (result.found && t.version == null) latest.set(t.name, result.version)
        if (t.direct || !result.found) findings.push(...registryFindings({ target: t, result, now }))
      } catch (err) {
        errors.push(err)
      }
    })
    if (errors.length) failures.push({ lookup: LOOKUP.REGISTRY, reason: `${errors.length} of ${registryTargets.length} registry lookup(s) failed: ${errors[0].message}` })

    const versioned = targets.map((t) => ({ ...t, version: t.version ?? latest.get(t.name) ?? null })).filter((t) => t.version)
    // A Map, not an object literal: package names such as `constructor` and `__proto__` are valid.
    const entries = new Map()
    for (const t of versioned) {
      const versions = entries.get(t.name) ?? []
      if (!versions.includes(t.version)) versions.push(t.version)
      entries.set(t.name, versions)
    }
    if (versioned.length) {
      try {
        const advisories = await call(() => lookups.advisories(Object.fromEntries(entries), { signal }))
        findings.push(...advisoryFindings({ targets: versioned, advisories }))
      } catch (err) {
        failures.push({ lookup: LOOKUP.ADVISORIES, reason: `advisory lookup failed: ${err.message}` })
      }
    }
  } finally {
    clearTimeout(timer)
  }
  return { findings, failures }
}

/**
 * The real lookups against registry.npmjs.org (D1, D2). `fetch` is injectable for tests; `timeoutMs` gives each
 * request its own timeout (CI) on top of the caller's signal (the guard's shared deadline).
 */
export const createLookups = ({ fetch = globalThis.fetch, timeoutMs = null } = {}) => {
  const request = async (url, init, signal) => {
    const controller = new AbortController()
    const abort = () => controller.abort()
    if (signal?.aborted) abort()
    else signal?.addEventListener('abort', abort, { once: true })
    const timer = timeoutMs ? setTimeout(abort, timeoutMs) : null
    try {
      const res = await fetch(url, { ...init, signal: controller.signal })
      return { status: res.status, body: res.ok ? await res.json() : null }
    } finally {
      clearTimeout(timer)
      signal?.removeEventListener('abort', abort)
    }
  }
  const isObject = (v) => v != null && typeof v === 'object' && !Array.isArray(v)

  return {
    /** Bulk advisories for { name: [versions] }; resolves to { name: [advisory] }. */
    advisories: async (entries, { signal } = {}) => {
      const { status, body } = await request(ADVISORY_URL, { method: 'POST', headers: { 'content-type': 'application/json', accept: 'application/json' }, body: JSON.stringify(entries) }, signal)
      if (status < 200 || status >= 300) throw new Error(`HTTP ${status} from the npm advisory endpoint`)
      if (!isObject(body)) throw new Error('unexpected response from the npm advisory endpoint')
      return body
    },
    /** Registry data for one version (null: dist-tags.latest); { found: false } on a 404. */
    registry: async (name, version, { signal } = {}) => {
      if (typeof name !== 'string' || name.length > 214 || !VALID_NAME.test(name)) throw new Error(`invalid package name "${name}"`)
      const { status, body } = await request(`${REGISTRY_URL}/${name.replace('/', '%2F')}`, { headers: { accept: 'application/json' } }, signal)
      if (status === 404) return { found: false }
      if (status < 200 || status >= 300) throw new Error(`HTTP ${status} from the npm registry for "${name}"`)
      const latest = body?.['dist-tags']?.latest
      if (!isObject(body?.versions) || !latest) throw new Error(`unexpected registry response for "${name}"`)
      // A base version the registry never published (`^1.2` → 1.2.0) is checked at latest instead.
      // Own properties only: a version such as `__proto__` must not read from the prototype.
      const own = (obj, key) => (isObject(obj) && Object.hasOwn(obj, key) ? obj[key] : undefined)
      const used = version != null && isObject(own(body.versions, version)) ? version : latest
      const meta = own(body.versions, used) ?? {}
      return { found: true, version: used, deprecated: meta.deprecated ? String(meta.deprecated) : null, latestTime: own(body.time, latest) ?? null, scripts: isObject(meta.scripts) ? meta.scripts : {} }
    },
  }
}
