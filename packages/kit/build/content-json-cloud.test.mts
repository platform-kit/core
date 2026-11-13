/* The content index in cloud mode (build/content-json.mjs): the functions read public.content and the bucket, never the file,
   so the step writes a stub and not the site's whole content. A function bundled server-side may not pass 5 MB, and the full
   index is in every function that imports the content API. */
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'

const script = fileURLToPath(new URL('./content-json.mjs', import.meta.url))
const site = fs.mkdtempSync(path.join(os.tmpdir(), 'content-json-cloud-'))
fs.writeFileSync(path.join(site, 'package.json'), JSON.stringify({ name: 'fixture-site', private: true, type: 'module' }))
fs.writeFileSync(path.join(site, 'platformkit.config.js'), 'export default {}\n')
try {
  const run = spawnSync(process.execPath, [script], { cwd: site, encoding: 'utf8', env: { ...process.env, CONTENT_STORE: 'cloud' } })
  assert.equal(run.status, 0, run.stderr)
  assert.match(run.stdout, /stub/)
  const file = path.join(site, 'supabase', 'functions', '_shared', 'content', 'index.json')
  assert.ok(fs.statSync(file).size < 1024, 'the index is a stub')
  assert.ok(JSON.parse(fs.readFileSync(file, 'utf8')) && typeof JSON.parse(fs.readFileSync(file, 'utf8')) === 'object')
  console.log('content-json-cloud: passed')
} finally {
  fs.rmSync(site, { recursive: true, force: true })
}
