/*
 * Bookvault, as a printer: the v3 API on an account key (BOOKVAULT_API_KEY, from the portal's
 * Apps page). Stateful: a book is a *title* there, created once (a setup fee) and its files
 * replaced free after, so `register` finds a title by our SKU before it ever creates one, and
 * what it creates is recorded by the caller (the registry) at once. Cloth, foil, ribbons,
 * endpapers and sprayed edges are the Bespoke line, printed in the UK and shipped from there.
 * PRINT_MOCK=1 / BOOKVAULT_MOCK=1, or no key, answers every call here.
 */
const on = (v) => /^(1|true|yes|on)$/i.test(String(v || ''))
const SIZES = { '6x9': { id: 8, w: 152, h: 229 }, '5x8': { id: 17, w: 127, h: 203 } }
const STATUS = { CREATED: 'submitted', ACKNOWLEDGED: 'submitted', RECEIVED: 'submitted', PREPRESS: 'submitted', 'IN PRODUCTION': 'in_production', PRODUCTION: 'in_production', PRINTED: 'in_production', DISPATCHED: 'shipped', SHIPPED: 'shipped', COMPLETE: 'shipped', COMPLETED: 'shipped', CANCELLED: 'canceled', CANCELED: 'canceled', REJECTED: 'rejected', ERROR: 'failed', FAILED: 'failed' }
const CLOTHS = [{ value: 146, label: 'Buckram, black' }, { value: 147, label: 'Buckram, red' }, { value: 148, label: 'Buckram, green' }, { value: 150, label: 'Buckram, Paris blue' }, { value: 151, label: 'Acrolin, black' }, { value: 152, label: 'Acrolin, red' }, { value: 153, label: 'Acrolin, green' }, { value: 154, label: 'Acrolin, blue' }]
const RIBBONS = [{ value: 0, label: 'None' }, { value: 183, label: 'Red' }, { value: 184, label: 'Black' }, { value: 209, label: 'Blue' }, { value: 210, label: 'Green' }, { value: 211, label: 'White' }]
const ART_FOILS = [{ value: 0, label: 'None' }, { value: 206, label: 'Gold' }, { value: 207, label: 'Silver' }, { value: 215, label: 'Holographic' }, { value: 217, label: 'Green' }, { value: 225, label: 'Clear (spot UV)' }]

