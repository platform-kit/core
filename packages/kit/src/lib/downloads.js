/*
 * A buyer's files: the PDFs and EPUBs of a book they have bought — a download of its
 * own, or the files that came with a printed copy. The `book-files` function decides
 * from the ledger and signs the bucket's urls for an hour; nothing here knows the
 * bucket. Asked once per book per visit.
 */
import { supabase, configured, url as SUPABASE_URL } from './supabase.js'

const cache = new Map()
export async function filesFor(slug, fresh = false) {
  if (!supabase || !configured) return []
  if (!fresh && cache.has(slug)) return cache.get(slug)
  const { data, error } = await supabase.functions.invoke('book-files', { body: { book: slug } })
  if (error) throw error
  /* the function signs a path; the public address goes in front of it */
  const files = ((data && data.files) || []).map((f) => ({ ...f, url: /^\//.test(f.url) ? SUPABASE_URL.replace(/\/$/, '') + f.url : f.url }))
  cache.set(slug, files)
  return files
}
export const forget = () => cache.clear()
