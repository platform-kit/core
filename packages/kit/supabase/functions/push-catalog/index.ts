/*
 * POST → makes Stripe match every offer in the catalog (offers.ts ensureAll):
 * products found or created by sku, prices found or created under the sku's
 * lookup key, a changed price replaced and the old one retired. Idempotent —
 * a second call with nothing changed touches nothing. Run by build/deploy.mjs
 * after the functions are deployed, and from the admin.
 *
 * Who may call it: an admin (their JWT), or the deploy, which has no user and
 * sends the service-role key as the bearer instead.
 */
import { stripeConfigured, stripeMock, stripeUnconfigured, admin, json, preflight, getUser, isServiceBearer } from '../_shared/lib.ts'
import { rolesOf, isAdmin } from '../_shared/roles.ts'
import { ensureAll, OFFERS } from '../_shared/offers.ts'

Deno.serve(async (req) => {
  const pre = preflight(req); if (pre) return pre
  if (req.method !== 'POST') return json({ error: 'method not allowed' }, 405)
  /* the deploy sends the service key (in whichever form it holds it — lib.ts checks it against the admin API, never by string) */
  let allowed = await isServiceBearer(req)
  if (!allowed) {
    const user = await getUser(req)
    if (!user) return json({ error: 'sign in first' }, 401)
    const { data: prof } = await admin.from('profiles').select('role').eq('id', user.id).maybeSingle()
    allowed = isAdmin(await rolesOf(user.id))
  }
  if (!allowed) return json({ error: 'admin only' }, 403)
  if (!stripeConfigured) return stripeUnconfigured()
  if (stripeMock) return json({ offers: Object.keys(OFFERS).length, made: 0, mock: true })
  try {
    const result = await ensureAll()
    const made = Object.values(result).filter((r) => r.made).length
    return json({ offers: Object.keys(OFFERS).length, made, result })
  } catch (e) {
    return json({ error: `Stripe: ${(e as any)?.message ?? e}` }, 502)
  }
})
