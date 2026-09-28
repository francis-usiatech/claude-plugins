import { describe, it, after } from 'node:test'
import assert from 'node:assert/strict'
import path from 'node:path'
import { CI_SCRIPTS, githubStub, runNode, tempDir, cleanupTempDirs } from './helpers.mjs'

after(cleanupTempDirs)

const SHA = 'abc1234def5678'
const PASS = { verdict: 'PASS', summary: '0 findings.', findings: [], traceability: [{ area: 'src/', requirement: 'FR-01' }] }

// existing: comments returned by the list call; failWrite: status for POST/PATCH
const runPost = async ({ verdictJson = JSON.stringify(PASS), existing = [], failWrite } = {}) => {
  const stub = await githubStub((req) => {
    if (req.method === 'GET') return { json: existing }
    return failWrite ? { status: failWrite, json: { message: 'nope' } } : { status: req.method === 'POST' ? 201 : 200, json: { id: 1 } }
  })
  try {
    const r = await runNode(path.join(CI_SCRIPTS, 'post-verdict.mjs'), {
      cwd: tempDir(),
      env: { VERDICT_JSON: verdictJson, HEAD_SHA: SHA, PR_NUMBER: '7', GITHUB_REPOSITORY: 'o/r', GITHUB_TOKEN: 't', GITHUB_API_URL: stub.url },
    })
    return { ...r, requests: stub.requests, write: stub.requests.find((q) => q.method !== 'GET') }
  } finally {
    await stub.close()
  }
}
const marker = (body) => JSON.parse(body.match(/<!-- governance-verdict (\{.*?\}) -->/)[1])

describe('post-verdict', () => {
  it('should create a verdict comment with a machine-readable marker for the head commit', async () => {
    const r = await runPost()
    assert.equal(r.code, 0, r.stderr)
    assert.equal(r.write.method, 'POST')
    assert.equal(r.write.url, '/repos/o/r/issues/7/comments')
    assert.deepEqual(marker(r.write.body.body), { verdict: 'PASS', sha: SHA })
    assert.match(r.write.body.body, /Governance review: PASS/)
    assert.match(r.write.body.body, /\| src\/ \| FR-01 \|/)
  })

  it('should update the latest existing bot verdict comment instead of adding another', async () => {
    const existing = [
      { id: 11, user: { login: 'github-actions[bot]' }, body: '<!-- governance-verdict {"verdict":"FLAG","sha":"old"} -->' },
      { id: 12, user: { login: 'github-actions[bot]' }, body: '<!-- governance-verdict {"verdict":"BLOCK","sha":"older"} -->' },
      { id: 13, user: { login: 'someone' }, body: '<!-- governance-verdict {"verdict":"PASS","sha":"x"} -->' },
    ]
    const r = await runPost({ existing })
    assert.equal(r.write.method, 'PATCH')
    assert.equal(r.write.url, '/repos/o/r/issues/comments/12')
  })

  it('should post an ERROR verdict when the reviewer output is missing or invalid', async () => {
    for (const verdictJson of ['', 'not json', JSON.stringify({ verdict: 'MAYBE' })]) {
      const r = await runPost({ verdictJson })
      assert.equal(r.code, 0)
      assert.equal(marker(r.write.body.body).verdict, 'ERROR', verdictJson)
    }
  })

  it('should escape table-breaking characters in findings', async () => {
    const v = { ...PASS, verdict: 'FLAG', findings: [{ severity: 'Flag', finding: 'a | b\nc', file: 'x.ts', line: 3, rule: 'R1', action: 'fix' }] }
    const r = await runPost({ verdictJson: JSON.stringify(v) })
    assert.match(r.write.body.body, /\| 1 \| Flag \| a \\\| b c \| x\.ts:3 \| R1 \| fix \|/)
    assert.match(r.write.body.body, /FLAG needs the Document Owner's decision/)
  })

  it('should exit non-zero when GitHub rejects the write', async () => {
    const r = await runPost({ failWrite: 403 })
    assert.equal(r.code, 1)
    assert.match(r.stderr, /Failed to post verdict: 403/)
  })
})
