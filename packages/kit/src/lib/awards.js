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
/* AND THE RULES NO FILE DECLARES: every quiz in a course earns an achievement the achievements push declares from
   the course itself (openspec: courses), so it is in the database and not among the compiled files. They are read
   once, from the table anybody may read, and join the catalogue the pages and profiles show. */
export const extra = ref([])
let looked = false
export async function loadCatalogue() {
  if (looked || !configured) return extra.value
  looked = true
  const { data, error } = await supabase.from('achievements').select('slug, title, sub, icon, colour, cover, shown, position')
  if (error) { looked = false; return extra.value }
  const known = new Set(catalogue.map((a) => a.slug))
  extra.value = (data || []).filter((a) => !known.has(a.slug)).map((a) => ({ ...a, order: a.position }))
  return extra.value
}
export const allAwards = () => [...catalogue, ...extra.value]
export const awardOf = (slug) => catalogue.find((a) => a.slug === slug) || extra.value.find((a) => a.slug === slug) || null

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
