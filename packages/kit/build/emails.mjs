/*
 * Every email the site sends, compiled: each design in content/emails/<kind>.json — a
 * Templatical template, built in the admin's Emails page — rendered to MJML by
 * @templatical/renderer and to sending-ready HTML by mjml, written together as
 * supabase/functions/_shared/emails/compiled.json (committed, like the words beside the
 * functions), which _shared/email.ts fills with the real order at send time (fill.js: the
 * handful of Handlebars a design may use). The two Supabase Auth sends — the address's
 * confirmation (the magic link) and the password reset — are written out whole besides, tokens
 * intact, as supabase/templates/<kind>.html for the local stack (config.toml names them, with
 * the subject from emails.md written into it here) and read from compiled.json by
 * build/auth-config.mjs for the hosted project on deploy. Run by deploy before
 * `functions deploy`, by the admin on every save, and by hand:
 *
 *   node build/emails.mjs            compile every design
 *   node build/emails.mjs --check    compile, and say what each fills to with its sample
 *
 * A design that will not compile, or that fills its sample to something with a tag left
 * unfilled, fails the build: the emails are sent to buyers, and a broken one is a broken sale.
 */
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs'
import { writeIfChanged } from './write-if-changed.mjs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { KINDS, GOTRUE, SAMPLES } from '../supabase/functions/_shared/emails/tags.js'
import { fill } from '../supabase/functions/_shared/emails/fill.js'
import { emailWords } from './chat-email-strings.mjs'

const ROOT = process.cwd()
export const DESIGNS = 'content/emails'
export const OUT = 'supabase/functions/_shared/emails/compiled.json'
export const TEMPLATES = 'supabase/templates'
const CONFIG = 'supabase/config.toml'
/* Supabase's names for the emails it sends */
const GOTRUE_NAME = { 'magic-link': 'magic_link', recovery: 'recovery', invitation: 'invite' }

/* one design → html; the errors mjml reports are the build's, not warnings */
/* one implementation, shared with the Edge Function that compiles a design where nothing builds */
export { compileDesign } from './emails-compile.mjs'
import { compileDesign } from './emails-compile.mjs'
/* the kit's own copy of a design, for a kind a site has not drawn one for. It is the same
   arrangement the theme's strings have: the kit ships something that works and a site's own file
   under content/emails overrides it whole. Without it, adding a kind to the kit would break every
   site that had not yet drawn it — including the demo and the docs, which have no designer. */
const KIT_DESIGNS = fileURLToPath(new URL('../content/emails/', import.meta.url))
export function readDesign(kind) {
  const own = join(ROOT, DESIGNS, kind + '.json')
  if (existsSync(own)) return JSON.parse(readFileSync(own, 'utf8'))
  const kit = KIT_DESIGNS + kind + '.json'
  return existsSync(kit) ? JSON.parse(readFileSync(kit, 'utf8')) : null
}
export async function compileEmails({ check = false } = {}) {
  const out = {}
  for (const kind of KINDS) {
    const design = readDesign(kind)
    if (!design) { console.error(`${DESIGNS}/${kind}.json: no design — build it under admin → Emails`); process.exitCode = 1; continue }
    const html = await compileDesign(design)
    /* the sample must fill cleanly: a tag that stays is a tag the design misspelt */
    const left = fill(html, SAMPLES[kind]).match(/\{\{[^}]*\}\}/g)
    if (left) { console.error(`${DESIGNS}/${kind}.json: left unfilled — ${[...new Set(left)].join(' ')}`); process.exitCode = 1 }
    out[kind] = html
    if (check) console.log(`${kind}: ${html.length} bytes of html${left ? '' : ', fills clean'}`)
  }
  mkdirSync(dirname(join(ROOT, OUT)), { recursive: true })
  writeIfChanged(join(ROOT, OUT), JSON.stringify(out, null, 0) + '\n')
  console.log(`${OUT} ← ${DESIGNS}/{${KINDS.join(',')}}.json`)
  await writeGotrueTemplates(out)
  return out
}

/* the local auth server's copies: the html files config.toml points at, and the subject lines
   in config.toml itself (the one place the local stack reads a subject from) — rewritten in
   place between the markers, the rest of the file byte for byte */
export async function writeGotrueTemplates(out) {
  const words = await emailWords()
  const dir = join(ROOT, TEMPLATES)
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true })
  const lines = ['# The emails Supabase Auth sends locally: the designs built under admin → Emails, compiled by', '# build/emails.mjs (which writes this block); the hosted project gets the same on deploy.']
  for (const kind of GOTRUE) {
    if (!out[kind]) continue
    writeIfChanged(join(dir, kind + '.html'), out[kind])
    lines.push(`[auth.email.template.${GOTRUE_NAME[kind]}]`, `subject = ${JSON.stringify((words[kind] || {}).subject || '')}`, `content_path = "./${TEMPLATES}/${kind}.html"`, '')
  }
  const block = '# >>> emails: written by build/emails.mjs\n' + lines.join('\n') + '# <<< emails\n'
  const file = join(ROOT, CONFIG)
  if (!existsSync(file)) { console.log(`${TEMPLATES}/{${GOTRUE.join(',')}}.html ← the designs Supabase Auth sends (no ${CONFIG} to point at them yet)`); return }
  const cur = readFileSync(file, 'utf8')
  const re = /# >>> emails: written by build\/emails\.mjs\n[\s\S]*?# <<< emails\n/
  const next = re.test(cur) ? cur.replace(re, block) : cur.replace(/\n# Uncomment to customize email template\n/, '\n' + block + '\n# Uncomment to customize email template\n')
  if (next !== cur) writeFileSync(file, next)
  console.log(`${TEMPLATES}/{${GOTRUE.join(',')}}.html and ${CONFIG} ← the designs Supabase Auth sends`)
}
if (import.meta.url === `file://${process.argv[1]}`) await compileEmails({ check: process.argv.includes('--check') })
