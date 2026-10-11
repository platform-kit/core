/*
 * What sold, for the store to know its best seller: the paid purchases of the last SALES_DAYS
 * days, by book — an unlock, a printed copy or a file all count as one sale of the book — read
 * with the service role at build time and written to .velite/sales.json, which the storefront
 * reads (src/lib/storefront.js). The best seller is the book with the most sales, ties broken
 * by the more recent sale; with no sales at all there is none, and no card wears the badge —
 * it is never a field on a product. Runs inside the Vite build after velite (vite.config.js),
 * in dev against the local stack; with no database in reach it writes an empty report and
 * says so, and the store simply shows no badge.
 */
import fs from 'node:fs'
import path from 'node:path'
import { createClient } from '@supabase/supabase-js'
import { supabaseUrl, serviceKey } from './tts/storage.mjs'

const DIR = '.velite'
export const SALES_DAYS = 90
const empty = (why) => ({ at: new Date().toISOString(), days: SALES_DAYS, books: {}, bestseller: null, note: why || '' })

export async function salesReport() {
  const out = path.join(DIR, 'sales.json')
  const write = (r) => { fs.mkdirSync(DIR, { recursive: true }); fs.writeFileSync(out, JSON.stringify(r, null, 2) + '\n'); return r }
  const url = supabaseUrl(), key = serviceKey()
  if (!url || !key) return write(empty('no database in reach'))
  /* the offers' keys → the book each is of (the catalog the functions read; the unlocks name their book too) */
  let offers = {}
  try { offers = JSON.parse(fs.readFileSync('supabase/functions/_shared/catalog.json', 'utf8')).offers || {} } catch (e) { /* no catalog yet */ }
  const bookOfKey = new Map(Object.values(offers).filter((o) => o.book).map((o) => [o.key, o.book]))
  const bookOfSku = new Map(Object.values(offers).filter((o) => o.book).map((o) => [o.sku, o.book]))
  const since = new Date(Date.now() - SALES_DAYS * 86400e3).toISOString()
  let rows = []
  try {
    const sb = createClient(url, key, { auth: { persistSession: false } })
    const { data, error } = await sb.from('purchases').select('key, sku, created_at').eq('status', 'paid').gte('created_at', since).order('created_at', { ascending: false }).limit(5000)
    if (error) throw error
    rows = data || []
  } catch (e) { console.log('[sales] not read — ' + (e && e.message || e)); return write(empty('purchases not read')) }
  const books = {}, last = {}
  for (const r of rows) {
    const b = bookOfKey.get(r.key) || bookOfSku.get(r.sku)
    if (!b) continue
    books[b] = (books[b] || 0) + 1
    if (!last[b]) last[b] = r.created_at
  }
  const best = Object.keys(books).sort((a, b) => books[b] - books[a] || String(last[b]).localeCompare(String(last[a])))[0] || null
  const r = write({ at: new Date().toISOString(), days: SALES_DAYS, books, bestseller: best, note: '' })
  console.log(`[sales] ${rows.length} purchases in ${SALES_DAYS} days → ${Object.keys(books).length} books sold; best seller ${best || 'none'}`)
  return r
}

if (import.meta.url === `file://${process.argv[1]}`) await salesReport()
