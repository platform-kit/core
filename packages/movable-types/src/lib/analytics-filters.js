/*
 * The dashboards' filters: the chips (a channel, a referrer, a campaign, a landing page, a device, browser, system,
 * country, language) and the source, one reactive object the three analytics pages share — read from the address's
 * query on load and written back (history.replaceState, never a navigation), so a filtered view survives a reload and
 * can be handed on as a link. The reads take it as `filters` (session_ok in the database). The audience filter is the
 * page's own, beside it.
 */
import { reactive, computed, watch } from 'vue'

export const FILTER_KEYS = ['channel', 'ref', 'campaign', 'entry', 'device', 'browser', 'os', 'country', 'lang']
const KEYS = FILTER_KEYS.concat('source')

function fromQuery() {
  const out = {}
  try {
    const q = new URLSearchParams(location.search)
    for (const k of KEYS) { const v = q.get(k); if (v) out[k] = v }
  } catch (e) { /* no window */ }
  return out
}
function toQuery(f) {
  try {
    const q = new URLSearchParams(location.search)
    for (const k of KEYS) { if (f[k]) q.set(k, f[k]); else q.delete(k) }
    const s = q.toString()
    history.replaceState(history.state, '', location.pathname + (s ? '?' + s : '') + location.hash)
  } catch (e) { /* no window */ }
}

let shared = null
export function useFilters(words = {}) {
  if (!shared) {
    const f = reactive(fromQuery())
    watch(f, (v) => toQuery(v), { deep: true })
    shared = f
  }
  const f = shared
  const set = (key, value) => { if (!KEYS.includes(key)) return; if (value == null || value === '') delete f[key]; else f[key] = String(value) }
  const toggle = (key, value) => { if (f[key] === String(value)) delete f[key]; else set(key, value) }
  const remove = (key) => { delete f[key] }
  const clear = () => { for (const k of FILTER_KEYS) delete f[k] }
  /* the chips: every filter but the source, with its word */
  const chips = computed(() => FILTER_KEYS.filter((k) => f[k]).map((k) => ({ key: k, value: f[k], label: words[k] || k })))
  /* what the reads take: the chips and the source */
  const forRead = computed(() => { const o = {}; for (const k of KEYS) if (f[k]) o[k] = f[k]; return o })
  const has = (key, value) => f[key] === String(value)
  return { filters: f, set, toggle, remove, clear, chips, forRead, has }
}
