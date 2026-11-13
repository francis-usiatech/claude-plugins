// Which conditional verify steps a diff selects (ESP-160). Shared by the local gate (skills/verify/gate.mjs) and the
// CI runner (run-verify.mjs), so both pick the same steps. setup-engineering copies this folder into .github/scripts/.
// A step is selected when a changed file starts with one of its `when` prefixes and matches none of its `unless`
// globs. Both match exactly, case included: git lists paths relative to the repo root with forward slashes.
import { globToRegExp } from './governance-rules.mjs'

// Each step's `unless` globs, compiled once: the local gate asks about one file at a time for its NOT COVERED list.
const compiled = new WeakMap()
const exclusionsOf = (step) => {
  if (!compiled.has(step)) {
    const unless = step.unless ?? []
    // run-verify.mjs doesn't validate the config as gate.mjs does, so a bad value is named here, not a TypeError.
    if (!Array.isArray(unless) || !unless.every((g) => typeof g === 'string')) throw new Error(`The "unless" of verify step "${step.name}" must be a list of globs.`)
    compiled.set(step, unless.map((glob) => globToRegExp(glob)))
  }
  return compiled.get(step)
}

/**
 * Why a conditional step is not selected for the changed files, or null when it is.
 * @param {{ name?: string, when?: string[], unless?: string[] }} step
 * @param {string[]} changed paths relative to the repo root
 * @returns {string|null}
 */
export const skipReason = (step, changed) => {
  const when = step.when ?? []
  const under = changed.filter((file) => when.some((prefix) => file.startsWith(prefix)))
  if (!under.length) return `no changed file under ${when.length ? when.join(', ') : '(none)'}`
  const excluded = exclusionsOf(step)
  if (under.every((file) => excluded.some((re) => re.test(file)))) return `every changed file under ${when.join(', ')} matches unless ${step.unless.join(', ')}`
  return null
}
