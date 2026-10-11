/*
 * A TEAM'S MEMBERSHIP, against the local stack.
 *
 * Two claims. **The rule fills it and an invitation survives the rule** — the sweep adds and removes
 * only what it put there, so somebody invited by hand stays through any change to the fill, which is
 * the whole reason the row says how they came to be there. And **a membership is not a directory** —
 * a team's name is public because a booking type carries it, but who is in it is not readable by
 * somebody outside it.
 *
 * Everything it makes is removed at the end. Skipped with a note when the stack is down.
 */
import { createClient } from '@supabase/supabase-js'
import { supabaseUrl, localStack, serviceKey } from './tts/storage.mjs'

const note = (m) => console.log('teams-db: ' + m)
if (process.env.TEAMS_TEST === '0') { note('skipped (TEAMS_TEST=0)'); process.exit(0) }
const url = supabaseUrl()
const anon = process.env.VITE_SUPABASE_ANON_KEY || ''
if (!url || !anon || !localStack()) { note('skipped — no local stack in .env'); process.exit(0) }
let up = false
try { up = (await fetch(url + '/auth/v1/health', { signal: AbortSignal.timeout(2000) })).ok } catch { /* down */ }
if (!up) { note('skipped — the local stack is not up'); process.exit(0) }

let pass = 0, fail = 0
const ok = (m, c, d) => { if (c) pass++; else { fail++; console.log('  FAIL  ' + m + (d ? ' — ' + d : '')) } }
const db = createClient(url, serviceKey(), { auth: { persistSession: false, autoRefreshToken: false } })
const signIn = async (email) => {
  const sb = createClient(url, anon, { auth: { persistSession: false, autoRefreshToken: false } })
  const { error } = await sb.auth.signInWithPassword({ email, password: 'password123' })
  if (error) throw new Error(email + ': ' + error.message)
  return sb
}

console.log('\nTEAMS · MEMBERSHIP\n')

const tag = 't' + Math.random().toString(36).slice(2, 8)
const made = { users: [], teams: [] }
const team = async (slug, fill) => { made.teams.push(slug); const { error } = await db.from('teams').upsert({ slug, name: slug, fill: fill || {} }, { onConflict: 'slug' }); if (error) throw new Error(error.message); return slug }
const membersOf = async (slug) => ((await db.from('team_members').select('user_id, source').eq('team', slug)).data || [])

