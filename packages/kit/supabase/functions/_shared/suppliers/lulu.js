/*
 * Lulu, as a printer (see index.js for the shape every printer has). Plain JavaScript on
 * fetch alone, so the build (node) and the functions (Deno) run this one file: the token,
 * the product codes, the cover dimensions, a quote, validation, the print job, its status,
 * the webhook. `env(k)` reads the keys: LULU_CLIENT_KEY + LULU_CLIENT_SECRET (Lulu →
 * Developer → API keys), LULU_SANDBOX=1 for the sandbox (no charge, nothing printed); with
 * neither key, or LULU_MOCK=1 / PRINT_MOCK=1, every call is answered here — dimensions from
 * the paper's thickness, a job whose status walks CREATED → IN_PRODUCTION → SHIPPED as it is
 * read — so the whole chain runs with no account.
 */
const on = (v) => /^(1|true|yes|on)$/i.test(String(v || ''))
const TRIM_PT = { '6x9': { w: 432, h: 648 }, '5x8': { w: 360, h: 576 } }
/* the jacket's flap and its bleed; a casewrap's wrap round the board (bleed included); a paperback's bleed */
const FLAP = 3.5 * 72, JACKET_BLEED = 0.375 * 72, WRAP = 0.875 * 72, PB_BLEED = 0.125 * 72
const CODES = { trim: { '6x9': '0600X0900', '5x8': '0500X0800' }, paper: { cream: '060UC444', white: '060UW444' }, cloth: { navy: 'N', gray: 'G', red: 'R', black: 'B', tan: 'T', forest: 'F' }, foil: { gold: 'G', black: 'B', white: 'W' } }
const STATUS = { CREATED: 'submitted', UNPAID: 'submitted', PAYMENT_IN_PROGRESS: 'submitted', PRODUCTION_DELAYED: 'in_production', PRODUCTION_READY: 'in_production', IN_PRODUCTION: 'in_production', SHIPPED: 'shipped', REJECTED: 'rejected', CANCELED: 'canceled', ERROR: 'failed' }
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

