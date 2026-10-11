/*
 * A call's recording, pulled and kept (session-recordings): POST { action }.
 *   pull            CRON (the service key, every ten minutes): every booking whose pull is pending, asked again
 *   pull { uid }    an administrator's Fetch again: one booking, its tries reset — a failed row tried afresh
 *   pull { uid, source: { recording, transcript } }   the service bearer alone: the links given, in place of cal.com's answer
 *   pull { uid, api }                                  the service bearer alone: another base for cal.com's API (a test's stand-in of its endpoints)
 *   retain          CRON (nightly): recordings older than the policy's recordings-keep removed, the row saying so
 *                   (the service bearer may name { days } in place of the policy's — a test's)
 * The work is _shared/recordings.ts, which cal-webhook also calls the moment cal.com says a recording is ready;
 * this function is the retry and the keep. verify_jwt is off (pg_cron holds no user), the door is checked here.
 */
import { admin, json, preflight, getUser, isServiceBearer } from '../_shared/lib.ts'
import { rolesOf, isAdmin } from '../_shared/roles.ts'
import { pull, pullPending, retain } from '../_shared/recordings.ts'
import { POLICY } from '../_shared/marketing.ts'

Deno.serve(async (req) => {
  const pre = preflight(req); if (pre) return pre
  if (req.method !== 'POST') return json({ error: 'POST only' }, 405)
  let body: any = {}
  try { body = await req.json() } catch { body = {} }
  const action = String(body?.action ?? '')
  const service = await isServiceBearer(req)
  let adminUser = false
  if (!service) {
    const user = await getUser(req); if (!user) return json({ error: 'not allowed' }, 401)
    const { data: prof } = await admin.from('profiles').select('role').eq('id', user.id).maybeSingle()
    if (!isAdmin(await rolesOf(user.id))) return json({ error: 'admins only' }, 403)
    adminUser = true
  }
  if (action === 'pull') {
    if (body.uid) return json(await pull(String(body.uid), { force: adminUser, source: service && body.source && typeof body.source === 'object' ? body.source : undefined, api: service && typeof body.api === 'string' ? body.api : undefined }))
    if (!service) return json({ error: 'a uid, or the service key' }, 400)
    return json({ pulled: await pullPending() })
  }
  if (action === 'retain') return json(await retain(service && body.days != null ? Number(body.days) : Number((POLICY as any)['recordings-keep'] ?? 0)))
  return json({ error: 'unknown action' }, 400)
})
