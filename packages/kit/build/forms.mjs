/*
 * The forms, compiled for the function: every document under content/forms read by the kit's parser
 * (src/lib/forms/parse.js) into what the `form` function checks a posted slide against — the fields
 * by name with their kind, whether required, a choice's values, the slide they sit on — with the
 * document's own settings (published, once, respond, the embed origins, the webhook, a quiz's right
 * answers and pass mark), written as supabase/functions/_shared/forms.json. An unpublished form is
 * in the file marked closed, so a post to it is refused by name rather than lost. Beside the contract the
 * file carries what the Forms API (Typeform's) says about a form — each field's question, description,
 * placeholder, choices and scale, the slides with their jump conditions and free markdown, the start and
 * end slides — under `api` (`apiShape`), so the function can answer a definition without the parser.
 * Run by deploy before `functions deploy`, by the admin on every save, by the site's build and by hand:
 *
 *   node build/forms.mjs            compile
 *   node build/forms.mjs --check    compile, and list every form with its fields and warnings
 *
 * A document the parser refuses — a field that does not close, a name used twice, a setting the kit
 * owns (post-url), a right answer naming no field — fails the build, naming the file and the line.
 */
/* NOTHING HERE OPENS A DISK AT IMPORT. The admin's pipe reaches this module — an Edge Function
   compiles it where the deployment cannot rebuild — and the pipe's guard refuses a `node:fs` import
   for exactly that reason. What writes files is the script at the foot, which loads fs when it runs. */
import { asStore } from './store/index.mjs'
import { join, dirname } from 'node:path'
import { parseForm, fieldContract } from '../src/lib/forms/parse.js'
import { apiShape as shapeOf } from '../src/lib/forms/api-shape.js'

const ROOT = process.cwd()
export const DIR = 'content/forms'
export const OUT = 'supabase/functions/_shared/forms.json'

/* THROUGH THE STORE, so the compile runs over a checkout or over the rows of cloud mode — where a
   deployment that never builds again has to make this itself when a form is published. */
export async function formNames(store = ROOT) {
  const st = asStore(store)
  try { return (await st.list(DIR, { ext: 'md' })).filter((n) => !n.includes('/')).sort() } catch { return [] }
}
export async function readForm(store, name) {
  const raw = await asStore(store).read(DIR + '/' + name + '.md')
  return { raw, model: parseForm(raw) }
}
/* the Forms API's shape of a document is src/lib/forms/api-shape.js (pure, shared with the functions in cloud mode); here with the file's time */
export function apiShape(model, name, mtime = null) {
  const at = mtime && typeof mtime === 'object' && mtime.toISOString ? mtime.toISOString() : (typeof mtime === 'string' && mtime.includes('T') ? mtime : null)
  return shapeOf(model, name, { updated: at, created: at })
}

/* every form as the function reads it, and the faults that stop the build */
export async function compileForms(store = ROOT) {
  const out = {}
  const faults = []
  const notes = []
  /* a file's time is the API's created/updated, and only a checkout has one */
  const at = typeof store === 'string' ? store : null
  const stat = at ? (await import('node:fs')).statSync : null
  for (const name of await formNames(store)) {
    const { model } = await readForm(store, name)
    for (const e of model.errors) faults.push(`${DIR}/${name}.md${e.line ? ':' + e.line : ''}: ${e.message}`)
    for (const w of model.warnings) notes.push(`${DIR}/${name}.md${w.line ? ':' + w.line : ''}: ${w.message}`)
    out[name] = { title: model.title || name, fields: fieldContract(model), kit: model.kit, settings: { page: model.settings.page }, api: apiShape(model, name, (() => { try { return stat ? stat(join(at, DIR, name + '.md')).mtime.toISOString() : null } catch { return null } })()) }
  }
  return { forms: out, faults, notes }
}

if (import.meta.url === new URL(process.argv[1], 'file:').href) {
  const check = process.argv.includes('--check')
  const { forms, faults, notes } = await compileForms()
  if (faults.length) { console.error('✖ forms:\n  ' + faults.join('\n  ')); process.exit(1) }
  const { mkdirSync, writeFileSync } = await import('node:fs')
  mkdirSync(dirname(join(ROOT, OUT)), { recursive: true })
  writeFileSync(join(ROOT, OUT), JSON.stringify(forms, null, 2) + '\n')
  if (check) {
    for (const [name, f] of Object.entries(forms)) console.log(`  ${name}${f.kit.published === false ? ' (unpublished)' : ''}: ${f.fields.length} field(s) — ${f.fields.map((x) => x.name + ':' + x.kind + (x.required ? '*' : '')).join(', ')}${f.kit.once ? '; once' : ''}${f.kit.webhook ? '; webhook' : ''}${Object.keys(f.kit.score).length ? '; a quiz of ' + Object.keys(f.kit.score).length : ''}`)
    if (notes.length) console.log('  notes:\n    ' + notes.join('\n    '))
  }
  console.log(`✔ forms: ${Object.keys(forms).length} form(s) → ${OUT}`)
}
