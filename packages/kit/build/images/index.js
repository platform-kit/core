/*
 * IMAGE SOURCES — where a picture can come from besides the library.
 *
 * The library is where every file LIVES (see the media-library spec: one place, addressed, never
 * beside a record). A source is a place a picture can be FOUND, and choosing one always ends the
 * same way: the bytes are fetched once and put in the library, and the field takes an ordinary
 * address. Nothing hotlinks. A site that later deletes its account somewhere else still has its
 * pictures, and every rule about assets keeps working because there is nothing special about
 * where one came from.
 *
 * THIS IS A CLASS WITH ONE MEMBER TODAY. Unsplash is a stock library; the next ones are expected
 * to be generators, which differ in one way that shapes this interface: a generator is asked for
 * a PROMPT and takes time, where a library is asked for WORDS and answers at once. So `search`
 * returns candidates and `take` does the fetching, and a generator fits by making `search` the
 * generate call — slower, fewer results, same shape. Nothing here assumes stock photography.
 *
 * A SOURCE IS ONLY OFFERED WHERE ITS KEYS ARE PRESENT. `configured()` is asked on the server, and
 * the browser is told which sources exist rather than deciding for itself — so a missing key is a
 * source that is absent, not one that appears and then fails.
 *
 * THE KEY NEVER REACHES THE BROWSER. Every call goes through the admin pipe, which is the one
 * door the admin already uses, so this needs no new function and no new secret in the client.
 *
 * WHAT A SOURCE MUST PROVIDE
 *
 *   key          its name, which the pipe and the picker use
 *   needs        the environment variables it cannot work without, for the report and the docs
 *   configured() whether those are set — no arguments, reads the environment
 *   search(q, { page, perPage })
 *                → { total, results: [{ id, thumb, full, width, height, alt, credit, meta }] }
 *                `credit` is { name, url, source } where the source requires attribution, else
 *                null. `meta` is the source's own and is handed back to take() untouched.
 *   take(result) → { bytes, type, name, credit }
 *                the bytes to put in the library. A source with terms to honour on selection —
 *                Unsplash's download endpoint — honours them here, because this is the only
 *                moment we know a picture was actually chosen.
 */

import * as unsplash from './unsplash.js'

/* every source the kit knows. A new one is a file and a line here, and nothing else. */
export const SOURCES = [unsplash]

export const sourceOf = (key) => SOURCES.find((s) => s.key === key) || null

/* the ones this deployment can actually use — asked on the server, never guessed in the browser */
export const configuredSources = (env = (typeof process !== 'undefined' ? process.env : {})) =>
  SOURCES.filter((s) => s.configured(env)).map((s) => ({ key: s.key, needs: s.needs }))

/* what a source needs that is missing, for the deploy's report and for a clear refusal */
export const missingFor = (key, env = (typeof process !== 'undefined' ? process.env : {})) => {
  const s = sourceOf(key)
  if (!s) return ['no such source']
  return s.needs.filter((n) => !String(env[n] || '').trim())
}

/*
 * A NAME FOR THE FILE THE LIBRARY WILL HOLD. It carries the source and the id so the same picture
 * chosen twice is the same file rather than two, and so anybody looking at the library later can
 * see where a picture came from without a database.
 */
export function assetName(sourceKey, result, type) {
  const ext = /png/.test(type) ? 'png' : /webp/.test(type) ? 'webp' : /gif/.test(type) ? 'gif' : 'jpg'
  const slug = String(result.alt || '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 48)
  return `${sourceKey}-${slug ? slug + '-' : ''}${String(result.id).replace(/[^\w-]+/g, '')}.${ext}`
}
