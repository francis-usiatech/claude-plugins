// Fake-pass rules (A6): find changed JS/TS tests that make a run green without proving anything. Findings use the
// shared shape { rule, tier, file, line, detail }; 'high' fails verify and the CI gate unless allowlisted or labelled,
// 'warning' is reported only. Detection is pattern based on code with comments, strings and regex literals blanked
// out, so no parser or dependency is needed (spec docs/specs/2026-09-30-fake-pass-and-mutation-test.md, D4–D8).
// Known limits (D7): aliases (`const o = it.only`), computed access (`it['only']`) and conditional calls
// (`(c ? it.skip : it)(…)`) aren't detected. Every lookup is linear or logarithmic, so a crafted file can't stall CI.

/** Finding tiers: 'high' blocks unless allowlisted or labelled; 'warning' is reported only. */
export const TIER = { HIGH: 'high', WARNING: 'warning' }

// Larger files aren't scanned; they fail closed as fp-unreadable.
const MAX_CHARS = 1_000_000
const JS_TS = /\.(?:js|mjs|cjs|jsx|ts|mts|cts|tsx)$/i
const norm = (p) => String(p).replace(/\\/g, '/')

/** True for a .js/.mjs/.cjs/.jsx/.ts/.mts/.cts/.tsx path. */
export const isJsTsFile = (rel) => JS_TS.test(norm(rel))

