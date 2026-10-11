/*
 * A GARMENT — the kit's first kind, and the one that shows what a kind is for.
 *
 * A shirt is not a book and not an ordinary product. What is true only of it: a PRODUCT TYPE
 * (Printify calls it a blueprint) which decides the colours and sizes it is made in; a DESIGN,
 * which is a file in the library; WHERE that design goes on it; and a MOCKUP per colour, which
 * is what a buyer actually sees. None of that belongs in a shared table, and the whole of it
 * reaches the store through two slots.
 *
 * THE PRODUCT TYPE IS THE SUPPLIER'S FACT, AND THERE IS NO WAY TO TYPE ONE. The admin offers the
 * list its supplier publishes and the file keeps an id, so a typo cannot become an order — which
 * is the thing this kind exists to make impossible, and it is checked in all three places a file
 * can reach the shop: at the build, at the save, and at the till.
 *
 *   options(offer)      the blueprint's own colours and sizes, from the supplier's catalogue —
 *                       never a list somebody typed, and never a fetch at request time
 *   artefacts(variant)  the artwork placed for that variant, and the mockup that shows it
 *
 * The store never opens either. It stores the record, hands it to the supplier, and asks only
 * whether the variant is makeable yet.
 */

/* a design on the garment: an address, where it goes, and how big. The address is the library's
   (`/uploads/...`) like every other file field — there is no second uploader. */
const placementOf = (offer) => {
  const d = (offer && offer.design) || {}
  return {
    artwork: String(d.artwork || d.image || ''),
    area: String(d.area || 'front'),
    scale: Number(d.scale ?? 1),
    x: Number(d.x ?? 0.5),
    y: Number(d.y ?? 0.5),
  }
}

/* the blueprint a file names, as a number — a file that names none has nothing to be checked
   against, which is a different fault from naming one that does not exist */
export const blueprintOf = (offer) => {
  const v = (offer && (offer.blueprint ?? (offer.options_for || {}).blueprint)) ?? null
  return v == null || v === '' ? null : Number(v)
}

/*
 * IS THIS A TYPE THE SUPPLIER SELLS? The one question asked at the build, at the save and at the
 * till, so all three refuse the same file for the same reason and in the same words.
 *
 * `types` is what the supplier's catalogue answered. A supplier that publishes none cannot say,
 * and then an offer naming a blueprint is a fault in itself: the shop has invented a product type.
 */
export function checkBlueprint(offer, types) {
  const id = blueprintOf(offer)
  if (id == null) return 'this names no product type — choose one from the supplier’s catalogue'
  if (!Array.isArray(types)) return null                     /* nothing to check against, this run */
  if (!types.length) return `the supplier publishes no catalogue, so product type ${id} cannot be one of its own`
  if (!types.some((t) => Number(t.id) === id)) {
    return `product type ${id} is not one the supplier sells — it offers ${types.slice(0, 6).map((t) => t.id).join(', ')}${types.length > 6 ? '…' : ''}`
  }
  return null
}

/*
 * AND IS THIS A VALUE THE BLUEPRINT CARRIES? The same question one level down: a shirt that comes
 * in black and white cannot be sold in red, however the file came to say so. The message names
 * the value, because "invalid variant" sends somebody to read the whole file.
 */
export function checkValues(options, axes) {
  if (!Array.isArray(axes) || !axes.length) return null
  const bad = []
  for (const o of options || []) {
    const axis = axes.find((a) => String(a.name).toLowerCase() === String(o.name).toLowerCase())
    if (!axis) continue                                      /* the shop's own axis, not the supplier's */
    const has = new Set(axis.values.map((v) => String(v.value)))
    for (const v of o.values || []) {
      const value = String(v && typeof v === 'object' ? v.value : v)
      if (value && !has.has(value)) bad.push(`${o.name} ${value}`)
    }
  }
  return bad.length ? `the product type is not made in ${bad.join(', ')}` : null
}

export const apparel = {
  key: 'apparel',
  /* what it derives for a variant, and so what a supplier may ask it for */
  produces: ['artwork', 'mockup'],

  /*
   * THE AXES A BUYER CHOOSES BETWEEN, from the supplier's own catalogue. Never typed, and never
   * fetched at request time — `ctx.catalogue` is what the build (or the admin's refresh, or the
   * publish in cloud mode) already asked for, so a product page never waits on a supplier.
   */
  options: async (offer, ctx = {}) => {
    const axes = ctx.catalogue || null
    if (!axes) return []
    return axes.map((a) => ({ ...a, from: ctx.supplier || 'printify' }))
  },

  /*
   * WHAT WAS MADE FOR ONE VARIANT: the artwork as placed, and the mockup for that COLOURWAY —
   * a garment is photographed per colourway and not per size, so the same picture serves every
   * size of one colour, and the variant key falls back to the colour when it has no picture of
   * its own (a colorway, in Printify's own spelling, is the same thing).
   *
   * The mockup is an ADDRESS like a book's cover art — resolved through the build's own asset
   * path, never read off the disk beside the record.
   */
  artefacts: async (variant, ctx = {}) => {
    const place = placementOf(ctx.offer || {})
    if (!place.artwork) return null
    const colour = (variant.chosen || []).find((c) => String(c.slug) === 'colour' || String(c.slug) === 'color')
    const mockups = (ctx.mockups || {})
    return {
      artwork: place.artwork,
      placement: { area: place.area, scale: place.scale, x: place.x, y: place.y },
      mockup: mockups[variant.variant] || (colour ? mockups[colour.value] : '') || mockups.default || '',
    }
  },
}
