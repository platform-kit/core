/*
 * THE DEVELOPER'S OWN ACCOUNT, PUT BACK AFTER A RESET.
 *
 * `supabase db reset` empties auth.users, so the account somebody signed up with while working is
 * gone every time the database is brought back to the declaration — and they are locked out of the
 * app they are building, mid-session, with only the seed's example.com people to sign in as. This
 * puts their own account back: made, made staff, given a live membership, and put into every space
 * and every open room, so the whole surface is theirs again the moment the reset finishes.
 *
 * It is driven by the ENVIRONMENT and not by a file, because the address is a real person's and a
 * real address belongs in neither a declaration nor a seed:
 *
 *   DEV_ACCOUNT=you@example.com          the account to keep (unset: this does nothing at all)
 *   DEV_ACCOUNT_NAME=Your Name           what to call them (default: the address's local part)
 *   DEV_ACCOUNT_PASSWORD=password123     default: the seed's own, so it matches every other account
 *   DEV_ACCOUNT_ROLES=admin,editor       the roles it holds, comma-separated — admin · coach ·
 *                                        editor · support · analyst (default admin: everything).
 *                                        DEV_ACCOUNT_ROLE is read too, for one role.
 *
 * It REFUSES any database that is not a local stack. Everything it does is state — an account, a
 * membership, an entitlement — and none of it is something a production database should ever be
 * given by a build script.
 *
 *   node build/dev-account.mjs           (run by `platformkit migrate reset` at its end)
 */
import { createClient } from '@supabase/supabase-js'
import { supabaseUrl, serviceKey, loadDotEnv } from './tts/storage.mjs'

const LOCAL = /^https?:\/\/(127\.0\.0\.1|localhost|\[::1\])(:|\/|$)/i

export async function devAccount({ quiet = false } = {}) {
  /* the repository's own .env first: an import is evaluated before the importer's top level, so
     nothing has loaded it yet and DEV_ACCOUNT would read as unset */
  loadDotEnv()
  const email = String(process.env.DEV_ACCOUNT || '').trim()
  if (!email) return { made: false, why: 'no DEV_ACCOUNT' }
  const url = supabaseUrl()
  const key = serviceKey()
  if (!url || !key) { if (!quiet) console.log('dev account: no local stack to reach'); return { made: false, why: 'no stack' } }
  /* the one hard rule: this writes people into a database, and only a local one may have them */
  if (!LOCAL.test(url)) {
    throw new Error(`dev-account: refusing to touch ${url} — DEV_ACCOUNT is for a local stack and nothing else`)
  }
  const name = String(process.env.DEV_ACCOUNT_NAME || '').trim() || email.split('@')[0]
  const pass = String(process.env.DEV_ACCOUNT_PASSWORD || '').trim() || 'password123'
  /* a person holds a SET of roles, so this takes one */
  const KNOWN = ['admin', 'provider', 'editor', 'support', 'analyst']
  const asked = String(process.env.DEV_ACCOUNT_ROLES || process.env.DEV_ACCOUNT_ROLE || 'admin')
    .split(',').map((r) => r.trim()).filter((r) => KNOWN.includes(r))
  const roles = asked.length ? [...new Set(asked)] : ['admin']
  const db = createClient(url, key, { auth: { persistSession: false } })
  const say = (m) => { if (!quiet) console.log('  ' + m) }

  /* the account: made through Supabase's own admin API, so the password is hashed as a sign-up's is */
  let id = (await db.from('profiles').select('id').eq('email', email).maybeSingle()).data?.id
  if (!id) {
    const { data, error } = await db.auth.admin.createUser({
      email, password: pass, email_confirm: true, user_metadata: { full_name: name },
    })
    if (error) throw new Error('dev-account: ' + error.message)
    id = data.user.id
    say('+ ' + email)
  } else say('· ' + email + ' was already here')

  await db.from('profiles').update({ roles, display_name: name, email_verified_at: new Date().toISOString() }).eq('id', id)

  /* a live membership, which is what a space filled by one asks for */
  const has = (await db.from('entitlements').select('id').eq('user_id', id).eq('key', 'subscribed').eq('active', true).maybeSingle()).data
  if (!has) {
    const tier = (await db.from('entitlements').select('tier').eq('key', 'subscribed').not('tier', 'is', null).limit(1).maybeSingle()).data?.tier || null
    await db.from('entitlements').insert({
      user_id: id, kind: 'class', key: 'subscribed', tier, active: true,
      source: 'grant', source_id: 'dev-account',
      expires_at: new Date(Date.now() + 365 * 864e5).toISOString(),
    })
    say('+ a live membership' + (tier ? ' (' + tier + ')' : ''))
  }

  /* whatever the rules now give them, and then every space by hand — an invitation is what the
     sweep leaves alone, so a rule that does not cover them never takes this away again */
  await db.rpc('space_sync_members')
  const spaces = (await db.from('spaces').select('id, slug').is('archived_at', null)).data || []
  for (const s of spaces) {
    await db.from('space_members').upsert({ space_id: s.id, user_id: id, source: 'invite' }, { onConflict: 'space_id,user_id', ignoreDuplicates: true })
  }
  /* and every open room of them, so nothing is empty on arrival */
  const rooms = (await db.from('channels').select('id').eq('kind', 'channel').eq('visibility', 'open').is('archived_at', null)).data || []
  for (const c of rooms) {
    await db.from('channel_members').upsert({ channel_id: c.id, user_id: id }, { onConflict: 'channel_id,user_id', ignoreDuplicates: true })
  }
  if (spaces.length) say('+ ' + spaces.length + ' space(s), ' + rooms.length + ' room(s)')
  if (!quiet) console.log(`dev account: ${email} holds ${roles.join(', ')}, signs in with the password in DEV_ACCOUNT_PASSWORD`)
  return { made: true, id, email, spaces: spaces.length, rooms: rooms.length }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  devAccount().catch((e) => { console.error(e.message); process.exit(1) })
}
