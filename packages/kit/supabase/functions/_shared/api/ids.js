/*
 * The content API's ids, as plain JavaScript the build and the functions share. Contentful's ids are strings of letters,
 * digits, `-`, `_` and `.`, 64 characters at most: an entry's is its content type's id, a dot, and its path within its
 * collection with `/` as `.` (`doc.guides.highlights`; stable, readable, and unique across the space — a book and the
 * product that sells it share a slug), an asset's a hash of its address (two FNV-1a passes, sixteen hex characters), a
 * content type's the model's key made singular and camelCase.
 */
export const entryId = (typeId, path) => (String(typeId || '') + '.' + String(path || '').replace(/\//g, '.')).replace(/[^A-Za-z0-9._-]/g, '_').slice(0, 64)

function fnv(s, seed) {
  let h = seed >>> 0
  for (const b of new TextEncoder().encode(String(s))) { h ^= b; h = Math.imul(h, 0x01000193) >>> 0 }
  return h.toString(16).padStart(8, '0')
}
/* an asset the Management API made lives at /uploads/api/<id>/<file>, so the id the client chose is the id the address answers */
export const assetId = (address) => { const m = /^\/uploads\/api\/([A-Za-z0-9._-]{1,64})\/[^/]+$/.exec(String(address || '')); return m ? m[1] : fnv(address, 0x811c9dc5) + fnv(address, 0x9e3779b9) }
export const hashOf = (s) => fnv(s, 0x811c9dc5) + fnv(s, 0x01000193)

/*
 * A model's key as a content type id: the singular the model names, else the key with a trailing `s` dropped, camelCase.
 * A SITE'S OWN MODEL KEEPS ITS NAMESPACE — `models/events` is `modelEvent`, not `event` — because the folder is
 * namespaced for exactly the same reason: a site may name a model `events` or `books` while the platform already has
 * one, and two content types under one id is a space where a query, a link validation and an entry's id all mean two
 * things at once (the demo had it: its Events model and the spaces' events).
 */
export function typeIdOf(model) {
  const key = String(model.key || '')
  const own = key.startsWith('models/')
  const single = model.model && model.model.singular ? String(model.model.singular) : null
  let k = single ? single.toLowerCase() : key.replace(/^models\//, '')
  if (!single && /[a-z]s$/.test(k) && !/ss$/.test(k) && !['news', 'series', 'status'].includes(k)) k = k.slice(0, -1)
  if (own) k = 'model ' + k
  return k.replace(/[^A-Za-z0-9]+(.)/g, (_, c) => c.toUpperCase()).replace(/[^A-Za-z0-9]/g, '')
}
/* a field's key as a GraphQL name: camelCase, a leading digit or a reserved name prefixed */
export const graphqlName = (key) => { let n = String(key).replace(/[^A-Za-z0-9]+(.)/g, (_, c) => c.toUpperCase()).replace(/[^A-Za-z0-9_]/g, ''); if (/^[0-9]/.test(n)) n = '_' + n; return n }
