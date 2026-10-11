/*
 * THE PROVIDERS' OWN DOOR. One thing only, and it is here because it needs something the browser
 * must not hold — the address of every provider, and the relay:
 *
 *   `terms` — a new version has been published, so everybody still on the old one is written to.
 *   Called by the database's trigger on provider_terms over pg_net (the service bearer), and by an
 *   administrator looking now; `dry: true` says who would be written to without writing.
 *
 * Everything else — writing an offering, signing the terms, retiring one, releasing one (an
 * administrator's own rpc to provider_release, so the act carries their name and not the service
 * role's) — is an ordinary row or an ordinary call under RLS and has no business here.
 */
import { admin, json, preflight, getUser, isServiceBearer, appUrl } from '../_shared/lib.ts'
import { rolesOf, isAdmin } from '../_shared/roles.ts'
import { sendEmail } from '../_shared/email.ts'
import { mdToEmailHtml } from '../_shared/emails/markdown.js'

const firstName = (n: string | null) => String(n ?? '').trim().split(/\s+/)[0] || 'there'

Deno.serve(async (req) => {
  const pf = preflight(req); if (pf) return pf
  if (req.method !== 'POST') return json({ error: 'method' }, 405)
  let body: any
  try { body = await req.json() } catch { body = {} }
  const action = String(body?.action ?? '')

  const service = await isServiceBearer(req)
  const user = service ? null : await getUser(req)
  if (!service && !user) return json({ error: 'sign in' }, 401)
  const staff = service || isAdmin(await rolesOf(user!.id))

  if (action === 'terms') {
    if (!staff) return json({ error: 'administrators only' }, 403)
    const version = String(body?.version ?? '') || null
    const { data: terms } = await admin.from('provider_terms').select('version, body')
      .order('published_at', { ascending: false }).limit(1).maybeSingle()
    const want = version ?? terms?.version ?? null
    if (!want) return json({ error: 'this site keeps no terms' }, 400)
    const { data: row } = await admin.from('provider_terms').select('body').eq('version', want).maybeSingle()
    const { data: owed, error } = await admin.rpc('provider_terms_owed', { p_version: want })
    if (error) return json({ error: error.message }, 500)
    const people = (owed ?? []).filter((p: any) => p.email)
    if (body?.dry) return json({ version: want, would: people.length, people: (owed ?? []).map((p: any) => ({ email: p.email, signed: p.signed })) })
    /* the terms themselves ride in the letter: somebody asked to agree to something reads it there
       rather than being sent to go and find it */
    const html = mdToEmailHtml(String(row?.body ?? ''))
    let sent = 0
    for (const p of people) {
      const ok = await sendEmail(p.email, 'provider-terms', {
        name: firstName(p.name), version: want, signed: p.signed ?? '',
        body: html, url: appUrl() + '/app/coaching?terms=' + encodeURIComponent(want),
      })
      if (ok) sent++
    }
    return json({ version: want, owed: (owed ?? []).length, sent })
  }

  return json({ error: 'unknown action' }, 400)
})
