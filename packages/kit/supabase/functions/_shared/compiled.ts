/*
 * THE COMPILED ARTEFACTS, read the way a function should read them: the row where there is one, the
 * file the deploy shipped where there is not.
 *
 * The catalog, the forms, the funnels and the email designs are compiled from content by the build
 * and shipped beside these functions as JSON. That is right on every deployment that builds. It
 * leaves out the one that does not: cloud mode with the repository out of the cycle and no deploy
 * hook, where a publish is the last thing that ever happens to the site. There a publish compiles
 * what it changed into `public.compiled`, and this module puts that over the file.
 *
 * ONE READ PER ISOLATE, at import, and nothing downstream becomes asynchronous. A module that holds
 * a value from an artefact declares it `export let` and re-derives it in `onRefresh` — ESM exports
 * are live bindings, so every importer sees the new value without a single call site changing shape.
 *
 * An isolate that started before a publish keeps the older values until it is recycled — seconds to
 * minutes. That is the trade for keeping every call site synchronous, and it is stated rather than
 * hidden: where a deployment cannot bear it, the answer is a deploy hook, which rebuilds properly.
 */
import { createClient } from 'jsr:@supabase/supabase-js@2'

import catalogFile from './catalog.json' with { type: 'json' }
import formsFile from './forms.json' with { type: 'json' }
import funnelsFile from './emails/funnels.json' with { type: 'json' }
import designsFile from './emails/compiled.json' with { type: 'json' }

/* the artefacts a publish may write, by the name the build gives the file */
export const ARTEFACTS = ['catalog', 'forms', 'funnels', 'emails'] as const
const FILE: Record<string, unknown> = { catalog: catalogFile, forms: formsFile, funnels: funnelsFile, emails: designsFile }

const live: Record<string, unknown> = {}
const listeners: Array<() => void> = []
/* a module that derives consts from an artefact registers here: it is called once now and again on
   every refresh, and its `export let`s are live bindings, so its importers need know nothing */
export function onRefresh(fn: () => void): void { listeners.push(fn); fn() }

export async function refresh(): Promise<void> {
  const url = Deno.env.get('SUPABASE_URL') ?? ''
  const key = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
  if (!url || !key) return
  try {
    const db = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } })
    const { data, error } = await db.from('compiled').select('path, data')
    if (error) return   /* no table, no rights, no matter: the files stand */
    for (const k of Object.keys(live)) delete live[k]
    for (const r of data ?? []) if (r && r.path) live[String(r.path)] = r.data
    for (const fn of listeners) { try { fn() } catch { /* one module's derivation is not another's */ } }
  } catch { /* the files stand */ }
}

/* one read as this isolate starts; a deployment with no rows pays one empty select for its life */
let readAt = Date.now()
let inflight: Promise<void> | null = null
await refresh()

/*
 * AND A BOUNDED RE-READ for a function that answers the public. An isolate can outlive a publish,
 * and then it would serve what it read when it started. `fresh()` re-reads at most once every few
 * seconds per isolate — one small select, shared by every request that asks while it is in flight —
 * so the worst a reader sees is a few seconds old rather than as old as the isolate.
 *
 * A function that reads an artefact calls this first. It is not automatic, because most functions
 * never touch one and a select they did not need is still a select.
 */
export async function fresh(maxAgeMs = 5000): Promise<void> {
  if (Date.now() - readAt < maxAgeMs) return
  if (!inflight) inflight = refresh().finally(() => { inflight = null; readAt = Date.now() })
  await inflight
}

/* what a module should read in place of importing the JSON itself */
export const of = <T>(name: string): T => ((live[name] ?? FILE[name] ?? {}) as T)
