/*
 * THE PROVIDER POLICY, projected — and the terms with it.
 *
 * content/providers.md is the site's answer to four questions: may providers offer anything of
 * their own, does a new offering wait for a person, how long the money is held before it is
 * payable, and which of the two ways of connecting an account this site uses. Its BODY is the terms
 * a provider agrees to before they may sell.
 *
 * The four answers go to app_settings, which no browser reads; the terms go to provider_terms, one
 * row per version. A VERSION ANYBODY HAS SIGNED IS FROZEN — the database refuses to change its
 * wording, so a site that edits the body without bumping the version is told at the projection
 * rather than quietly rewriting what people agreed to.
 *
 * Run by the deploy, by `platformkit migrate reset`, and by hand while writing one.
 */
import { createClient } from '@supabase/supabase-js'
import { asStore } from './store/index.mjs'
import { supabaseUrl, serviceKey } from './tts/storage.mjs'
import matter from 'gray-matter'
import { spanMinutes as delay } from '../src/lib/payouts.js'

/* the shapes and the writes are providers-io's, because the admin's Edge Function does them too
   where there is no machine to run this script (see projectProviders) */
export { POLICY, policyOf, readPolicy } from './providers-io.mjs'
export { spanMinutes as delayMinutes } from '../src/lib/payouts.js'
import { readPolicy, projectProviders, policyOf } from './providers-io.mjs'

export async function pushProviders({ root = process.cwd(), store, log = console.log, db: client = null } = {}) {
  const url = client ? '' : supabaseUrl()
  const key = client ? '' : serviceKey()
  if (!client && (!url || !key)) { log('providers: no database to push to'); return { policy: null } }
  const db = client || createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } })

  const { data, body } = await readPolicy(store || root)
  if (!data) { log('providers: no content/providers.md — nothing to project'); return { policy: null } }
  const { policy, terms } = await projectProviders({ data, body, db })
  log(`providers: offerings ${policy.offerings}, approve ${policy.approve}, ${policy.delay}m delay, ${policy.connect} account`
    + (terms ? `, terms ${policy.terms}` : ', no terms'))
  return { policy }
}

if (import.meta.url === `file://${process.argv[1]}`) await pushProviders()
