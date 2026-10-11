/*
 * A PERSON'S OWN ACCOUNT: what they are called, the face they wear, the line they wrote, whether
 * their page is public, and what they have asked to be told about.
 *
 * Every one of these is the person's own and is written straight to their profile row under RLS —
 * the policy is that the row is theirs — with the guard trigger refusing the columns that are not
 * (their roles, their address's proof, the Stripe customer). Nothing here goes through a function,
 * because nothing here is a decision anybody else has a say in.
 *
 * The exception is the USERNAME, which is an address: it is unique, somebody may already hold it,
 * and a person typing one needs to be told before they press save rather than after. `nameFree`
 * answers a boolean and never who holds it — "taken by Ada" would make this a way to look people up.
 */
import { ref } from 'vue'
import { supabase, configured } from './supabase.js'
import { session, myFace } from './auth.js'

/* the reader's own row, as the settings page reads it. Their address is here because it is theirs. */
export const me = ref(null)

/* every column a settings page shows, because the row that comes BACK from a save is what the page
   then holds: a column left off this list is written and then forgotten a tick later, which reads
   as a save that did nothing. That is what happened to avatar_options. */
const FIELDS = 'id, email, username, display_name, first_name, last_name, about, avatar, avatar_style, avatar_seed, avatar_options, public_profile, notify, roles, created_at'

/* READ THROUGH A FUNCTION, WRITE THROUGH THE ROW. The read resolves one field a select cannot: the
   seed a drawn face comes from, which is what they picked or else a digest of their address. It is
   resolved in the database for every surface, so a settings page that computed its own would offer
   somebody a different face from the one everybody else is looking at. "seed" is that answer;
   "avatar_seed" is what they actually chose, which is empty until they choose. */
export async function loadMe() {
  if (!configured || !session.value) { me.value = null; return null }
  const { data, error } = await supabase.rpc('my_profile')
  if (error) throw error
  me.value = data || null
  return me.value
}

/* WRITING SOME OF IT. A settings page saves what changed and nothing else, so a field somebody
   never touched is never written — which is what keeps two tabs open on the same account from
   undoing each other. */
export async function saveMe(patch) {
  if (!configured || !session.value) return null
  const { error } = await supabase.from('profiles').update(patch).eq('id', session.value.user.id).select(FIELDS).maybeSingle()
  if (error) throw error
  /* …and then READ IT BACK THROUGH THE FUNCTION, which is the rule at the top of this file. A
     select cannot answer `seed` — the face somebody has when they have chosen none — so a page
     that took the select's row as the new truth lost it the moment anything was saved, and with
     it the designer's "put it back". Writing through the row and reading through the function
     means what the page holds after a save is the same shape it held before one. */
  const row = await loadMe()
  /*
   * …AND THE FACE THE REST OF THE SITE IS WEARING. The header, the rail, every avatar outside this
   * page reads `myFace`, which is filled when the person's role is read — at sign-in, and not
   * again. Without this line a reader changes their face, sees it change on this page, and finds
   * the old one still in the navigation and in every room until they reload: a save that looks
   * like it half worked, which is worse than one that plainly did not.
   */
  if (row) myFace.value = { id: row.id, email: row.email, avatar: row.avatar, avatar_style: row.avatar_style, avatar_seed: row.avatar_seed, avatar_options: row.avatar_options }
  return row
}

/* is this address free. Empty is free — a person may give their username up. */
export async function nameFree(username) {
  const u = String(username || '').trim().toLowerCase()
  if (!u) return true
  const { data, error } = await supabase.rpc('username_free', { p_username: u })
  if (error) throw error
  return !!data
}
/* the shape the database will take, said once here so the field can refuse before the row does */
export const USERNAME = /^[a-z0-9][a-z0-9-]{1,38}$/
export const usernameOk = (u) => USERNAME.test(String(u || '').trim().toLowerCase())

/* SOMEBODY ELSE'S PAGE. Answers nothing at all for a person who has not made theirs public, which
   is the default: a directory of everybody who ever signed up is not a thing to publish for them. */
export async function personOf(username) {
  if (!configured) return null
  const { data, error } = await supabase.rpc('public_profile', { p_username: String(username || '').trim().toLowerCase() })
  if (error) throw error
  return data || null
}

/* their own picture, into the avatars bucket under their own id. A picture always beats a drawn
   face, so this is the one write that changes what everybody sees without touching a style. */
export async function uploadAvatar(file) {
  if (!configured || !session.value) return null
  const ext = (String(file.name || '').match(/\.([a-z0-9]+)$/i) || [, 'png'])[1].toLowerCase()
  const path = `${session.value.user.id}/face.${ext}`
  const { error } = await supabase.storage.from('avatars').upload(path, file, { upsert: true, contentType: file.type || undefined })
  if (error) throw error
  const { data } = supabase.storage.from('avatars').getPublicUrl(path)
  /* the url carries the moment, so a replaced picture is not the browser's old one */
  return (data && data.publicUrl ? data.publicUrl : '') + '?v=' + Date.now()
}
