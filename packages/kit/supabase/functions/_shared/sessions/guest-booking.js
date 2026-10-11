export function mayBookAsGuest(requireAuthToBook, requires) {
  return requireAuthToBook === false && (requires === 'anyone' || requires === 'guest')
}

export function guestEmail(value) {
  const email = typeof value === 'string' ? value.trim().toLowerCase() : ''
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) ? email : null
}

export function guestSessionSku(items, booking, requireAuthToBook, offerOf) {
  if (requireAuthToBook !== false || !booking || !Array.isArray(items) || items.length !== 1) return null
  const item = items[0]
  if (!item || (item.quantity != null && Number(item.quantity) !== 1)) return null
  const sku = String(item.sku ?? '')
  return sku && offerOf(sku)?.kind === 'session' ? sku : null
}
