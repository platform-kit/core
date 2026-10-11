/*
 * THE PROVIDER POLICY as a file, and as rows.
 *
 * `content/providers.md` is the site's answer to four questions — may providers offer anything of
 * their own, does a new offering wait for a person, how long the money is held before it is payable,
 * and which of the two ways of connecting an account this site uses — and its BODY is the terms a
 * provider agrees to before they may sell.
 *
 * Everything here is store-based and touches no disk, because three callers need it and only one of
 * them has a machine: the script (a checkout), the admin's model (either), and the admin's Edge
 * Function (rows, no machine). Reading and writing the file is the grammar; making the database
 * agree is the projection, and it is pure database writes — a handful of settings and one terms row
 * — so it runs wherever there is a connection rather than waiting for a deploy that, in a
 * deployment with git out of the cycle and no deploy hook, never comes.
 */
import matter from 'gray-matter'
import { asStore } from './store/index.mjs'
import { spanMinutes as delay } from '../src/lib/payouts.js'

export const POLICY_AT = 'content/providers.md'
/* what ships: nobody may offer anything, a new one would wait, a month's delay, the managed
   account. Every one of those is the cautious answer on purpose. */
export const POLICY = { offerings: 'off', approve: 'on', terms: '', 'payout-delay': '30d', connect: 'managed' }
export const CONNECT = ['managed', 'own']
const onoff = (v, dflt) => (v === true || v === 'on' ? 'on' : v === false || v === 'off' ? 'off' : dflt)

/* the file's frontmatter → the four answers, resolved. A delay is whole minutes by the ledger's own
   arithmetic, because the policy and the ledger disagreeing about what 30d means is a whole class of
   fault nobody would look for. */
export function policyOf(d = {}) {
  const mins = delay(d['payout-delay'])
  return {
    offerings: onoff(d.offerings, POLICY.offerings),
    approve: onoff(d.approve, POLICY.approve),
    terms: String(d.terms == null ? '' : d.terms).trim(),
    delay: mins == null ? delay(POLICY['payout-delay']) : mins,
    connect: CONNECT.includes(String(d.connect || '').trim()) ? String(d.connect).trim() : POLICY.connect,
  }
}

/* the file as the store holds it: its frontmatter and its body, or the shipped defaults where the
   site keeps none */
export async function readPolicy(store) {
  const st = asStore(store)
  try { const f = matter(await st.read(POLICY_AT)); return { data: f.data || {}, body: String(f.content || '').trim() } }
  catch { return { data: null, body: '' } }
}

/*
 * THE PROJECTION. The four answers go to app_settings, which no browser reads; the terms go to
 * provider_terms, one row per version.
 *
 * A VERSION ANYBODY HAS SIGNED IS FROZEN, and the database is what refuses it — a signature against
 * text that has since changed is not a signature. So a body edited without bumping the version comes
 * back here as a sentence saying what to do, rather than quietly rewriting what people agreed to.
 */
export async function projectProviders({ data, body, db }) {
  const policy = policyOf(data || {})
  const now = new Date().toISOString()
  for (const [k, v] of Object.entries({
    offerings: policy.offerings, approve: policy.approve,
    delay: String(policy.delay), connect: policy.connect,
  })) {
    const { error } = await db.from('app_settings').upsert({ key: 'provider_' + k, value: v, updated_at: now }, { onConflict: 'key' })
    if (error) throw new Error('providers: ' + error.message)
  }
  let terms = 0
  if (policy.terms) {
    if (!body) throw new Error('providers: terms ' + policy.terms + ' has no words — the file\'s body is what people agree to')
    const { error } = await db.from('provider_terms').upsert({ version: policy.terms, body }, { onConflict: 'version' })
    if (error) {
      if (/have been signed/.test(error.message)) {
        throw new Error('providers: the wording of terms ' + policy.terms + ' has changed and somebody has already signed it — '
          + 'give the new wording a new version (terms: …) rather than editing this one')
      }
      throw new Error('providers: ' + error.message)
    }
    terms = 1
  }
  return { policy, terms }
}
