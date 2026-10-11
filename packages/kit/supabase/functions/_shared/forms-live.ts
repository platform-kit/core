/*
 * The forms as the functions read them: _shared/forms.json (build/forms.mjs, written at build and deploy) in git mode;
 * in cloud mode (CONTENT_STORE=cloud) the rows of public.content under content/forms — each document parsed by the
 * kit's own parser (the pipe's copy of src/lib/forms/parse.js) into the same record forms.json holds: the contract
 * the `form` function checks a post against, the kit's settings, and the Forms API's shape (api-shape.js) — so a
 * form written through the Forms API, or saved in the admin, answers the moment it is published, not at the next
 * deploy. A draft never counts: the live text only. Kept for a few seconds between reads.
 *
 *   formsNow()          → { [slug]: { title, fields, kit, settings: { page }, api } }
 *   invalidateForms()   after a write, so the next read sees it
 */
import { admin } from './lib.ts'
import { of } from './compiled.ts'
/* the forms as this deployment has them: the shipped file, or the row a publish wrote */
const formsJson = () => of<Record<string, any>>('forms')
import { parseForm, fieldContract } from './pipe/src/lib/forms/parse.js'
import { apiShape } from './pipe/src/lib/forms/api-shape.js'

export const CLOUD = (Deno.env.get('CONTENT_STORE') ?? '') === 'cloud'
const TTL = 5000
let cache: { at: number; forms: Record<string, any> } | null = null

export async function formsNow(): Promise<Record<string, any>> {
  if (!CLOUD) return formsJson()
  if (cache && Date.now() - cache.at < TTL) return cache.forms
  const { data: rows } = await admin.from('content').select('path, text, updated_at, published_at, deleted_at').like('path', 'content/forms/%')
  const forms: Record<string, any> = {}
  for (const r of rows ?? []) {
    if (r.deleted_at || !r.text) continue
    const m = /^content\/forms\/([^/]+)\.md$/.exec(r.path); if (!m) continue
    const name = m[1]
    try {
      const model = parseForm(r.text)
      if (model.errors.length) continue
      forms[name] = { title: model.title || name, fields: fieldContract(model), kit: model.kit, settings: { page: model.settings.page }, api: apiShape(model, name, { updated: r.updated_at, created: r.published_at || r.updated_at }) }
    } catch { /* a document the parser refuses is not a form */ }
  }
  cache = { at: Date.now(), forms }
  return forms
}
export const invalidateForms = () => { cache = null }
