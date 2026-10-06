// GitHub Actions workflow rules (roadmap step 4, B10; spec docs/specs/2026-09-28-security-supply-chain.md R7–R10).
// Shared by the local guard hook and the PR governance checks through governance-rules.mjs, so both give the
// same verdict on the same file. No dependencies: workflows are read with the small YAML subset parser below.

export const TIER = { HIGH: 'high', WARNING: 'warning' }

// AI or agent actions whose inputs become a model prompt (R8). Matched on owner/repo, case-insensitively.
export const AI_ACTIONS = [
  'anthropics/claude-code-action',
  'anthropics/claude-code-base-action',
  'openai/codex-action',
  'google-github-actions/run-gemini-cli',
  'actions/ai-inference',
]

const PRIVILEGED_TRIGGERS = ['pull_request_target', 'workflow_run']
const FIRST_PARTY_OWNERS = ['actions', 'github']

// Event fields an outside contributor controls (GitHub's "untrusted input" list).
// An index holds no "[" of its own, so a "[" that is never closed is given up at the next "[" instead of scanned to
// the end of the expression from every "[" (quadratic).
const ANY_INDEX = String.raw`(?:\[[^\][]*\]|\.\*)`
const UNTRUSTED_EXPR = new RegExp(String.raw`\bgithub\.(?:head_ref\b|event\.(?:` + [
  String.raw`issue\.(?:title|body)`,
  String.raw`pull_request\.(?:title|body|head\.(?:ref|label|repo\.default_branch))`,
  String.raw`(?:comment|review|review_comment)\.body`,
  String.raw`discussion\.(?:title|body)`,
  String.raw`pages${ANY_INDEX}\.page_name`,
  String.raw`(?:commits${ANY_INDEX}|head_commit|workflow_run\.head_commit)\.(?:message|author\.(?:email|name))`,
  String.raw`workflow_run\.(?:head_branch|pull_requests${ANY_INDEX}\.head\.ref)`,
].join('|') + '))', 'i')
// A whole context object serialised into the output (toJSON(github.event) and the like) carries every untrusted
// field in it, and so does the .* filter over one. Matches github, github.event or an event sub-object followed by
// .* or by no property or index.
const WHOLE_EVENT_EXPR = /\bgithub(?:\.event(?:\.(?:pull_request(?:\.head(?:\.repo)?)?|issue|comment|review|review_comment|discussion|head_commit|commits|pages|workflow_run))?)?(?:\.\*|(?![\w.[]))/i

// Refs and repositories that point at PR-controlled code (R7).
const PR_REF_EXPR = /\bgithub\.(?:head_ref\b|event\.(?:pull_request\.(?:head\.(?:sha|ref|repo\.\w+)|merge_commit_sha)|workflow_run\.head_(?:sha|branch|repository)|number\b))|refs\/pull\//i
// A run script checks out PR code with "gh pr checkout", or with a git fetch/checkout/switch followed, starting on the
// same line, by a pull ref or a PR head expression.
const GH_PR_CHECKOUT = /\bgh\s+pr\s+checkout\b/i
const GIT_CHECKOUT_CMD = /\bgit\s+(?:fetch|checkout|switch)\b/gi
const PULL_REF_AT = /(?:refs\/|[\s:])pull\//iy
const PR_HEAD_EXPR_AT = /\$\{\{[^}]*\bgithub\.(?:head_ref|event\.pull_request\.head|event\.workflow_run\.head_|event\.(?:pull_request\.)?number\b)/iy
const matchesAt = (re, s, at) => { re.lastIndex = at; return re.test(s) }
// One regex with "[^\n]*" between the command and the ref would rescan the rest of the line from every command, and
// "[^}]*" from every "${{" (quadratic). Instead each start position is tried once: a command whose line was already
// searched from an earlier command adds nothing, and a "${{" with no "}" since the last "${{" that failed fails too.
const runChecksOutPr = (run) => {
  if (GH_PR_CHECKOUT.test(run)) return true
  let searchedTo = -1, exprFailsUntil = -1
  for (const cmd of run.matchAll(GIT_CHECKOUT_CMD)) {
    const from = cmd.index + cmd[0].length
    if (from <= searchedTo) continue
    const lineEnd = run.indexOf('\n', from)
    searchedTo = lineEnd === -1 ? run.length : lineEnd
    for (let at = from; at <= searchedTo; at++) {
      if (matchesAt(PULL_REF_AT, run, at)) return true
      if (at < exprFailsUntil || !run.startsWith('${{', at)) continue
      if (matchesAt(PR_HEAD_EXPR_AT, run, at)) return true
      const brace = run.indexOf('}', at)
      exprFailsUntil = brace === -1 ? run.length : brace
    }
  }
  return false
}
const SECRET_REF = /\bsecrets\.[A-Za-z_]/
const SHA_PIN = /^[0-9a-f]{40}$/i

export const isWorkflowPath = (rel) => /^\.github\/workflows\/[^/]+\.ya?ml$/i.test(rel)

// ---------------------------------------------------------------------------------------------------------------
// YAML subset parser: block mappings and sequences, literal/folded block scalars, quoted and plain scalars (joined
// across indented continuation lines), one-line flow sequences and mappings, and comments. Every scalar stays a
// string. It never throws. Anything outside the subset (anchors, aliases, merge keys, tags, explicit keys, lines it
// skipped, or input too deep to parse) is recorded as a problem so the caller can fail closed instead of checking a
// partial document. Line numbers (1-based) for each mapping key and sequence item are kept in a side table and read
// with lineOf().
// ---------------------------------------------------------------------------------------------------------------
const LINES = new WeakMap()
const setLine = (node, key, line) => {
  if (!LINES.has(node)) LINES.set(node, new Map())
  LINES.get(node).set(key, line)
}
export const lineOf = (node, key) => (node && typeof node === 'object' && LINES.get(node)?.get(key)) || 0

// Own data property even for "__proto__", which plain assignment would turn into a prototype change.
const setKey = (node, key, value) => Object.defineProperty(node, key, { value, enumerable: true, writable: true, configurable: true })

// Node-building YAML features the subset does not follow: anchors (&), aliases (*), tags (!) and explicit keys (?).
const UNSUPPORTED = /^[&*!]|^\?(\s|$)/
const unsupportedIn = (raw) => (UNSUPPORTED.test(raw.trim()) ? `"${raw.trim().split(/\s/)[0]}" (anchors, aliases, tags and explicit keys are not supported)` : null)

// A quote only opens a quoted scalar where a value starts: at the start of the line, after "[", "{", "," or ":", or
// after "- " block sequence entries that start the line. Inside a plain word or scalar (it's, a"b, echo "x) it is
// just a character, and so it is after "- " inside [ ] / { } (inFlow), where YAML has no sequence entries. Comment
// stripping and flow splitting both use this one rule.
const opensQuote = (s, i, inFlow) => {
  const skipSpaces = (k) => { while (k >= 0 && /\s/.test(s[k])) k--; return k }
  let k = skipSpaces(i - 1)
  if (k < 0 || '[{,:'.includes(s[k])) return true
  for (let end = i; !inFlow && s[k] === '-' && k < end - 1; k = skipSpaces(k - 1)) end = k
  return k < 0 && !inFlow
}

const stripComment = (s) => {
  let quote = null
  for (let i = 0; i < s.length; i++) {
    const c = s[i]
    if (quote) {
      if (c === '\\' && quote === '"') i++
      else if (c === "'" && quote === "'" && s[i + 1] === "'") i++
      else if (c === quote) quote = null
    } else if ((c === '"' || c === "'") && opensQuote(s, i, false)) quote = c
    else if (c === '#' && (i === 0 || /\s/.test(s[i - 1]))) return s.slice(0, i)
  }
  return s
}

const splitFlow = (inner, problem) => {
  const parts = []
  let depth = 0, quote = null, start = 0, closedAt = -1
  for (let i = 0; i < inner.length; i++) {
    const c = inner[i]
    if (quote) {
      if (quote === '"' && c === '\\') i++
      else if (quote === "'" && c === "'" && inner[i + 1] === "'") i++
      else if (c === quote) { quote = null; closedAt = i }
      continue
    }
    // A quote right after a ":" that follows a plain word (name:'x) is part of a plain scalar in YAML 1.2 but a value
    // in YAML 1.1, so the entry boundaries are unclear. Only a quoted key ("a":"b") may be followed directly by one.
    // The space skip stops at the last closing quote, so each run of spaces is walked at most once.
    if ((c === '"' || c === "'") && inner[i - 1] === ':') {
      let keyEnd = i - 2
      while (keyEnd > closedAt && /\s/.test(inner[keyEnd])) keyEnd--
      if (keyEnd !== closedAt) problem(`a quote directly after "${inner.slice(Math.max(start, i - 20), i)}" in a [ ] / { } collection is ambiguous`)
    }
    if ((c === '"' || c === "'") && opensQuote(inner, i, true)) quote = c
    else if (c === '[' || c === '{') depth++
    else if (c === ']' || c === '}') depth--
    else if (c === ',' && depth === 0) { parts.push(inner.slice(start, i)); start = i + 1 }
  }
  if (quote || depth !== 0) problem('a quote or bracket in a [ ] / { } collection is not closed')
  parts.push(inner.slice(start))
  return parts.map((p) => p.trim()).filter((p) => p !== '')
}

// A plain key ends on a non-space, and a value starts on one, so the spaces around ":" are matched once instead of
// split every way between the key, the spaces and the value (quadratic on a long run of spaces with no ":", or before
// a value that "." can't reach the end of, such as one cut by U+2028).
const KEY_RE = /^("(?:[^"\\]|\\.)*"|'(?:[^']|'')*'|[^\s"'[{#-](?:[^:]*[^\s:])?|-[^\s:](?:[^:]*[^\s:])?)\s*:(?:\s+((?:\S.*)?))?$/

// problem(reason) is called for anything in the value the subset can't represent.
const DOUBLE_QUOTED = /^"(?:[^"\\]|\\.)*"$/
const SINGLE_QUOTED = /^'(?:[^']|'')*'$/
// Every YAML 1.2.2 escape (section 5.7), so a value is checked as GitHub reads it ("\x24{{" is "${{"). Anything else,
// including a lone surrogate or a code point past U+10FFFF, is reported rather than guessed.
const ESCAPES = {
  0: '\0', a: '\x07', b: '\b', t: '\t', '\t': '\t', n: '\n', v: '\v', f: '\f', r: '\r', e: '\x1B', ' ': ' ', '"': '"',
  '/': '/', '\\': '\\', N: '\x85', _: '\xA0', L: '\u2028', P: '\u2029',
}
// One left-to-right pass: a hex escape with the wrong digit count falls through to the single-character branch.
const ESCAPE_RE = /\\(?:x[0-9A-Fa-f]{2}|u[0-9A-Fa-f]{4}|U[0-9A-Fa-f]{8}|[^])/g
const decodeEscape = (m, problem) => {
  if (m.length > 2) {
    const code = parseInt(m.slice(2), 16)
    if (code <= 0x10FFFF && (code < 0xD800 || code > 0xDFFF)) return String.fromCodePoint(code)
  } else if (Object.hasOwn(ESCAPES, m[1])) return ESCAPES[m[1]]
  problem(`escape "${m}" in a double-quoted string is not valid YAML`)
  return m
}

