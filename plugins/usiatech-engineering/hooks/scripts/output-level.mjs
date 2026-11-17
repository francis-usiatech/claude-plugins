// usiatech-engineering: SessionStart hook (ESP-167). Adds the output-level rule from output.level in the base-branch
// .claude/engineering.json (F11) to the session context, at start-up and again after a compaction. Advice only:
// it never fails, and an unreadable or invalid setting falls back to "low".
import { readConfigText } from '../../scripts/session-check.mjs'
import { isMainModule } from '../../templates/github/scripts/main-module.mjs'
import { isPlainObject, outputSettingProblem } from '../../templates/github/scripts/governance-rules.mjs'

const DEFAULT_LEVEL = 'low'

/**
 * output.level from the base-branch config, else the working copy, else "low". `warning` names a config problem
 * only: reading the working copy because the base branch has no config is normal for a new setup, not a problem.
 */
export const readOutputLevel = ({ cwd }) => {
  const { text } = readConfigText(cwd)
  const result = (level, warning) => ({ level, warning })
  const fallback = (problem) => result(DEFAULT_LEVEL, `${problem}; using "${DEFAULT_LEVEL}"`)
  if (text == null) return result(DEFAULT_LEVEL, null)
  let cfg
  try {
    cfg = JSON.parse(text)
  } catch (e) {
    return fallback(`.claude/engineering.json is not valid JSON (${e.message})`)
  }
  const output = isPlainObject(cfg) ? cfg.output : undefined
  const problem = outputSettingProblem(output)
  if (problem) return fallback(problem)
  return result(output?.level ?? DEFAULT_LEVEL, null)
}

// The exemption is part of every rule, so a lower level can never shorten what the user must read to decide.
const EXEMPTION = 'Always in full detail, whatever the level: specs, plans, approval and decision questions to the user, and HTML review pages. The level never shortens them.'
const STEP_RULES = {
  low: 'Report each step to the user as one line that describes it. Show no commands, command output, diffs or reasoning paragraphs in progress messages. A failure is one line: the step and the decisive error.',
  medium: 'Report each step to the user as one line that describes it, plus at most two lines of the command it ran, when there is one. Show no command output, diffs or reasoning paragraphs in progress messages. A failure is one line: the step and the decisive error.',
}

/** The rule text for the session context, or null for "high" (normal output needs no rule). */
export const outputLevelContext = ({ level, warning }) => {
  if (!STEP_RULES[level]) return null
  const lines = [`usiatech-engineering output level: ${level} (output.level in .claude/engineering.json).`, STEP_RULES[level], EXEMPTION]
  // The hook runs again after every compaction, so "once" has to survive a repeat of this text.
  if (warning) lines.push(`Config problem: ${warning}. Tell the user once per session; skip it if you already did.`)
  return lines.join('\n')
}

const readHookCwd = async () => {
  let raw = ''
  try {
    for await (const c of process.stdin) raw += c
    const input = JSON.parse(raw || '{}')
    return process.env.CLAUDE_PROJECT_DIR || input.cwd || process.cwd()
  } catch {
    return process.env.CLAUDE_PROJECT_DIR || process.cwd() // bad hook input still gets the default rule
  }
}

if (isMainModule(import.meta.url)) {
  const cwd = await readHookCwd()
  let setting
  try {
    setting = readOutputLevel({ cwd })
  } catch (e) {
    setting = { level: DEFAULT_LEVEL, warning: `output.level could not be read (${e.message}); using "${DEFAULT_LEVEL}"` }
  }
  const additionalContext = outputLevelContext(setting)
  if (additionalContext) console.log(JSON.stringify({ hookSpecificOutput: { hookEventName: 'SessionStart', additionalContext } }))
}
