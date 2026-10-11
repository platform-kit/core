/*
 * The one thing about a space that cannot be done from the browser: the credentials for a call in a
 * channel. Everything else a member does — reading, sending, editing, withdrawing, reacting,
 * searching, catching up, marking read — is RLS and the module's own reads, done directly, because
 * the database is the gate and a second one in front of it is a second thing to keep in step.
 *
 *   call { channel }     the caller's credentials for that channel's huddle: who they are on it,
 *                        the topic to signal on, where to find themselves (and a relay, where the
 *                        site was given one), how many the call carries, and whether it records.
 *                        Only a member of the channel is answered; nobody else learns it exists.
 *   sweep                the service bearer (pg_cron): the memberships re-read against what fills them.
 *   mail                 the service bearer (a trigger): the away email to one person, whom the
 *                        database has already decided is owed one — it kept the restraint, this
 *                        only says the words.
 */
import { createClient } from 'npm:@supabase/supabase-js@2'
import { json, preflight, getUser, admin, isServiceBearer } from '../_shared/lib.ts'
import { videos } from '../_shared/video/index.js'
import { sendEmail } from '../_shared/email.ts'

const env = (k: string) => Deno.env.get(k) ?? ''

Deno.serve(async (req) => {
  const pre = preflight(req); if (pre) return pre
  if (req.method !== 'POST') return json({ error: 'method not allowed' }, 405)
  let body: any
  try { body = await req.json() } catch { return json({ error: 'bad request' }, 400) }
  const action = String(body?.action ?? 'call')

  if (action === 'mail') {
    if (!(await isServiceBearer(req))) return json({ error: 'not allowed' }, 401)
    const to = String(body?.user ?? ''), ch = String(body?.channel ?? ''), mid = String(body?.message ?? '')
    if (!to || !ch) return json({ error: 'who' }, 400)
    const [{ data: person }, { data: c }, { data: m }] = await Promise.all([
      admin.from('profiles').select('email, display_name, email_verified_at').eq('id', to).maybeSingle(),
      admin.from('channels').select('name, kind').eq('id', ch).maybeSingle(),
      admin.from('space_messages').select('body, title, author_id').eq('id', mid).maybeSingle(),
    ])
    /* never to an address that has not answered its own confirmation — the rule the desk keeps */
    if (!person?.email || !person?.email_verified_at) return json({ skipped: 'unconfirmed' })
    const { data: from } = m?.author_id
      ? await admin.from('profiles').select('display_name, email').eq('id', m.author_id).maybeSingle()
      : { data: null }
    const who = (from?.display_name || '').trim() || String(from?.email || '').split('@')[0] || 'Someone'
    const app = (env('APP_URL') || '').replace(/\/$/, '')
    await sendEmail(person.email, 'chat', {
      name: who,
      message: String(m?.title || m?.body || '').slice(0, 300),
      where: c?.kind === 'dm' ? '' : '#' + (c?.name || ''),
      url: app + '/channels/' + ch,
    })
    return json({ sent: 1 })
  }

  if (action === 'sweep') {
    if (!(await isServiceBearer(req))) return json({ error: 'not allowed' }, 401)
    const { data, error } = await admin.rpc('space_sync_members')
    return error ? json({ error: error.message }, 500) : json({ swept: data ?? 0 })
  }

  const user = await getUser(req)
  if (!user) return json({ error: 'sign in first' }, 401)

  if (action === 'call') {
    const channel = String(body?.channel ?? '')
    if (!channel) return json({ error: 'which channel' }, 400)
    /* the caller's own client: the channel's policy is the check, and a channel they may not read is
       a channel they are not told about */
    const mine = createClient(env('SUPABASE_URL'), env('SUPABASE_ANON_KEY'), { global: { headers: { Authorization: req.headers.get('Authorization') ?? '' } } })
    const { data: ok } = await mine.rpc('in_channel', { p_channel: channel })
    if (!ok) return json({ error: 'not your channel', code: 'not-yours' }, 403)
    const { data: c } = await admin.from('channels').select('id, name, space_id').eq('id', channel).maybeSingle()
    if (!c) return json({ error: 'not your channel', code: 'not-yours' }, 403)
    const { data: prof } = await admin.from('profiles').select('display_name, email').eq('id', user.id).maybeSingle()
    const name = (prof?.display_name || '').trim() || String(prof?.email || '').split('@')[0] || ''

    /* the same seam a booking's room uses: LiveKit where the site has an account, browser to browser
       where it has none. A huddle is a room like any other. */
    const { video } = videos({ db: admin, env })
    const id = env('LIVEKIT_URL') && env('LIVEKIT_API_KEY') && env('LIVEKIT_API_SECRET') ? 'livekit' : 'mesh'
    const v: any = video(id)
    const room = { id: channel, uid: channel, room: channel, start_at: new Date(Date.now() - 6e4).toISOString(), end_at: new Date(Date.now() + 12 * 36e5).toISOString() }
    const cred = await v.admit(room, { id: user.id, name }, 'member')
    if (cred?.early || cred?.over) return json({ error: 'the room is not open', code: 'closed' }, 425)
    /* two names, so neither is mistaken for the other: `who` is the caller's own, which the people
       they meet in the room are told, and `channelName` is the room's. */
    return json({ ...cred, provider: id, channel: c.id, channelName: c.name, who: name, records: id !== 'mesh' })
  }

  return json({ error: 'unknown action' }, 400)
})
