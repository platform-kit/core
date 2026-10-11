/*
 * The words the Edge Functions send live with every other reader-facing string,
 * in content/app/ui/chat.md: `## followup` (the coach's line after a session,
 * cal-webhook) and `## refusal` — and in content/app/ui/emails.md, every email's
 * subject (_shared/emails/strings.json, with the store's print words for a line; the
 * bodies are the designs in content/emails). The functions
 * run on Deno, far from velite, so this copies each group out as JSON beside
 * its function, where it is imported. Run before `supabase functions deploy`
 * (build/deploy.mjs does) and whenever the copy changes; the JSON is committed
 * so `npm run db:serve` works from a checkout. The words are read as the app reads them —
 * the site's file merged over the theme's defaults (strings-io.mjs), so a subject the site
 * leaves out is the theme's.
 */
import { writeFileSync, mkdirSync } from 'node:fs'
import { writeIfChanged } from './write-if-changed.mjs'
import { dirname } from 'node:path'
import { uiScope } from './strings-io.mjs'

const SRC = 'content/app/ui/chat.md'
const OUT = { followup: 'supabase/functions/cal-webhook/strings.json' }
/* the cal-webhook's file carries two groups: the follow-up lines and the refusal lines */

/* the store's emails: the subject of each (the bodies are designs, content/emails/<kind>.json), each group's one `### mail` record flattened */
export const EMAILS_SRC = 'content/app/ui/emails.md', EMAILS_OUT = 'supabase/functions/_shared/emails/strings.json'
export async function emailWords() {
  const g = await uiScope('emails')
  /* a group is one record flattened — except push, whose records are the topics, each with its own words */
  const w = Object.fromEntries(Object.entries(g).map(([k, recs]) => [k, k === 'push' ? recs : Object.assign({}, ...Object.values(recs))]))
  /* the store's own words for a printed book — the formats, the contents, the colours — so the
     confirmation says a line as the store's page did (`## product / ### print` in store.md) */
  try { w.print = (await uiScope('store')).product.print || {} } catch (e) { w.print = {} }
  return w
}
export async function writeEmailStrings() {
  const w = await emailWords()
  for (const k of ['order', 'shipped', 'files']) if (!w[k].subject) { console.error(`${EMAILS_SRC}: "## ${k}" has no subject`); process.exit(1) }
  mkdirSync(dirname(EMAILS_OUT), { recursive: true })
  writeIfChanged(EMAILS_OUT, JSON.stringify(w, null, 2) + '\n')
  return w
}

if (import.meta.url !== `file://${process.argv[1]}`) { /* imported for its parsers */ } else {
const groups = await uiScope('chat')
if (!groups.followup || !groups.followup.lines || !Object.keys(groups.followup.lines).length) { console.error(`${SRC}: no "## followup / ### lines"`); process.exit(1) }
if (!groups.refusal || !groups.refusal.lines || !groups.refusal.lines.over) { console.error(`${SRC}: no "## refusal / ### lines" with over, not-included and guest`); process.exit(1) }
for (const [group, out] of Object.entries(OUT)) {
  const body = group === 'followup' ? { ...groups.followup, refusal: groups.refusal.lines } : groups[group]
  mkdirSync(dirname(out), { recursive: true })
  writeIfChanged(out, JSON.stringify(body, null, 2) + '\n')
  console.log(`${out} ← ${SRC} ## ${group}${group === 'followup' ? ' + ## refusal' : ''}`)
}
await writeEmailStrings()
console.log(`${EMAILS_OUT} ← ${EMAILS_SRC}`)
}
