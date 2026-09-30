// npm supply-chain rules (roadmap step 4, B9; spec docs/specs/2026-09-28-security-supply-chain.md R1–R6).
// Shared by the local guard hook and the PR governance checks through governance-rules.mjs, so both give the
// same verdict on the same file. No dependencies: lockfiles are read line by line (pnpm, yarn) or as JSON (npm),
// and only the structures the rules need are parsed. Anything the parser can't read is a problem, never an
// empty list, so an unreadable file can't hide an added dependency.

// Matched case-insensitively: a checkout on a case-insensitive file system treats `Package.JSON` as the manifest.
const KINDS = { 'package.json': 'manifest', 'package-lock.json': 'npm-lock', 'pnpm-lock.yaml': 'pnpm-lock', 'yarn.lock': 'yarn-lock' }

export const MANIFEST_SECTIONS = ['dependencies', 'devDependencies', 'optionalDependencies', 'peerDependencies']

/** The dependency file kind for a repo-relative path, or null. Files under node_modules/ are installed copies, not ours. */
export const dependencyKind = (rel) => {
  const parts = String(rel).replace(/\\/g, '/').split('/')
  if (parts.some((p) => p.toLowerCase() === 'node_modules')) return null
  return KINDS[parts[parts.length - 1].toLowerCase()] || null
}

// A lone CR is a line break to YAML and to yarn too (E), so an entry can't hide behind one.
const lines = (text) => String(text).replace(/^\uFEFF/, '').split(/\r\n|\r|\n/)
// Line breaks some YAML readers accept (NEL, LS, PS); a lockfile containing one is reported rather than guessed at.
const OTHER_BREAKS = /[\u0085\u2028\u2029]/
// An `npm:` alias names the real package: `npm:lodash@4.17.21`, `npm:@scope/x@^1`.
const NPM_ALIAS = /^npm:((?:@[^/@]+\/)?[^@]+)@(.+)$/
// An exact version as lockfiles record registry packages. Anything looser is a problem, not a spelling to guess at.
const SEMVER = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/
const isObject = (v) => !!v && typeof v === 'object' && !Array.isArray(v)

const parseJson = (content, problems) => {
  try {
    const doc = JSON.parse(String(content).replace(/^\uFEFF/, ''))
    if (isObject(doc)) return doc
    problems.push('The file is not a JSON object.')
  } catch (e) {
    problems.push(`The file is not valid JSON: ${e.message}`)
  }
  return null
}

// package.json: one entry per dependency, keyed by section, with the range as the version.
const parseManifest = (content) => {
  const problems = []
  const doc = parseJson(content, problems)
  const entries = []
  if (!doc) return { entries, problems }
  for (const section of MANIFEST_SECTIONS) {
    const deps = doc[section]
    if (deps == null) continue
    if (!isObject(deps)) {
      problems.push(`"${section}" is not an object.`)
      continue
    }
    for (const [name, range] of Object.entries(deps)) {
      if (typeof range === 'string') entries.push({ name, version: range, section })
      else problems.push(`"${section}.${name}" is not a string.`)
    }
  }
  return { entries, problems }
}

// Where a lockfile entry is downloaded from and its checksum (F4), null when the lockfile doesn't record them.
const source = (resolved, integrity) => ({
  resolved: typeof resolved === 'string' && resolved ? resolved : null,
  integrity: typeof integrity === 'string' && integrity ? integrity : null,
})

// package-lock.json: the v2/v3 `packages` map (keys are install paths), or the nested v1 `dependencies` tree.
const parseNpmLock = (content) => {
  const problems = []
  const doc = parseJson(content, problems)
  const entries = []
  if (!doc) return { entries, problems }
  // A `packages` or `dependencies` that is there but not an object would otherwise drop every pin unread (fix set 7).
  for (const field of ['packages', 'dependencies']) {
    if (Object.hasOwn(doc, field) && !isObject(doc[field])) problems.push(`"${field}" is not an object.`)
  }
  if (problems.length) return { entries, problems }
  if (isObject(doc.packages)) {
    for (const [key, pkg] of Object.entries(doc.packages)) {
      const at = key.lastIndexOf('node_modules/')
      // "" is the root project and "packages/x" a workspace folder; links point at those and have no version.
      if (at < 0) continue
      if (!isObject(pkg)) {
        problems.push(`"packages.${key}" is not an object.`)
        continue
      }
      if (pkg.link) continue
      if (typeof pkg.version !== 'string') {
        problems.push(`"packages.${key}" has no version.`)
        continue
      }
      // An alias (`"my-lodash": "npm:lodash@…"`) installs under its alias; `name` holds the real package. The
      // install name is kept too, since that is the name code imports and a spoofed `name` could hide it.
      const installName = key.slice(at + 'node_modules/'.length)
      const name = typeof pkg.name === 'string' ? pkg.name : installName
      entries.push({ name, version: pkg.version, ...source(pkg.resolved, pkg.integrity), ...(name !== installName && { installName }) })
    }
  } else if (isObject(doc.dependencies)) {
    const walk = (deps, trail) => {
      for (const [name, dep] of Object.entries(deps)) {
        if (!isObject(dep) || typeof dep.version !== 'string') {
          problems.push(`"dependencies.${trail}${name}" has no version.`)
          continue
        }
        // v1 aliases record the real package in the version: "npm:lodash@4.17.21".
        const alias = NPM_ALIAS.exec(dep.version)
        const src = source(dep.resolved, dep.integrity)
        entries.push(alias ? { name: alias[1], version: alias[2], ...src, installName: name } : { name, version: dep.version, ...src })
        if (isObject(dep.dependencies)) walk(dep.dependencies, `${trail}${name}.dependencies.`)
      }
    }
    walk(doc.dependencies, '')
  } else {
    problems.push('The lockfile has neither "packages" nor "dependencies".')
  }
  return { entries, problems }
}

