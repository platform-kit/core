/*
 * PRINTIFY — print on demand, on the same shape Lulu answers.
 *
 * This supplier exists to be the test of whether the seam was real. Everything before it
 * generalised the store away from books: the interface took a variant and its artefacts rather
 * than a page count and two PDFs, the registry stopped being a list of printers, a kind came to
 * own what is true of one sort of thing. If any of that was a rename rather than a generalisation,
 * adding a garment printer would require moving something — and that, rather than the garments,
 * is what this file is for.
 *
 * WHAT IS DIFFERENT ABOUT IT, and so what it tests:
 *
 *   it PUBLISHES ITS CATALOGUE. A blueprint's colours and sizes are Printify's fact, not the
 *   shop's, so `catalogue()` answers them and the shop never types one (see `reconcileOptions`
 *   in _shared/variants.js: the rows are written into the file marked `from: printify`, and a
 *   value Printify drops is marked rather than deleted, so a cart line naming it still reads);
 *
 *   it needs ARTWORK, not files — `needs: ['artwork']`, which a book's kind does not produce and
 *   a garment's does. The pairing is matched when the shop is configured rather than at the till;
 *
 *   its product is a BLUEPRINT and a PRINT PROVIDER, which are ids from its own catalogue. There
 *   is deliberately no way for an editor to type one: a product type is the supplier's fact, and
 *   a typo must not be able to become an order.
 *
 * THE KEYS: `PRINTIFY_API_KEY` (a personal access token from the account) and `PRINTIFY_SHOP_ID`
 * (the shop the orders go to — an account may have several). With neither, or with PRINT_MOCK=1
 * or PRINTIFY_MOCK=1, every call is answered locally and a job walks itself to shipped, so the
 * whole chain runs with no account.
 *
 * The API is https://api.printify.com/v1 on a bearer token.
 */

const API = 'https://api.printify.com/v1'

/* its words onto ours. Printify's order statuses are a longer list than our six; everything that
   means "it is being made" is in_production, and everything that means "it is on its way or has
   arrived" is shipped, because a shop does not act differently on the difference. */
const STATUS = {
  'pending': 'submitted', 'on-hold': 'submitted', 'payment-not-received': 'submitted',
  'in-production': 'in_production', 'sending-to-production': 'in_production', 'has-issues': 'in_production',
  'fulfilled': 'shipped', 'shipped': 'shipped', 'on-the-way': 'shipped', 'delivered': 'shipped',
  'canceled': 'canceled', 'cancelled': 'canceled',
  'refunded': 'rejected', 'payment-failed': 'failed',
}

/* A FIXTURE CATALOGUE for the mock, and the shape every real answer is read into: a blueprint,
   the provider that makes it, and the axes a buyer chooses between. Two blueprints is enough to
   prove a shop cannot name a third. */
const MOCK_BLUEPRINTS = [
  {
    id: 5, title: 'Unisex Cotton Crew Tee', provider: 29,
    areas: ['front', 'back'],
    options: [
      { name: 'Colour', values: [{ value: 'black', label: 'Black' }, { value: 'white', label: 'White' }, { value: 'navy', label: 'Navy' }] },
      { name: 'Size', values: [{ value: 's', label: 'S' }, { value: 'm', label: 'M' }, { value: 'l', label: 'L' }, { value: 'xl', label: 'XL' }] },
    ],
  },
  {
    id: 49, title: 'Unisex Heavy Blend Hoodie', provider: 29,
    areas: ['front'],
    options: [
      { name: 'Colour', values: [{ value: 'black', label: 'Black' }, { value: 'sand', label: 'Sand' }] },
      { name: 'Size', values: [{ value: 'm', label: 'M' }, { value: 'l', label: 'L' }, { value: 'xl', label: 'XL' }] },
    ],
  },
]

