/*
 * The funnels, the blasts and the policy, compiled: content/funnels/*.md and content/blasts/*.md
 * (build/funnel-io.mjs is the grammar) with every step's and blast's markdown rendered to
 * email html (_shared/emails/markdown.js) and its audience turned into the query's rules
 * (_shared/emails/rules.js; a book's slug widened to its skus by the catalog), written as
 * supabase/functions/_shared/emails/funnels.json for the funnels-run and email-blast functions.
 * A funnel's chat steps (`channel: chat`) are not emails: they are compiled apart as prompts —
 * into funnels.json's `prompts` for the support function (the line a thread opens with) and into
 * .velite/support-prompts.json for the widget (the line, its triggers, the funnel's audience) —
 * and never counted among a funnel's steps, so the runner and a member's place in the funnel
 * know nothing of them. The policy's two desk clocks go to the browser as .velite/desk-policy.json,
 * which is how the staff's one list says what a support thread is owed.
 * Run by deploy before `functions deploy`, by the admin on every save, and by hand:
 *
 *   node build/funnels.mjs            compile
 *   node build/funnels.mjs --check    compile, and list what each funnel and blast is
 *   node build/funnels.mjs --key      give every step and blast written by hand its id first
 *
 * A step with no subject, an `after` that is not a span, a chat step whose `when` has no trigger
 * it understands, an audience rule that is not one of rules.js's, or a design that is not
 * compiled fails the build.
 */
/* NOTHING HERE OPENS A DISK AT IMPORT. The admin's pipe reaches this module — an Edge Function
   compiles it where the deployment cannot rebuild — and the pipe's guard refuses a `node:fs` import
   for exactly that reason. What writes files is the script at the foot, which loads fs when it runs. */
import { asStore } from './store/index.mjs'
import { join, dirname } from 'node:path'
import { createHash } from 'node:crypto'
import { funnelNames, blastNames, readFunnel, readBlast, readPolicy, keyAll, goalOk } from './funnel-io.mjs'
import { mdToEmailHtml, mdToText } from '../supabase/functions/_shared/emails/markdown.js'
import { normalizeRules, normalizePolicy, days, RULE_KEYS } from '../supabase/functions/_shared/emails/rules.js'
import { parseWhen, splitChoices } from '../src/lib/support/when.js'

const ROOT = process.cwd()
export const OUT = 'supabase/functions/_shared/emails/funnels.json'
export const PROMPTS_OUT = '.velite/support-prompts.json'
/* the funnels' shape for the admin's analytics page (names, steps, goals, audiences — never a body): the database holds
   the log and knows nothing of a funnel's steps, so the page brings them */
export const INDEX_OUT = '.velite/funnels-index.json'
/* the desk's own clocks, for the staff's one list in the browser: the same two numbers the
   escalation keeps, and nothing else of the policy, which is marketing's and the server's */
export const DESK_OUT = '.velite/desk-policy.json'
/* the words as sent, hashed: the log keeps it beside the id, so a changed email is told apart in the numbers */
const version = (...parts) => createHash('sha1').update(parts.join('\n')).digest('hex').slice(0, 12)

/* a book's slug → its skus, from the catalog the functions read */
/* THE TWO ARTEFACTS IT LEANS ON — the catalog (a book's slug widened to its skus) and the compiled
   designs (a step's design must exist) — are handed in where the caller has them, and read off the
   disk where it does not. In an Edge Function there is no disk: the publish passes both. */
function skusOfFn(offers) {
  const o = offers || {}
  return (slug) => Object.values(o).filter((x) => x.book === slug || x.sku === slug).map((x) => x.sku)
}
const designsOf = (designs) => designs || {}

/* the script's own write-if-changed: inline, because anything this module names — even in a
   dynamic import — is assembled into the pipe, and the pipe may not reach a disk */
async function writer() {
  const { readFileSync, writeFileSync, mkdirSync } = await import('node:fs')
  return (at, text) => {
    try { if (readFileSync(at, 'utf8') === text) return false } catch { /* not there yet */ }
    mkdirSync(dirname(at), { recursive: true })
    writeFileSync(at, text)
    return true
  }
}

