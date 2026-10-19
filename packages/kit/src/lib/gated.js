/*
 * GATED TEXT, ASKED FOR. The published bundle carries what a guest may read (_shared/gate.js); a reader with
 * more access is sent the rest by functions/reader-content, which reads their class from their own
 * entitlements. Asked once per record per reader and kept for the visit — and forgotten the moment the
 * person signed in changes, so one reader's text is never drawn for the next.
 *
 *   readerBook(slug)              → { raw, companion, readable }   the book cut to this reader's chapters
 *   readerPage(collection, slug)  → { body }                       a gated page's markdown
 *   forgetGated()                 the cache, emptied (sign-in and sign-out call it)
 *
 * A failure rejects; the caller shows its error line and a retry, never the paywall.
 */
import { watch, ref, computed } from 'vue'
import { supabase } from './supabase.js'
import { user } from './auth.js'
import { forgetCompanions } from './companions.js'

const cache = new Map()
export const forgetGated = () => { cache.clear(); forgetCompanions() }
watch(() => user.value && user.value.id, () => forgetGated())

function ask(key, body) {
  if (cache.has(key)) return cache.get(key)
  const p = (async () => {
    if (!supabase) throw new Error('no backend')
    const { data, error } = await supabase.functions.invoke('reader-content', { body })
    if (error) throw error
    if (!data || data.error) throw new Error((data && data.error) || 'no text')
    return data
  })()
  cache.set(key, p)
  p.catch(() => cache.delete(key))   /* a failure is asked again, not remembered */
  return p
}

export const readerBook = (slug) => ask('books/' + slug, { collection: 'books', slug })
export const readerPage = (collection, slug) => ask(collection + '/' + slug, { collection, slug })

/*
 * A gated page in a view: its html once fetched, and the state to draw while it is not.
 *   const g = useGatedPage(collection, () => record, () => allowed)
 *   g.html (the page's html — the bundle's, or the fetched one), g.state ('' | 'loading' | 'error' | 'done'), g.retry()
 * `record` is { id, html, gated }; nothing is asked for a page the bundle carries whole or the reader may not read.
 */
export function useGatedPage(collection, record, allowed) {
  const fetched = ref(null), state = ref(''), turn = ref(0)
  const want = () => { const r = record(); return r && r.gated && allowed() ? r : null }
  watch([() => (want() || {}).id, allowed, turn], async () => {
    fetched.value = null
    const r = want()
    if (!r) { state.value = ''; return }
    state.value = 'loading'
    try {
      const { body } = await readerPage(collection, r.id)
      const { renderer } = await import('./markdown.js')
      if (want() !== r && (want() || {}).id !== r.id) return   /* the reader moved on while it was coming */
      fetched.value = await renderer().parse(body || '')
      state.value = 'done'
    } catch (e) { state.value = 'error' }
  }, { immediate: true })
  return {
    html: computed(() => (fetched.value != null ? fetched.value : (record() || {}).html || '')),
    state,
    waiting: computed(() => !!want() && state.value !== 'done'),
    retry: () => { turn.value++ },
  }
}
