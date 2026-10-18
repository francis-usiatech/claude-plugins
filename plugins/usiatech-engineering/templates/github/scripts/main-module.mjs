// usiatech-engineering: "was this script started directly?" for the plugin's entry scripts. Node built-ins only, so
// the after-Bash hook can import it on its no-change path (AC6).
import { realpathSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

/**
 * True when the module at moduleUrl (pass import.meta.url) is the script Node was started with. Real paths on both
 * sides: a script reached through a link has the link in argv and the target in import.meta.url, and comparing them
 * as written would make the script do nothing, without a word (F4).
 */
export const isMainModule = (moduleUrl) => {
  if (!process.argv[1]) return false
  try {
    return realpathSync(process.argv[1]) === realpathSync(fileURLToPath(moduleUrl))
  } catch {
    return false
  }
}
