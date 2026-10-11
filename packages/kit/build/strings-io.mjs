/* The UI strings' grammar and merge — one parser for velite, the admin and every build script.
   A strings file is `## group / ### key [Name] / field: value` lines under a `scope` frontmatter
   (content/app/ui/<scope>.md in a site; <theme>/content/ui/<scope>.md as the theme's defaults).
   The site's file is merged OVER the theme's by key: a field the site writes wins, a field it
   leaves out falls back to the theme's, a group or a key only the theme has is there whole, and
   a scope only the site has is the site's alone. So a site holds only the words it changes,
   and a missing override shows the default rather than a blank. No Vite here. */
import fs from 'node:fs'
import path from 'node:path'

/* the grammar is the shared module's (src/lib/strings-groups.js): the browser reads a strings row through it too */
import { parseGroups, stringsHead as head, mergeGroups } from '../src/lib/strings-groups.js'
export { parseGroups, mergeGroups }
/* one file → { scope, title, groups } */
export function parseFile(file) { const raw = fs.readFileSync(file, 'utf8'); return { ...head(raw), groups: parseGroups(raw) } }
export const parseText = (raw) => ({ ...head(raw), groups: parseGroups(raw) })
/* the site's strings through the store (content/app/ui), by scope */
export async function readSiteScopes(store, dir = 'content/app/ui') {
  const { asStore } = await import('./store/index.mjs'); const st = asStore(store)
  const out = {}
  for (const name of await st.list(dir)) { const raw = await st.read(dir + '/' + name + '.md'); const p = parseText(raw || ''); if (p.scope) out[p.scope] = { ...p, file: dir + '/' + name + '.md' } }
  return out
}
/* every strings file in a directory on disk, by scope — the theme's defaults; a directory that is not there is no strings */
export function readScopes(dir) {
  const out = {}
  let files = []
  try { files = fs.readdirSync(dir).filter((f) => f.endsWith('.md')).sort() } catch { return out }
  for (const f of files) { const p = parseFile(path.join(dir, f)); if (p.scope) out[p.scope] = { ...p, file: path.join(dir, f) } }
  return out
}
/* the `ui` collection as the app reads it: every scope of the theme and the site, merged */
/*
 * THE ROLE'S WORD, PUT IN EVERY SENTENCE THAT ASKS FOR IT.
 *
 * The kit has no idea what business a site is, so the theme ships no English word for the person
 * who delivers what the site sells: its strings say {provider}, {providers}, {a-provider},
 * {your-provider}, {work} and {session}, and ONE record — people / role / provider — says what
 * those are. A site that calls them Therapists edits that record and every sentence follows.
 *
 * It is done HERE, in the merge, rather than in the components, because the alternative is every
 * surface remembering to call a helper and one of them forgetting — which shows a reader the word
 * "{a-provider}" and is exactly the kind of failure the strings rule exists to prevent. A
 * component only has to think about it where it is naming a PERSON rather than the class, and
 * there it asks titleOf(), because a person's own title beats the site's word.
 */
const ROLE_FIELDS = { provider: 'name', providers: 'plural', 'a-provider': 'a', 'your-provider': 'your', work: 'work', session: 'session' }
function fillRole(groups, role) {
  if (!role) return groups
  const lower = (x) => (x || '').charAt(0).toLowerCase() + (x || '').slice(1)
  const one = (text) => {
    let v = String(text)
    for (const [tag, field] of Object.entries(ROLE_FIELDS)) {
      if (!v.includes('{' + tag + '}')) continue
      v = v.split('{' + tag + '}').join(role[field] || '')
    }
    if (v.includes('{provider-lower}')) v = v.split('{provider-lower}').join(lower(role.name || ''))
    return v
  }
  const walk = (node) => {
    if (typeof node === 'string') return one(node)
    if (Array.isArray(node)) return node.map(walk)
    if (node && typeof node === 'object') { const o = {}; for (const [k, v] of Object.entries(node)) o[k] = walk(v); return o }
    return node
  }
  return walk(groups)
}

export function mergeUi(siteEntries, themeDir) {
  const theme = readScopes(themeDir)
  const site = Object.fromEntries((siteEntries || []).map((e) => [e.scope, e]))
  const merged = {}
  for (const scope of new Set([...Object.keys(theme), ...Object.keys(site)])) {
    const t = theme[scope], s = site[scope]
    merged[scope] = { ...(t || {}), ...(s || {}), scope, groups: mergeGroups(t && t.groups, s && s.groups), file: undefined }
  }
  /* the record is itself a merged string, so it is read AFTER the merge and before anything uses it */
  const role = ((merged.people || {}).groups || {}).role && merged.people.groups.role.provider
  const out = []
  for (const scope of Object.keys(merged)) {
    const e = merged[scope]
    out.push({ ...e, groups: fillRole(e.groups, role) })
  }
  return out
}
/* one scope, merged, for a build script (the site from cwd or a store, the theme from its manifest — or, where there
   is no manifest to read (the function), the theme's scopes handed in as `theme`: { scope: { groups } }) */
export async function uiScope(scope, root = process.cwd(), { theme } = {}) {
  const { asStore } = await import('./store/index.mjs'); const st = asStore(root)
  let t
  if (theme) t = theme[scope]
  else { const { loadSite } = await import('./site.mjs'); const { loadTheme } = await import('./theme.mjs'); t = readScopes((await loadTheme(await loadSite(st.root || process.cwd()))).strings)[scope] }
  const s = (await readSiteScopes(st))[scope]
  return mergeGroups(t && t.groups, s && s.groups)
}