export function printify(env) {
  const token = () => env('PRINTIFY_API_KEY')
  const shop = () => env('PRINTIFY_SHOP_ID')
  const configured = () => !!token() && !!shop()
  const mock = () => !configured() || env('PRINT_MOCK') === '1' || env('PRINTIFY_MOCK') === '1'

  const call = async (path, init = {}) => {
    const r = await fetch(API + path, {
      ...init,
      headers: { authorization: 'Bearer ' + token(), 'content-type': 'application/json', ...(init.headers || {}) },
    })
    const text = await r.text()
    let body = null
    try { body = text ? JSON.parse(text) : null } catch { body = { raw: text } }
    if (!r.ok) throw new Error(`printify ${path}: ${r.status} ${body?.message ?? text.slice(0, 200)}`)
    return body
  }

  return {
    id: 'printify', name: 'Printify',
    /* the formats it MAKES, in our words: a shop's own kinds name these */
    formats: ['shirt', 'hoodie'], makes: ['shirt', 'hoodie'],
    sends: true,
    /* it keeps a product of its own per blueprint and artwork, and that product is what an order
       names — so a title has to be made once before anything can be ordered */
    stateful: true,
    /* the ARTEFACTS it needs a kind to have produced. A garment's kind makes artwork and knows
       where it goes; a book's makes a page count and two PDFs, and could not feed this. */
    needs: ['artwork'],
    /* the ENVIRONMENT keys it cannot work without */
    keys: ['PRINTIFY_API_KEY', 'PRINTIFY_SHOP_ID'],
    configured,
    mock,
    /* our three shipping words in its */
    levels: { standard: 1, priority: 2, express: 3 },

    /*
     * THE SHOP'S OWN CHOICES about how a thing is made — the admin's tab, and NOT the buyer's.
     * Which blueprint and which print provider: both are ids from the catalogue, offered as a
     * list, never typed.
     */
    options: (format) => [
      { key: 'blueprint', label: 'Product type', type: 'select', from: 'catalogue', choices: [], help: 'from Printify’s own catalogue — a type it does not sell cannot be chosen' },
      { key: 'provider', label: 'Print provider', type: 'select', from: 'catalogue', choices: [], help: 'who makes it; the catalogue lists those who make this type' },
      { key: 'placement', label: 'Where the design goes', type: 'select', choices: [{ value: 'front', label: 'Front' }, { value: 'back', label: 'Back' }], default: 'front' },
      ...(format === 'shirt' ? [] : []),
    ],

    /*
     * THE BUYER'S AXES, which are Printify's to say. Given the blueprint the shop chose, these
     * are the colours and sizes that blueprint is actually made in — written into the product's
     * file as ordinary option rows by the refresh, so nothing fetches at the till.
     */
    catalogue: async (chosen = {}) => {
      const id = Number(chosen.blueprint ?? chosen.id ?? 0)
      if (mock()) {
        const bp = MOCK_BLUEPRINTS.find((b) => b.id === id) || MOCK_BLUEPRINTS[0]
        return bp.options
      }
      if (!id) return []
      /* a blueprint's variants, as its own options: Printify gives them as a list of variants
         each carrying its options, so they are gathered back into axes */
      const providers = await call(`/catalog/blueprints/${id}/print_providers.json`)
      const pid = Number(chosen.provider ?? providers?.[0]?.id ?? 0)
      if (!pid) return []
      const vs = await call(`/catalog/blueprints/${id}/print_providers/${pid}/variants.json`)
      const axes = new Map()
      for (const v of vs?.variants ?? []) {
        for (const [name, value] of Object.entries(v.options ?? {})) {
          if (!axes.has(name)) axes.set(name, new Map())
          const slug = String(value).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')
          axes.get(name).set(slug, String(value))
        }
      }
      return [...axes].map(([name, values]) => ({
        name: name.charAt(0).toUpperCase() + name.slice(1),
        values: [...values].map(([value, label]) => ({ value, label })),
      }))
    },

    /*
     * EVERY PRODUCT TYPE IT SELLS, for the admin's list. The shop picks from this; there is no
     * other way for a blueprint id to reach a file, which is the point — a typo cannot become an
     * order.
     */
    types: async () => {
      if (mock()) return MOCK_BLUEPRINTS.map((b) => ({ id: b.id, title: b.title, providers: [{ id: b.provider, title: 'Mock Print Co' }], areas: b.areas }))
      const bps = await call('/catalog/blueprints.json')
      const out = []
      for (const b of (bps ?? []).slice(0, 200)) out.push({ id: b.id, title: b.title, providers: [], areas: [] })
      return out
    },

    /*
     * THE PICTURES OF THE THING, one per COLOURWAY. Printify renders them from the artwork on the
     * blueprint, and they are addresses — so they travel exactly as a book's cover art does, and
     * a card, a gallery or a picker shows one without anybody fetching anything.
     *
     * Asked for at the same moment as the catalogue (the admin's refresh), which is why this
     * works in both shapes that have an admin: in git mode the refresh is a dev server, in cloud
     * mode it is the admin function, and NEITHER is a build. A shop that adds a colour in cloud
     * mode has its mockup without a deploy, because nothing was waiting on one.
     */
    mockups: async ({ blueprint, artwork, ref } = {}) => {
      if (mock()) {
        const bp = MOCK_BLUEPRINTS.find((b) => b.id === Number(blueprint)) || MOCK_BLUEPRINTS[0]
        const colour = bp.options.find((o) => o.name === 'Colour')
        return Object.fromEntries((colour ? colour.values : []).map((v) => [v.value, `https://images.printify.example/mock/${bp.id}-${v.value}.jpg`]))
      }
      if (!ref) return {}
      /* a registered product carries its rendered images, each naming the variants it is of */
      const prod = await call(`/shops/${shop()}/products/${ref}.json`)
      const byVariant = new Map((prod?.variants ?? []).map((v) => [v.id, String(v.options?.color ?? v.title ?? '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')]))
      const out = {}
      for (const img of prod?.images ?? []) {
        if (!img?.src) continue
        for (const id of img.variant_ids ?? []) {
          const slug = byVariant.get(id)
          if (slug && !out[slug]) out[slug] = img.src
        }
      }
      return out
    },

    /* its descriptor for a variant: pure, no io — what the order will name */
    product: ({ chosen = {}, options = {} }) => ({
      by: 'printify',
      blueprint: Number(options.blueprint ?? 0),
      provider: Number(options.provider ?? 0),
      placement: options.placement || 'front',
      chosen,
    }),

    /* a garment has no shape worth measuring here: the blueprint is the shape */
    measure: async () => null,

    quote: async ({ product, quantity = 1, country = 'US', level = 'standard' }) => {
      if (mock()) return { print: 1150 * quantity, shipping: level === 'express' ? 1400 : 495, currency: 'USD', days: level === 'express' ? 3 : 8 }
      const r = await call(`/shops/${shop()}/orders/shipping.json`, {
        method: 'POST',
        body: JSON.stringify({ line_items: [{ blueprint_id: product.blueprint, print_provider_id: product.provider, variant_id: product.variantId ?? 0, quantity }], address_to: { country } }),
      })
      const ship = r?.standard ?? r?.express ?? 0
      return { print: null, shipping: ship, currency: 'USD', days: null }
    },

    /* the artwork is the one thing that can be wrong before anything is made */
    validate: async ({ artefacts = {} }) => (artefacts.artwork ? { ok: true } : { ok: false, errors: ['there is no artwork to print'] }),

    /*
     * THE TITLE IT KEEPS. Printify holds a product per blueprint × provider × artwork, and an
     * order names that product — so it is made once, before anything can be ordered, and its id
     * is what the fulfilment carries.
     */
    register: async ({ product, artefacts = {}, title, sku, existing }) => {
      if (mock()) return { ref: existing || 'pf_mock_' + (sku || 'x'), paid: false, validated: true }
      if (existing) return { ref: existing, paid: false, validated: true }
      const made = await call(`/shops/${shop()}/products.json`, {
        method: 'POST',
        body: JSON.stringify({
          title: title || sku, description: title || sku,
          blueprint_id: product.blueprint, print_provider_id: product.provider,
          variants: [], print_areas: [{ variant_ids: [], placeholders: [{ position: product.placement, images: [{ src: artefacts.artwork, x: 0.5, y: 0.5, scale: 1, angle: 0 }] }] }],
        }),
      })
      return { ref: String(made?.id ?? ''), paid: false, validated: true }
    },

    order: async ({ product, ref, quantity = 1, address = {}, email, externalId, level = 'standard' }) => {
      if (mock()) return { id: 'pf_mock_' + String(externalId || Date.now()), status: 'pending', cost: null }
      const r = await call(`/shops/${shop()}/orders.json`, {
        method: 'POST',
        body: JSON.stringify({
          external_id: String(externalId ?? ''),
          label: String(externalId ?? ''),
          line_items: [{ product_id: ref, variant_id: product.variantId ?? 0, quantity }],
          shipping_method: level === 'express' ? 2 : 1,
          send_shipping_notification: false,
          address_to: {
            first_name: String(address.name ?? '').split(' ')[0] || 'Customer',
            last_name: String(address.name ?? '').split(' ').slice(1).join(' ') || '.',
            email: email ?? '', country: address.country ?? 'US',
            region: address.state ?? '', address1: address.line1 ?? '', address2: address.line2 ?? '',
            city: address.city ?? '', zip: address.postal_code ?? '',
          },
        }),
      })
      return { id: String(r?.id ?? ''), status: String(r?.status ?? 'pending'), cost: null }
    },

    /* a mock job walks itself: pending → in-production → fulfilled, one step per read */
    status: async (id) => {
      if (mock()) {
        const step = ['pending', 'in-production', 'fulfilled']
        const n = Math.min(step.length - 1, Number(String(id).replace(/\D/g, '').slice(-1) || 0) % step.length)
        return { id, status: step[n], tracking: n === 2 ? { carrier: 'Mock Post', number: 'PF' + String(id).slice(-8) } : null, cost: null }
      }
      const r = await call(`/shops/${shop()}/orders/${id}.json`)
      const sh = r?.shipments?.[0] ?? null
      return { id, status: String(r?.status ?? ''), tracking: sh ? { carrier: sh.carrier ?? '', number: sh.number ?? '', url: sh.url ?? '' } : null, cost: null }
    },

    statusOf: (w) => STATUS[String(w).toLowerCase()] ?? null,

    /* its webhook names the order in `resource.id`; trust is the signature the caller checks */
    webhook: (body) => (body && (body.resource?.id ?? body.id)) || null,
    ensureWebhook: async (url) => {
      if (mock() || !url) return null
      await call(`/shops/${shop()}/webhooks.json`, { method: 'POST', body: JSON.stringify({ topic: 'order:updated', url }) })
      return url
    },
  }
}
