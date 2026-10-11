/*
 * The content index's kinds and ids, as plain JavaScript the build (build/content-json.mjs) and the functions
 * (_shared/content-index.ts) share: the library's four kinds, and an integer a record or a picture is known by across
 * builds — FNV-1a over `<kind>:<path>` (a record) or `media:<address>` (a picture), masked to 31 bits.
 */
export const KINDS = ['articles', 'docs', 'books', 'wiki']

export function fnv(s) {
  let h = 0x811c9dc5
  for (const c of String(s)) { for (const b of new TextEncoder().encode(c)) { h ^= b; h = Math.imul(h, 0x01000193) >>> 0 } }
  return (h & 0x7fffffff) || 2
}
export const idOf = (kind, path) => fnv(kind + ':' + path)
export const mediaId = (address) => fnv('media:' + address)
