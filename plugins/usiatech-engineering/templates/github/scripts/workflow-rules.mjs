// GitHub Actions workflow rules (roadmap step 4, B10; spec docs/specs/2026-09-28-security-supply-chain.md R7–R10).
// Shared by the local guard hook and the PR governance checks through governance-rules.mjs, so both give the
// same verdict on the same file. No dependencies: workflows are read with the small YAML subset parser below.

export const TIER = { HIGH: 'high', WARNING: 'warning' }

// Shared helpers. They live here because this module imports nothing, so the other rules modules can import them
// without a cycle through governance-rules.mjs (which re-exports isPlainObject and escapeRegExp).
export const isPlainObject = (v) => !!v && typeof v === 'object' && !Array.isArray(v)
export const isNonEmptyString = (v) => typeof v === 'string' && v.trim() !== ''
export const escapeRegExp = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

// AI or agent actions whose inputs become a model prompt (R8). Matched on owner/repo, case-insensitively.
export const AI_ACTIONS = [
  'anthropics/claude-code-action',
  'anthropics/claude-code-base-action',
  'openai/codex-action',
  'google-github-actions/run-gemini-cli',
  'actions/ai-inference',
]

const PRIVILEGED_TRIGGERS = ['pull_request_target', 'workflow_run', 'issue_comment']
const FIRST_PARTY_OWNERS = ['actions', 'github']