/** True for a JS/TS file named *.test.* or *.spec.*, or under a __tests__/, test/ or tests/ directory (D4). */
export const isTestFile = (rel) => {
  const p = norm(rel)
  return isJsTsFile(p) && (/\.(?:test|spec)\.[^./]+$/i.test(p) || /(?:^|\/)(?:__tests__|tests?)\//i.test(p))
}

// A `/` after one of these (or at the start) opens a regex literal; after anything else it's division.
const REGEX_PREFIX = new Set('(,=:[!&|?{};+-*%<>~^'.split(''))

/**
 * Blanks comment text and the contents of strings, templates and regex literals with spaces, keeping newlines and
 * delimiters so offsets and line numbers still match. `unterminated` is true when a block comment, template or
 * string runs to the end of the file, since everything after it would otherwise go unchecked.
 * @returns {{ code: string, unterminated: boolean }}
 */
export const blankCode = (text) => {
  const out = text.split('')
  const blank = (from, to) => { for (let k = from; k < to; k++) if (out[k] !== '\n' && out[k] !== '\r') out[k] = ' ' }
  let unterminated = false
  let prev = '' // last significant character outside comments, strings and regexes
  let i = 0
  while (i < text.length) {
    const c = text[i]
    const next = text[i + 1]
    if (c === '/' && next === '/') {
      const end = text.indexOf('\n', i)
      const stop = end === -1 ? text.length : end
      blank(i, stop)
      i = stop
    } else if (c === '/' && next === '*') {
      const end = text.indexOf('*/', i + 2)
      if (end === -1) unterminated = true
      const stop = end === -1 ? text.length : end + 2
      blank(i, stop)
      i = stop
    } else if (c === '/' && (prev === '' || REGEX_PREFIX.has(prev))) {
      let j = i + 1
      let inClass = false
      while (j < text.length && text[j] !== '\n' && (inClass || text[j] !== '/')) {
        if (text[j] === '\\') j++
        else if (text[j] === '[') inClass = true
        else if (text[j] === ']') inClass = false
        j++
      }
      if (text[j] !== '/') { prev = c; i++; continue } // no closing slash on the line: not a regex
      blank(i + 1, j)
      prev = '/'
      i = j + 1
    } else if (c === '\'' || c === '"' || c === '`') {
      let j = i + 1
      while (j < text.length && text[j] !== c) {
        if (text[j] === '\\') j++
        else if (c !== '`' && text[j] === '\n') break
        j++
      }
      if (j >= text.length) unterminated = true
      blank(i + 1, Math.min(j, text.length))
      prev = c
      i = j + 1
    } else {
      if (!/\s/.test(c)) prev = c
      i++
    }
  }
  return { code: out.join(''), unterminated }
}

// Index of the closing bracket for every opening one (-1 when unclosed), built once per file.
const bracketPairs = (code) => {
  const close = new Int32Array(code.length).fill(-1)
  const stacks = { '(': [], '{': [], '[': [] }
  const opener = { ')': '(', '}': '{', ']': '[' }
  for (let k = 0; k < code.length; k++) {
    const ch = code[k]
    if (stacks[ch]) stacks[ch].push(k)
    else if (opener[ch]) {
      const open = stacks[opener[ch]].pop()
      if (open !== undefined) close[open] = k
    }
  }
  return close
}

// 1-based line of an offset, by binary search over precomputed line starts.
const lineIndex = (text) => {
  const starts = [0]
  for (let k = 0; k < text.length; k++) if (text[k] === '\n') starts.push(k + 1)
  return (offset) => {
    let lo = 0
    let hi = starts.length - 1
    while (lo < hi) {
      const mid = (lo + hi + 1) >> 1
      if (starts[mid] <= offset) lo = mid
      else hi = mid - 1
    }
    return lo + 1
  }
}

// First value in a sorted array that is >= x, or Infinity.
const firstAtOrAfter = (sorted, x) => {
  let lo = 0
  let hi = sorted.length
  while (lo < hi) {
    const mid = (lo + hi) >> 1
    if (sorted[mid] < x) lo = mid + 1
    else hi = mid
  }
  return lo < sorted.length ? sorted[lo] : Infinity
}

const FOCUSED = [
  /\b(?:it|test|describe|suite|context)\.only\s*\(/g,
  /(?<![\w$.])(?:fit|fdescribe)\s*\(/g,
]
const SKIPPED = [
  /\b(?:it|test|describe|suite|context)\.(?:skip|todo|fixme)\s*\(/g,
  /(?<![\w$.])(?:xit|xdescribe|xtest|xcontext)\s*\(/g,
  // node:test options: it(name, { skip: … }, fn) or { todo: … }; an explicit false is not a skip.
  /(?<![\w$.])(?:it|test|describe|suite)\s*\(\s*[^,(){}[\]]*?,\s*\{[^{}]*?\b(?:skip|todo)\s*:\s*(?!false\b)/g,
]
// D6: the assertion calls that count. Extend this list to accept another style.
const ASSERTION = /(?<![\w$])assert\s*[.(]|(?<![\w$.])expect\s*\(|\.should\b|\bt\.plan\s*\(/g
// Test calls whose callback body is checked: it/test with run modifiers, an optional .each(table), an optional
// TypeScript type argument. Describe blocks and hooks are not tests.
const TEST_CALL = /(?<![\w$.])(?:it|test)(?:\.(?:only|concurrent|serial|fails|sequential))*(\.each)?\s*(?:<[^<>()]*>)?\s*\(/g
const CALLBACK = /=>|\bfunction\b/g
const PLACEHOLDER = /\b(?:TODO|FIXME|XXX)\b|\b[Nn]ot [Ii]mplemented\b/ // upper case only, so it.todo() isn't one

const finding = (rule, tier, file, line, detail) => ({ rule, tier, file, line, detail })
const unreadable = (file, why) => finding('fp-unreadable', TIER.HIGH, file, 1, `changed test file ${why}, so it was not checked`)

const nextNonSpace = (code, from) => {
  let k = from
  while (k < code.length && /\s/.test(code[k])) k++
  return k
}

// Offsets [open, close) of the test callback's body for the call whose argument list opens at `paren`, or null.
// An expression body (`() => expect(x)`) runs to the end of the argument list.
const callbackRange = (code, close, paren) => {
  const end = close[paren]
  if (end === -1) return null // unclosed call: a syntax error the test run reports itself
  CALLBACK.lastIndex = paren
  const m = CALLBACK.exec(code)
  if (!m || m.index >= end) return null
  let k = m.index + m[0].length
  if (m[0] === 'function') {
    while (k < end && code[k] !== '(') k++
    if (k >= end || close[k] === -1) return null
    k = close[k] + 1
  }
  k = nextNonSpace(code, k)
  if (code[k] === '{' && close[k] !== -1) return [k + 1, close[k]]
  return [k, end]
}

const patternFindings = (code, file, lineOf, patterns, rule, detail) => patterns.flatMap((re) => [...code.matchAll(re)]
  .map((m) => finding(rule, TIER.HIGH, file, lineOf(m.index), detail(m[0].replace(/\s*\(.*$/s, '')))))

const bodyFindings = (code, file, lineOf, close) => {
  const assertions = [...code.matchAll(ASSERTION)].map((m) => m.index)
  const found = []
  for (const m of code.matchAll(TEST_CALL)) {
    let paren = m.index + m[0].length - 1
    if (m[1]) { // .each(table)(name, fn): the test's own argument list follows the table
      if (close[paren] === -1) continue
      paren = nextNonSpace(code, close[paren] + 1)
      if (code[paren] !== '(') continue
    }
    const range = callbackRange(code, close, paren)
    if (!range) continue
    const [from, to] = range
    const line = lineOf(m.index)
    if (nextNonSpace(code, from) >= to) found.push(finding('fp-empty-test', TIER.HIGH, file, line, 'test body is empty, so it passes whatever the code does'))
    else if (firstAtOrAfter(assertions, from) >= to) found.push(finding('fp-no-assert', TIER.HIGH, file, line, 'test has no recognised assertion (assert, expect, .should, t.plan); allowlist it if a helper asserts'))
  }
  return found
}

const placeholderFindings = (text, file) => text.split('\n').flatMap((l, i) => (PLACEHOLDER.test(l)
  ? [finding('fp-placeholder', TIER.WARNING, file, i + 1, `placeholder left in a changed file: ${l.trim().slice(0, 80)}`)]
  : []))

/**
 * Checks one changed file. `content` is the file text, or null when it couldn't be read; `status` 'deleted' skips it.
 * Test files get every rule; other JS/TS files get only fp-placeholder; anything else gets nothing.
 * @param {{ file: string, content: string | null, status?: string }} input
 */
export const checkFakePasses = ({ file, content, status }) => {
  if (status === 'deleted' || !isJsTsFile(file)) return []
  const test = isTestFile(file)
  if (typeof content !== 'string') return test ? [unreadable(file, 'could not be read')] : []
  if (test && content.length > MAX_CHARS) return [unreadable(file, `is over ${MAX_CHARS} characters`)]
  const placeholders = content.length > MAX_CHARS ? [] : placeholderFindings(content, file)
  if (!test) return placeholders
  const { code, unterminated } = blankCode(content)
  if (unterminated) return [unreadable(file, 'has a comment, string or template that never closes'), ...placeholders]
  const lineOf = lineIndex(code)
  return [
    ...patternFindings(code, file, lineOf, FOCUSED, 'fp-only', (what) => `focused test (${what}) runs only itself and silently drops the rest of the suite`),
    ...patternFindings(code, file, lineOf, SKIPPED, 'fp-skip', (what) => `skipped or pending test (${what}) passes without running`),
    ...bodyFindings(code, file, lineOf, bracketPairs(code)),
    ...placeholders,
  ]
}
