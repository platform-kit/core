/*
 * THE DATA THE EDGE FUNCTIONS IMPORT, MADE BEFORE THEY ARE SERVED.
 *
 * The functions run on Deno and cannot read `content/`, so the build flattens what they need into
 * JSON inside the functions tree: the catalog of offers, the compiled email designs and their
 * subjects, the funnels, the bots and their commands, the spaces, the teams, the forms, the
 * content index. Thirteen files, each a pure function of committed content, each read by a
 * STATIC import — so a function whose file is missing does not degrade, it fails to boot and
 * answers 503, and it takes every function sharing that module with it.
 *
 * THEY WERE COMMITTED, AND THAT WAS WRONG TWICE OVER. A generated file in git is a second source
 * of truth that can disagree with the first, and two of these had: the catalog by 55 price
 * entries, and the email subjects by three (a session held, one to confirm, one declined — all
 * present in the content and absent from what the functions would read). Nothing noticed, because
 * the checks validated each file's contents and never asked whether it was what a fresh build
 * would write. They also tax every offer change with a few hundred lines of regenerated JSON that
 * nobody can review and two branches cannot merge. `_shared/content/index.json` was already
 * ignored, so the line between committed and generated was arbitrary as well as harmful.
 *
 * So they are generated, by this, before anything serves or deploys the functions: `npm run dev`
 * runs it before `supabase functions serve`, `npm test` runs it first, and the deploy already ran
 * these steps before `supabase functions deploy`. It costs about a second from nothing.
 *
 * WHICH STEPS. Not a phase: `prepare` holds the search index, which is heavier than this needs to
 * be, and `functions` holds three steps that are not data at all — `print` renders books with
 * Typst, `print-type` uploads a typeface, `lulu-webhook` registers a webhook with a printer. So
 * the list is named here, and `steps.test.mjs` holds it honest: after this runs from an empty
 * tree, every path assemble knows as the build's own must exist. A new data file nobody adds here
 * fails the suite rather than 503-ing somebody's dev server a week later.
 */
import { runPhase, loadSteps } from './steps.mjs'
import { loadSite } from './site.mjs'
import fs from 'node:fs'
import path from 'node:path'

/* the steps that write a file the functions import, and nothing else */
export const DATA_STEPS = {
  prepare: ['funnels', 'bots'],
  functions: null,   /* all of them but these: */
}
export const NOT_DATA = ['print', 'print-type', 'lulu-webhook']
/* an empty file in each one's own shape: a list is read with .find and .map, the funnels by their sections */
const EMPTY = {
  'functions/_shared/webhooks.json': [], 'functions/_shared/bots.json': [], 'functions/_shared/commands.json': [], 'functions/_shared/spaces.json': [],
  'functions/_shared/emails/funnels.json': { policy: {}, funnels: {}, blasts: {}, prompts: {} },
}

export async function functionsData({ site, env = process.env, log = () => {}, changed = null, phases = ['prepare', 'functions'] } = {}) {
  const c = site || await loadSite()
  const all = await loadSteps(c)
  const ran = []
  for (const phase of phases) {
    const pick = DATA_STEPS[phase]
    if (!pick && pick !== null) throw new Error(`functionsData: unknown phase "${phase}"`)
    const only = all.filter((s) => s.phase === phase && (pick ? pick.includes(s.key) : !NOT_DATA.includes(s.key))).map((s) => s.key)
    if (only.length) ran.push(...await runPhase(phase, { site: c, env, changed, only, log }))
  }
  /* A MODULE THAT IS OFF WRITES NO FILE, but the functions import every one statically (_shared/compiled.ts takes the
     emails' designs and funnels whatever the site has on) — so a site with emails off had no function sharing that
     module boot at all. Each the build did not make is written empty: the module is off, so there is nothing in it.
     The list is assemble.mjs's BUILT_PATHS, read rather than imported (importing assemble runs it). */
  const root = (c && c.root) || process.cwd()
  const listed = /export const BUILT_PATHS = \[([\s\S]*?)\]/.exec(fs.readFileSync(new URL('./assemble.mjs', import.meta.url), 'utf8'))
  for (const rel of listed ? [...listed[1].matchAll(/'([^']+)'/g)].map((m) => m[1]) : []) {
    const f = path.join(root, 'supabase', rel)
    if (fs.existsSync(f) || !fs.existsSync(path.dirname(path.dirname(f)))) continue
    fs.mkdirSync(path.dirname(f), { recursive: true }); fs.writeFileSync(f, JSON.stringify(EMPTY[rel] ?? {}) + '\n'); log(`${rel}: empty (its module is off)`)
  }
  return ran
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const ran = await functionsData({ log: (m) => console.log('  ' + m) })
  console.log(`✔ the functions' data: ${ran.length} step(s)`)
}
