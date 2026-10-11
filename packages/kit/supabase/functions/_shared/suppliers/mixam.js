/*
 * Mixam, as a printer: a public API on a JWT (MIXAM_USER + MIXAM_PASS, the account's login;
 * MIXAM_UK=1 for the UK shop, else the US) — an offer for a spec, an order with its assets
 * by url and a callback for its status, the order read back. Stateless like Lulu: nothing is
 * set up at the printer, every order carries its spec. Their casebound is adhesive; sewn
 * routes to a short-run plant at many times the price, so it is never asked for; foil is
 * off-API. Mixam has no 6 × 9: a book is set at their 6.14 × 9.21, the nearest.
 * PRINT_MOCK=1 / MIXAM_MOCK=1, or no login, answers every call here.
 */
const on = (v) => /^(1|true|yes|on)$/i.test(String(v || ''))
const SIZES = { '6x9': { std: 'IN_6_14_X_9_21', format: 5, w: 442, h: 663 }, '6.14x9.21': { std: 'IN_6_14_X_9_21', format: 5, w: 442, h: 663 }, '5x8': { std: 'IN_5_5_X_8_5', format: 5, w: 396, h: 612 } }
const PAPER = { cream: { typeId: 1, weightId: 8, colourId: 0 }, white: { typeId: 1, weightId: 8, colourId: 0 } }
const STATUS = { CREATED: 'submitted', ARTWORK_VALIDATION: 'submitted', ON_HOLD: 'failed', CONFIRMED: 'submitted', IN_PRODUCTION: 'in_production', PRODUCTION: 'in_production', DISPATCHED: 'shipped', SHIPPED: 'shipped', DELIVERED: 'shipped', CANCELLED: 'canceled', CANCELED: 'canceled', REJECTED: 'rejected', ERROR: 'failed' }

