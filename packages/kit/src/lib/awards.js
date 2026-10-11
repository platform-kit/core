/*
 * WHAT THE READER HAS EARNED. One read, cached for the session: a gallery, a page and a profile all
 * ask the same question and none of them should ask it twice.
 *
 * Nothing here awards anything. An achievement is decided in the database, by the trigger on the
 * event stream, as the definer — a browser can no more ask for a badge than it can ask for a role.
 * This only looks.
 */
import { ref } from 'vue'
import { achievements as COMPILED } from '#content'
import { supabase, configured } from './supabase.js'
import { session } from './auth.js'

/* THE CATALOGUE, keyed the way the database keys it. velite calls a record's name its `id`; every
   row that says who has earned what calls it `slug`, because that is what the table's key is. One
   of the two had to give, and it is this one — so nothing downstream ever has to remember which
   side of the wire it is looking at. */
export const catalogue = (COMPILED || []).map((a) => ({ ...a, slug: a.slug || a.id }))
export const awardOf = (slug) => catalogue.find((a) => a.slug === slug) || null

export const mine = ref([])
let asked = ''

export async function loadMine(force = false) {
  const id = session.value ? session.value.user.id : ''
  if (!configured || !id) { mine.value = []; asked = ''; return mine.value }
  if (!force && asked === id) return mine.value
  asked = id
  const { data, error } = await supabase.rpc('achievements_of', { p_user: id })
  if (error) { asked = ''; throw error }
  mine.value = data || []
  return mine.value
}

/* somebody else's, which answers nothing at all unless they have made their page public */
export async function awardsOf(userId) {
  if (!configured || !userId) return []
  const { data, error } = await supabase.rpc('achievements_of', { p_user: userId })
  if (error) throw error
  return data || []
}

/* what the site has come to believe about somebody — the staff only, and the function says so */
export async function traitsOf(userId) {
  if (!configured || !userId) return []
  const { data, error } = await supabase.rpc('traits_of', { p_user: userId })
  if (error) throw error
  return data || []
}
export async function traitCounts() {
  if (!configured) return []
  const { data, error } = await supabase.rpc('trait_counts')
  if (error) throw error
  return data || []
}
