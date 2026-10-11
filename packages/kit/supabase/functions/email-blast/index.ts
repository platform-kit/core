/*
 * A blast, sent once: POST { name, dry? } from an admin. The blast's audience now (its rules),
 * less anyone the policy's cooldowns hold back when the blast respects them, each sent the
 * blast's design with its html, and logged. Anyone the log already shows this blast sent to is
 * skipped, so a second press finishes a run that was cut short rather than sending twice.
 * `dry` counts and sends nothing. The admin server marks the file sent afterwards.
 */
import { admin, json, preflight, getUser } from '../_shared/lib.ts'
import { rolesOf, isAdmin } from '../_shared/roles.ts'
import { BLASTS, POLICY, audience, recentSends, cooled, sendMarketing, alreadyHad } from '../_shared/marketing.ts'

Deno.serve(async (req) => {
  const pf = preflight(req); if (pf) return pf
  if (req.method !== 'POST') return json({ error: 'method' }, 405)
  const user = await getUser(req)
  if (!user) return json({ error: 'sign in' }, 401)
  if (!isAdmin(await rolesOf(user.id))) return json({ error: 'admins only' }, 403)
  let body: any
  try { body = await req.json() } catch { return json({ error: 'bad request' }, 400) }
  const name = String(body?.name ?? ''), dry = !!body?.dry
  const b = BLASTS[name]
  if (!b) return json({ error: 'no such blast — save it first' }, 404)
  const people = await audience(b.rules)
  const ids = people.map((p) => p.user_id)
  /* by the blast's id, not its name: the log's word on who had this email */
  const had = ids.length ? await alreadyHad(b.id, ids) : new Set<string>()
  const sends = b.respectCooldown && POLICY['blasts-respect-cooldown'] ? await recentSends(ids) : new Map()
  let sent = 0, held = 0, skipped = 0, failed = 0
  for (const p of people) {
    if (had.has(p.user_id)) { skipped++; continue }
    if (sends.size && !cooled(sends.get(p.user_id), POLICY)) { held++; continue }
    if (dry) { sent++; continue }
    const res = await sendMarketing('blast', name, null, p, b.design, b)
    if (res === 'sent') sent++; else if (res === 'had') skipped++; else failed++
  }
  return json({ ok: true, dry, audience: people.length, sent, held, skipped, failed })
})