export function mixam(env) {
  const configured = () => !!(env('MIXAM_USER') && env('MIXAM_PASS'))
  const mock = () => on(env('PRINT_MOCK')) || on(env('MIXAM_MOCK')) || !configured()
  const base = () => (on(env('MIXAM_UK')) ? 'https://mixam.co.uk' : 'https://mixam.com')
  let token = null
  async function auth() {
    if (token && token.until > Date.now()) return token.value
    const r = await fetch(base() + '/api/user/token', { headers: { authorization: 'Basic ' + btoa(env('MIXAM_USER') + ':' + env('MIXAM_PASS')) } })
    if (!r.ok) throw new Error('mixam auth: ' + r.status + ' ' + (await r.text()).slice(0, 200))
    const t = (await r.text()).replace(/^"|"$/g, '')
    token = { value: t, until: Date.now() + 50 * 60 * 1000 }
    return t
  }
  async function call(path, body, method = body ? 'POST' : 'GET') {
    const r = await fetch(base() + path, { method, headers: { 'content-type': 'application/json', accept: 'application/json', authorization: 'Bearer ' + (await auth()) }, body: body ? JSON.stringify(body) : undefined })
    const text = await r.text()
    if (!r.ok) throw new Error(`mixam ${method} ${path}: ${r.status} ${text.slice(0, 300)}`)
    return text ? JSON.parse(text) : null
  }
  /* the spec of a book, in Mixam's words: the bound block and its cover (and a jacket) */
  const itemSpec = (product, pages, copies) => {
    const s = SIZES[product.trim] || SIZES['6x9'], paper = PAPER[product.paper] || PAPER.cream
    const comp = (type, extra) => ({ format: s.format, standardSize: s.std, orientation: 'PORTRAIT', colours: 'PROCESS', substrate: { ...paper, design: 'NONE' }, componentType: type, folded: false, preDrilledHoles: 'NONE', samplePackType: 'PRODUCTS', shape: 'NONE', ...extra })
    const components = [comp('BOUND', { colours: 'GRAYSCALE', pages, lamination: 'NONE', binding: product.hard ? { type: 'CASE', sewn: false, edge: 'LEFT_RIGHT' } : { type: 'PUR', edge: 'LEFT_RIGHT' } }),
      comp('COVER', { substrate: { typeId: 1, weightId: product.hard ? 1 : 7, colourId: 0, design: 'NONE' }, lamination: product.lamination, backColours: 'NONE', backLamination: 'NONE' })]
    if (product.hard) components.push(comp('END_PAPERS', { colours: 'NONE', substrate: { typeId: 0, weightId: 0, colourId: 0, design: 'NONE' } }))
    if (product.jacket) components.push(comp('DUST_JACKET', { substrate: { typeId: 1, weightId: 7, colourId: 0, design: 'NONE' }, lamination: product.lamination }))
    return { copies, product: 'BOOK', components, bound: true }
  }
  const offerBody = (product, pages, copies) => ({ productId: 7, subProductId: 0, productName: 'Book', quoteType: 'QUOTE', itemSpecification: itemSpec(product, pages, copies) })

  return {
    id: 'mixam', name: 'Mixam', formats: ['softcover', 'hardcover'], get makes() { return this.formats }, stateful: false,
    /* the ENVIRONMENT keys it cannot work without, by name: a deploy refuses before it starts
       rather than letting a sale fail at the till. Not to be confused with `needs`, which is the
       ARTEFACTS it needs a kind to have produced. */
    /* the ARTEFACTS it reads from whatever kind it is paired with — it sizes and costs by the page count and fetches the two files. Matched
       against a kind's `produces` when the shop is configured, never at the till. */
    needs: ['pages', 'files'],
    keys: ["MIXAM_USER","MIXAM_PASS"],
    configured, mock,
    levels: { standard: 'STANDARD', priority: 'PRIORITY', express: 'EXPRESS' },
    options(format) {
      const o = [{ key: 'lamination', label: 'Cover lamination', type: 'select', choices: [{ value: 'MATT', label: 'Matte' }, { value: 'GLOSS', label: 'Gloss' }], default: 'MATT' }]
      if (format === 'hardcover') o.push({ key: 'jacket', label: 'Dust jacket', type: 'toggle', default: true })
      return o
    },
    product({ chosen = {}, options = {} }) {
      const { format, trim = '6x9', paper = 'cream' } = chosen
      const hard = format === 'hardcover', s = SIZES[trim] || SIZES['6x9']
      return { hard, jacket: hard && options.jacket !== false, lamination: options.lamination || 'MATT', trim, paper, size: s.std, minPages: hard ? 40 : 32, pageStep: 4, note: trim === '6x9' ? 'set at 6.14 × 9.21 in, the nearest Mixam has' : '' }
    },
    /* the cover sheet: the trim per panel, a 3 mm bleed, the spine from the offer's own word for it */
    async measure({ product, artefacts = {} }) {
      const { pages } = artefacts
      const s = SIZES[product.trim] || SIZES['6x9'], bleed = 3 / 25.4 * 72
      let spine = pages * 0.0048 * 72 + (product.hard ? 0.35 * 72 : 0)
      if (!mock()) { try { const o = await call('/api/public/offers', offerBody(product, pages, 1)); const sp = Array.isArray(o) ? o[0]?.spine : o?.spine; if (sp) spine = Number(sp) * 72 } catch (e) { /* the estimate stands */ } }
      const wrap = product.hard ? 0.6 * 72 : 0, flap = product.jacket ? 3.25 * 72 : 0
      return { width: s.w * 2 + spine + 2 * (bleed + wrap) + 2 * flap, height: s.h + 2 * (bleed + wrap), spine, bleed: bleed + wrap, flap, unit: 'pt', mock: mock() }
    },
    async quote({ product, artefacts = {}, quantity = 1, country = 'US' }) {
      const { pages } = artefacts
      if (mock()) return { print: (product.hard ? 15 : 4.5) + pages * 0.03, shipping: country === 'US' ? 6.5 : 18, currency: 'USD', days: 7, mock: true }
      const o = await call('/api/public/offers', offerBody(product, pages, quantity))
      const best = (Array.isArray(o) ? o : [o]).filter((x) => x && x.total != null).sort((a, b) => a.total - b.total)[0]
      if (!best) throw new Error('mixam: no offer')
      return { print: Number(best.total) / quantity, shipping: 0, currency: best.currency?.currencyCode || (on(env('MIXAM_UK')) ? 'GBP' : 'USD'), days: Number(best.days || 7), offer: best }
    },
    /* Mixam validates the artwork after the order is placed and says so on the callback */
    async validate({ artefacts = {} }) { return { ok: true, pages: artefacts.pages, deferred: true } },
    async order({ product, artefacts = {}, title, quantity = 1, address = {}, email, externalId, callbackUrl }) {
      const { pages, files } = artefacts
      if (mock()) { const id = 'mixam_mock_' + Date.now(); return { id, status: 'CREATED', cost: { print: 15 * quantity, shipping: 6.5, currency: 'USD', mock: true } } }
      const assets = [{ name: 'interior.pdf', url: files.interior }, { name: 'cover.pdf', url: files.cover }]
      if (product.jacket && files.jacket) assets.push({ name: 'jacket.pdf', url: files.jacket })
      const o = await call('/api/public/orders', {
        metadata: { externalOrderId: externalId, statusCallbackUrl: callbackUrl },
        orderItems: [{ product: 'BOOK', subProductId: 0, quoteType: 'QUOTE', itemSpecification: itemSpec(product, pages, quantity), assets, metadata: { title } }],
        deliveryAddress: { firstName: (address.name || '').split(' ')[0] || 'Reader', lastName: (address.name || '').split(' ').slice(1).join(' ') || '-', line1: address.line1 || '', line2: address.line2 || '', town: address.city || '', county: address.state || '', postcode: address.postal_code || '', country: address.country || 'US', phone: address.phone || '', email: email || env('SMTP_FROM') || '' },
      })
      return { id: String(o.id || o.orderId), status: String(o.status || 'CREATED'), cost: o.total != null ? { print: Number(o.total), shipping: 0, currency: o.currency?.currencyCode || 'USD' } : null }
    },
    async status(id) {
      if (mock() || id.startsWith('mixam_mock_')) { const age = Date.now() - Number(id.split('_')[2] || 0); const s = age < 20_000 ? 'CREATED' : age < 60_000 ? 'IN_PRODUCTION' : 'DISPATCHED'; return { id, status: s, tracking: s === 'DISPATCHED' ? { carrier: 'MOCK', id: 'MOCK' + id.slice(-6), url: null } : null, cost: null } }
      const o = await call('/api/public/orders/' + id)
      const t = o.tracking || o.shipments?.[0]
      return { id, status: String(o.status || ''), tracking: t ? { carrier: t.carrier || null, id: t.trackingNumber || t.id || null, url: t.url || null } : null, cost: o.total != null ? { print: Number(o.total), shipping: 0, currency: o.currency?.currencyCode || 'USD' } : null }
    },
    statusOf: (word) => STATUS[String(word || '').toUpperCase()] ?? null,
    /* the callback we asked for on the order: { orderId | id, status, artworkErrors } */
    webhook: (body) => String(body?.orderId ?? body?.id ?? body?.metadata?.orderId ?? '') || null,
    async ensureWebhook() { return null },   /* given per order, as statusCallbackUrl */
    call,
  }
}
