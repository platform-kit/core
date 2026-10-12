import { admin, json, preflight, getUser, isServiceBearer } from '../_shared/lib.ts'
import { reportPendingUsage } from '../_shared/usage.ts'

Deno.serve(async (req) => {
  const pre = preflight(req); if (pre) return pre
  if (req.method !== 'POST') return json({ error: 'method not allowed' }, 405)
  const user = await getUser(req)
  if (user) {
    const { data: profile, error } = await admin.from('profiles').select('role').eq('id', user.id).maybeSingle()
    if (error) return json({ error: `could not verify administrator: ${error.message}` }, 500)
    if (profile?.role !== 'admin') return json({ error: 'not allowed' }, 403)
  } else if (!await isServiceBearer(req)) return json({ error: 'not allowed' }, 401)
  try {
    return json(await reportPendingUsage())
  } catch (cause) {
    return json({ error: String((cause as Error)?.message ?? cause) }, 500)
  }
})
