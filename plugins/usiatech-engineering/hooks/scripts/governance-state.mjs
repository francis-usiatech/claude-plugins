// usiatech-engineering: where the guard and the after-Bash check keep a project's temporary state (the workflow
// snapshots and the config-warning marker), and the rule for trusting that folder.
// Node built-ins only, so both hooks can import it statically without loading the rules modules.
import { lstatSync, mkdirSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'

/** The shell tools whose command the guard checks and the after-Bash check follows (ESP-106 R1: PowerShell on Windows). */
export const SHELL_TOOLS = ['Bash', 'PowerShell']

/** The folder under $TMP that holds every project's state. No trusted write path may name it (ESP-21). */
export const STATE_FOLDER = 'usiatech-governance'

/**
 * Where the state for a project lives. Deliberately not under a trusted write path ($TMP/claude/{project}/**), so an
 * Edit or Write the guard lets through without asking can't rewrite it. A Bash command still can: the guard asks
 * before one that names the folder or a snapshot file, but a command that builds the path another way is not caught
 * (a known limitation).
 */
export const stateDir = (root) => path.join(os.tmpdir(), STATE_FOLDER, root.replace(/[^A-Za-z0-9]/g, '-'))

/**
 * Why a state folder can't be trusted, or null. `st` is its lstat; `uid` the user's (undefined on Windows, whose
 * temp folder is per user). In a shared POSIX /tmp another local user could have created the folder first.
 */
export const stateFolderProblem = (st, uid) => {
  if (st.isSymbolicLink() || !st.isDirectory()) return 'not a real folder'
  if (uid === undefined) return null
  if (st.uid !== uid) return `owned by uid ${st.uid}`
  if (st.mode & 0o022) return 'writable by group or others'
  return null
}

/**
 * The project state folder `dir` (from stateDir), created private when `create` is set; null when it doesn't exist.
 * Throws when it, or the shared folder above it, can't be trusted. `what` names the folder in that error.
 */
export const checkedStateDir = (dir, { create, what = 'state' }) => {
  if (create) mkdirSync(dir, { recursive: true, mode: 0o700 })
  for (const d of [path.dirname(dir), dir]) {
    let st
    try {
      st = lstatSync(d)
    } catch (e) {
      if (e.code === 'ENOENT' && !create) return null
      throw e
    }
    const problem = stateFolderProblem(st, process.getuid?.())
    if (problem) throw new Error(`${what} folder ${d} can't be trusted: ${problem}`)
  }
  return dir
}