// Event fields an outside contributor controls (GitHub's "untrusted input" list).
// An index holds no "[" of its own, so a "[" that is never closed is given up at the next "[" instead of scanned to
// the end of the expression from every "[" (quadratic). ".0" is the form normalizeExpr gives ['0']; "\d+" must be
// followed by ".", so it gives back at most its own digits.
const ANY_INDEX = String.raw`(?:\[[^\][]*\]|\.\*|\.\d+)`
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
// A run script checks out PR code with "gh pr checkout", or with a git fetch/checkout/switch/clone/pull followed,
// starting on the same line, by a pull ref or a PR head expression.
const GH_PR_CHECKOUT = /\bgh\s+pr\s+checkout\b/i
// Regex source for "git" plus up to 8 global options, ending where the subcommand starts (git -C dir fetch,
// git -c k="a b" pull). Shared by every git rule (F3). Any option may take a separate value, so a value option this
// list doesn't know (--attr-source HEAD) still fails closed, except git's options that never take one, so
// "git --no-pager log -S commit" is a log. An option value is a run of quoted and unquoted chunks whose first character
// picks the branch, so each value is read only one way, and the bound keeps a long run of options from being rescanned
// from every "git" in it (quadratic). A line continuation or a 9th option still hides the subcommand.
const GIT_VALUE = String.raw`(?:"[^"\n]*"|'[^'\n]*'|[^\s"'])`
const GIT_NO_VALUE = String.raw`(?:-p|-P|--paginate|--no-pager|--bare|--no-replace-objects|--no-lazy-fetch|--no-optional-locks|--no-advice|--literal-pathspecs|--glob-pathspecs|--noglob-pathspecs|--icase-pathspecs|--exec-path)`
export const GIT_PREFIX = String.raw`\bgit(?:\s+(?:(?!${GIT_NO_VALUE}\s)-[\w-]+\s+(?!-)${GIT_VALUE}+|-[\w-]+(?:=${GIT_VALUE}*)?)){0,8}?\s+`
const GIT_CHECKOUT_CMD = new RegExp(String.raw`${GIT_PREFIX}(?:fetch|checkout|switch|clone|pull)\b`, 'gi')
const PULL_REF_AT = /(?:refs\/|[\s:])pull\//iy
const PR_HEAD_IN_EXPR = /\bgithub\.(?:head_ref|event\.pull_request\.head|event\.workflow_run\.head_|event\.(?:pull_request\.)?number\b)/i
const matchesAt = (re, s, at) => { re.lastIndex = at; return re.test(s) }
// One regex with "[^\n]*" between the command and the ref would rescan the rest of the line from every command
// (quadratic). Instead each start position is tried once: a command whose line was already searched from an earlier
// command adds nothing. Each ${{ … }} that starts on the line is read whole through exprSpans, so a "}" in a literal
// can't end it early (ESP-111); the spans are walked in order alongside the lines, so each is tested once.
const runChecksOutPr = (run) => {
  if (GH_PR_CHECKOUT.test(run)) return true
  const spans = exprSpans(run)
  let searchedTo = -1, next = 0
  for (const cmd of run.matchAll(GIT_CHECKOUT_CMD)) {
    const from = cmd.index + cmd[0].length
    if (from <= searchedTo) continue
    const lineEnd = run.indexOf('\n', from)
    searchedTo = lineEnd === -1 ? run.length : lineEnd
    for (let at = from; at <= searchedTo; at++) if (matchesAt(PULL_REF_AT, run, at)) return true
    while (next < spans.length && spans[next].start < from) next++
    for (; next < spans.length && spans[next].start <= searchedTo; next++) if (PR_HEAD_IN_EXPR.test(spans[next].inner)) return true
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
const strings = (v, out = []) => {
  if (typeof v === 'string') out.push(v)
  else if (Array.isArray(v)) v.forEach((x) => strings(x, out))
  else if (isPlainObject(v)) Object.values(v).forEach((x) => strings(x, out))
  return out
}
// Expressions are case-insensitive and accept obj['key'] and spaces around dots; rewrite them to one lowercase
// dotted form so the patterns above see github.event.issue.title however it was written.
// Each ${{ … }} runs to the first "}}" after it outside a '…' literal, so format('}}', x) can't end it early
// (ESP-111). An escaped quote ('') reads as a literal ending and the next starting, which skips the same text. A
// literal that never closes runs the span to the end of the text (fail closed).
// A "${{" with no "}}" anywhere after it is not a span. Found with indexOf rather than a lazy regex, which rescans to
// the end of the text from every "${{" that is never closed (quadratic); the "}}" and quote searches only move forward.
const exprSpans = (s) => {
  const spans = []
  let open = s.indexOf('${{')
  let quote = -2
  while (open !== -1) {
    let close = s.indexOf('}}', open + 3)
    // Kept across spans: a quote past this span is searched for again only once the scan has passed it.
    if (quote !== -1 && quote < open + 3) quote = s.indexOf("'", open + 3)
    while (close !== -1 && quote !== -1 && quote < close) {
      const end = s.indexOf("'", quote + 1)
      if (end === -1) { close = s.length; break }
      if (close < end) close = s.indexOf('}}', end + 1)
      quote = s.indexOf("'", end + 1)
    }
    if (close === -1) break
    spans.push({ start: open, end: Math.min(close + 2, s.length), inner: s.slice(open + 3, close) })
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
// ANY_INDEX can't read an index with "[" or "]" inside it (commits[fromJSON('[0]')[0]]), so an indexed list of untrusted
// objects followed anywhere later by one of their untrusted fields counts as untrusted (fail closed).
const UNTRUSTED_LIST_INDEX = /\bgithub\.event\.(?:commits|pages|workflow_run\.pull_requests)\[/i
const UNTRUSTED_ITEM_FIELD = /\.(?:message|author\.(?:email|name)|page_name|head\.ref)\b/i
const unreadableIndex = (e) => {
  const list = UNTRUSTED_LIST_INDEX.exec(e)
  return list !== null && UNTRUSTED_ITEM_FIELD.test(e.slice(list.index + list[0].length)) ? `${list[0]}…` : undefined
}
// A non-literal index (github.event[inputs.key], github[matrix.ctx]) can pick any field, so anywhere on a github path
// it counts as untrusted (fail closed). The text is read as it was written (lowercased only), one token at a time: a
// closed '…' literal is skipped whole, so 'github[bot]' is text, not a path; an unclosed quote matches nothing and is
// stepped over (fail closed). It isn't read after normalizeExpr, whose ['key'] rewrite can join two literals around a
// path ('x[', github[k], ']') and hide it. The path takes only literal segments (.name, .*, [0], [*], ['key']) and
// can't fail once "github" has matched, so matchAll resumes after each path instead of rescanning it, and the "["
// check reads only the spaces after it.
const LITERAL_OR_GITHUB_PATH = /'[^']*'|(?<![\w.-])github\b(?:\s*\.\s*(?:[\w-]+|\*)|\s*\[\s*(?:\d+|\*|'[^']*'|"[^"]*")\s*\])*/g
const OPEN_INDEX_AT = /\s*\[/y
const computedIndex = (inner) => {
  const e = inner.toLowerCase()
  for (const token of e.matchAll(LITERAL_OR_GITHUB_PATH)) {
    if (token[0][0] !== "'" && matchesAt(OPEN_INDEX_AT, e, token.index + token[0].length)) return `${token[0]}[…]`
  }
  return undefined
}
// Stands for every env name. It is set when the untrusted names can't be read: a whole-expression env: block, a name
// outside [\w-] (env['A.B'] reads as env.a.b), or a $GITHUB_ENV write. Then any env reference counts (fail closed).
const ANY_ENV = '*'
// normalizeExpr has already turned env['T'] and ENV . T into env.t. The whole object (toJSON(env)), env.* and a
// computed index (env[x]) may reach any name, so they count as the first untrusted one (fail closed).
const ENV_REF = /(?<![\w.-])env(?:\.([\w-]+)|(?![\w-]))/g
const untrustedEnvRef = (e, env) => {
  for (const [ref, name] of e.matchAll(ENV_REF)) {
    const hit = name === undefined ? env.keys().next().value : env.has(name) ? name : env.has(ANY_ENV) ? ANY_ENV : undefined
    if (hit !== undefined) return `\${{ ${name === undefined ? `${ref}…` : ref} }} (env.${hit} is set from ${env.get(hit)})`
  }
  return undefined
}
// The same for step and job outputs: ids holds the lowercased ids of steps that wrote untrusted text to $GITHUB_OUTPUT
// (R8), or of jobs with an output that reads untrusted text (ESP-111). toJSON(steps), steps.* and steps[x] may reach
// any of them, and so may the same forms of needs.
const STEPS_REF = /(?<![\w.-])steps(?:\.([\w-]+)|(?![\w-]))/g
const NEEDS_REF = /(?<![\w.-])needs(?:\.([\w-]+)|(?![\w-]))/g
const untrustedIdRef = (e, re, ids, why) => {
  for (const [ref, id] of e.matchAll(re)) {
    const hit = id === undefined ? ids.values().next().value : ids.has(id) ? id : undefined
    if (hit !== undefined) return `\${{ ${id === undefined ? `${ref}…` : ref} }} (${why(hit)})`
  }
  return undefined
}
// What is untrusted at one point in a job: env maps a lowercased env name set from untrusted text to where it came
// from (F10), steps and needs are the ids for untrustedIdRef.
const NO_TAINT = { env: new Map(), steps: new Set(), needs: new Set() }
// Each untrusted ${{ … }} in s, as shown in a finding.
const untrustedIn = (s, taint = NO_TAINT) => exprSpans(s)
  .map(({ inner }) => {
    const e = normalizeExpr(inner)
    const found = e.match(UNTRUSTED_EXPR)?.[0] ?? e.match(WHOLE_EVENT_EXPR)?.[0] ?? unreadableIndex(e) ?? computedIndex(inner)
    return found ? `\${{ ${found} }}` : untrustedEnvRef(e, taint.env)
      ?? untrustedIdRef(e, STEPS_REF, taint.steps, (id) => `step ${id} writes untrusted text to $GITHUB_OUTPUT`)
      ?? untrustedIdRef(e, NEEDS_REF, taint.needs, (id) => `job ${id} has an output set from untrusted text`)
  })
  .filter(Boolean)
// The env names untrusted after one level's env: block. A name it sets replaces the outer one (step over job over
// workflow), and a value that reads an untrusted outer name is untrusted too. Names are read case-insensitively, and
// a safe value never clears a name its own block set from untrusted text (T and t in one block, ESP-102).
const untrustedEnv = (block, taint) => {
  const outer = taint.env
  if (typeof block === 'string') {
    const from = untrustedIn(block, taint)[0]
    return from ? new Map([...outer, [ANY_ENV, from]]) : outer
  }
  if (!isPlainObject(block)) return outer
  const env = new Map(outer)
  const marked = new Set()
  for (const [name, value] of Object.entries(block)) {
    const key = name.toLowerCase()
    const from = typeof value === 'string' ? untrustedIn(value, taint)[0] : undefined
    if (from) {
      env.set(key, from)
      marked.add(key)
      if (/[^\w-]/.test(key)) env.set(ANY_ENV, from)
    } else if (!marked.has(key)) env.delete(key)
  }
  return env
}
// Untrusted text a run script reads: an untrusted ${{ … }}, or an untrusted env name named anywhere in it, whatever
// the shell's read syntax ($T, $env:T, %T%, os.environ['T']; fail closed). After a $GITHUB_ENV write any shell
// variable may hold it, except GITHUB_* and RUNNER_*, which $GITHUB_ENV can't set: $X, ${X}, $env:X, %X%, and any
// environ / getenv / printenv / process.env read, whose name isn't parsed (fail closed).
const SHELL_VAR = /\$(?:env:)?\{?([A-Za-z_]\w*)|%([A-Za-z_]\w*)%|\b(?:environ|getenv|printenv)\b|\bprocess\.env\b/gi
// Commands that print event or PR text themselves (ESP-111): the event payload file, gh reads of a PR or issue, and
// git log / show, which print commit messages, author names and, with a patch, PR file contents.
const SHELL_EVENT_READ = /\bGITHUB[._]EVENT_PATH\b|\bgh\s+(?:(?:pr|issue)\s+(?:view|list|diff)|api)\b/i
const GIT_LOG_CMD = new RegExp(String.raw`${GIT_PREFIX}(log|show)\b`, 'gi')
// A format of only hashes, dates and newlines; anything else (%s, %an, a named format such as oneline) prints text.
const SAFE_PLACEHOLDERS = /%(?:[HhTtPpn%]|[ac][dDrtiIsh])/g
const safeFormat = (value) => {
  const format = value.replace(/^t?format:/, '')
  return format.includes('%') && !format.replace(SAFE_PLACEHOLDERS, '').includes('%')
}
// The only characters a hash-only git log / show may use. Anything the shell reads specially (quotes, $, `…`, {…},
// globs, backslashes) could hide an option or change the words, so it fails closed instead of being parsed.
// shortcut: a quoted format or a "$SHA" revision is flagged too; parse shell words if that proves noisy.
const PLAIN_GIT_TEXT = /^[\s\w%./:@^~=,+-]*$/
// A git log / show prints only hashes when its text is plain, every option on it is known to be safe (fail closed:
// -L, --dirstat or an option not listed prints text), it has a format and every format is safe (git uses the last
// one), and a show drops its patch with -s.
const printsOnlyHashes = (sub, text) => {
  if (!PLAIN_GIT_TEXT.test(text)) return false
  const words = text.split(/\s+/).filter(Boolean)
  let formats = 0, noPatch = false
  for (let i = 0; i < words.length; i++) {
    const word = words[i]
    if (word === '--') break
    // A revision with ":" names a file (HEAD:path), whose contents git show prints even with -s.
    if (!word.startsWith('-')) { if (word.includes(':')) return false; continue }
    if (/^-\d+$|^--max-count=\d+$/.test(word)) continue
    if (word === '-n' || word === '--max-count') { i++; continue }
    if (word === '-s' || word === '--no-patch') { noPatch = true; continue }
    // Only the = form: a bare --pretty means --pretty=medium, and the next word is a revision or path.
    const format = word.match(/^--(?:format|pretty)=(.*)$/)
    if (!format || !safeFormat(format[1])) return false
    formats++
  }
  return formats > 0 && (sub.toLowerCase() === 'log' || noPatch)
}
// Each git log / show is read up to the next shell separator; a quote or backtick before it makes the text not
// plain, so a separator inside one can't hide what follows. One that starts inside the previous one's text is an
// argument of it, already read, so each character is scanned once (a 1 MB line of "git log" stays linear).
const SHELL_SEPARATOR = /[;&|\n)]/g
// A line continuation leaves a backslash in the text, so it isn't plain either.
const shellEventRead = (run) => {
  const read = run.match(SHELL_EVENT_READ)
  if (read) return read[0]
  let readTo = -1
  for (const cmd of run.matchAll(GIT_LOG_CMD)) {
    const from = cmd.index + cmd[0].length
    if (cmd.index < readTo) continue
    SHELL_SEPARATOR.lastIndex = from
    readTo = SHELL_SEPARATOR.exec(run)?.index ?? run.length
    if (!printsOnlyHashes(cmd[1], run.slice(from, readTo))) return cmd[0].trim()
  }
  return undefined
}
const untrustedRead = (run, taint) => {
  const direct = untrustedIn(run, taint)[0]
  if (direct) return direct
  const { env } = taint
  const text = run.toLowerCase()
  for (const [name, from] of env) {
    if (name !== ANY_ENV && new RegExp(`(?<![\\w-])${escapeRegExp(name)}(?![\\w-])`).test(text)) return `${name} (env.${name} is set from ${from})`
  }
  if (env.has(ANY_ENV)) {
    for (const [ref, dollar, percent] of run.matchAll(SHELL_VAR)) {
      const name = dollar ?? percent
      if (name === undefined || !/^(?:github|runner)_/i.test(name)) return `${ref} (env.${ANY_ENV} is set from ${env.get(ANY_ENV)})`
    }
  }
  return shellEventRead(run)
}

const triggersOf = (doc) => {
  const on = doc.on
  if (typeof on === 'string') return [on]
  if (Array.isArray(on)) return on.filter((t) => typeof t === 'string')
  return isPlainObject(on) ? Object.keys(on) : []
}

const actionName = (uses) => String(uses).split('@')[0].toLowerCase()
const isAiAction = (uses) => AI_ACTIONS.some((a) => actionName(uses) === a || actionName(uses).startsWith(a + '/'))

const stepsOf = (job) => (Array.isArray(job?.steps) ? job.steps.filter(isPlainObject) : [])
const jobsOf = (doc) => (isPlainObject(doc.jobs) ? Object.entries(doc.jobs).filter(([, j]) => isPlainObject(j)) : [])

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
  if (!isPlainObject(doc.jobs)) return [...out, { line: lineOf(doc, 'jobs'), reason: '"jobs" is not a mapping' }]
  for (const [id, job] of Object.entries(doc.jobs)) {
    if (!isPlainObject(job)) { out.push({ line: lineOf(doc.jobs, id), reason: `job "${id}" is not a mapping` }); continue }
    if (job.steps === undefined) continue
    if (!Array.isArray(job.steps)) { out.push({ line: lineOf(job, 'steps'), reason: `the steps of job "${id}" are not a list` }); continue }
    job.steps.forEach((step, n) => {
      if (!isPlainObject(step)) out.push({ line: lineOf(job.steps, n), reason: `step ${n + 1} of job "${id}" is not a mapping` })
    })
  }
  return out
}

// A step or job output in a checkout ref counts as PR code: the usual issue_comment job looks up the PR head with gh
// or github-script and passes it on that way (ESP-103, ESP-111). Any steps or needs reference counts, so steps[x]
// fails closed. So does an env name set from a PR ref, an output or untrusted text (prEnv holds those names, ANY_ENV
// for every name), so env: REF: ${{ github.sha }} stays clean. Each ${{ … }} span is read whole, so a "}" in a
// string literal ('{0}') can't end it early.
const OUTPUT_IN_EXPR = /(?<![\w.-])(?:steps|needs)\b/
const readsPrEnv = (e, prEnv) => [...e.matchAll(ENV_REF)].some(([, name]) => (name === undefined ? prEnv.size > 0 : prEnv.has(name) || prEnv.has(ANY_ENV)))
const readsPrRef = (s, prEnv) => PR_REF_EXPR.test(normalizeExprs(s)) || untrustedIn(s).length > 0
  || exprSpans(s).some(({ inner }) => { const e = normalizeExpr(inner); return OUTPUT_IN_EXPR.test(e) || readsPrEnv(e, prEnv) })
const checksOutPrCode = (step, prEnv) => {
  if (typeof step.uses === 'string' && actionName(step.uses) === 'actions/checkout' && isPlainObject(step.with)) {
    return ['ref', 'repository'].some((k) => typeof step.with[k] === 'string' && readsPrRef(step.with[k], prEnv))
  }
  return typeof step.run === 'string' && runChecksOutPr(normalizeExprs(step.run))
}
// The lowercased env names set from PR-derived text after one level's env: block, as untrustedEnv does for untrusted
// text: a name it sets replaces the outer one, a whole-expression block or a name outside [\w-] that reads such text
// marks every name, and a plain value never clears a name its own block set from such text.
const prRefEnv = (block, outer) => {
  if (typeof block === 'string') return readsPrRef(block, outer) ? new Set([...outer, ANY_ENV]) : outer
  if (!isPlainObject(block)) return outer
  const env = new Set(outer), marked = new Set()
  for (const [name, value] of Object.entries(block)) {
    const key = name.toLowerCase()
    if (typeof value === 'string' && readsPrRef(value, outer)) {
      env.add(key)
      marked.add(key)
      if (/[^\w-]/.test(key)) env.add(ANY_ENV)
    } else if (!marked.has(key)) env.delete(key)
  }
  return env
}
// A run script that names $GITHUB_ENV and reads PR-derived text (an expression, a PR-derived env name in any shell
// syntax, or event text it fetches itself) may set any env name from it.
const writesPrEnv = (run, prEnv) => /\bGITHUB_ENV\b/i.test(run) && (readsPrRef(run, prEnv) || untrustedRead(run, NO_TAINT) !== undefined
  || prEnv.has(ANY_ENV) || [...prEnv].some((name) => new RegExp(`(?<![\\w-])${escapeRegExp(name)}(?![\\w-])`, 'i').test(run)))
// The index of the first step that checks out PR code.
const prCheckoutIndex = (doc, job, steps) => {
  let jobEnv = prRefEnv(job.env, prRefEnv(doc.env, new Set()))
  for (const [n, step] of steps.entries()) {
    const env = prRefEnv(step.env, jobEnv)
    if (checksOutPrCode(step, env)) return n
    if (typeof step.run === 'string' && writesPrEnv(step.run, env)) jobEnv = new Set([...jobEnv, ANY_ENV])
  }
  return -1
}

const privilegedRules = (doc, file, findings) => {
  const trigger = triggersOf(doc).find((t) => PRIVILEGED_TRIGGERS.includes(t))
  if (!trigger) return
  for (const [id, job] of jobsOf(doc)) {
    const steps = stepsOf(job)
    const idx = prCheckoutIndex(doc, job, steps)
    if (idx === -1) {
      // A reusable workflow call can't be read from here, so with inherited secrets it is assumed to run PR code.
      // Any non-null "uses" counts, so a malformed one fails closed.
      if (job.uses != null && job.secrets === 'inherit') {
        const called = typeof job.uses === 'string' ? job.uses : 'a reusable workflow'
        findings.push({
          rule: 'wf-privileged-secrets', tier: TIER.HIGH, file, line: lineOf(doc.jobs, id),
          detail: `Job "${id}" calls ${called} with secrets: inherit under ${trigger}. The called workflow can't be checked here, so its secrets are assumed reachable by PR-controlled code. Pass only the secrets the called workflow needs, or call it from a pull_request workflow.`,
        })
      }
      continue
    }
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

// Walks a job's steps in order, calling visit(step, taint) with what is untrusted at each one, and says whether any
// of the job's outputs reads untrusted text. needs holds the lowercased ids of jobs whose outputs do.
const walkJob = (job, workflowEnv, needs, visit) => {
  const steps = new Set()
  let jobEnv = untrustedEnv(job.env, { env: workflowEnv, steps, needs })
  for (const step of stepsOf(job)) {
    const taint = { env: untrustedEnv(step.env, { env: jobEnv, steps, needs }), steps, needs }
    visit(step, taint)
    if (typeof step.run !== 'string') continue
    // Untrusted text written to $GITHUB_ENV reaches every later step's env under a name the script chose, and text
    // written to $GITHUB_OUTPUT (or with the deprecated ::set-output command) reaches steps.<id>.outputs (R8,
    // ESP-111). Either file named, in any case (Windows env names aren't case-sensitive), counts as written to.
    const from = untrustedRead(step.run, taint)
    if (from && /\bGITHUB_ENV\b/i.test(step.run)) jobEnv = new Map([...jobEnv, [ANY_ENV, `$GITHUB_ENV, written from ${from}`]])
    if (from && /\bGITHUB_OUTPUT\b|::set-output\b/i.test(step.run) && step.id != null) steps.add(String(step.id).toLowerCase())
  }
  const final = { env: jobEnv, steps, needs }
  return strings(job.outputs).some((s) => untrustedIn(s, final).length > 0)
}
// Jobs ordered so each comes after the jobs its needs: names, read without recursion (a long chain can't overflow the
// stack). A job already being expanded is not expanded again, so a cycle ends; every job is in the result once.
const needsOrder = (jobs) => {
  const byId = new Map(jobs.map((entry) => [entry[0].toLowerCase(), entry]))
  const order = [], placed = new Set(), expanding = new Set()
  for (const start of jobs) {
    const stack = [[start, false]]
    while (stack.length) {
      const [entry, expanded] = stack.pop()
      if (placed.has(entry)) continue
      if (expanded) { placed.add(entry); order.push(entry); continue }
      if (expanding.has(entry)) continue
      expanding.add(entry)
      stack.push([entry, true])
      for (const dep of [entry[1].needs].flat()) {
        const next = typeof dep === 'string' ? byId.get(dep.toLowerCase()) : undefined
        if (next && !placed.has(next)) stack.push([next, false])
      }
    }
  }
  return order
}
// The needs ids a job may read as untrusted: those in tainted, and any it doesn't declare in needs: (fail closed;
// GitHub rejects such a read, and following it would take a pass per job).
const needsTaintOf = (job, tainted) => {
  const declared = new Set([job.needs].flat().filter((d) => typeof d === 'string').map((d) => d.toLowerCase()))
  return { has: (id) => tainted.has(id) || !declared.has(id), values: () => tainted.values() }
}
// The jobs with an output that reads untrusted text, through any chain of needs. One walk in needs order finds them
// all, since each job's declared needs are walked before it.
const untrustedJobs = (doc, workflowEnv) => {
  const tainted = new Set()
  for (const [id, job] of needsOrder(jobsOf(doc))) {
    if (walkJob(job, workflowEnv, needsTaintOf(job, tainted), () => {})) tainted.add(id.toLowerCase())
  }
  return tainted
}

const untrustedInputRules = (doc, file, findings) => {
  const workflowEnv = untrustedEnv(doc.env, NO_TAINT)
  const needs = untrustedJobs(doc, workflowEnv)
  for (const [id, job] of jobsOf(doc)) {
    walkJob(job, workflowEnv, needsTaintOf(job, needs), (step, taint) => {
      const line = lineOf(step, 'run') || lineOf(step, 'with') || lineOf(job.steps, job.steps.indexOf(step))
      if (typeof step.run === 'string') {
        for (const expr of untrustedIn(step.run, taint)) {
          findings.push({
            rule: 'wf-untrusted-input', tier: TIER.HIGH, file, line,
            detail: `Job "${id}" puts ${expr} directly into a run script (shell injection). Pass it through env: and quote it.`,
          })
        }
      }
      if (typeof step.uses !== 'string' || !isPlainObject(step.with)) return
      const isScript = actionName(step.uses) === 'actions/github-script'
      const inputs = isScript ? [step.with.script].filter((s) => typeof s === 'string') : isAiAction(step.uses) ? strings(step.with) : []
      for (const expr of inputs.flatMap((s) => untrustedIn(s, taint))) {
        findings.push({
          rule: 'wf-untrusted-input', tier: TIER.HIGH, file, line,
          detail: isScript
            ? `Job "${id}" puts ${expr} into an actions/github-script script (code injection). Pass it through env: and read process.env.`
            : `Job "${id}" passes ${expr} into ${actionName(step.uses)} (prompt injection into an agent with repo access).`,
        })
      }
    })
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
  if (isPlainObject(v)) return Object.fromEntries(Object.entries(v).filter(([, l]) => Object.hasOwn(RANK, l)))
  return v === '' || v === '{}' ? {} : null
}
const levelOf = (perms, scope) => (Object.hasOwn(perms, scope) ? perms[scope] : perms['*']) ?? 'none'

// R10: an old version the rules can't fully read counts as granting no permissions at every level, so only a block
// in the new version that grants something is reported, with a note saying what it was compared against. A block
// the readable part of the old version still shows is reported when the new version drops it.
const UNREADABLE_BASE_NOTE = ' The old version could not be parsed, so it was compared as granting no permissions.'
const UNREADABLE_BASE_DROPPED_NOTE = ' The old version could not be fully parsed; its readable part had this block.'

const permissionRules = (doc, base, baseUnreadable, file, findings) => {
  const levels = [{ where: 'workflow', node: doc, baseNode: base, fallbackLine: 1 }]
  for (const [id, job] of jobsOf(doc)) {
    levels.push({ where: `job "${id}"`, node: job, baseNode: isPlainObject(base?.jobs?.[id]) ? base.jobs[id] : null, fallbackLine: lineOf(doc.jobs, id) })
  }
  for (const { where, node, baseNode, fallbackLine } of levels) {
    const line = lineOf(node, 'permissions') || fallbackLine
    if (node.permissions === 'write-all') {
      findings.push({ rule: 'wf-write-all', tier: TIER.WARNING, file, line, detail: `The ${where} grants permissions: write-all. List only the scopes it needs.` })
      continue
    }
    const baseBlock = baseNode ? permsOf(baseNode.permissions) : null
    const before = baseUnreadable ? {} : baseBlock
    if (!before) continue
    const after = permsOf(node.permissions)
    if (!after) {
      if (!baseBlock) continue
      findings.push({ rule: 'wf-permissions-widened', tier: TIER.WARNING, file, line, detail: `The ${where} dropped its explicit permissions block, so the repo default token permissions apply.${baseUnreadable ? UNREADABLE_BASE_DROPPED_NOTE : ''}` })
      continue
    }
    const scopes = [...new Set([...Object.keys(after), ...Object.keys(before)])].filter((s) => s !== '*')
    const widened = scopes.filter((s) => RANK[levelOf(after, s)] > RANK[levelOf(before, s)])
      .map((s) => `${s}: ${levelOf(before, s)} → ${levelOf(after, s)}`)
    if (after['*'] && RANK[after['*']] > RANK[before['*'] ?? 'none']) widened.push(`all scopes: ${before['*'] ?? 'none'} → ${after['*']}`)
    if (widened.length) {
      findings.push({ rule: 'wf-permissions-widened', tier: TIER.WARNING, file, line, detail: `The ${where} widens token permissions (${widened.join(', ')}).${baseUnreadable ? UNREADABLE_BASE_NOTE : ''}` })
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
  const baseParsed = base == null ? null : parseWorkflowYaml(base)
  const baseUnreadable = !!baseParsed && (baseParsed.problems.length > 0 || shapeProblems(baseParsed.doc).length > 0)
  const findings = []
  // Fail closed: a file the rules can't fully read is high risk, since the part they skipped may be the dangerous one.
  for (const { line, reason } of [...problems, ...shapeProblems(doc)]) {
    findings.push({ rule: 'wf-unparsed', tier: TIER.HIGH, file, line, detail: `The workflow checks could not read this part of the file: ${reason}. Rewrite it in plain YAML so it can be checked.` })
  }
  privilegedRules(doc, file, findings)
  untrustedInputRules(doc, file, findings)
  unpinnedRules(doc, file, findings)
  permissionRules(doc, baseParsed?.doc ?? null, baseUnreadable, file, findings)
  return findings
}
