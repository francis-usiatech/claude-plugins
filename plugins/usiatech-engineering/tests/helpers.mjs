// Test helpers: temp git repos with an origin, a base-branch governance copy, script runners and a GitHub API stub.
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, cpSync, readFileSync, existsSync } from 'node:fs'
import { execFileSync, execFile } from 'node:child_process'
import { createServer } from 'node:http'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

export const PLUGIN_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
export const CI_SCRIPTS = path.join(PLUGIN_ROOT, 'templates', 'github', 'scripts')
export const GUARD_SCRIPT = path.join(PLUGIN_ROOT, 'hooks', 'scripts', 'governance-guard.mjs')
export const BASH_WF_SCRIPT = path.join(PLUGIN_ROOT, 'hooks', 'scripts', 'bash-workflow-check.mjs')

const tempDirs = []
export const tempDir = (prefix = 'usiatech-test-') => {
  const d = mkdtempSync(path.join(tmpdir(), prefix))
  tempDirs.push(d)
  return d
}
export const cleanupTempDirs = () => {
  for (const d of tempDirs.splice(0)) rmSync(d, { recursive: true, force: true })
}

export const git = (cwd, ...args) => execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim()

// Writes files relative to root. A null value deletes the file.
export const writeFiles = (root, files) => {
  for (const [rel, content] of Object.entries(files)) {
    const p = path.join(root, rel)
    if (content === null) { rmSync(p, { force: true }); continue }
    mkdirSync(path.dirname(p), { recursive: true })
    writeFileSync(p, content)
  }
}

/**
 * Creates a working repo whose base branch is pushed to a bare origin, then checks out a head branch
 * with headFiles applied and committed. Returns the working directory.
 */
export const makeRepo = ({ base = 'develop', head = 'feature/x', baseFiles = { 'README.md': 'base\n' }, headFiles = {} } = {}) => {
  const origin = tempDir('usiatech-origin-')
  const work = tempDir('usiatech-work-')
  git(origin, 'init', '--bare', '-q')
  git(work, 'init', '-q')
  git(work, 'checkout', '-q', '-b', base)
  git(work, 'config', 'user.email', 'test@example.com')
  git(work, 'config', 'user.name', 'Test')
  git(work, 'config', 'core.autocrlf', 'false')
  git(work, 'remote', 'add', 'origin', origin)
  writeFiles(work, baseFiles)
  git(work, 'add', '-A')
  git(work, 'commit', '-q', '-m', 'base')
  git(work, 'push', '-q', 'origin', base)
  git(work, 'checkout', '-q', '-b', head)
  if (Object.keys(headFiles).length) {
    writeFiles(work, headFiles)
    git(work, 'add', '-A')
    git(work, 'commit', '-q', '-m', 'head')
  }
  return work
}

// Mirrors the workflow's base-branch copy: .github/scripts plus .claude/engineering.json in their own tree.
export const makeGovTree = (config) => {
  const gov = tempDir('usiatech-gov-')
  cpSync(CI_SCRIPTS, path.join(gov, '.github', 'scripts'), { recursive: true })
  if (config !== undefined) writeFiles(gov, { '.claude/engineering.json': JSON.stringify(config) })
  return path.join(gov, '.github', 'scripts')
}

/**
 * Runs a node script asynchronously (so an in-process HTTP stub can answer it).
 * Returns { code, stdout, stderr, summary } where summary is what the script wrote to GITHUB_STEP_SUMMARY.
 */
export const runNode = (script, { cwd, env = {}, input } = {}) => new Promise((resolve) => {
  const summaryFile = path.join(tempDir('usiatech-summary-'), 'summary.md')
  const child = execFile(process.execPath, [script], {
    cwd,
    env: { ...process.env, GITHUB_STEP_SUMMARY: summaryFile, CLAUDE_PROJECT_DIR: '', ...env },
    encoding: 'utf8',
  }, (err, stdout, stderr) => {
    resolve({
      code: err ? (typeof err.code === 'number' ? err.code : 1) : 0,
      stdout, stderr,
      summary: existsSync(summaryFile) ? readFileSync(summaryFile, 'utf8') : '',
    })
  })
  child.stdin.end(input ?? '')
})

/**
 * Minimal GitHub REST stub. handler(req, body) returns { status?, json }.
 * Returns { url, requests, close }.
 */
export const githubStub = async (handler) => {
  const requests = []
  const server = createServer((req, res) => {
    let body = ''
    req.on('data', (c) => { body += c })
    req.on('end', () => {
      const parsed = body ? JSON.parse(body) : null
      requests.push({ method: req.method, url: req.url, body: parsed, auth: req.headers.authorization })
      const { status = 200, json = {} } = handler(req, parsed) || {}
      res.writeHead(status, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify(json))
    })
  })
  await new Promise((r) => server.listen(0, '127.0.0.1', r))
  return {
    url: `http://127.0.0.1:${server.address().port}`,
    requests,
    close: () => new Promise((r) => server.close(r)),
  }
}
