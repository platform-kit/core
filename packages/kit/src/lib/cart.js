/*
 * The bag — a small reactive list persisted in the Loro store (so it survives a
 * reload, and for a signed-in reader follows them across devices), plus the
 * open/closed state of the drawer that shows it. A line is one offer (its sku)
 * at one variant (a size); its key is the two together. Amounts are display only —
 * every one is re-read from the product files server-side at checkout.
 */
import { ref, computed } from 'vue'
import { get as storeGet, set as storeSet } from './store.js'

const KEY = 'dl.cart.v2'   /* v1 lines were keyed by Stripe price id */
const MAX_QTY = 10
export const keyOf = (sku, variant) => sku + (variant ? '|' + variant : '')
const load = () => {
  try {
    const r = storeGet(KEY)
    const lines = r ? JSON.parse(r) : []
    return lines.filter((l) => l.sku).map((l) => ({ ...l, key: l.key || keyOf(l.sku, l.variant) }))
  } catch (e) { return [] }
}

export const items = ref(load())
const persist = () => storeSet(KEY, JSON.stringify(items.value))
const clamp = (q) => Math.max(1, Math.min(MAX_QTY, q | 0 || 1))

/* the drawer */
export const open = ref(false)
/* the line most recently added, so the drawer can draw the eye to it */
export const lastAdded = ref('')
export function openCart() { open.value = true }
export function closeCart() { open.value = false }
export function toggleCart() { open.value = !open.value }

/* p: { sku, slug, name, variant, label?, unit_amount, currency, kind, image } — kind print ships and stacks; download does neither */
export function add(p, quantity = 1) {
  const key = keyOf(p.sku, p.variant)
  const line = items.value.find((x) => x.key === key)
  const stackable = p.kind === 'store_good' || p.kind === 'good' || p.kind === 'print'
  if (line) { if (stackable) line.quantity = clamp(line.quantity + quantity) }
  else items.value.push({ ...p, key, quantity: stackable ? clamp(quantity) : 1 })
  items.value = [...items.value]; persist()
  lastAdded.value = key
  return key
}
export function remove(key) { items.value = items.value.filter((x) => x.key !== key); persist() }
export function setQty(key, q) {
  const line = items.value.find((x) => x.key === key)
  if (!line) return
  line.quantity = clamp(q); items.value = [...items.value]; persist()
}
export function clear() { items.value = []; persist() }
export const has = (sku, variant) => items.value.some((x) => x.key === keyOf(sku, variant))
export const hasProduct = (sku) => items.value.some((x) => x.sku === sku)
export const count = computed(() => items.value.reduce((n, i) => n + i.quantity, 0))
export const total = computed(() => items.value.reduce((n, i) => n + (i.unit_amount || 0) * i.quantity, 0))
export const currency = computed(() => (items.value[0] && items.value[0].currency) || 'usd')
