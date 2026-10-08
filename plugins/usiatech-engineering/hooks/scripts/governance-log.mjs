// usiatech-engineering: the .claude/governance-log.jsonl writer shared by the guard and the after-Bash check.
// Node built-ins only, so the guard can import it statically and still log when any other module fails to load.
import { existsSync, appendFileSync, mkdirSync } from 'node:fs'
import path from 'node:path'

/** Appends one entry to .claude/governance-log.jsonl. Returns whether it was written. */
export const appendGovernanceLog = (root, entry) => {
  try {
    const dir = path.join(root, '.claude')
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true })
    appendFileSync(path.join(dir, 'governance-log.jsonl'),
      JSON.stringify({ ts: new Date().toISOString(), ...entry, target: String(entry.target || '').slice(0, 300) }) + '\n')
    return true
  } catch (e) {
    process.stderr.write(`[governance] could not write governance-log.jsonl: ${e.message}\n`)
    return false
  }
}
