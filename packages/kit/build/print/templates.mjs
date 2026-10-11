#!/usr/bin/env node
/*
 * THE TEMPLATES AND THE TYPE, WHERE A FUNCTION CAN REACH THEM.
 *
 * `book.typ` and `cover.typ` are files in this package, and the fonts beside them are 1.7 MB of
 * type. On a machine the compiler reads both off the disk. In an Edge Function there is no disk,
 * so they have to arrive some other way — and the two arrive differently, on purpose:
 *
 *   THE TEMPLATES ARE COMPILED IN, as a JSON file beside the functions, the way the catalog and
 *   the strings are. They are a few tens of kilobytes, they change when the code changes, and a
 *   function holding a template that does not match its own code would set a book nobody could
 *   explain.
 *
 *   THE FONTS ARE FETCHED, once per worker, from the `print` bucket. They are large, they change
 *   almost never, and a deploy that had to carry them would carry them into every function.
 *
 * Both are the same bytes the native path uses, which is what keeps an edition an edition: see
 * print/typeset/compiler.js.
 *
 * The templates are written by the ASSEMBLER, beside everything else the functions carry — one
 * writer for that tree, so `assemble --check` can say it is what its sources make. What is left
 * here is the type, which the deploy uploads.
 */
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = path.dirname(fileURLToPath(import.meta.url))
export const FONT_PREFIX = '_type'          /* where the type lives in the print bucket */

export function templates() {
  const out = {}
  for (const f of fs.readdirSync(HERE)) {
    if (f.endsWith('.typ')) out[f] = fs.readFileSync(path.join(HERE, f), 'utf8')
  }
  return out
}

export function fonts() {
  const dir = path.join(HERE, 'fonts')
  if (!fs.existsSync(dir)) return []
  return fs.readdirSync(dir).filter((f) => /\.(ttf|otf)$/i.test(f))
    .map((f) => ({ name: f, bytes: fs.readFileSync(path.join(dir, f)) }))
}

/* the type into the print bucket, only what it lacks — they change almost never */
export async function uploadFonts(store) {
  const list = fonts()
  if (!list.length) return { sent: 0, had: 0 }
  let sent = 0, had = 0
  for (const f of list) {
    const at = `${FONT_PREFIX}/${f.name}`
    const { data } = await store.list(FONT_PREFIX, { search: f.name })
    if (data && data.some((x) => x.name === f.name)) { had++; continue }
    const { error } = await store.upload(at, f.bytes, { contentType: 'font/ttf', upsert: true })
    if (error) throw new Error(`print: the type could not be uploaded (${f.name}) — ${error.message}`)
    sent++
  }
  return { sent, had }
}

/* ---- the CLI: node packages/kit/build/print/templates.mjs --fonts ----
   The type into a project's print bucket. Run by the deploy (build/steps/print-type.mjs) and by
   hand against a local stack, which loses the bucket on every `supabase start`. */
if (process.argv[1] && process.argv[1].endsWith('templates.mjs')) {
  const { createClient } = await import('@supabase/supabase-js')
  const { supabaseUrl, serviceKey } = await import('../tts/storage.mjs')
  const url = supabaseUrl()
  const key = serviceKey()
  if (!url || !key) {
    console.error('print: the type needs SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY (or a local stack)')
    process.exit(1)
  }
  const sb = createClient(url, key)
  const { sent, had } = await uploadFonts(sb.storage.from('print'))
  console.log(`the type: ${sent} uploaded, ${had} already there`)
}