export function lulu(env) {
  const configured = () => !!(env('LULU_CLIENT_KEY') && env('LULU_CLIENT_SECRET'))
  const mock = () => on(env('PRINT_MOCK')) || on(env('LULU_MOCK')) || !configured()
  const base = () => (on(env('LULU_SANDBOX')) ? 'https://api.sandbox.lulu.com' : 'https://api.lulu.com')
  let token = null
  async function auth() {
    if (token && token.until > Date.now()) return token.value
    const r = await fetch(base() + '/auth/realms/glasstree/protocol/openid-connect/token', {
      method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded', authorization: 'Basic ' + btoa(env('LULU_CLIENT_KEY') + ':' + env('LULU_CLIENT_SECRET')) },
      body: 'grant_type=client_credentials',
    })
    if (!r.ok) throw new Error('lulu auth: ' + r.status + ' ' + (await r.text()).slice(0, 200))
    const j = await r.json()
    token = { value: j.access_token, until: Date.now() + (j.expires_in - 60) * 1000 }
    return token.value
  }
  async function call(path, body, method = 'POST') {
    const r = await fetch(base() + path, { method, headers: { 'content-type': 'application/json', authorization: 'Bearer ' + (await auth()) }, body: body ? JSON.stringify(body) : undefined })
    const text = await r.text()
    if (!r.ok) throw new Error(`lulu ${method} ${path}: ${r.status} ${text.slice(0, 300)}`)
    return text ? JSON.parse(text) : null
  }
  const costOf = (c) => {
    if (!c || !c.line_item_costs) return null
    const li = Array.isArray(c.line_item_costs) ? c.line_item_costs[0] : c.line_item_costs
    return { print: Number(li?.total_cost_incl_tax ?? li?.cost_excl_discounts ?? 0), shipping: Number(c.shipping_cost?.total_cost_incl_tax ?? 0), currency: c.currency || 'USD' }
  }
  const mockStatus = (id) => { const age = Date.now() - Number(id.split('_')[2] || 0); return age < 20_000 ? 'CREATED' : age < 60_000 ? 'IN_PRODUCTION' : 'SHIPPED' }

  return {
    id: 'lulu', name: 'Lulu', formats: ['softcover', 'hardcover'], get makes() { return this.formats }, stateful: false,
    /* the ENVIRONMENT keys it cannot work without, by name: a deploy refuses before it starts
       rather than letting a sale fail at the till. Not to be confused with `needs`, which is the
       ARTEFACTS it needs a kind to have produced. */
    /* the ARTEFACTS it reads from whatever kind it is paired with — it sizes and costs by the page count and fetches the two files. Matched
       against a kind's `produces` when the shop is configured, never at the till. */
    needs: ['pages', 'files'],
    keys: ["LULU_CLIENT_KEY","LULU_CLIENT_SECRET"],
    configured, mock,
    levels: { standard: 'MAIL', priority: 'PRIORITY_MAIL', express: 'EXPRESS' },
    /* what the admin may set, per format: a hardcover's style; the code itself when not the rule's */
    options(format) {
      const o = [{ key: 'package', label: 'Product code', type: 'text', help: "the printer's pod_package_id, when not the one the rule makes", applies: ['softcover', 'hardcover'] }]
      if (format === 'hardcover') o.unshift({ key: 'style', label: 'Hardcover', type: 'select', choices: [{ value: 'linen', label: 'Linen wrap, foil-stamped spine, dust jacket' }, { value: 'casewrap', label: 'Printed case (casewrap)' }], default: 'linen' })
      return o
    },
    /* the product: Lulu's dotted code for the trim × binding × paper (× a linen's cloth and foil) */
    product({ chosen = {}, options = {} }) {
      const { format, trim = '6x9', paper = 'cream', cloth = 'black', foil = 'gold' } = chosen
      const t = CODES.trim[trim] || CODES.trim['6x9'], p = CODES.paper[paper] || CODES.paper.cream
      const style = format === 'hardcover' ? (options.style === 'casewrap' ? 'casewrap' : 'linen') : 'softcover'
      const pod = options.package || (style === 'softcover' ? `${t}.BW.STD.PB.${p}.MXX` : style === 'casewrap' ? `${t}.BW.STD.CW.${p}.MXX` : `${t}.BW.STD.LW.${p}.M${CODES.cloth[cloth] || 'B'}${CODES.foil[foil] || 'G'}`)
      return { pod, style, jacket: /\.LW\./.test(pod), paperback: /\.PB\./.test(pod), trim, cloth: style === 'linen' ? cloth : null, foil: style === 'linen' ? foil : null, minPages: /\.PB\./.test(pod) ? 32 : 24 }
    },
    /* the cover's size in points for a product and a page count: a casewrap's sheet (the wrap
       round the boards as `bleed`), a jacket's with its two flaps, a paperback's */
    async measure({ product, artefacts = {} }) {
      const { pages } = artefacts
      const t = TRIM_PT[product.trim] || TRIM_PT['6x9'], jacket = product.jacket
      if (mock()) {
        const spine = Math.round(pages * 0.00274 * 72 + 0.117 * 72)
        const bleed = jacket ? JACKET_BLEED : product.paperback ? PB_BLEED : WRAP, flap = jacket ? FLAP : 0
        return { width: t.w * 2 + spine + bleed * 2 + flap * 2, height: t.h + bleed * 2, spine, bleed, flap, unit: 'pt', mock: true }
      }
      const d = await call('/cover-dimensions/', { pod_package_id: product.pod, interior_page_count: pages, unit: 'pt' })
      const width = Number(d.width), height = Number(d.height), bleed = (height - t.h) / 2, flap = jacket ? FLAP : 0
      return { width, height, spine: width - 2 * t.w - 2 * bleed - 2 * flap, bleed, flap, unit: 'pt' }
    },
    /* what a copy costs to print and to ship to a country, before our price */
    async quote({ product, artefacts = {}, quantity = 1, country = 'US', level = 'standard' }) {
      const { pages } = artefacts
      if (mock()) return { print: (product.paperback ? 3.5 : 12.5) + pages * 0.012, shipping: country === 'US' ? 5.99 : 14.99, currency: 'USD', days: 7, mock: true }
      const r = await call('/print-job-cost-calculations/', {
        line_items: [{ page_count: pages, pod_package_id: product.pod, quantity }],
        shipping_address: country === 'US' ? { country_code: 'US', city: 'Washington', state_code: 'DC', postcode: '20540', street1: '101 Independence Ave SE', phone_number: '+1 206 555 0100' }
          : { country_code: country, city: 'x', postcode: '00000', street1: 'x', phone_number: '0000000000' },
        shipping_option: this.levels[level] || level || 'MAIL',
      })
      const li = r.line_item_costs?.[0]
      return { print: Number(li?.total_cost_incl_tax ?? li?.cost_excl_discounts ?? 0) / quantity, shipping: Number(r.shipping_cost?.total_cost_incl_tax ?? 0), currency: r.currency || 'USD', days: 7 }
    },
    /* the printer normalises the files and says whether they print, and how many pages it sees */
    async validate({ product, artefacts = {} }) {
      const { pages, files } = artefacts
      if (mock()) return { ok: true, pages, mock: true }
      const poll = async (kind, id) => {
        for (let i = 0; i < 60; i++) {
          const s = await call(`/${kind}/${id}/`, null, 'GET')
          if (s.status === 'NORMALIZED' || s.status === 'VALIDATED') return { ok: true, pages: s.page_count }
          if (s.status === 'ERROR') return { ok: false, errors: s.errors }
          await sleep(3000)
        }
        return { ok: false, errors: ['validation timed out'] }
      }
      const i = await poll('validate-interior', (await call('/validate-interior/', { source_url: files.interior, pod_package_id: product.pod })).id)
      if (!i.ok) return i
      const c = await poll('validate-cover', (await call('/validate-cover/', { source_url: files.cover, pod_package_id: product.pod, interior_page_count: i.pages || pages })).id)
      return c.ok ? { ok: true, pages: i.pages || pages } : c
    },
    /* the job: one line, the edition's files by url, the address as Stripe gave it */
    async order({ product, artefacts = {}, title, quantity = 1, address = {}, email, level = 'standard', externalId, foilStamp }) {
      const { files } = artefacts
      if (mock()) { const id = 'job_mock_' + Date.now(); return { id, status: 'CREATED', cost: { print: 12.5 * quantity, shipping: (address.country || 'US') === 'US' ? 5.99 : 14.99, currency: 'USD', mock: true } } }
      const contact = email || env('SMTP_FROM') || 'orders@example.com'
      const job = await call('/print-jobs/', {
        external_id: externalId, contact_email: contact, shipping_level: this.levels[level] || level || 'MAIL',
        shipping_address: { name: address.name || '', street1: address.line1 || '', street2: address.line2 || undefined, city: address.city || '', state_code: address.state || undefined, postcode: address.postal_code || '', country_code: address.country || 'US', phone_number: address.phone || '0000000000', email: contact },
        line_items: [{ external_id: externalId, title, quantity, printable_normalization: { pod_package_id: product.pod, interior: { source_url: files.interior }, cover: { source_url: files.cover },
          /* a linen wrap: the title and author stamped in foil on the spine — inside the normalization, the API insists */
          ...(product.jacket && foilStamp ? { foil_stamp_title_text: foilStamp.title, ...(foilStamp.author ? { foil_stamp_author_text: foilStamp.author } : {}) } : {}) } }],
      })
      return { id: String(job.id), status: String(job.status?.name ?? 'CREATED'), cost: costOf(job.costs) }
    },
    async status(id) {
      if (mock() || id.startsWith('job_mock_')) { const s = mockStatus(id); return { id, status: s, tracking: s === 'SHIPPED' ? { carrier: 'MOCK', id: 'MOCK' + id.slice(-6), url: null } : null, cost: null } }
      const job = await call(`/print-jobs/${id}/`, null, 'GET')
      const li = job.line_items?.[0]
      return { id, status: String(job.status?.name ?? ''), tracking: li?.tracking_id ? { carrier: li.carrier_name || null, id: li.tracking_id, url: li.tracking_urls?.[0] ?? null } : null, cost: costOf(job.costs) }
    },
    statusOf: (word) => STATUS[word] ?? null,
    /* Lulu POSTs { topic: 'PRINT_JOB_STATUS_CHANGED', data: { id, … } } */
    webhook: (body) => String(body?.data?.id ?? body?.data?.print_job_id ?? '') || null,
    async ensureWebhook(url) {
      if (mock()) return null
      const list = await call('/webhooks/', null, 'GET'), rows = Array.isArray(list) ? list : list?.results ?? []
      const mine = rows.find((w) => w.url === url)
      if (!mine) return call('/webhooks/', { topics: ['PRINT_JOB_STATUS_CHANGED'], url })
      if (mine.is_active === false) await call(`/webhooks/${mine.id}/`, { is_active: true }, 'PATCH')
      return mine
    },
    call,
  }
}
