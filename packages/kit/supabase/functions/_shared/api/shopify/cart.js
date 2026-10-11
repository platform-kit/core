/*
 * A cart's arithmetic and errors, pure: the lines a headless storefront sent (a variant id, a quantity, attributes)
 * kept as { id, sku, variant, quantity, attributes } — the bag's own shape plus a line id — and answered as Shopify's
 * Cart with its cost from the catalog at read time. Shipping is not in the cart (Checkout prices it), tax and duties
 * none. The bag's cap (10) clamps a quantity, as the bag does.
 */
import { GID, findVariant, lineOf, money } from './products.js'
export const MAX_QTY = 10
const CODES = { INVALID_MERCHANDISE_LINE: 'INVALID_MERCHANDISE_LINE', QUANTITY_MUST_BE_POSITIVE: 'QUANTITY_MUST_BE_POSITIVE', INVALID: 'INVALID', MISSING_NOTE: 'MISSING_NOTE', LESS_THAN: 'LESS_THAN' }
const newLineId = () => GID.line + (crypto.randomUUID ? crypto.randomUUID().replace(/-/g, '').slice(0, 24) : Math.random().toString(36).slice(2, 14))
const err = (code, message, field) => ({ code, message, field: field || null })

/* the lines a mutation gives → the rows kept, or the errors */
export function linesIn(store, input, existing = []) {
  const rows = existing.map((l) => ({ ...l })); const errors = []
  for (const [i, l] of (Array.isArray(input) ? input : []).entries()) {
    const v = l && l.merchandiseId ? findVariant(store, String(l.merchandiseId)) : null
    if (!v) { errors.push(err(CODES.INVALID_MERCHANDISE_LINE, 'The merchandise with id ' + String(l && l.merchandiseId) + ' does not exist.', ['lines', String(i), 'merchandiseId'])); continue }
    const q = l.quantity == null ? 1 : Number(l.quantity)
    if (!(q > 0)) { errors.push(err(CODES.QUANTITY_MUST_BE_POSITIVE, 'The quantity must be greater than zero.', ['lines', String(i), 'quantity'])); continue }
    const { sku, variant } = lineOf(v.id)
    const stackable = v._line.kind === 'good' || v._line.kind === 'print'
    const had = rows.find((r) => r.sku === sku && r.variant === variant)
    const attributes = Array.isArray(l.attributes) ? l.attributes.filter((a) => a && a.key).map((a) => ({ key: String(a.key), value: String(a.value ?? '') })) : []
    if (had) { had.quantity = stackable ? Math.min(MAX_QTY, had.quantity + q) : 1; if (attributes.length) had.attributes = attributes }
    else rows.push({ id: newLineId(), sku, variant, quantity: stackable ? Math.min(MAX_QTY, q) : 1, attributes })
  }
  return { rows, errors }
}
export function linesUpdated(store, input, existing) {
  const rows = existing.map((l) => ({ ...l })); const errors = []
  for (const [i, l] of (Array.isArray(input) ? input : []).entries()) {
    const row = rows.find((r) => r.id === String(l && l.id))
    if (!row) { errors.push(err(CODES.INVALID, 'The cart line with id ' + String(l && l.id) + ' does not exist.', ['lines', String(i), 'id'])); continue }
    if (l.merchandiseId) { const v = findVariant(store, String(l.merchandiseId)); if (!v) { errors.push(err(CODES.INVALID_MERCHANDISE_LINE, 'The merchandise with id ' + String(l.merchandiseId) + ' does not exist.', ['lines', String(i), 'merchandiseId'])); continue } Object.assign(row, lineOf(v.id)) }
    if (l.quantity != null) { const q = Number(l.quantity); if (q === 0) { rows.splice(rows.indexOf(row), 1); continue } if (!(q > 0)) { errors.push(err(CODES.QUANTITY_MUST_BE_POSITIVE, 'The quantity must be greater than zero.', ['lines', String(i), 'quantity'])); continue } row.quantity = Math.min(MAX_QTY, q) }
    if (Array.isArray(l.attributes)) row.attributes = l.attributes.filter((a) => a && a.key).map((a) => ({ key: String(a.key), value: String(a.value ?? '') }))
  }
  return { rows, errors }
}
export function linesRemoved(existing, ids) {
  const set = new Set((Array.isArray(ids) ? ids : []).map(String))
  return { rows: existing.filter((l) => !set.has(l.id)), errors: [] }
}
/* the row → Shopify's Cart */
export function cartOf(store, row, o = {}) {
  const lines = []
  let subtotal = 0, currency = null, quantity = 0
  for (const l of row.lines || []) {
    const v = findVariant(store, GID.variant + l.sku + (l.variant ? '/' + l.variant : '')) || findVariant(store, GID.variant + l.sku)
    if (!v) continue
    const cents = Math.round(Number(v.price.amount) * 100) * l.quantity
    subtotal += cents; quantity += l.quantity; currency = currency || v.price.currencyCode
    lines.push({ id: l.id, quantity: l.quantity, merchandise: v, attributes: l.attributes || [], attribute: null, cost: { totalAmount: money(cents, currency), subtotalAmount: money(cents, currency), amountPerQuantity: v.price, compareAtAmountPerQuantity: v.compareAtPrice }, discountAllocations: [], sellingPlanAllocation: null })
  }
  const cur = currency || 'USD'
  return {
    id: GID.cart + row.id, checkoutUrl: (o.site || '').replace(/\/+$/, '') + '/cart/c/' + row.id, createdAt: row.created_at || null, updatedAt: row.updated_at || null, totalQuantity: quantity, note: row.note || null,
    attributes: row.attributes || [], attribute: null, discountCodes: [], discountAllocations: [], appliedGiftCards: [], deliveryGroups: [],
    buyerIdentity: { email: (row.buyer && row.buyer.email) || null, phone: (row.buyer && row.buyer.phone) || null, countryCode: (row.buyer && row.buyer.countryCode) || null, customer: null, deliveryAddressPreferences: [], preferences: null },
    cost: { totalAmount: money(subtotal, cur), subtotalAmount: money(subtotal, cur), totalTaxAmount: null, totalDutyAmount: null, checkoutChargeAmount: money(subtotal, cur), totalAmountEstimated: false, subtotalAmountEstimated: false },
    _lines: lines,
  }
}
export const buyerIn = (b) => ({ email: b && b.email ? String(b.email).slice(0, 200) : null, phone: b && b.phone ? String(b.phone).slice(0, 40) : null, countryCode: b && b.countryCode ? String(b.countryCode).toUpperCase().slice(0, 2) : null })
export const attributesIn = (list) => (Array.isArray(list) ? list.filter((a) => a && a.key).map((a) => ({ key: String(a.key).slice(0, 80), value: String(a.value ?? '').slice(0, 500) })) : [])