export function bookvault(env) {
  const configured = () => !!env('BOOKVAULT_API_KEY')
  const mock = () => on(env('PRINT_MOCK')) || on(env('BOOKVAULT_MOCK')) || !configured()
  const base = 'https://api.bookvault.app/v3'
  async function call(path, body, method = body ? 'POST' : 'GET') {
    const r = await fetch(base + path, { method, headers: { 'content-type': 'application/json', accept: 'application/json', authorization: 'basic ' + env('BOOKVAULT_API_KEY') }, body: body ? JSON.stringify(body) : undefined })
    const text = await r.text()
    if (!r.ok) throw new Error(`bookvault ${method} ${path}: ${r.status} ${text.slice(0, 300)}`)
    return text ? JSON.parse(text) : null
  }
  /* the title's specifications, in Bookvault's ids */
  const specOf = (product, pages) => ({
    Binding: { ID: product.binding }, Lamination: { ID: 2 }, SizeType: { ID: product.size.id }, FinishedHeight: product.size.h, FinishedWidth: product.size.w,
    ColourPages: 0, MonoPages: pages, Premium: false,
    Stocks: { TextStock: product.textStock, CoverStock: product.coverStock, FoilColour: product.foilColour },
    Extras: { HasJacket: !!product.jacket, FrontFoil: product.frontFoil, SpineFoil: product.spineFoil, FoilText: product.foilText || '' },
  })
  const bespokeOf = (product) => {
    const b = []
    if (product.ribbon) b.push({ OptionID: 1, ChoiceID: product.ribbon })
    if (product.artFoil) b.push({ OptionID: 2, ChoiceID: product.artFoil })
    if (product.endpapers) b.push({ OptionID: 3, ChoiceID: 1 })
    if (product.headTailBands) b.push({ OptionID: 4, ChoiceID: 1 })
    if (product.sprayedEdges) b.push({ OptionID: 5, ChoiceID: 222, Data: product.sprayedEdges })
    return b
  }
  const titleBody = (product, pages, title, sku) => ({ Title: title, SKU: sku, TitleIntent: 'Print', Classification: 'Book', Specifications: specOf(product, pages), BespokeOptions: bespokeOf(product) })

  return {
    id: 'bookvault', name: 'Bookvault', formats: ['softcover', 'hardcover', 'premium'], get makes() { return this.formats }, stateful: true,
    /* the ENVIRONMENT keys it cannot work without, by name: a deploy refuses before it starts
       rather than letting a sale fail at the till. Not to be confused with `needs`, which is the
       ARTEFACTS it needs a kind to have produced. */
    /* the ARTEFACTS it reads from whatever kind it is paired with — it sizes and costs by the page count and fetches the two files. Matched
       against a kind's `produces` when the shop is configured, never at the till. */
    needs: ['pages', 'files'],
    keys: ["BOOKVAULT_API_KEY"],
    configured, mock,
    levels: { standard: 'STANDARD', priority: 'TRACKED', express: 'EXPRESS' },
    options(format) {
      const o = [
        { key: 'textStock', label: 'Paper', type: 'select', choices: [{ value: 193, label: '80 gsm premium cream' }, { value: 158, label: '70 gsm cream' }, { value: 1, label: '80 gsm white' }], default: 193 },
      ]
      if (format === 'premium') o.push(
        { key: 'coverStock', label: 'Cloth', type: 'select', choices: CLOTHS, default: 146 },
        { key: 'foilColour', label: 'Foil', type: 'select', choices: [{ value: 0, label: 'None' }, { value: 10, label: 'Gold' }, { value: 11, label: 'Silver' }], default: 10, help: 'the title and author blocked on the cloth — included' },
        { key: 'frontFoil', label: 'Foil on the front', type: 'select', choices: [{ value: 0, label: 'None' }, { value: 1, label: 'Top' }, { value: 2, label: 'Middle' }, { value: 3, label: 'Bottom' }], default: 2 },
        { key: 'spineFoil', label: 'Foil on the spine', type: 'select', choices: [{ value: 0, label: 'None' }, { value: 4, label: 'Top' }, { value: 5, label: 'Middle' }, { value: 6, label: 'Bottom' }], default: 5 },
        { key: 'artFoil', label: 'Foil artwork', type: 'select', choices: ART_FOILS, default: 206, help: 'our own foil layer over the cloth — from £2.50 a copy' },
        { key: 'jacket', label: 'Dust jacket', type: 'toggle', default: true },
        { key: 'ribbon', label: 'Ribbon', type: 'select', choices: RIBBONS, default: 184, help: '£1 a copy' },
        { key: 'headTailBands', label: 'Head and tail bands', type: 'toggle', default: true, help: '£1 a copy' },
        { key: 'endpapers', label: 'Printed endpapers', type: 'toggle', default: false, help: 'from £1.50 a copy' },
        { key: 'sprayedEdges', label: 'Sprayed edges', type: 'text', default: '', help: 'a colour, or blank for none — from £5 a copy' },
      )
      else if (format === 'hardcover') o.push({ key: 'jacket', label: 'Dust jacket', type: 'toggle', default: true })
      return o
    },
    product({ chosen = {}, options = {} }) {
      const { format, trim = '6x9' } = chosen
      const size = SIZES[trim] || SIZES['6x9']
      const binding = format === 'premium' ? 3 : format === 'hardcover' ? 2 : 1
      const p = { format, binding, hard: binding !== 1, size, trim, textStock: Number(options.textStock || 193), coverStock: binding === 3 ? Number(options.coverStock || 146) : binding === 2 ? 8 : 5, foilColour: binding === 3 ? Number(options.foilColour ?? 10) : 0, frontFoil: binding === 3 ? Number(options.frontFoil ?? 2) : 0, spineFoil: binding === 3 ? Number(options.spineFoil ?? 5) : 0, jacket: binding !== 1 && options.jacket !== false, artFoil: binding === 3 ? Number(options.artFoil ?? 206) : 0, ribbon: binding === 3 ? Number(options.ribbon ?? 184) : 0, headTailBands: binding === 3 && options.headTailBands !== false, endpapers: binding === 3 && !!options.endpapers, sprayedEdges: binding === 3 ? String(options.sprayedEdges || '') : '', minPages: binding === 1 ? 32 : 24, ukOnly: binding === 3 }
      return p
    },
    /* the sheet from the title calculator: its expected cover size and spine, in millimetres */
    async measure({ product, artefacts = {} }) {
      const { pages } = artefacts
      const t = product.size, mm = 72 / 25.4, bleed = 3 * mm
      let spine = pages * 0.06 * mm + (product.hard ? 6 * mm : 0), wrap = product.hard ? 15 * mm : 0
      if (!mock()) { try { const r = await call('/CalculateTitle', titleBody(product, pages, 'quote', 'quote')); if (r?.Specifications?.Spine) spine = Number(r.Specifications.Spine) * mm; if (r?.Specifications?.CoverSizing?.RequiredBleed) { /* the bleed as they size it */ } } catch (e) { /* the estimate stands */ } }
      const flap = product.jacket ? 90 * mm : 0
      return { width: t.w * mm * 2 + spine + 2 * (bleed + wrap) + 2 * flap, height: t.h * mm + 2 * (bleed + wrap), spine, bleed: bleed + wrap, flap, unit: 'pt', mock: mock() }
    },
    async quote({ product, artefacts = {}, quantity = 1, country = 'US' }) {
      const { pages } = artefacts
      if (mock()) return { print: (product.binding === 3 ? 7.5 : product.hard ? 5.5 : 2) + pages * 0.015, shipping: country === 'GB' ? 3.5 : 12, currency: 'GBP', days: product.ukOnly ? 10 : 6, mock: true, from: 'GB' }
      const r = await call('/CalculateTitle', titleBody(product, pages, 'quote', 'quote'))
      const rows = (r?.Pricing || []).filter((p) => p.Price > 0)
      const local = rows.find((p) => (country === 'GB' ? /UK/ : country === 'CA' ? /CA/ : country === 'AU' ? /AU/ : /US/).test(p.Partner?.Name || '')) || rows.find((p) => /UK/.test(p.Partner?.Name || ''))
      if (!local) throw new Error('bookvault: no plant makes this')
      return { print: Number(local.Price), shipping: 0, currency: local.Partner?.Currency || 'GBP', days: /UK/.test(local.Partner?.Name) && country !== 'GB' ? 12 : 6, from: /UK/.test(local.Partner?.Name) ? 'GB' : country }
    },
    async validate({ artefacts = {} }) { return { ok: true, pages: artefacts.pages, deferred: true } },   /* their pre-press validates the title once made */
    /* a title, found by our SKU or made — the fee paid through the API — and its files set by url */
    async register({ product, artefacts = {}, title, sku, existing }) {
      const { pages, files } = artefacts
      if (mock()) return { ref: existing?.ref || ('bv_mock_' + sku), paid: true, validated: true, mock: true }
      let ref = existing?.ref && !/^bv_mock_/.test(String(existing.ref)) ? existing.ref : null
      if (!ref) {
        const found = await call('/Titles', { SKU: sku })
        const hit = (found?.Products || found?.Titles || (Array.isArray(found) ? found : [])).find((t) => t.SKU === sku)
        if (hit) ref = hit.LibID
      }
      const body = titleBody(product, pages, title, sku)
      const upload = (type, url) => ({ DropType: type, DropMethod: 'URL', DownloadUrl: url, FileName: `${sku}-${type.toLowerCase()}.pdf` })
      const drops = [upload('Text', files.interior), upload('Cover', files.cover)]
      if (product.jacket && files.jacket) drops.push(upload('Jacket', files.jacket))
      if (product.artFoil && files.foil) drops.push(upload('CoverFoil', files.foil))
      if (!ref) {
        const made = await call('/Title', body)
        ref = made?.LibID
        if (!ref) throw new Error('bookvault: the title was not made — ' + JSON.stringify(made?.Messages || made).slice(0, 300))
        await call(`/Title?LibID=${ref}&UpdateType=PayTitle`, body, 'PUT')
      } else {
        await call(`/Title?LibID=${ref}&UpdateType=Full`, { ...body, LibID: ref }, 'PUT')
      }
      for (const d of drops) await call('/FileDrop', { ...d, LibID: ref })
      const t = await call(`/Title?LibID=${ref}`)
      return { ref, paid: true, validated: !!t?.Validated, isbn: t?.ISBN || null }
    },
    async order({ ref, quantity = 1, address = {}, email, level = 'standard', externalId }) {
      if (mock()) { const id = 'bv_mock_' + Date.now(); return { id, status: 'CREATED', cost: { print: 7.5 * quantity, shipping: 12, currency: 'GBP', mock: true } } }
      const o = await call('/Order?payMethod=Saved', {
        DocRef: externalId, Notifications: { NotifyCustomer: true },
        Address: { Name: address.name || '', Line1: address.line1 || '', Line2: address.line2 || '', Town: address.city || '', County: address.state || '', Postcode: address.postal_code || '', Country: address.country || 'US', Phone: address.phone || '', Email: email || '' },
        DispatchRequest: { Service: this.levels[level] || 'STANDARD' },
        OrderLines: [{ LineNumber: 1, Title: { LibID: ref }, Quantity: quantity }],
      })
      if (o?.CriticalError) throw new Error('bookvault order: ' + JSON.stringify(o.Messages || []).slice(0, 300))
      return { id: String(o.PodRef), status: String(o.Status || 'CREATED'), cost: o.OrderCost ? { print: Number(o.OrderCost.Production ?? o.OrderCost.Total ?? 0), shipping: Number(o.OrderCost.Dispatch ?? 0), currency: 'GBP' } : null }
    },
    async status(id) {
      if (mock() || id.startsWith('bv_mock_')) { const age = Date.now() - Number(id.split('_')[2] || 0); const s = age < 20_000 ? 'CREATED' : age < 60_000 ? 'PRODUCTION' : 'DISPATCHED'; return { id, status: s, tracking: s === 'DISPATCHED' ? { carrier: 'MOCK', id: 'MOCK' + id.slice(-6), url: null } : null, cost: null } }
      const o = await call(`/Order?PodRef=${id}`)
      const t = o?.Tracking
      return { id, status: String(o?.Status || ''), tracking: t && (t.TrackingNumber || t.Number) ? { carrier: t.Carrier || null, id: t.TrackingNumber || t.Number, url: t.URL || t.Url || null } : null, cost: null }
    },
    statusOf: (word) => STATUS[String(word || '').toUpperCase()] ?? null,
    webhook: () => null,   /* none: open orders are refreshed by the admin and print-order */
    async ensureWebhook() { return null },
    call,
  }
}