// Splits `name@version` where the name may itself start with `@` (a scope).
const splitAt = (spec) => {
  const at = spec.indexOf('@', 1)
  return at > 0 ? { name: spec.slice(0, at), version: spec.slice(at + 1) } : null
}
const unquote = (s) => s.replace(/^(['"])(.*)\1$/, '$2')
// A double-quoted string with a `\` escape, which YAML decodes and unquote doesn't; such a value is not read.
const hasEscape = (s) => /"[^"]*\\/.test(s)

// Both lockfile parsers are strict (A): they accept only the layout pnpm and yarn write, and report any other line,
// because a YAML spelling they skipped (a quoted key, a block where a flow map belongs) could hide an entry.
// A plain, unquoted mapping key and its value, with a trailing comment treated as no value.
const plainKey = (indent) => new RegExp(`^ {${indent}}([A-Za-z_][\\w-]*)(:?)(?: (.*))?$`)
const valueOf = (raw) => {
  const v = (raw ?? '').trim()
  return v.startsWith('#') ? '' : v
}
// A field whose value is on the lines below it: empty, or a block scalar (`|`, `>-`).
const opensBlock = (value) => value === '' || /^[|>][-+0-9]*$/.test(value)

// pnpm writes `resolution: {integrity: …, tarball: …}` on one line with plain keys; anything else is unread.
const parseResolution = (value) => {
  const m = /^\{([^{}[\]]*)\}$/.exec(value)
  if (!m) return null
  const fields = {}
  for (const part of m[1].split(',')) {
    const f = /^\s*([A-Za-z]+): (\S.*?)\s*$/.exec(part)
    if (!f || Object.hasOwn(fields, f[1])) return null
    fields[f[1]] = unquote(f[2])
  }
  return fields
}

// pnpm-lock.yaml: the keys of the top-level `packages:` map.
//   v9: `express@4.19.2:` / `'@scope/util@2.0.0':`   v6: `/express@4.18.2:`   v5: `/express/4.18.2:`
// Peer suffixes (`(react@18.3.1)` in v6+, `_react@18.3.1` in v5) are dropped. Top-level keys are plain and
// unique, package keys sit at 2 spaces, their fields at exactly 4 with plain unique keys, and deeper lines only
// under a field that opens a block. An entry with no `resolution` (every pnpm package has one) is a problem too.
const TOP_KEY = plainKey(0)
const PNPM_FIELD = plainKey(4)
// Unquoted keys may hold `#` (git keys such as `gh@git+https://…#sha`); a comment needs a space before it.
const PNPM_PACKAGE = /^ {2}('[^']+'|"[^"\\]+"|[^\s'"]+):(?: (\{\}))?$/
// v5 keys: `/name/version`, `/@scope/name/version`, with an optional `_peer@x` suffix after the version (G).
const PNPM_V5_KEY = /^((?:@[^/]+\/)?[^/]+)\/([^/_]+)(?:_.+)?$/
// The only package fields pnpm writes as nested maps or lists, plus `deprecated`, whose message may span lines.
// Any other field must hold its value on its own line, because a `name`, `version` or `resolution` on the lines
// below would be skipped.
const PNPM_BLOCK_FIELDS = new Set(['dependencies', 'optionalDependencies', 'peerDependencies', 'peerDependenciesMeta', 'dependenciesMeta', 'engines', 'bin', 'transitivePeerDependencies', 'cpu', 'os', 'libc', 'bundledDependencies', 'deprecated'])
// Where pnpm fetches a package from: a directory, a git repo, or a tarball (no type; the registry when absent).
const pnpmSource = (resolution) => {
  if (resolution.type === 'directory') return resolution.directory ? `file:${resolution.directory}` : null
  if (resolution.type === 'git') return resolution.repo ?? null
  return resolution.type == null ? resolution.tarball ?? null : undefined
}
const parsePnpmLock = (content) => {
  const problems = []
  const entries = []
  if (OTHER_BREAKS.test(content)) return { entries, problems: ['The lockfile contains a NEL, LS or PS line break.'] }
  const all = lines(content)
  const versionLine = all.find((l) => /^lockfileVersion:/.test(l))
  if (!versionLine) return { entries, problems: ['The lockfile has no lockfileVersion.'] }
  // `5.4` or `'9.0'`; anything else would pick the key layout by accident (NaN reads keys as v5).
  const versionText = unquote(versionLine.slice('lockfileVersion:'.length).trim())
  if (!/^\d+(\.\d+)?$/.test(versionText)) return { entries, problems: [`The lockfileVersion "${versionText}" is not a version number.`] }
  const major = Number(versionText.split('.')[0])
  const topKeys = new Set()
  let inPackages = false
  let current = null
  const finish = () => {
    if (!current) return
    const { key, line, meta, resolution } = current
    let id = current.id
    current = null
    const registryKey = !!id && !isNonRegistrySpec(id.version)
    if (!id) {
      // Hosted-git and local keys (`github.com/owner/repo/sha`, `file:packages/foo`) carry no name; pnpm records it
      // in `name:` and `version:`.
      if (!meta.name || !meta.version) return problems.push(`Line ${line}: could not read the package key "${key}".`)
      id = { name: meta.name, version: meta.version }
    } else if (registryKey && !SEMVER.test(id.version)) {
      return problems.push(`Line ${line}: the version in the package key "${key}" is not an exact version.`)
    } else if ((meta.name && meta.name !== id.name) || (meta.version && registryKey && meta.version !== id.version)) {
      // pnpm builds the download from these fields when present (H), so they must name the same package as the key.
      return problems.push(`Line ${line}: the name or version fields of "${key}" disagree with its key.`)
    }
    if (meta.version && !SEMVER.test(meta.version)) return problems.push(`Line ${line}: the version field of "${key}" is not an exact version.`)
    if (!resolution) return problems.push(`Line ${line}: the package "${key}" has no resolution.`)
    const resolved = pnpmSource(resolution)
    if (resolved === undefined) return problems.push(`Line ${line}: the resolution of "${key}" has the unknown type "${resolution.type}".`)
    // A git, URL or file key isn't fetched from the registry, so its source must be recorded for sc-resolved to check;
    // without one, pnpm could install the registry package its version field names.
    if (!resolved && (!registryKey || resolution.type)) return problems.push(`Line ${line}: the package "${key}" has no tarball, repo or directory source.`)
    entries.push({ ...id, ...source(resolved, resolution.integrity) })
  }
  const readKey = (raw) => {
    // v5 and v6 write every registry key with a leading `/`; any other key (`file:packages/foo`, hosted git) is
    // read from its `name:` and `version:` fields (B).
    if (major < 9 && !unquote(raw).startsWith('/')) return null
    const key = unquote(raw).replace(/^\//, '').replace(/\(.*$/, '')
    if (major >= 6) return splitAt(key)
    const m = PNPM_V5_KEY.exec(key)
    return m ? { name: m[1], version: m[2] } : null
  }
  all.forEach((line, i) => {
    if (!line.trim() || /^\s*#/.test(line)) return
    const problem = (text) => problems.push(`Line ${i + 1}: ${text}`)
    if (/^\S/.test(line)) {
      finish()
      const m = TOP_KEY.exec(line)
      inPackages = false
      if (!m || !m[2]) return problem(`"${line}" is not a top-level key in the layout the checks read.`)
      if (topKeys.has(m[1])) problem(`the top-level key "${m[1]}" appears twice.`)
      topKeys.add(m[1])
      if (m[1] !== 'packages') return
      const value = valueOf(m[3])
      inPackages = value === ''
      // `packages: {}` is an empty map; any other inline form is one this parser doesn't read.
      if (value !== '' && !/^\{\s*\}(\s+#.*)?$/.test(value)) problem('the packages map is not in the block layout the checks read.')
      return
    }
    if (!inPackages) return
    if (/^ {2}\S/.test(line)) {
      finish()
      const m = PNPM_PACKAGE.exec(line)
      const entry = m && readKey(m[1])
      if (m) current = { id: entry && entry.name && entry.version ? entry : null, key: m[1], line: i + 1, fields: new Set(), meta: {}, block: false, resolution: null }
      else problem(`could not read the package key "${line.trim()}".`)
      return
    }
    if (!current) return problem('unexpected indentation in the packages map.')
    if (/^ {6,}\S/.test(line) && current.block) return
    const f = PNPM_FIELD.exec(line)
    if (!f || !f[2]) return problem(`"${line.trim()}" is not a package field in the layout the checks read.`)
    if (current.fields.has(f[1])) problem(`the field "${f[1]}" appears twice in "${current.key}".`)
    current.fields.add(f[1])
    const value = valueOf(f[3])
    current.block = opensBlock(value)
    if (current.block && !PNPM_BLOCK_FIELDS.has(f[1])) problem(`the field "${f[1]}" of "${current.key}" has no one-line value.`)
    if (['name', 'version', 'resolution'].includes(f[1]) && hasEscape(value)) problem(`the field "${f[1]}" of "${current.key}" holds an escaped string.`)
    if (f[1] === 'name' || f[1] === 'version') current.meta[f[1]] = unquote(value)
    if (f[1] !== 'resolution') return
    current.resolution = parseResolution(value)
    if (!current.resolution) {
      problem(`the resolution of "${current.key}" is not a one-line map the checks read.`)
      current.resolution = {}
    }
  })
  finish()
  return { entries, problems }
}

// yarn.lock (classic v1 and berry): a descriptor line at column 0 ending in `:` (`express@^4.18.2, express@^4.19.0:`),
// then fields at exactly 2 spaces with plain unique keys: `version "4.19.2"` (classic) or `version: 4.19.2` (berry).
// Deeper lines are allowed only under a field that opens a block (`dependencies:`).
const YARN_FIELD = plainKey(2)
// The only entry fields yarn writes as nested maps; any other field must hold its value on its own line.
const YARN_BLOCK_FIELDS = new Set(['dependencies', 'optionalDependencies', 'peerDependencies', 'dependenciesMeta', 'peerDependenciesMeta', 'bin'])
// The fields each format writes. Each format ignores the other's source field (berry `resolved`, classic
// `resolution`), so one found in the wrong format could stand in for the source that is really fetched.
const BERRY_FIELDS = new Set([...YARN_BLOCK_FIELDS, 'version', 'resolution', 'checksum', 'languageName', 'linkType', 'conditions'])
const BERRY_METADATA_FIELDS = new Set(['version', 'cacheKey'])
// Classic's list is yarn 1.22's implodeEntry. It writes `name` when the package differs from the key's name.
const CLASSIC_BLOCK_FIELDS = new Set(['dependencies', 'optionalDependencies', 'permissions', 'prebuiltVariants'])
const CLASSIC_FIELDS = new Set([...CLASSIC_BLOCK_FIELDS, 'name', 'version', 'uid', 'resolved', 'registry', 'integrity'])
// Only this exact key is berry's header; `__metadata` among other descriptors would drop them unread.
const BERRY_HEADER = /^(__metadata|"__metadata"):$/
// A berry locator: `name@npm:1.2.3` is a registry package, `name@patch:<URL-encoded locator>#…` patches the locator
// it wraps, and any other (`file:`, `https:`, git) is where the entry comes from. Null when unreadable.
const readLocator = (text, inPatch = false) => {
  const at = splitAt(text)
  if (!at) return null
  const npm = /^npm:(.+)$/.exec(at.version)
  // Strict semver closes `npm:1.2.3::__archiveUrl=…`, which downloads from the URL it names.
  if (npm) return SEMVER.test(npm[1]) ? { name: at.name, version: npm[1] } : null
  const patch = /^patch:([^#]+)/.exec(at.version)
  if (!patch) return { name: at.name, resolved: at.version }
  if (inPatch) return null
  try {
    return readLocator(decodeURIComponent(patch[1]), true)
  } catch {
    return null
  }
}
const parseYarnLock = (content) => {
  const problems = []
  const entries = []
  let current = null
  let entry = null
  const all = lines(content)
  // Berry files start with `__metadata:`; every berry package entry records the locator it fetches in `resolution`.
  const berry = all.some((l) => BERRY_HEADER.test(l))
  const finish = () => {
    if (!current) return
    const { descriptor, descriptors, version, locator, line, nameField } = current
    let { name } = current
    const src = source(current.resolved, current.integrity)
    const hasResolution = current.hasResolution
    current = null
    if (!version) return problems.push(`Line ${line}: the entry "${descriptor}" has no version.`)
    if (berry && !hasResolution) return problems.push(`Line ${line}: the entry "${descriptor}" has no resolution.`)
    // Workspace, link and portal locators are the project's own folders. Only the locator decides this (A): every
    // descriptor in the key resolves to it, so a local first descriptor can't hide a registry or URL package.
    if (berry && /^(workspace|link|portal):/.test(src.resolved ?? '')) return
    if (locator) {
      // Berry fetches the locator in `resolution` (F): its name is the package, and its version must be `version`.
      if (locator.version !== version) return problems.push(`Line ${line}: the resolution of "${descriptor}" names version ${locator.version}, not ${version}.`)
      name = locator.name
    }
    // Classic's `name` is the package installed under the key's name, so it is read like an npm: alias.
    if (nameField) name = nameField
    // An npm: alias in any descriptor names the package it asks for, so the entry must be that package.
    const disagrees = descriptors.find((d) => d.name !== d.descriptor && d.name !== name)
    if (disagrees) return problems.push(`Line ${line}: the alias "${disagrees.descriptor}" of "${descriptor}" asks for ${disagrees.name}, not ${name}.`)
    for (const installName of new Set(descriptors.map((d) => d.descriptor))) {
      entries.push({ name, version, ...src, ...(name !== installName && { installName }) })
    }
  }
  if (OTHER_BREAKS.test(content)) return { entries, problems: ['The lockfile contains a NEL, LS or PS line break.'] }
  all.forEach((line, i) => {
    if (!line.trim() || /^\s*#/.test(line)) return
    const problem = (text) => problems.push(`Line ${i + 1}: ${text}`)
    if (/^\S/.test(line)) {
      finish()
      entry = { fields: new Set(), block: false }
      if (!line.endsWith(':')) return problem(`the entry "${line}" does not end with ":".`)
      if (hasEscape(line)) return problem(`the entry "${line}" holds an escaped string.`)
      // __metadata is berry's header.
      entry.metadata = BERRY_HEADER.test(line)
      if (entry.metadata) return
      // Berry quotes the whole list (`"a@npm:^1, a@npm:^2":`), classic quotes each descriptor (`"a@1", "a@2":`),
      // so a descriptor can carry a quote at either end or both. Every descriptor resolves to this entry (fix set 7),
      // so each one is read: a later one naming another package is what code importing that name gets. One that
      // can't be read (including `__metadata`, which has no `@`) makes the entry a problem.
      const descriptors = []
      for (const text of line.slice(0, -1).split(',').map((d) => d.trim().replace(/^["']|["']$/g, ''))) {
        // A quote left after unquoting is not a name any package.json can ask for.
        const spec = !/["']/.test(text) && splitAt(text)
        if (!spec) return problem(`could not read the entry "${text}".`)
        // `my-lodash@npm:lodash@^4` installs lodash under the name my-lodash.
        const alias = NPM_ALIAS.exec(spec.version)
        descriptors.push({ descriptor: spec.name, name: alias ? alias[1] : spec.name })
      }
      current = { ...descriptors[0], descriptors, version: null, line: i + 1 }
      return
    }
    // An indented line before any entry means the whole file is laid out differently from what this reads.
    if (!entry) return problem('an indented line outside any entry.')
    if (/^ {4,}\S/.test(line) && entry.block) return
    const f = YARN_FIELD.exec(line)
    const value = f && valueOf(f[3])
    if (!f || (!f[2] && !value)) return problem(`"${line.trim()}" is not an entry field in the layout the checks read.`)
    const allowed = entry.metadata ? BERRY_METADATA_FIELDS : berry ? BERRY_FIELDS : CLASSIC_FIELDS
    if (!allowed.has(f[1])) problem(`the field "${f[1]}" is not one yarn ${berry ? 'berry' : 'classic'} writes there.`)
    if (entry.fields.has(f[1])) problem(`the field "${f[1]}" appears twice.`)
    entry.fields.add(f[1])
    entry.block = f[2] === ':' && opensBlock(value)
    if (entry.block && !(berry ? YARN_BLOCK_FIELDS : CLASSIC_BLOCK_FIELDS).has(f[1])) problem(`the field "${f[1]}" has no one-line value.`)
    if (!current) return
    const key = f[1]
    if (['name', 'version', 'resolved', 'resolution', 'integrity', 'checksum'].includes(key) && hasEscape(value)) problem(`the field "${key}" of "${current.descriptor}" holds an escaped string.`)
    if (key === 'name') current.nameField = unquote(value)
    if (key === 'version') current.version = unquote(value)
    // Classic records the tarball URL; berry records a locator (see readLocator).
    if (key === 'resolved') current.resolved = unquote(value)
    if (key === 'resolution') {
      current.hasResolution = true
      const locator = readLocator(unquote(value))
      if (!locator) problem(`the resolution of "${current.descriptor}" is not a locator the checks read.`)
      else if (locator.version) current.locator = locator
      else current.resolved = locator.resolved
    }
    if (key === 'integrity' || key === 'checksum') current.integrity = unquote(value)
  })
  finish()
  return { entries, problems }
}

const PARSERS = { manifest: parseManifest, 'npm-lock': parseNpmLock, 'pnpm-lock': parsePnpmLock, 'yarn-lock': parseYarnLock }

/**
 * Reads the dependency entries of one manifest or lockfile (R1).
 * @returns {{ kind: string|null, entries: {name: string, version: string, section?: string}[], problems: string[] }}
 */
export const parseDependencies = ({ file, content }) => {
  const kind = dependencyKind(file)
  if (!kind) return { kind, entries: [], problems: [] }
  return { kind, ...PARSERS[kind](content) }
}

const byName = (a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : a.version < b.version ? -1 : a.version > b.version ? 1 : 0)

/**
 * The dependencies a change adds or changes (R1): entries in `content` that are not in `base`.
 * `previous` is the earlier range (manifest) or the earlier versions of the same name (lockfile), or null when added.
 * A null base means a new file, so everything in it is added. Base problems are reported too, prefixed "Base:".
 * @returns {{ kind: string|null, changes: {name: string, version: string, previous: string|null, section?: string}[], problems: string[] }}
 */
export const diffDependencies = ({ file, content, base = null }) => {
  const after = parseDependencies({ file, content })
  const before = base == null ? { entries: [], problems: [] } : parseDependencies({ file, content: base })
  const problems = [...after.problems, ...before.problems.map((p) => `Base: ${p}`)]
  const changes = []
  if (after.kind === 'manifest') {
    const old = new Map(before.entries.map((e) => [`${e.section}\0${e.name}`, e.version]))
    for (const e of after.entries) {
      const prev = old.get(`${e.section}\0${e.name}`)
      if (prev !== e.version) changes.push({ name: e.name, version: e.version, previous: prev ?? null, section: e.section })
    }
  } else {
    // The install name is part of the key, so a new name for a package already listed (a yarn descriptor, an npm alias)
    // is still a change the typosquat check sees.
    const keyOf = (e) => `${e.installName ?? ''}\0${e.name}@${e.version}`
    const oldKeys = new Set(before.entries.map(keyOf))
    const newKeys = new Set(after.entries.map((e) => `${e.name}@${e.version}`))
    const seen = new Set()
    for (const e of after.entries) {
      const key = keyOf(e)
      if (oldKeys.has(key) || seen.has(key)) continue
      seen.add(key)
      const gone = [...new Set(before.entries.filter((b) => b.name === e.name && !newKeys.has(`${b.name}@${b.version}`)).map((b) => b.version))]
      changes.push({ name: e.name, version: e.version, previous: gone.length ? gone.sort().join(', ') : null, ...(e.installName && { installName: e.installName }) })
    }
  }
  return { kind: after.kind, changes: changes.sort(byName), problems }
}

export const TIER = { HIGH: 'high', WARNING: 'warning' }

// Widely installed npm packages (R2; D3). An added name one edit away from one of these, and not on the list itself,
// is a likely typosquat. Near neighbours that are real packages (preact/react, semver/server) are listed so they
// don't flag each other; anything else is handled with a governance.allowlist entry.
export const POPULAR_PACKAGES = new Set([
  'react', 'react-dom', 'preact', 'vue', 'svelte', 'angular', 'next', 'nuxt', 'gatsby', 'astro', 'solid-js', 'lit',
  'express', 'koa', 'fastify', 'hapi', 'restify', 'connect', 'body-parser', 'cookie-parser', 'cors', 'helmet',
  'morgan', 'multer', 'compression', 'serve-static', 'express-session', 'passport', 'jsonwebtoken', 'bcrypt',
  'bcryptjs', 'lodash', 'lodash-es', 'underscore', 'ramda', 'immutable', 'immer', 'rxjs', 'async', 'bluebird',
  'axios', 'node-fetch', 'got', 'request', 'superagent', 'undici', 'ky', 'cross-fetch', 'isomorphic-fetch',
  'moment', 'dayjs', 'date-fns', 'luxon', 'chalk', 'colors', 'kleur', 'picocolors', 'debug', 'winston', 'pino',
  'bunyan', 'log4js', 'loglevel', 'commander', 'yargs', 'minimist', 'inquirer', 'prompts', 'meow', 'ora',
  'dotenv', 'cross-env', 'uuid', 'nanoid', 'classnames', 'clsx', 'semver', 'server', 'glob', 'globby',
  'minimatch', 'micromatch', 'rimraf', 'mkdirp', 'fs-extra', 'chokidar', 'graceful-fs', 'del', 'execa',
  'shelljs', 'cross-spawn', 'which', 'typescript', 'ts-node', 'tslib', 'tsx', '@types/node', 'babel-core',
  'webpack', 'webpack-cli', 'webpack-dev-server', 'rollup', 'vite', 'esbuild', 'parcel', 'turbo', 'nodemon',
  'concurrently', 'eslint', 'tslint', 'prettier', 'stylelint', 'husky', 'lint-staged', 'jest', 'mocha', 'chai', 'sinon',
  'vitest', 'jasmine', 'karma', 'cypress', 'playwright', 'puppeteer', 'supertest', 'nock', 'enzyme',
  'redux', 'react-redux', 'redux-thunk', 'mobx', 'zustand', 'recoil', 'jotai', 'react-router',
  'react-router-dom', 'react-query', 'swr', 'formik', 'react-hook-form', 'yup', 'zod', 'joi', 'ajv',
  'validator', 'styled-components', 'emotion', 'tailwindcss', 'postcss', 'autoprefixer', 'sass', 'less',
  'bootstrap', 'jquery', 'd3', 'chart.js', 'three', 'socket.io', 'socket.io-client', 'ws', 'mongoose',
  'mongodb', 'mysql', 'mysql2', 'mssql', 'pg', 'sqlite3', 'sequelize', 'typeorm', 'prisma', 'knex', 'redis',
  'ioredis', 'graphql', 'apollo-server', 'aws-sdk', 'firebase', 'stripe', 'twilio', 'nodemailer',
  'cheerio', 'jsdom', 'jsdoc', 'marked', 'markdown-it', 'handlebars', 'ejs', 'pug', 'mustache', 'yaml', 'js-yaml',
  'xml2js', 'qs', 'query-string', 'querystring', 'url-parse', 'path-to-regexp', 'mime', 'mime-types',
  'form-data', 'busboy', 'sharp', 'jimp', 'canvas', 'electron', 'core-js', 'regenerator-runtime',
  'object-assign', 'inherits', 'safe-buffer', 'readable-stream', 'through2', 'event-stream', 'eventemitter3',
  'ms', 'color', 'colord', 'color-name', 'ansi-styles', 'strip-ansi', 'string-width', 'wrap-ansi', 'escape-html',
  'he', 'entities', 'deepmerge', 'deep-equal', 'fast-deep-equal', 'json5', 'crypto-js', 'node-forge', 'tar',
  'archiver', 'adm-zip', 'jszip', 'pako', 'ethers', 'web3', 'discord.js', 'openai', 'langchain',
])

// Optimal string alignment distance, stopping early once it passes `max` (only "one edit away" matters here).
const editDistance = (a, b, max = 1) => {
  if (Math.abs(a.length - b.length) > max) return max + 1
  const d = Array.from({ length: a.length + 1 }, (_, i) => [i, ...Array(b.length).fill(0)])
  for (let j = 1; j <= b.length; j++) d[0][j] = j
  for (let i = 1; i <= a.length; i++) {
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1
      d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + cost)
      if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) d[i][j] = Math.min(d[i][j], d[i - 2][j - 2] + 1)
    }
  }
  return d[a.length][b.length]
}

/** The popular package an added name imitates (R2; D3), or null. Scoped names and names under 5 characters are skipped. */
export const typosquatOf = (name) => {
  const n = String(name).toLowerCase()
  if (n.startsWith('@') || n.length < 5 || POPULAR_PACKAGES.has(n)) return null
  for (const p of POPULAR_PACKAGES) if (!p.startsWith('@') && editDistance(n, p) === 1) return p
  return null
}

// D9: specifiers that don't resolve through the public registry. They are left out of the lookups and reported.
const NON_REGISTRY = /^(workspace|file|link|portal|git|git\+[a-z]+|github|gitlab|bitbucket|gist|https?|npm):/i
export const isNonRegistrySpec = (spec) => NON_REGISTRY.test(spec) || /^[^@\s][^\s]*\/\S+$/.test(spec)

// R6: a range with no upper bound. `*`, `x`, `''`, a dist-tag such as `latest`, or any `||` alternative with only a
// lower bound (`>=1`, `> 1.0.0`).
const isOpenRange = (range) => String(range).split('||').some((alt) => {
  const r = alt.trim()
  if (r === '' || /^[*xX]$/.test(r)) return true
  if (/^[a-z][\w.-]*$/i.test(r)) return true
  return /(^|\s)>=?\s*\S/.test(r) && !/</.test(r) && !/\s-\s/.test(r)
})

// F4: lockfile entries should download from the public registry, from their own package's tarball path.
const PUBLIC_REGISTRIES = new Set(['registry.npmjs.org', 'registry.yarnpkg.com'])
const resolvedProblem = (name, version, resolved) => {
  let url
  try {
    url = new URL(resolved)
  } catch {
    return `"${name}" is resolved from "${resolved}", which is not a URL on the public npm registry.`
  }
  if (url.protocol !== 'https:' || !PUBLIC_REGISTRIES.has(url.hostname.toLowerCase())) {
    return `"${name}" is resolved from ${url.protocol}//${url.host}, not the public npm registry; check it is a registry you trust.`
  }
  let pathname = url.pathname
  try {
    pathname = decodeURIComponent(pathname)
  } catch {
    // An undecodable path can't be the package's own tarball path; the check below reports it.
  }
  if (!pathname.startsWith(`/${name}/-/`)) return `"${name}" is resolved from the registry tarball ${url.pathname}, which belongs to another package.`
  // D: the registry names each tarball `<name without scope>-<version>.tgz`.
  if (pathname.slice(`/${name}/-/`.length) !== `${name.split('/').pop()}-${version}.tgz`) {
    return `"${name}@${version}" is resolved from the registry tarball ${url.pathname}, which is not that version's tarball.`
  }
  return null
}

// sc-resolved: new or changed lockfile entries downloaded from elsewhere (high), and a changed download or checksum
// for a version that didn't change (warning). Entries whose source is unchanged aren't re-checked.
const resolvedFindings = (file, content, afterEntries, baseEntries) => {
  const olds = new Map()
  for (const e of baseEntries) olds.set(`${e.name}@${e.version}`, [...(olds.get(`${e.name}@${e.version}`) ?? []), e])
  const findings = []
  const reported = new Set()
  for (const e of afterEntries) {
    const key = `${e.name}@${e.version}`
    const before = olds.get(key) ?? []
    // A checksum the base didn't record isn't a change; a download location that differs always is.
    const unchanged = before.some((o) => o.resolved === e.resolved && (o.integrity == null || o.integrity === e.integrity))
    if (reported.has(key) || unchanged) continue
    const at = { rule: 'sc-resolved', file, line: lineOfName(content, e.installName ?? e.name), package: e.name }
    const bad = e.resolved && resolvedProblem(e.name, e.version, e.resolved)
    // Only a value the base recorded counts as changed, so a lockfile that gains these fields isn't flagged.
    const changed = before.some((o) => (o.resolved != null && o.resolved !== e.resolved) || (o.integrity != null && o.integrity !== e.integrity))
    if (bad) findings.push({ ...at, tier: TIER.HIGH, detail: bad })
    else if (changed) findings.push({ ...at, tier: TIER.WARNING, detail: `"${key}" keeps its version but its download or checksum changed; check the lockfile wasn't edited by hand.` })
    else continue
    reported.add(key)
  }
  return findings
}

// sc-alias (B): an npm-lock entry that installs under one name (what code imports) but fetches another package,
// unless the base had the same alias. Checked on every entry, not only changed versions, so swapping an existing
// install path to a package already in the lockfile is still seen.
const aliasFindings = (file, content, afterEntries, baseEntries) => {
  const pair = (e) => `${e.installName}\0${e.name}`
  const known = new Set(baseEntries.filter((e) => e.installName).map(pair))
  const findings = []
  for (const e of afterEntries) {
    if (!e.installName || known.has(pair(e))) continue
    known.add(pair(e))
    findings.push({ rule: 'sc-alias', tier: TIER.WARNING, file, line: lineOfName(content, e.installName), package: e.installName, detail: `"${e.installName}" installs the package "${e.name}"; check the alias is intended.` })
  }
  return findings
}

const escapeRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
// The first line naming the package: `"name":` in JSON, `name@…`, `/name@…` or `/name/…` in lockfiles.
export const lineOfName = (content, name) => {
  const re = new RegExp(`(^|["'/\\s])${escapeRe(name)}(["'@/]|$)`)
  return lines(content).findIndex((l) => re.test(l)) + 1 || 1
}

/**
 * Offline supply-chain rules for one manifest or lockfile (R2, R6, D9), comparing `content` with `base`
 * (null for a new file). `manifestChanged` says whether the matching package.json changed in the same change;
 * a lockfile change without one is drift. Findings use the shared { rule, tier, file, line, detail, package? } shape.
 */
export const checkDependencies = ({ file, content, base = null, manifestChanged = false }) => {
  const { kind, changes, problems } = diffDependencies({ file, content, base })
  if (!kind) return []
  if (problems.length) {
    return [{ rule: 'sc-unparsed', tier: TIER.HIGH, file, line: 1, detail: `The dependency checks could not read this file, so they did not run: ${problems.slice(0, 3).join(' ')}` }]
  }
  const findings = []
  const at = (name) => lineOfName(content, name)
  const baseEntries = base == null ? [] : parseDependencies({ file, content: base }).entries
  const baseNames = new Set(baseEntries.flatMap((e) => [e.name, e.installName].filter(Boolean)))
  for (const c of changes) {
    // Both the package name and, in a lockfile, the name it installs under (what code imports).
    const squat = [c.name, c.installName].filter(Boolean).map((n) => ({ n, imitated: !baseNames.has(n) && typosquatOf(n) })).find((x) => x.imitated)
    if (squat) findings.push({ rule: 'sc-typosquat', tier: TIER.HIGH, file, line: at(squat.n), package: squat.n, detail: `"${squat.n}" is one edit away from the popular package "${squat.imitated}"; check it is the package you meant.` })
    if (kind !== 'manifest') continue
    if (isNonRegistrySpec(c.version)) {
      findings.push({ rule: 'sc-non-registry', tier: TIER.WARNING, file, line: at(c.name), package: c.name, detail: `"${c.name}" uses "${c.version}", which is not a public registry version, so advisory and registry checks skip it.` })
    } else if (c.previous != null && !isNonRegistrySpec(c.previous) && !isOpenRange(c.previous) && isOpenRange(c.version)) {
      findings.push({ rule: 'sc-range-widened', tier: TIER.WARNING, file, line: at(c.name), package: c.name, detail: `"${c.name}" widens from "${c.previous}" to "${c.version}", which accepts any future release.` })
    }
  }
  if (kind !== 'manifest') {
    const afterEntries = parseDependencies({ file, content }).entries
    findings.push(...resolvedFindings(file, content, afterEntries, baseEntries), ...aliasFindings(file, content, afterEntries, baseEntries))
  }
  if (kind !== 'manifest' && changes.length && !manifestChanged) {
    findings.push({ rule: 'sc-lockfile-drift', tier: TIER.WARNING, file, line: 1, detail: `The lockfile changes ${new Set(changes.map((c) => `${c.name}@${c.version}`)).size} package(s) with no matching package.json change.` })
  }
  return findings
}