const scalar = (raw, problem) => {
  const s = raw.trim()
  if (/^["']/.test(s) && !(s.startsWith('"') ? DOUBLE_QUOTED : SINGLE_QUOTED).test(s)) problem(`quoted string ${s.slice(0, 20)}… is not closed on its line`)
  if (/^[[{]/.test(s) && !s.endsWith(s[0] === '[' ? ']' : '}')) problem(`[ ] / { } collection ${s.slice(0, 20)}… is not closed on its line`)
  if (s.startsWith('"') && s.endsWith('"') && s.length >= 2) {
    return s.slice(1, -1).replace(ESCAPE_RE, (m) => decodeEscape(m, problem))
  }
  if (s.startsWith("'") && s.endsWith("'") && s.length >= 2) return s.slice(1, -1).replace(/''/g, "'")
  const unsupported = unsupportedIn(s)
  if (unsupported) problem(unsupported)
  if (s.startsWith('[') && s.endsWith(']')) {
    // A plain entry with ": " or a trailing ":" is a one-pair mapping in YAML ([a: b] is [{a: b}]), not a string.
    // Quoted entries followed by ":" already fail as unclosed quoted strings.
    return splitFlow(s.slice(1, -1), problem).map((p) => {
      if (!/^["'[{]/.test(p) && /:(?:\s|$)/.test(p)) problem(`flow sequence entry "${p.slice(0, 20)}" is a key: value pair`)
      return scalar(p, problem)
    })
  }
  if (s.startsWith('{') && s.endsWith('}')) {
    const obj = {}
    for (const part of splitFlow(s.slice(1, -1), problem)) {
      // The key ends on a non-space and the value starts on one, as in KEY_RE, so the spaces around ":" are not split
      // every way (quadratic).
      const m = part.match(/^([^:]*[^\s:])\s*:\s*((?:\S.*)?)$/)
      if (m) setKey(obj, scalar(m[1], problem), scalar(m[2], problem))
      else problem(`flow mapping entry "${part}" is not a key: value pair`)
    }
    return obj
  }
  return s
}

/**
 * Parses workflow YAML.
 * @returns {{ doc: object, problems: { line: number, reason: string }[] }}
 */
export const parseWorkflowYaml = (text) => {
  const raw = String(text ?? '').replace(/^\uFEFF/, '').replace(/\r\n?/g, '\n').split('\n')
  const problems = []
  const problemAt = (i) => (reason) => problems.push({ line: i + 1, reason })
  // YAML 1.1 reads NEL, LS and PS as line breaks and YAML 1.2 doesn't, so the lines around one are unclear. Their escapes
  // ("\N", "\L", "\P") are fine; only the raw characters are reported.
  const breakAt = raw.findIndex((line) => /[\x85\u2028\u2029]/.test(line))
  // Structural lines only; block scalars read raw lines directly.
  const indentOf = (s) => s.length - s.trimStart().length
  const isBlank = (i) => { const t = raw[i].trim(); return t === '' || t.startsWith('#') }
  const nextContent = (i) => { while (i < raw.length && isBlank(i)) i++; return i }
  const first = nextContent(0)
  // A leading document marker; anything after it on the same line is the document's first node.
  if (first < raw.length && /^---(\s|$)/.test(raw[first])) {
    const afterMarker = raw[first].slice(3)
    raw[first] = stripComment(afterMarker).trim() === '' ? '' : afterMarker.trimStart()
  }
  // A line's structural text; sequence items rewrite this so their inline mapping parses at the item's column.
  const view = new Map()
  const at = (i) => view.get(i) ?? { indent: indentOf(raw[i]), text: stripComment(raw[i]).trim() }

  const blockScalar = (header, i, parentIndent) => {
    const lines = []
    let contentIndent = null
    let j = i
    for (; j < raw.length; j++) {
      const line = raw[j]
      if (line.trim() === '') { lines.push(''); continue }
      const ind = indentOf(line)
      if (ind <= parentIndent) break
      if (contentIndent === null) contentIndent = ind
      if (ind < contentIndent) break
      lines.push(line.slice(contentIndent))
    }
    while (lines.length && lines[lines.length - 1] === '') lines.pop()
    const body = header.startsWith('>')
      ? lines.join('\n').replace(/([^\n])\n(?=[^\n ])/g, '$1 ')
      : lines.join('\n')
    const chomp = header.includes('-') ? '' : '\n'
    return [lines.length ? body + chomp : '', j]
  }

  // A value starting on the key's line; plain and flow scalars may continue on more-indented lines.
  const inlineValue = (rest, i, parentIndent) => {
    if (/^[|>][-+0-9]*$/.test(rest)) return blockScalar(rest, i + 1, parentIndent)
    let text = rest
    let j = i + 1
    for (let k = nextContent(j); k < raw.length && at(k).indent > parentIndent; k = nextContent(k + 1)) {
      if (!/^["'[{]/.test(rest) && KEY_RE.test(at(k).text)) break
      text += ' ' + at(k).text
      j = k + 1
    }
    // Quoted strings (also inside [ ] / { }) that span lines fold, keep "#" lines and join on a trailing "\" in ways
    // the join above doesn't. The join skips "#" lines, so a value left open on its line is also checked against
    // the next raw line: inside an open quote or collection, a "#" line is content, not a comment.
    const closedOnLine = /^["']/.test(rest) ? (rest.startsWith('"') ? DOUBLE_QUOTED : SINGLE_QUOTED).test(rest) : rest.endsWith(rest[0] === '[' ? ']' : '}')
    let next = i + 1
    while (next < raw.length && raw[next].trim() === '') next++
    const continuesRaw = !closedOnLine && next < raw.length && indentOf(raw[next]) > parentIndent
    if (/^["'[{]/.test(rest) && (j > i + 1 || continuesRaw)) problemAt(i)('quoted strings and [ ] / { } collections that span lines are not supported (use a "|" block or block style)')
    return [scalar(text, problemAt(i)), j]
  }

  const parseNode = (i, indent) => {
    i = nextContent(i)
    if (i >= raw.length || at(i).indent < indent) return [null, i]
    const { text } = at(i)
    return /^-(\s|$)/.test(text) ? parseSeq(i, at(i).indent) : parseMap(i, at(i).indent)
  }

  const childOf = (i, indent, allowSameIndentSeq) => {
    const k = nextContent(i)
    if (k < raw.length && (at(k).indent > indent || (allowSameIndentSeq && at(k).indent === indent && /^-(\s|$)/.test(at(k).text)))) {
      return parseNode(k, at(k).indent)
    }
    return [null, k]
  }

  const parseMap = (i, indent) => {
    const node = {}
    while ((i = nextContent(i)) < raw.length) {
      const { indent: ind, text } = at(i)
      if (ind !== indent || /^-(\s|$)/.test(text)) break
      const m = text.match(KEY_RE)
      if (!m) {
        problemAt(i)(unsupportedIn(text) ?? 'line is not a "key: value" pair')
        i++
        continue
      }
      const key = scalar(m[1], problemAt(i))
      if (key === '<<') problemAt(i)('merge keys ("<<") are not supported')
      const rest = (m[2] ?? '').trim()
      setLine(node, key, i + 1)
      let value
      if (rest === '') [value, i] = childOf(i + 1, indent, true)
      else [value, i] = inlineValue(rest, i, indent)
      setKey(node, key, value)
    }
    return [node, i]
  }

  const parseSeq = (i, indent) => {
    const node = []
    while ((i = nextContent(i)) < raw.length) {
      const { indent: ind, text } = at(i)
      if (ind !== indent || !/^-(\s|$)/.test(text)) break
      const after = text.slice(1).trimStart()
      const idx = node.length
      setLine(node, idx, i + 1)
      let value
      if (after === '') [value, i] = childOf(i + 1, indent, false)
      // KEY_RE already rejects flow collections and quoted scalars with no ":" after the closing quote.
      else if (KEY_RE.test(after)) {
        view.set(i, { indent: indent + (text.length - after.length), text: after })
        ;[value, i] = parseMap(i, indent + (text.length - after.length))
      } else [value, i] = inlineValue(after, i, indent)
      node.push(value)
    }
    return [node, i]
  }

  try {
    const [doc, end] = parseNode(0, 0)
    const rest = nextContent(end)
    if (rest < raw.length) problemAt(rest)('content from here on was not parsed (unexpected indentation or structure)')
    if (doc != null && (typeof doc !== 'object' || Array.isArray(doc))) problemAt(first)('the document is not a mapping')
    // Once per file, unless that line is already reported for something else.
    if (breakAt !== -1 && !problems.some((p) => p.line === breakAt + 1)) {
      problemAt(breakAt)('a raw NEL, LS or PS character (U+0085, U+2028, U+2029) is read as a line break by some YAML parsers')
    }
    return { doc: doc && typeof doc === 'object' && !Array.isArray(doc) ? doc : {}, problems }
  } catch (e) {
    // Deeply nested or pathological input: report it rather than crash the guard or CI.
    return { doc: {}, problems: [{ line: 1, reason: `the file could not be parsed (${e.message})` }] }
  }
}

export const parseYamlSubset = (text) => parseWorkflowYaml(text).doc

// ---------------------------------------------------------------------------------------------------------------
// Rules
// ---------------------------------------------------------------------------------------------------------------
const isObj = (v) => !!v && typeof v === 'object' && !Array.isArray(v)
const strings = (v, out = []) => {
  if (typeof v === 'string') out.push(v)
  else if (Array.isArray(v)) v.forEach((x) => strings(x, out))
  else if (isObj(v)) Object.values(v).forEach((x) => strings(x, out))
  return out
}
// Expressions are case-insensitive and accept obj['key'] and spaces around dots; rewrite them to one lowercase
// dotted form so the patterns above see github.event.issue.title however it was written.
// Each ${{ … }} runs to the first "}}" after it. Found with indexOf rather than a lazy regex, which rescans to the end
// of the text from every "${{" that is never closed (quadratic).
const exprSpans = (s) => {
  const spans = []
  let open = s.indexOf('${{')
  while (open !== -1) {
    const close = s.indexOf('}}', open + 3)
    if (close === -1) break
    spans.push({ start: open, end: close + 2, inner: s.slice(open + 3, close) })
    open = s.indexOf('${{', close + 2)
  }
  return spans
}
// Spaces are only taken from the start of a run ((?<!\s)), so a long run that no "[" or "." follows is scanned once
// rather than from every space in it (quadratic). Dropping the spaces next to a "." is what replacing \s*\.\s* did.
const normalizeExpr = (e) => e.toLowerCase()
  .replace(/(?<!\s)\s*\[\s*(['"])([^'"]*)\1\s*\]/g, '.$2')
  .replace(/(?<!\s)\s+(?=\.)|(?<=\.)\s+/g, '')
  .trim()
const normalizeExprs = (s) => {
  let out = '', last = 0
  for (const { start, end, inner } of exprSpans(s)) {
    out += s.slice(last, start) + `\${{ ${normalizeExpr(inner)} }}`
    last = end
  }
  return out + s.slice(last)
}
const expressions = (s) => exprSpans(s).map(({ inner }) => normalizeExpr(inner))
// ANY_INDEX can't read an index with "[" or "]" inside it (commits[fromJSON('[0]')[0]]), so an indexed list of untrusted
// objects followed anywhere later by one of their untrusted fields counts as untrusted (fail closed).
const UNTRUSTED_LIST_INDEX = /\bgithub\.event\.(?:commits|pages|workflow_run\.pull_requests)\[/i
const UNTRUSTED_ITEM_FIELD = /\.(?:message|author\.(?:email|name)|page_name|head\.ref)\b/i
const unreadableIndex = (e) => {
  const list = UNTRUSTED_LIST_INDEX.exec(e)
  return list !== null && UNTRUSTED_ITEM_FIELD.test(e.slice(list.index + list[0].length)) ? `${list[0]}…` : undefined
}
const untrustedIn = (s) => expressions(s)
  .map((e) => e.match(UNTRUSTED_EXPR)?.[0] ?? e.match(WHOLE_EVENT_EXPR)?.[0] ?? unreadableIndex(e))
  .filter(Boolean)

const triggersOf = (doc) => {
  const on = doc.on
  if (typeof on === 'string') return [on]
  if (Array.isArray(on)) return on.filter((t) => typeof t === 'string')
  return isObj(on) ? Object.keys(on) : []
}

const actionName = (uses) => String(uses).split('@')[0].toLowerCase()
const isAiAction = (uses) => AI_ACTIONS.some((a) => actionName(uses) === a || actionName(uses).startsWith(a + '/'))

const stepsOf = (job) => (Array.isArray(job?.steps) ? job.steps.filter(isObj) : [])
const jobsOf = (doc) => (isObj(doc.jobs) ? Object.entries(doc.jobs).filter(([, j]) => isObj(j)) : [])

// Places where the rules expect a mapping or a list but the file has something else; jobsOf/stepsOf would skip them.
const shapeProblems = (doc) => {
  const out = []
  // triggersOf reads only the names in an "on" list, so a { } entry there would be skipped.
  if (Array.isArray(doc.on)) {
    doc.on.forEach((t, n) => {
      if (typeof t !== 'string') out.push({ line: lineOf(doc.on, n) || lineOf(doc, 'on'), reason: `entry ${n + 1} of "on" is not an event name` })
    })
  }
  if (doc.jobs === undefined) return out
  if (!isObj(doc.jobs)) return [...out, { line: lineOf(doc, 'jobs'), reason: '"jobs" is not a mapping' }]
  for (const [id, job] of Object.entries(doc.jobs)) {
    if (!isObj(job)) { out.push({ line: lineOf(doc.jobs, id), reason: `job "${id}" is not a mapping` }); continue }
    if (job.steps === undefined) continue
    if (!Array.isArray(job.steps)) { out.push({ line: lineOf(job, 'steps'), reason: `the steps of job "${id}" are not a list` }); continue }
    job.steps.forEach((step, n) => {
      if (!isObj(step)) out.push({ line: lineOf(job.steps, n), reason: `step ${n + 1} of job "${id}" is not a mapping` })
    })
  }
  return out
}

const checksOutPrCode = (step) => {
  if (typeof step.uses === 'string' && actionName(step.uses) === 'actions/checkout' && isObj(step.with)) {
    return ['ref', 'repository'].some((k) => typeof step.with[k] === 'string' && PR_REF_EXPR.test(normalizeExprs(step.with[k])))
  }
  return typeof step.run === 'string' && runChecksOutPr(normalizeExprs(step.run))
}

const privilegedRules = (doc, file, findings) => {
  const trigger = triggersOf(doc).find((t) => PRIVILEGED_TRIGGERS.includes(t))
  if (!trigger) return
  for (const [id, job] of jobsOf(doc)) {
    const steps = stepsOf(job)
    const idx = steps.findIndex(checksOutPrCode)
    if (idx === -1) continue
    findings.push({
      rule: 'wf-privileged-checkout', tier: TIER.HIGH, file, line: lineOf(job.steps, job.steps.indexOf(steps[idx])),
      detail: `Job "${id}" runs on ${trigger} (base-repo token and secrets) and checks out PR-controlled code. Run untrusted code under pull_request instead, or split build and privileged steps.`,
    })
    const secretsInJob = job.secrets === 'inherit' || strings(job).some((s) => SECRET_REF.test(s)) || strings(doc.env).some((s) => SECRET_REF.test(s))
    if (secretsInJob) {
      findings.push({
        rule: 'wf-privileged-secrets', tier: TIER.HIGH, file, line: lineOf(doc.jobs, id),
        detail: `Job "${id}" exposes secrets to PR-controlled code under ${trigger}.`,
      })
    }
  }
}

const untrustedInputRules = (doc, file, findings) => {
  for (const [id, job] of jobsOf(doc)) {
    for (const step of stepsOf(job)) {
      const line = lineOf(step, 'run') || lineOf(step, 'with') || lineOf(job.steps, job.steps.indexOf(step))
      if (typeof step.run === 'string') {
        for (const expr of untrustedIn(step.run)) {
          findings.push({
            rule: 'wf-untrusted-input', tier: TIER.HIGH, file, line,
            detail: `Job "${id}" puts \${{ ${expr} }} directly into a run script (shell injection). Pass it through env: and quote it.`,
          })
        }
      }
      if (typeof step.uses !== 'string' || !isObj(step.with)) continue
      const isScript = actionName(step.uses) === 'actions/github-script'
      const inputs = isScript ? [step.with.script].filter((s) => typeof s === 'string') : isAiAction(step.uses) ? strings(step.with) : []
      for (const expr of inputs.flatMap(untrustedIn)) {
        findings.push({
          rule: 'wf-untrusted-input', tier: TIER.HIGH, file, line,
          detail: isScript
            ? `Job "${id}" puts \${{ ${expr} }} into an actions/github-script script (code injection). Pass it through env: and read process.env.`
            : `Job "${id}" passes \${{ ${expr} }} into ${actionName(step.uses)} (prompt injection into an agent with repo access).`,
        })
      }
    }
  }
}

const unpinnedRules = (doc, file, findings) => {
  const check = (uses, line, where) => {
    if (typeof uses !== 'string' || uses.startsWith('./') || uses.startsWith('docker://')) return
    const [name, ref = ''] = uses.split('@')
    if (FIRST_PARTY_OWNERS.includes(name.split('/')[0].toLowerCase()) || SHA_PIN.test(ref)) return
    findings.push({
      rule: 'wf-unpinned-action', tier: TIER.WARNING, file, line,
      detail: `${where} uses ${uses}, which is not pinned to a full commit SHA; a moved tag can change what runs.`,
    })
  }
  for (const [id, job] of jobsOf(doc)) {
    check(job.uses, lineOf(job, 'uses'), `Job "${id}"`)
    for (const step of stepsOf(job)) check(step.uses, lineOf(step, 'uses'), `Job "${id}"`)
  }
}

const RANK = { none: 0, read: 1, write: 2 }
// null = no explicit block (repo default applies); otherwise scope → level, '*' for read-all/write-all.
const permsOf = (v) => {
  if (v === undefined || v === null) return null
  if (v === 'write-all') return { '*': 'write' }
  if (v === 'read-all') return { '*': 'read' }
  if (isObj(v)) return Object.fromEntries(Object.entries(v).filter(([, l]) => Object.hasOwn(RANK, l)))
  return v === '' || v === '{}' ? {} : null
}
const levelOf = (perms, scope) => (Object.hasOwn(perms, scope) ? perms[scope] : perms['*']) ?? 'none'

const permissionRules = (doc, base, file, findings) => {
  const levels = [{ where: 'workflow', node: doc, baseNode: base, fallbackLine: 1 }]
  for (const [id, job] of jobsOf(doc)) {
    levels.push({ where: `job "${id}"`, node: job, baseNode: isObj(base?.jobs?.[id]) ? base.jobs[id] : null, fallbackLine: lineOf(doc.jobs, id) })
  }
  for (const { where, node, baseNode, fallbackLine } of levels) {
    const line = lineOf(node, 'permissions') || fallbackLine
    if (node.permissions === 'write-all') {
      findings.push({ rule: 'wf-write-all', tier: TIER.WARNING, file, line, detail: `The ${where} grants permissions: write-all. List only the scopes it needs.` })
      continue
    }
    const before = baseNode ? permsOf(baseNode.permissions) : null
    if (!before) continue
    const after = permsOf(node.permissions)
    if (!after) {
      findings.push({ rule: 'wf-permissions-widened', tier: TIER.WARNING, file, line, detail: `The ${where} dropped its explicit permissions block, so the repo default token permissions apply.` })
      continue
    }
    const scopes = [...new Set([...Object.keys(after), ...Object.keys(before)])].filter((s) => s !== '*')
    const widened = scopes.filter((s) => RANK[levelOf(after, s)] > RANK[levelOf(before, s)])
      .map((s) => `${s}: ${levelOf(before, s)} → ${levelOf(after, s)}`)
    if (after['*'] && RANK[after['*']] > RANK[before['*'] ?? 'none']) widened.push(`all scopes: ${before['*'] ?? 'none'} → ${after['*']}`)
    if (widened.length) {
      findings.push({ rule: 'wf-permissions-widened', tier: TIER.WARNING, file, line, detail: `The ${where} widens token permissions (${widened.join(', ')}).` })
    }
  }
}

/**
 * Checks one workflow file.
 * @param {{ file: string, content: string, base?: string|null }} input  file: repo-relative path; content: the new
 *   text; base: the previous text (file on disk before an edit, or the base-branch version in CI), if any.
 * @returns {{ rule: string, tier: 'high'|'warning', file: string, line: number, detail: string }[]}
 */
export const checkWorkflow = ({ file, content, base = null }) => {
  const { doc, problems } = parseWorkflowYaml(content)
  const baseDoc = base == null ? null : parseYamlSubset(base)
  const findings = []
  // Fail closed: a file the rules can't fully read is high risk, since the part they skipped may be the dangerous one.
  for (const { line, reason } of [...problems, ...shapeProblems(doc)]) {
    findings.push({ rule: 'wf-unparsed', tier: TIER.HIGH, file, line, detail: `The workflow checks could not read this part of the file: ${reason}. Rewrite it in plain YAML so it can be checked.` })
  }
  privilegedRules(doc, file, findings)
  untrustedInputRules(doc, file, findings)
  unpinnedRules(doc, file, findings)
  permissionRules(doc, baseDoc, file, findings)
  return findings
}