try {
  const mk = async (email, roles) => {
    const { data, error } = await db.auth.admin.createUser({ email, password: 'password123', email_confirm: true })
    if (error) throw new Error(email + ': ' + error.message)
    made.users.push(data.user.id)
    if (roles) await db.from('profiles').update({ roles }).eq('id', data.user.id)
    return data.user.id
  }
  /* profiles.roles is a closed list, so the fixture uses a real role and moves the goalposts with a
     second one rather than inventing one the check constraint would refuse */
  const marked = 'analyst'
  const inside = await mk(tag + '-in@example.com', [marked])
  const outside = await mk(tag + '-out@example.com', [])

  /* --- the rule fills it --- */
  const t = await team(tag + '-team', { role: [marked] })
  await db.rpc('team_sync_members')
  /* the seed has accounts of its own that a real role matches, so every check here is about the
     people this test made and never about how many rows there are */
  const mine = (rows) => rows.filter((x) => x.user_id === inside || x.user_id === outside)
  let m = mine(await membersOf(t))
  ok('the rule fills it', m.some((x) => x.user_id === inside))
  ok('and says the sweep put them there', (m.find((x) => x.user_id === inside) || {}).source === 'fill')

  /* --- an invitation is an act --- */
  await db.from('team_members').insert({ team: t, user_id: outside, source: 'invite' })
  await db.rpc('team_sync_members')
  m = mine(await membersOf(t))
  ok('somebody invited is in it too', m.length === 2)
  ok('and the sweep leaves them alone', (m.find((x) => x.user_id === outside) || {}).source === 'invite')

  /* --- the rule changes, and only what it put there goes --- */
  await db.from('teams').update({ fill: { role: ['editor'] } }).eq('slug', t)
  await db.rpc('team_sync_members')
  m = mine(await membersOf(t))
  ok('the rule changing takes out who it put in', !m.some((x) => x.user_id === inside))
  ok('and leaves the invitation standing', m.length === 1 && m[0].user_id === outside)

  /* --- an unpublished team fills nobody --- */
  await db.from('teams').update({ fill: { role: [marked] }, published: false }).eq('slug', t)
  await db.rpc('team_sync_members')
  ok('an unpublished team is filled by nobody', !(await membersOf(t)).some((x) => x.source === 'fill'))
  await db.from('teams').update({ published: true }).eq('slug', t)
  await db.rpc('team_sync_members')
  ok('and publishing it fills it again', (await membersOf(t)).some((x) => x.user_id === inside))

  /* --- a membership is not a directory --- */
  const asOutsider = await signIn(tag + '-out@example.com')
  const asMember = await signIn(tag + '-in@example.com')
  const other = await team(tag + '-other', {})
  const nosy = await asOutsider.rpc('team_people', { p_team: other })
  ok('somebody outside a team cannot read who is in it', nosy.data === null)
  const seen = await asMember.rpc('team_people', { p_team: t })
  ok('a member can', Array.isArray(seen.data) && seen.data.length > 0)
  ok('and what they see is a name and a face, never an address', seen.data.every((p) => !('email' in p)))
  const theirs = await asMember.rpc('my_teams')
  ok('a person sees their own teams and how they got there', (theirs.data || []).some((x) => x.slug === t && x.source === 'fill'))

  /* --- AND AN ADMINISTRATOR READS EVERY TEAM, published or not. It is what lets the editor tell a
     team nobody is in from a team that is not in the database yet — which is the ordinary state in
     cloud mode, where the projection is the deploy's rather than the save's. --- */
  const asAdmin = await signIn('admin@example.com')
  await db.from('teams').update({ published: false }).eq('slug', t)
  const hidden = await asAdmin.from('teams').select('slug').eq('slug', t).maybeSingle()
  ok('an administrator reads a team that is not published', hidden.data && hidden.data.slug === t)
  const notTheirs = await asOutsider.from('teams').select('slug').eq('slug', t).maybeSingle()
  ok('and nobody else does', !notTheirs.data)
  const absent = await asAdmin.from('teams').select('slug').eq('slug', tag + '-never').maybeSingle()
  ok('a team that was never projected reads as nothing, not as an empty one', !absent.data && !absent.error)
  await db.from('teams').update({ published: true }).eq('slug', t)

  /* --- an ordinary person writes none of it --- */
  const wrote = await asOutsider.from('team_members').insert({ team: t, user_id: outside, source: 'manual' })
  ok('nobody puts themselves in a team', !!wrote.error)
  const madeTeam = await asOutsider.from('teams').insert({ slug: tag + '-mine', name: 'Mine' })
  ok('nor declares one', !!madeTeam.error)
  const invited = await asOutsider.rpc('team_invite', { p_team: t, p_user: outside })
  ok('and an invitation is an administrator\'s to make', !!invited.error)

  /* --- THE PROJECTION IS NOT THE SCRIPT'S ALONE ---
     The admin's Edge Function has no machine, so it calls projectTeams itself rather than waiting
     for a deploy that, with git out of the cycle and no deploy hook, never comes. Same function,
     same writes, so this is the check for both callers. --- */
  {
    const { projectTeams } = await import('./teams-io.mjs')
    const slug = tag + '-projected'
    /* THE PROJECTION IS THE WHOLE DECLARATION, not one record: what it is not given, it deletes.
       So the check hands it what the table already holds plus the new one, and then the same list
       without it — which tests both directions and leaves the site's own teams exactly as found.
       (An earlier draft of this check passed [] and took every real team with it.) */
    const held = (await db.from('teams').select('slug, name, about, thumb, position, published, fill')).data || []
    const one = { slug, name: 'Projected', about: 'by the function', position: 4, published: true, fill: { role: [marked] } }
    await projectTeams({ teams: [...held, one], db })
    const made = (await db.from('teams').select('slug, name, about, fill').eq('slug', slug).maybeSingle()).data
    ok('a team the function projects is a team', made && made.name === 'Projected' && made.about === 'by the function')
    ok('and its rule is the one it was given', made && JSON.stringify(made.fill) === JSON.stringify({ role: [marked] }))
    ok('and the sweep it runs has filled it', (await membersOf(slug)).some((x) => x.source === 'fill'))
    /* one way: a team the declaration no longer holds goes, with its memberships */
    await projectTeams({ teams: held, db })
    ok('a team the declaration drops goes with it', !(await db.from('teams').select('slug').eq('slug', slug).maybeSingle()).data)
    ok('and its memberships go too', (await membersOf(slug)).length === 0)
  }

  /* --- a team going takes its memberships --- */
  await db.from('teams').delete().eq('slug', t)
  ok('a team removed takes its memberships with it', (await membersOf(t)).length === 0)
} catch (e) {
  fail++
  console.log('  FAIL  ' + e.message)
} finally {
  await db.from('teams').delete().in('slug', made.teams)
  for (const id of made.users) await db.auth.admin.deleteUser(id).catch(() => {})
}

console.log('\n  ' + pass + ' passed' + (fail ? ', ' + fail + ' FAILED' : ''))
if (fail) process.exit(1)