export async function compileFunnels({ check = false, store, offers = null, designs = null, write = true } = {}) {
  const at = store || ROOT
  const skusOf = skusOfFn(offers)
  const compiledDesigns = designsOf(designs)
  /* where the caller has no list of designs — an Edge Function, which cannot run mjml — the check is
     skipped rather than failed: a step naming a design that exists would otherwise refuse the whole
     compile for a reason the compiler could not actually see. */
  const knowsDesigns = Object.keys(compiledDesigns).length > 0
  const designOk = (dn) => !knowsDesigns || !!compiledDesigns[dn]
  const errors = []
  const err = (m) => errors.push(m)
  const rulesOf = (audience, where) => {
    for (const k of Object.keys(audience || {})) if (!RULE_KEYS.includes(k)) err(`${where}: audience rule "${k}" is not one of ${RULE_KEYS.join(', ')}`)
    return normalizeRules(audience, { skusOf })
  }
  const funnels = {}
  const prompts = {}          /* for the function: id → the line */
  const browserPrompts = []   /* for the widget: the published funnels' prompts with their triggers and audience */
  for (const name of await funnelNames(at)) {
    const f = await readFunnel(at, name)
    const where = `content/funnels/${name}.md`
    const design = String(f.data.design || 'campaign')
    if (!designOk(design)) err(`${where}: design "${design}" is not compiled (admin → Emails)`)
    const cooldown = days(f.data.cooldown ?? '1d')
    if (cooldown == null) err(`${where}: cooldown "${f.data.cooldown}" is not a span (3d, 1w, 12h)`)
    const rules = rulesOf(f.data.audience, where)
    if (!goalOk(f.data.goal)) err(`${where}: goal "${f.data.goal}" is not a path on the site (it begins with /)`)
    const published = f.data.published !== false
    const chat = f.steps.filter((s) => s.channel === 'chat')
    for (const s of chat) {
      const i = f.steps.indexOf(s)
      if (!s.id) { err(`${where}: step ${i + 1} "${s.title}" has no id — node build/funnels.mjs --key gives it one`); continue }
      const { when, errors: werr } = parseWhen(s.when)
      for (const e of werr) err(`${where}: step ${i + 1} "${s.title}" — when: ${e}`)
      if (!Object.keys(when).length) err(`${where}: step ${i + 1} "${s.title}" is a chat prompt with no trigger (when: on-site 30s, on-page /store/**)`)
      const { text: md, choices } = splitChoices(s.body)
      if (!md.trim()) err(`${where}: step ${i + 1} "${s.title}" has no line to say`)
      const keys = []; const walk = (l) => { for (const c of l) { keys.push(c.key); walk(c.children) } }; walk(choices)
      if (new Set(keys).size !== keys.length) err(`${where}: step ${i + 1} "${s.title}" has two choices with the same words under one parent`)
      const text = mdToText(md)
      const image = String(s.image || '').trim()
      if (image && !/^(https?:\/\/|\/)/.test(image)) err(`${where}: step ${i + 1} "${s.title}" — image must be a url or a /uploads path`)
      prompts[s.id] = { id: s.id, funnel: name, title: s.title, text, image, choices, default: !!when.default, version: version(s.body, s.when, image) }
      if (published) browserPrompts.push({ id: s.id, funnel: name, title: s.title, text, teaser: String(s.teaser || '').trim(), image, choices, default: !!when.default, when, rules })
    }
    const steps = f.steps.filter((s) => s.channel !== 'chat').map((s, i) => {
      if (!s.id) err(`${where}: step ${i + 1} "${s.title}" has no id — node build/funnels.mjs --key gives it one`)
      const after = days(s.after)
      if (after == null) err(`${where}: step ${i + 1} "${s.title}" — after "${s.after}" is not a span`)
      if (!s.subject) err(`${where}: step ${i + 1} "${s.title}" has no subject`)
      if (!s.body.trim()) err(`${where}: step ${i + 1} "${s.title}" has no body`)
      return { id: s.id, title: s.title, after: after ?? 0, subject: s.subject, html: mdToEmailHtml(s.body), text: mdToText(s.body), version: version(s.subject, s.body) }
    })
    if (!steps.length && !chat.length) err(`${where}: no steps (a "# " heading each)`)
    const order = f.steps.filter((s) => s.id).map((s) => (s.channel === 'chat' ? { id: s.id, title: s.title, channel: 'chat', text: (prompts[s.id] || {}).text || '' } : { id: s.id, title: s.title, channel: 'email', after: days(s.after) ?? 0, subject: s.subject }))
    funnels[name] = { title: String(f.data.title || name), published, design, cooldown: cooldown ?? 1, rules, goal: String(f.data.goal || '') || null, steps, order }
    if (check) console.log(`funnel ${name}: ${steps.length} email${steps.length === 1 ? '' : 's'}${chat.length ? `, ${chat.length} chat prompt${chat.length === 1 ? '' : 's'}` : ''}, ${published ? 'on' : 'off'}`)
  }
  const blasts = {}
  for (const name of await blastNames(at)) {
    const b = await readBlast(at, name)
    const where = `content/blasts/${name}.md`
    const design = String(b.data.design || 'campaign')
    if (!designOk(design)) err(`${where}: design "${design}" is not compiled (admin → Emails)`)
    if (!b.data.subject) err(`${where}: no subject`)
    if (!/^[0-9a-f-]{36}$/i.test(String(b.data.id || ''))) err(`${where}: no id — node build/funnels.mjs --key gives it one`)
    if (!goalOk(b.data.goal)) err(`${where}: goal "${b.data.goal}" is not a path on the site (it begins with /)`)
    blasts[name] = { id: String(b.data.id || '').toLowerCase(), version: version(b.data.subject, b.body), title: String(b.data.title || name), subject: String(b.data.subject || ''), design, respectCooldown: b.data['respect-cooldown'] !== false, status: b.data.status === 'sent' ? 'sent' : 'draft', sentAt: b.data.sent_at || null, sent: Number(b.data.sent) || 0, rules: rulesOf(b.data.audience, where), goal: String(b.data.goal || '') || null, html: mdToEmailHtml(b.body), text: mdToText(b.body) }
    if (check) console.log(`blast ${name}: ${blasts[name].status}${blasts[name].sent ? ', sent to ' + blasts[name].sent : ''}`)
  }
  const policy = normalizePolicy(await readPolicy(at))
  if (errors.length) { console.error('✖ funnels:\n  ' + errors.join('\n  ')); process.exitCode = 1 }
  const out = { policy, funnels: Object.fromEntries(Object.entries(funnels).map(([k, { order, ...f }]) => [k, f])), blasts, prompts }
  if (!write) return out   /* the caller wanted the artefact, not the files (cloud mode: it goes to a row) */
  const { mkdirSync } = await import('node:fs')
  const writeIfChanged = await writer()
  mkdirSync(dirname(join(ROOT, OUT)), { recursive: true })   /* a site's functions directory, before phase 3 assembles it */
  writeIfChanged(join(ROOT, OUT), JSON.stringify(out, null, 2) + '\n')
  mkdirSync(join(ROOT, '.velite'), { recursive: true })
  writeIfChanged(join(ROOT, PROMPTS_OUT), JSON.stringify(browserPrompts, null, 2) + '\n')
  writeIfChanged(join(ROOT, DESK_OUT), JSON.stringify({ wait: policy['support-wait'], presence: policy['support-presence'] }, null, 2) + '\n')
  const index = {
    funnels: Object.entries(funnels).map(([name, f]) => ({ name, title: f.title, published: f.published, goal: f.goal, rules: f.rules, cooldown: f.cooldown, steps: f.order })),
    blasts: Object.entries(blasts).map(([name, b]) => ({ name, id: b.id, title: b.title, subject: b.subject, goal: b.goal, rules: b.rules, status: b.status, sentAt: b.sentAt, sent: b.sent })),
  }
  writeIfChanged(join(ROOT, INDEX_OUT), JSON.stringify(index, null, 2) + '\n')
  console.log(`${OUT} ← ${Object.keys(funnels).length} funnel(s), ${Object.keys(blasts).length} blast(s), ${Object.keys(prompts).length} chat prompt(s), the policy; ${PROMPTS_OUT} ← the published prompts; ${DESK_OUT} ← the desk's clocks`)
  return out
}
/* what only a machine has: the two artefacts on disk, read here and handed to the compile */
async function fromDisk() {
  const { readFileSync } = await import('node:fs')
  const read = (at) => { try { return JSON.parse(readFileSync(join(ROOT, at), 'utf8')) } catch (e) { return null } }
  return { offers: (read('supabase/functions/_shared/catalog.json') || {}).offers || null, designs: read('supabase/functions/_shared/emails/compiled.json') }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  if (process.argv.includes('--key')) { const n = await keyAll(ROOT); console.log(`${n} email${n === 1 ? '' : 's'} given an id`) }
  await compileFunnels({ check: process.argv.includes('--check'), ...(await fromDisk()) })
}
