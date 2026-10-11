/*
 * THE CONTENT BUILDS — every record, against its schema.
 *
 * velite validates the whole of `content/` against the collections' schemas, and a record that
 * fails is not an error anybody sees: it is simply DROPPED, and the site is built without it. A
 * product whose `kind` the schema does not know has no store page; an event whose `rsvp` block the
 * schema thinks is a boolean is not on the calendar. Both of those happened, in two different
 * changes, and both survived a green `npm test` — because the suite never built the content.
 *
 * So it does now. The build is run for real and any error is the failure, named by its file and
 * its field.
 *
 * NOT `--clean`. Half of `.velite` is written by steps that are not velite — the search index and
 * the teachings (build/embed-content.mjs), the sales report, the compiled funnels — and `--clean`
 * takes them with it, leaving a dev server unable to resolve `#content/search.json` until those
 * steps run again. A check must not break the tree it is checking. Every file is validated on
 * every run either way; that was measured with a deliberately broken record.
 *
 * It is not fast — a second or two — and that is the right price for knowing the site has every
 * record its content declares.
 */
import { spawnSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'

const ROOT = process.cwd()
console.log('\nTHE CONTENT BUILDS\n')

if (!fs.existsSync(path.join(ROOT, 'velite.config.js'))) {
  console.log('  no velite.config.js — skipped\n')
  process.exit(0)
}

const r = spawnSync('npx', ['velite', 'build'], { cwd: ROOT, encoding: 'utf8', env: process.env })
const said = String(r.stdout || '') + String(r.stderr || '')

/* velite prints its faults and still exits 0, so the exit status is not the answer: the report is.
   `error` is a record refused; `info` (an empty body) is not. */
const lines = said.split('\n')
const faults = []
for (let i = 0; i < lines.length; i++) {
  if (!/^\s*error\s/.test(lines[i])) continue
  /* the file is the last blank-separated heading above it */
  let file = '(somewhere)'
  for (let j = i - 1; j >= 0; j--) { const s = lines[j].trim(); if (s && !/^\s*(error|info|warn)\s/.test(lines[j])) { file = s; break } }
  faults.push(`${file}: ${lines[i].trim().replace(/^error\s+/, '')}`)
}

if (r.status !== 0 && !faults.length) {
  console.log('  FAIL  the content build did not run')
  console.log(said.split('\n').slice(-12).join('\n'))
  process.exit(1)
}
for (const f of faults) console.log('  FAIL  ' + f)
console.log(`\n${faults.length ? 0 : 1} passed, ${faults.length} failed\n`)
if (faults.length) process.exit(1)
