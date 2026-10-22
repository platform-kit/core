/*
 * What the admin does to an experiment, in one place: read the pages or ads it
 * can point at, duplicate one as a new variant, and patch the experiment file
 * through the admin API (which validates it against the things it names).
 * Dev-only, like the rest of the admin.
 */
import pipe from '../../lib/admin/api.js'
/* a refusal's issues as one line, the way the ops report them */
const said = (e) => { if (e.issues) e.message = e.issues.map((i) => i.message).join('; '); throw e }
const post = ({ col, name, data, content, create }) => pipe.save(col, name, { data, content }, { create }).catch(said)

/* the collection a kind of experiment draws its variants from */
export const colFor = (kind) => (kind === 'ad' ? 'ads' : 'pages')

/* the candidate items: [{ name, title, route? }] */
export async function listItems(kind) {
  const items = await pipe.items(colFor(kind))
  return items.map((i) => ({ name: i.name, title: i.data.title || i.name, route: i.data.route || (kind === 'ad' ? '' : '/') }))
}

/* the next variant key after the ones in use: A, B, C … */
export function nextKey(variants) {
  const used = new Set((variants || []).map((v) => String(v.key || '').toUpperCase()))
  for (let i = 0; i < 26; i++) { const k = String.fromCharCode(65 + i); if (!used.has(k)) return k }
  return 'V' + ((variants || []).length + 1)
}

/* copy a page or ad into a new file for a variant — "home" + "B" → "home-b" —
   with its title marked; returns the new file's name */
export async function duplicateItem(kind, item, key) {
  const col = colFor(kind)
  const f = await pipe.read(col, item)
  const base = item.replace(/-[a-z]$/, '')
  let name = base + '-' + key.toLowerCase()
  const data = { ...f.data, title: ((f.data.title || item).replace(/\s+—\s+[A-Z]$/, '')) + ' — ' + key.toUpperCase() }
  try { await post({ col, name, data, content: f.content || '', create: true }) }
  catch (e) {
    if (!/already exists/.test(e.message)) throw e
    name = base + '-' + key.toLowerCase() + '-' + Date.now().toString(36).slice(-4)
    await post({ col, name, data, content: f.content || '', create: true })
  }
  return name
}

/* read, change, write an experiment file */
export async function patchExperiment(name, change) {
  const f = await pipe.read('experiments', name)
  const data = { ...f.data }
  change(data)
  await post({ col: 'experiments', name, data, content: f.content || '', create: false })
  return data
}

export const today = () => { const d = new Date(), p = (n) => String(n).padStart(2, '0'); return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}` }
export const plusDays = (ymd, n) => { const d = new Date(ymd + 'T00:00:00'); d.setDate(d.getDate() + n); const p = (x) => String(x).padStart(2, '0'); return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}` }
