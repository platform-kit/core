<script setup>
/*
 * Print editions: every book in print, edited as what it is. The list shows each book with
 * the state of its editions — what is on sale at what price, or why not — and opens into
 * the editor: the block's fields in four panels (what is printed and how it is bound; the
 * formats sold and their prices; the jacket's copy; the note before the text), and beside
 * them the book itself — the interior of each contents rendered from the draft as a flipbook
 * you can turn, and each cover flat. Every save writes the block to the book's markdown and
 * renders the files again from it (a second or two per edition), so the preview is always the
 * file as it is. "Set the editions" does the real thing: the renders go to the bucket, the
 * printer quotes each binding, print.json and the catalog carry them, and the book is on sale.
 * Everything here goes through the content pipe's print model (build/models/core/print.mjs, build/print/block.mjs).
 */
import { ref, computed, reactive, watch, watchEffect, onMounted, onBeforeUnmount, nextTick } from 'vue'
import { PageFlip } from 'page-flip'
import { AgGridVue } from 'ag-grid-vue3'
import { ModuleRegistry, AllCommunityModule } from 'ag-grid-community'
import { useAgGridTheme } from '../../lib/agGridTheme.js'
ModuleRegistry.registerModules([AllCommunityModule])
import { openPdf, shotsOf, coverArtOf } from './pdf-pages.js'
import { printSpec, formatPrice, spineWords, PRICE_STEP, FORMATS, PRINTED, FILES, CONTENTS, PRINTERS, costUsd, proofState } from 'platformkit/lib/print-offers.js'
import { us } from 'platformkit/lib/content.js'
import { CLOUD } from 'platformkit/lib/router.js'
import { supabase, configured as supabaseOn } from 'platformkit/lib/supabase.js'
import { isSignedIn } from 'platformkit/lib/auth.js'
import './admin-ui.css'

const props = defineProps({ book: { type: String, default: '' } })
const emit = defineEmits(['open', 'back'])

import pipe from '../../lib/admin/api.js'
const post = ({ action, ...payload }) => pipe.action('print', action, payload)

const books = ref([])
const choices = ref({})
const printers = ref({})   /* who prints: name, formats, keys present, options per format */
const loading = ref(true)
const err = ref('')
async function load() {
  loading.value = true; err.value = ''
  try { const j = await pipe.list('print'); books.value = j.books; choices.value = j.choices; printers.value = j.printers || {} } catch (e) { err.value = e.message }
  finally { loading.value = false }
}
onMounted(load)

/* ---- the list ---- */
/* the listing's own words (the theme's orders scope, group `listing`) */
const L = () => ((us('orders').editions || {}).listing || {})
const SPINE_EDITION = () => ((us('library').print || {}).book || {})['spine-edition'] || 'the site edition'
const money = (n) => '$' + Number(n).toFixed(n % 1 ? 2 : 0)
const FORMAT_NAMES = { softcover: 'Paperback', hardcover: 'Hardcover', premium: 'Cloth edition', pdf: 'PDF', epub: 'EPUB' }
const PRINTER_NAMES = { lulu: 'Lulu', mixam: 'Mixam', bookvault: 'Bookvault', auto: 'Cheapest available' }
/* a printer's quote in the store's dollars, said with its own currency beside when it is not ours */
const cost = (x) => (x && typeof x.cost === 'number' ? (x.currency && x.currency !== 'USD' ? `${x.currency === 'GBP' ? '£' : x.currency + ' '}${x.cost.toFixed(2)} ≈ ` : '') + money(costUsd(x)) : '—')
const CONTENTS_NAMES = { parts: 'Two parts', both: 'Text + companion', full: 'Text alone', summary: 'the site Edition alone' }
/* the formats a block sells, each with what it sells for (null while a markup has no quote) */
const priced = (b) => { const spec = printSpec(b.print); return spec ? FORMATS.filter((f) => spec.formats[f]).map((f) => ({ format: f, price: formatPrice(spec, f, b.edition), markup: spec.formats[f].markup })) : [] }
const state = (b) => {
  const spec = printSpec(b.print)
  if (!spec) return { kind: 'off', label: 'Not in print' }
  if (!spec.rights) return { kind: 'warn', label: 'Not on sale — no rights line' }
  const on = priced(b).filter((p) => p.price)
  if (!on.length) return { kind: 'warn', label: 'Not on sale — no edition quoted' }
  /* on sale either way; the proof is a note beside it */
  const st = spec.contents.map((c) => proofState(spec, b.edition, c))
  const proof = st.every((s) => s === 'proofed') ? ' · proofed' : st.some((s) => s === 'stale') ? ' · changed since its proof' : ' · not proofed'
  return { kind: 'ok', label: 'On sale · ' + on.map((p) => (FORMAT_NAMES[p.format] || p.format) + ' ' + money(p.price)).join(' · ') + proof }
}
const onSale = computed(() => books.value.filter((b) => state(b).kind === 'ok').length)
const pagesOf = (b, contents) => { const e = b.edition && b.edition.editions && b.edition.editions[contents]; if (e) return e.pages; const d = b.draft && b.draft.editions && b.draft.editions[contents]; return d ? d.pages : null }

/* the index: the same grid every collection has, one row per book */
const theme = useAgGridTheme()
const defaultColDef = { sortable: true, filter: true, resizable: true, floatingFilter: true }
const cap = (v) => (v ? String(v)[0].toUpperCase() + String(v).slice(1) : '—')
const columnDefs = [
  { headerName: 'Book', field: 'title', pinned: 'left', flex: 1.6, minWidth: 260, cellRenderer: (q) => `<span class="pr-gtitle">${q.value}</span><span class="pr-gauthor">${q.data.author || ''}</span>` },
  { headerName: 'Sale', flex: 2, minWidth: 260, valueGetter: (q) => state(q.data).label, cellRenderer: (q) => `<span class="pr-gstate pr-${state(q.data).kind}">${q.value}</span>` },
  { headerName: 'Contents', width: 170, valueGetter: (q) => { const s = printSpec(q.data.print); return s ? s.contents.map((c) => CONTENTS_NAMES[c] || c).join(', ') : '—' } },
  { headerName: 'Formats', width: 200, valueGetter: (q) => { const s = printSpec(q.data.print); return s ? FORMATS.filter((f) => s.formats[f]).map((f) => FORMAT_NAMES[f] || f).join(', ') : '—' } },
  { headerName: 'Cloth', width: 100, valueGetter: (q) => { const s = printSpec(q.data.print); return s ? (s.formats.hardcover && s.formats.hardcover.cloth.length > 1 ? 'Choice' : cap(s.cloth)) : '—' }, cellRenderer: (q) => { const s = printSpec(q.data.print); return s ? `<i class="pr-gsw" style="background:${clothHex[s.cloth]}"></i>${q.value}` : '—' } },
  { headerName: 'Foil', width: 92, valueGetter: (q) => { const s = printSpec(q.data.print); return s ? (s.formats.hardcover && s.formats.hardcover.foil.length > 1 ? 'Choice' : cap(s.foil)) : '—' }, cellRenderer: (q) => { const s = printSpec(q.data.print); return s ? `<i class="pr-gsw" style="background:${foilHex[s.foil]}"></i>${q.value}` : '—' } },
  { headerName: 'Pages', width: 110, type: 'numericColumn', valueGetter: (q) => { const s = printSpec(q.data.print); return s ? pagesOf(q.data, s.contents[0]) : null }, valueFormatter: (q) => (q.value == null ? '—' : q.value + (q.data.edition ? '' : ' draft')) },
  { headerName: 'To print', width: 130, type: 'numericColumn', valueGetter: (q) => { const s = printSpec(q.data.print); const e = s && q.data.edition && q.data.edition.editions && q.data.edition.editions[s.contents[0]]; const f = e && e.printers && (PRINTED.includes(s.main) && e.printers[s.main] ? s.main : PRINTED.find((x) => e.printers[x])); return f ? costUsd(e.printers[f]) : null }, valueFormatter: (q) => (q.value == null ? '—' : money(q.value)) },
  { headerName: 'Printers', width: 200, valueGetter: (q) => { const s = printSpec(q.data.print); return s ? PRINTED.filter((f) => s.formats[f]).map((f) => `${FORMAT_NAMES[f]}: ${PRINTER_NAMES[s.printers[f]] || s.printers[f]}`).join(' · ') : '—' } },
  { headerName: 'Prices', width: 150, valueGetter: (q) => priced(q.data).map((p) => (p.price ? money(p.price) : p.markup != null ? '$' + p.markup + ' over' : '—')).join(' · ') || '—' },
]
const getRowId = (q) => q.data.slug

/* ---- the editor ---- */
const cur = computed(() => books.value.find((b) => b.slug === props.book) || null)
const form = reactive({ pr: null })
const saved = ref('')
const dirty = computed(() => JSON.stringify(form.pr) !== saved.value)
const PANELS = [['edition', 'Edition'], ['sale', 'Formats & prices'], ['printers', 'Printers'], ['jacket', 'Jacket'], ['note', 'Note'], ['proofs', 'Proofs']]
const panel = ref('edition')
const issues = ref({})
const saving = ref(false), setting = ref(false), msg = ref('')

/* the form's shape: the spec, with every format present (on or off) so the rows are stable */
const DEFAULT_FORMAT = { softcover: { markup: 8 }, hardcover: { markup: 15 }, premium: { markup: 25 }, pdf: { price: 8 }, epub: { price: 8 } }
function formOf(pr) {
  const spec = printSpec(pr || {})
  const formats = {}
  for (const f of FORMATS) {
    const rec = spec.formats[f]
    formats[f] = { on: !!rec, price: rec && rec.price != null ? rec.price : null, markup: rec && rec.markup != null ? rec.markup : (rec ? null : DEFAULT_FORMAT[f].markup ?? null), by: rec ? (rec.price != null ? 'price' : 'markup') : (DEFAULT_FORMAT[f].price != null ? 'price' : 'markup'), cloth: rec && rec.cloth ? [...rec.cloth] : [spec.cloth], foil: rec && rec.foil ? [...rec.foil] : [spec.foil] }
    if (!rec && DEFAULT_FORMAT[f].price != null) formats[f].price = DEFAULT_FORMAT[f].price
  }
  const prs = {}; for (const f of PRINTED) prs[f] = spec.printers[f] || (f === 'premium' ? 'bookvault' : 'auto')
  const providers = {}; for (const id of PRINTERS) providers[id] = { ...(spec.providers[id] || {}) }
  return { on: !!pr, key: spec.key, ebook: spec.ebook, main: spec.main, contents: [...spec.contents], formats, printers: prs, providers, includes: [...spec.includes], cloth: spec.cloth, foil: spec.foil, trim: spec.trim, paper: spec.paper, spine: spec.spine, blurb: spec.blurb, flap: spec.flap, note: spec.note, rights: spec.rights, proofed: { ...spec.proofed } }
}
/* the block to write, from the form */
function blockOf(f) {
  const formats = {}
  for (const k of FORMATS) { const r = f.formats[k]; if (!r.on) continue; const o = r.by === 'price' ? { price: Number(r.price) } : { markup: Number(r.markup) }; if (k === 'hardcover') { o.cloth = r.cloth; o.foil = r.foil } formats[k] = o }
  const printers = {}; for (const k of PRINTED) if (f.formats[k].on) printers[k] = f.printers[k] || 'auto'
  const providers = {}; for (const id of PRINTERS) { const o = {}; for (const [k, v] of Object.entries(f.providers[id] || {})) if (v !== '' && v != null) o[k] = v; if (Object.keys(o).length) providers[id] = o }
  return { key: f.key || undefined, ebook: f.ebook, main: f.main, contents: f.contents, formats, printers, providers, includes: f.includes, cloth: f.cloth, foil: f.foil, trim: f.trim, paper: f.paper, spine: f.spine, blurb: f.blurb, flap: f.flap, note: f.note, rights: f.rights, proofed: f.proofed }
}

/* ---- the proofs: which edition a printed copy was read and passed at — a record, never a gate ----
   Per contents: the set edition (print.json) against the block's proofed id — proofed, changed since
   (a new edition), or never. "Order a proof" sends one copy to the admin's own address through the
   print-order function (a print order flagged proof, never a purchase); "Mark proofed" writes the
   edition's id on the block. The book is on sale either way. */
const PROOF_WORDS = { proofed: 'Proofed', stale: 'Changed since its proof', never: 'Never proofed', unset: 'No edition set' }
const proofs = computed(() => { const b = cur.value; if (!b || !form.pr) return []; const spec = printSpec(b.print); return spec ? form.pr.contents.map((c) => { const e = b.edition && b.edition.editions && b.edition.editions[c]; return { contents: c, edition: e ? e.edition : '', pages: e ? e.pages : 0, state: proofState(spec, b.edition, c), was: spec.proofed[c] || '' } }) : [] })
const ADDR_KEY = 'dl.admin.proof-address'
const proofForm = reactive({ contents: '', format: 'softcover', cloth: '', foil: '', level: 'standard', address: { name: '', line1: '', line2: '', city: '', state: '', postal_code: '', country: 'US', phone: '' } })
try { Object.assign(proofForm.address, JSON.parse(localStorage.getItem(ADDR_KEY) || '{}')) } catch (e) { /* none kept */ }
const proofing = ref(''), proofMsg = ref('')
const proofFormats = computed(() => (form.pr ? PRINTED.filter((f) => form.pr.formats[f].on) : []))
function orderProof(p) { proofForm.contents = p.contents; if (!proofFormats.value.includes(proofForm.format)) proofForm.format = proofFormats.value[0] || 'softcover'; proofMsg.value = '' }
async function sendProof() {
  if (!cur.value || !proofForm.contents) return
  if (!supabaseOn || !isSignedIn.value) { proofMsg.value = 'Sign in as an admin to order a proof'; return }
  proofing.value = proofForm.contents; proofMsg.value = ''
  try {
    try { localStorage.setItem(ADDR_KEY, JSON.stringify(proofForm.address)) } catch (e) { /* not kept */ }
    const hc = proofForm.format === 'hardcover' ? { cloth: proofForm.cloth || form.pr.formats.hardcover.cloth[0], foil: proofForm.foil || form.pr.formats.hardcover.foil[0] } : {}
    const { data, error } = await supabase.functions.invoke('print-order', { body: { action: 'proof', book: cur.value.slug, contents: proofForm.contents, format: proofForm.format, ...hc, level: proofForm.level, address: proofForm.address } })
    if (error) throw error
    if (data && data.error) throw new Error(data.error)
    proofMsg.value = data && data.ok ? `Proof ordered — ${FORMAT_NAMES[proofForm.format] || proofForm.format}, one copy, with ${PRINTER_NAMES[data.order.supplier] || data.order.supplier} (job ${data.order.supplier_job || '…'}). Follow it under Sales → Print orders.` : `Recorded but not sent: ${(data && data.order && data.order.error) || 'the printer refused it'} — retry from Sales → Print orders`
    proofForm.contents = ''
  } catch (e) { proofMsg.value = (e && e.message) || 'The proof could not be ordered' }
  finally { proofing.value = '' }
}
async function markProofed(p) {
  if (!cur.value || dirty.value) return
  if (!confirm(`Mark the ${CONTENTS_NAMES[p.contents] || p.contents} edition ${p.edition.slice(0, 8)} of “${cur.value.title}” proofed?\n\nOnly once a printed copy of THIS edition has been read through.`)) return
  proofing.value = p.contents; proofMsg.value = ''
  try { const j = await post({ action: 'proofed', book: cur.value.slug, contents: p.contents }); Object.assign(cur.value, j.book); form.pr = formOf(j.book.print); saved.value = JSON.stringify(form.pr); proofMsg.value = 'Marked proofed' }
  catch (e) { proofMsg.value = e.message }
  finally { proofing.value = '' }
}
function begin() {
  const b = cur.value; if (!b) return
  form.pr = formOf(b.print)
  saved.value = JSON.stringify(form.pr); issues.value = {}; msg.value = ''
  loadPreview()
}
watch(cur, (b, was) => { if (b && (!was || b.slug !== was.slug)) begin() }, { immediate: true })
watch(() => cur.value && cur.value.slug, () => { panel.value = 'edition' })

/* a list toggled: contents kept in the canon's order, at least one; a linen's cloths and foils the same */
function toggle(list, v, all, min = 1) { const i = list.indexOf(v); if (i >= 0) { if (list.length > min) list.splice(i, 1) } else { list.push(v); list.sort((a, b) => all.indexOf(a) - all.indexOf(b)) } }
const sells = (k) => {
  if (!form.pr || !cur.value) return ''
  const r = form.pr.formats[k]; if (!r.on) return ''
  const price = formatPrice(printSpec(blockOf(form.pr)), k, cur.value.edition)
  if (r.by === 'price') return price ? `Sells for ${money(price)}` : ''
  if (FILES.includes(k)) return price ? `Sells for ${money(price)}` : ''
  const costs = form.pr.contents.map((c) => { const e = cur.value.edition && cur.value.edition.editions && cur.value.edition.editions[c]; return e && e.printers && e.printers[k] ? costUsd(e.printers[k]) : null })
  if (costs.some((c) => c == null)) return 'No quote yet for every contents — set the editions and the printers price them'
  const who = [...new Set(form.pr.contents.map((c) => cur.value.edition.editions[c].printers[k].provider))].map((p) => PRINTER_NAMES[p] || p).join(' / ')
  return `Sells for ${money(price)} — ${who}'s ${money(Math.max(...costs))} to print the costliest contents plus the markup, rounded up to the next $${PRICE_STEP}; shipping is charged where it goes`
}
const spine = computed(() => (cur.value && form.pr ? spineWords(cur.value.title, form.pr.spine, SPINE_EDITION()) : null))

/* ---- the Printers tab: who makes each format, each printer's options, and a live quote ----
   every printed format that is on is quoted at the printer named for it (or at every one that
   could make it, for auto), for the draft's page count, as the options change */
const printedOn = computed(() => (form.pr ? PRINTED.filter((f) => form.pr.formats[f].on) : []))
const makers = (f) => Object.values(printers.value).filter((p) => p.formats.includes(f))
/* the printers whose options are shown: every one named for a format, and every one auto might pick */
const shownProviders = computed(() => { const ids = new Set(); for (const f of printedOn.value) { const id = form.pr.printers[f]; if (id && id !== 'auto') ids.add(id); else for (const p of makers(f)) if (p.configured || !Object.values(printers.value).some((x) => x.configured)) ids.add(p.id) } return [...ids] })
const optionsFor = (id) => { const p = printers.value[id]; if (!p) return []; const seen = new Map(); for (const f of printedOn.value) if (p.formats.includes(f) && (form.pr.printers[f] === id || form.pr.printers[f] === 'auto')) for (const o of p.options[f] || []) if (!seen.has(o.key)) seen.set(o.key, o); return [...seen.values()] }
const optionValue = (id, o) => { const v = form.pr.providers[id] && form.pr.providers[id][o.key]; return v == null || v === '' ? o.default : v }
const setOption = (id, o, v) => { if (!form.pr.providers[id]) form.pr.providers[id] = {}; form.pr.providers[id][o.key] = o.type === 'toggle' ? !!v : o.type === 'select' && typeof o.choices[0].value === 'number' ? Number(v) : v; quoteAll() }
const quotes = reactive({})   /* `${format}:${provider}` → { print, shipping, currency, days, mock, error } */
let quoteTimer = null
function quoteAll() {
  if (!cur.value || !form.pr) return
  clearTimeout(quoteTimer)
  quoteTimer = setTimeout(async () => {
    const jobs = []
    for (const f of printedOn.value) {
      const id = form.pr.printers[f]
      const ids = id && id !== 'auto' ? [id] : makers(f).map((p) => p.id)
      for (const pid of ids) jobs.push([f, pid])
    }
    await Promise.all(jobs.map(async ([f, pid]) => {
      const k = f + ':' + pid
      quotes[k] = { ...(quotes[k] || {}), busy: true }
      try { const j = await post({ action: 'quote', book: cur.value.slug, format: f, provider: pid, options: form.pr.providers[pid] || {}, contents: form.pr.contents[0], print: blockOf(form.pr) }); quotes[k] = { ...j.quote, pages: j.pages, mock: j.mock, configured: j.configured, note: j.product && j.product.note, busy: false } }
      catch (e) { quotes[k] = { error: e.message, busy: false } }
    }))
  }, 350)
}
const quoteOf = (f, pid) => quotes[f + ':' + pid] || null
const quoteLine = (q) => { if (!q) return '…'; if (q.busy) return 'quoting…'; if (q.error) return 'no quote — ' + q.error; const cur = q.currency === 'GBP' ? '£' : q.currency === 'EUR' ? '€' : '$'; return `${cur}${Number(q.print).toFixed(2)} a copy${q.currency && q.currency !== 'USD' ? ' (≈ ' + money(costUsd({ cost: q.print, currency: q.currency })) + ')' : ''}${q.shipping ? ', ' + cur + Number(q.shipping).toFixed(2) + ' to ship' : ''}${q.days ? ', ' + q.days + ' days' : ''}${q.from === 'GB' ? ', from the UK' : ''}${q.mock ? ' · mock' : ''}` }
/* the price a format would sell for at a quote, by the same rule the store uses */
const priceAt = (f, q) => { if (!q || q.busy || q.error) return null; const r = form.pr.formats[f]; if (r.by === 'price') return Number(r.price); const usd = costUsd({ cost: q.print, currency: q.currency }); return Math.ceil((usd + Number(r.markup || 0)) / PRICE_STEP) * PRICE_STEP }
watch(() => form.pr && [form.pr.printers, form.pr.contents, form.pr.trim, form.pr.paper], () => quoteAll(), { deep: true })
watch(panel, (p) => { if (p === 'printers') quoteAll() })
const clothHex = { navy: '#1c2740', gray: '#585b60', red: '#712727', black: '#161512', tan: '#b39a72', forest: '#28422f' }
const foilHex = { gold: '#d4ad57', black: '#161512', white: '#f4f1ea' }

async function save() {
  if (!cur.value) return
  saving.value = true; issues.value = {}; msg.value = ''
  try {
    const j = await post({ action: 'save', book: cur.value.slug, print: form.pr.on ? blockOf(form.pr) : null })
    Object.assign(cur.value, j.book)
    form.pr = formOf(j.book.print)
    saved.value = JSON.stringify(form.pr)
    msg.value = j.draft ? `Saved · rendered ${Object.entries(j.draft.editions).map(([c, e]) => `${CONTENTS_NAMES[c] || c} (${e.pages} pages)`).join(', ')} in ${(j.draft.ms / 1000).toFixed(1)}s` : 'Saved'
    loadPreview(); quoteAll()
  } catch (e) { for (const i of e.issues || []) issues.value[i.path] = i.message; msg.value = e.issues && e.issues.length ? 'Not saved — see the fields marked' : e.message }
  finally { saving.value = false }
}
function discard() { begin() }
/* what the last Set answered, for the drawing step that follows it */
let lastSet = null
async function setEdition() {
  if (!cur.value || dirty.value) return
  lastSet = null
  const stateful = PRINTED.filter((f) => form.pr.formats[f].on).map((f) => form.pr.printers[f]).filter((id) => printers.value[id] && printers.value[id].stateful)
  const titles = stateful.length ? `\n\n${[...new Set(stateful)].map((id) => PRINTER_NAMES[id]).join(', ')} keeps a title per book: one is found by our SKU or MADE ONCE (a setup fee), and recorded in the registry the moment it is.` : ''
  if (!confirm(`Set the editions of “${cur.value.title}”?\n\nThe files go to the bucket, each printer checks and quotes its format, and the book goes on sale at the prices the quotes give.${titles}`)) return
  setting.value = true; msg.value = ''
  try { const j = await post({ action: 'set', book: cur.value.slug }); Object.assign(cur.value, j.book); lastSet = j.set && j.set.editions; msg.value = 'Editions set — ' + Object.entries(j.set.editions).map(([c, e]) => `${CONTENTS_NAMES[c] || c}: ${e.pages} pages${e.printers ? ', ' + Object.entries(e.printers).map(([f, x]) => `${FORMAT_NAMES[f] || f} ${cost(x)} at ${PRINTER_NAMES[x.provider] || x.provider}`).join(' / ') : ''}`).join(' · ') }
  catch (e) { msg.value = e.message }
  finally { setting.value = false }
  /* and then the pictures a listing needs, which only a browser can draw (see drawListing) */
  if (CLOUD && lastSet) await drawListing(lastSet)
}

/*
 * THE LISTING'S PICTURES, DRAWN HERE BECAUSE THERE IS NOWHERE ELSE.
 *
 * In cloud mode nothing rebuilds, and the function that just set the book has Typst and no browser:
 * it cannot raster a page of the interior, and it cannot even write the cover as SVG (`svg` is on
 * the compiler seam and the WASM build answers "Unsupported fmt" — SVG in typst.ts belongs to the
 * renderer). This browser has the other half. So it takes the PDFs the function just stored, draws
 * the same three pages the build would — by the SAME rule, `pdf-shots.js` and `choose()`, so a
 * cloud-set book's gallery is cropped exactly like a machine-set one's — and posts them back.
 *
 * NONE OF IT IS A CONDITION OF THE SALE. The book is set, priced and orderable before this runs; a
 * browser that cannot do it leaves the gallery showing the book alone, which is what a listing
 * looked like before there were page pictures at all.
 */
const drawing = ref(false)
async function drawListing(eds) {
  const b = cur.value
  if (!b || !eds || !Object.keys(eds).length) return
  drawing.value = true
  const was = msg.value
  msg.value = L().drawing || ''
  let drew = 0
  try {
    for (const [contents, ed] of Object.entries(eds)) {
      if (!ed || !ed.edition) continue
      const pictures = {}, art = {}
      const url = (file) => pipe.fileUrl('print', 'pdf', { book: b.slug, edition: ed.edition, file })
      /* the three pages, from the document's own account of itself — the function read it back out
         of the compiled file with the same Typst query the build makes */
      let shots = null
      try {
        const got = await shotsOf(await url('interior'), { where: ed.where || [], marks: ed.marks || [] })
        shots = {}
        for (const sh of got.shots) {
          const name = `page-${sh.page}.jpg`
          pictures[name] = sh.jpeg
          if (sh.kind === 'chapter') shots.edition = { contents, page: sh.page, art: name }
          if (sh.kind === 'marks') shots.marks = { page: sh.page, count: (ed.marks || []).filter((m) => m.page === sh.page).length, art: name }
          if (sh.kind === 'other') shots.other = { contents: sh.contents || 'full', page: sh.page, art: name }
        }
        if (got.chapter) shots.chapter = got.chapter.title
      } catch (e) { /* the pages are a nicety; the cover below may still work */ }
      /* and every cover, as the whole sheet — Book3D positions it by the edition's dims */
      for (const key of Object.keys(ed.covers || {})) {
        try {
          const name = `cover-${key}.jpg`
          pictures[name] = await coverArtOf(await url('cover-' + key))
          art[key] = name
        } catch (e) { /* one cover missing is one card falling back to the plain picture */ }
      }
      if (!Object.keys(pictures).length) continue
      const j = await pipe.action('print', 'listing', { book: b.slug, contents, edition: ed.edition, pictures, shots, art })
      drew += Number(j.pictures) || 0
    }
    msg.value = drew
      ? `${was}${was ? ' · ' : ''}${(L().drawn || '').replace('{n}', String(drew))}`
      : `${was}${was ? ' · ' : ''}${L().none || ''}`
  } catch (e) {
    /* the one refusal worth its own line: the book was set again under us, so these are of the
       wrong text and were not kept */
    const stale = /another edition/.test(String(e.message || ''))
    msg.value = `${was}${was ? ' · ' : ''}${(stale ? L().stale : L().none) || e.message}`
  } finally { drawing.value = false; pipe.forgetFiles() }
}

/* ---- the preview: a draft's interior as a book to turn, each cover flat ----
   pdf.js draws each page to an image; page-flip turns them. The page elements are Vue's
   (an <img> each, its src filled in as the page is drawn), handed to page-flip once the
   count is known, so the book opens on its first pages while the rest are still drawing. */
const previewOf = ref('interior')
const previewContents = ref('')
const previewCover = ref('')
const pages = ref([])
const pageCount = ref(0)
const pageAt = ref(0)
const jacket = ref('')
const rendering = ref(false)
const bookEl = ref(null)
let handle = null, jacketHandle = null, coverHandle = null, backHandle = null, flip = null
function closePreview() {
  if (flip) { try { flip.destroy() } catch (e) { /* already gone */ } flip = null }
  for (const h of [handle, jacketHandle, coverHandle, backHandle]) if (h) h.close()
  handle = jacketHandle = coverHandle = backHandle = null
  pages.value = []; pageCount.value = 0; pageAt.value = 0; jacket.value = ''
}
/* the book is sized to what the preview has: the spread no wider than the panel, the page no
   taller than what is left under the toolbar and the nav — and sized again when that changes */
const previewEl = ref(null)
const bookKey = ref(0)
function pageSize() {
  const panel = previewEl.value, el = bookEl.value
  if (!panel || !el) return { width: 300, height: 450 }
  const w = Math.max(160, (el.clientWidth || panel.clientWidth - 26) / 2)
  const above = el.getBoundingClientRect().top - panel.getBoundingClientRect().top
  const limited = getComputedStyle(panel).overflowY === 'auto'
  const h = limited ? Math.max(240, panel.clientHeight - above - 16) : 720
  const height = Math.min(h, w * 1.5, 720)
  return { width: Math.round(height / 1.5), height: Math.round(height) }
}
async function mountBook() {
  await nextTick()
  const el = bookEl.value; if (!el || flip || !pages.value.length) return
  const { width, height } = pageSize()
  flip = new PageFlip(el, { width, height, size: 'fixed', showCover: true, maxShadowOpacity: 0.35, flippingTime: 650, usePortrait: false, mobileScrollSupport: false, drawShadow: true })
  flip.loadFromHTML(el.querySelectorAll('.pr-page'))
  flip.on('flip', (e) => { pageAt.value = e.data })
  const at = pageAt.value
  if (at > 0) { try { flip.turnToPage(at) } catch (e) { /* not yet */ } }
}
let ro = null, resizeTimer = null
onMounted(() => {
  ro = new ResizeObserver(() => {
    clearTimeout(resizeTimer)
    /* page-flip takes the page elements over and removes them with itself, so the book's DOM is
       made again (the key) before it is mounted at the new size */
    resizeTimer = setTimeout(async () => {
      if (!flip || previewOf.value !== 'interior') return
      const old = flip; flip = null
      bookKey.value++; await nextTick()
      try { old.destroy() } catch (e) { /* its nodes are already gone */ }
      mountBook()
    }, 150)
  })
  watch(previewEl, (el, was) => { if (was && ro) ro.unobserve(was); if (el && ro) ro.observe(el) }, { immediate: true })
})
onBeforeUnmount(() => { if (ro) ro.disconnect() })
const draftEditions = computed(() => (cur.value && cur.value.draft ? cur.value.draft.editions : {}))
const draftEd = computed(() => draftEditions.value[previewContents.value] || null)
const coverKeys = computed(() => (draftEd.value ? Object.keys(draftEd.value.covers || {}) : []))
async function loadPreview() {
  closePreview()
  const b = cur.value; if (!b) return
  let draft = b.draft
  if (!draft && b.print) { rendering.value = true; try { const j = await post({ action: 'render', book: b.slug }); draft = j.draft; b.draft = draft } catch (e) { msg.value = e.message } finally { rendering.value = false } }
  if (!draft) return
  if (!draft.editions[previewContents.value]) previewContents.value = Object.keys(draft.editions)[0] || ''
  const ed = draft.editions[previewContents.value]; if (!ed) return
  const keys = Object.keys(ed.covers || {})
  if (!keys.includes(previewCover.value)) previewCover.value = keys[0] || ''
  /* the dev server answers a GET; in cloud mode the action answers the bytes and this is a blob */
  const url = (file) => pipe.fileUrl('print', 'pdf', { book: b.slug, edition: ed.edition, file })
  const coverFile = previewCover.value ? 'cover-' + previewCover.value : ''
  /* the book opens on its cover and closes on its back: the cover's front and back panels,
     cropped by the binding's dimensions (trim wide, between the bleeds; past the flap and the
     spine), with the interior between them */
  const d = ed.dims && ed.dims[previewCover.value], TRIM = { '6x9': 432, '5x8': 360 }
  const tw = d ? TRIM[d.trim] || 432 : 432
  const panel = (x) => (d ? { x, y: d.bleed, w: tw, h: d.height - 2 * d.bleed } : null)
  const front = d ? panel(d.bleed + d.flap + tw + d.spine) : null, back = d ? panel(d.bleed + d.flap) : null
  handle = openPdf(await url('interior'), { width: 640,
    /* the list: the cover, the inside of the cover (blank), the pages, the inside of the back, the
       back — so page 1 opens on the right, as in the book */
    onCount: (n, urls) => { pageCount.value = n; pages.value = [urls[0], urls[0], ...urls, urls[0], urls[0]]; mountBook() },
    onPage: (i, u) => { if (pages.value.length > i + 1) pages.value[i + 1] = u } })
  if (coverFile) {
    const cu = await url(coverFile)
    jacketHandle = openPdf(cu, { width: 1400, onPage: (i, u) => { if (i === 1) jacket.value = u } })
    if (front) { coverHandle = openPdf(cu, { width: 640, crop: front, onPage: (i, u) => { if (i === 1 && pages.value.length) pages.value[0] = u } }) }
    if (back) { backHandle = openPdf(cu, { width: 640, crop: back, onPage: (i, u) => { if (i === 1 && pages.value.length) pages.value[pages.value.length - 1] = u } }) }
  }
}
/* the book is mounted only while the interior is shown; switching back mounts it again */
watch(previewOf, (v) => { if (v === 'interior') mountBook(); else if (flip) { try { flip.destroy() } catch (e) { /* gone */ } flip = null } })
watch([previewContents, previewCover], () => { if (cur.value && cur.value.draft) loadPreview() })
onBeforeUnmount(() => { closePreview(); pipe.forgetFiles() })
const flipPrev = () => flip && flip.flipPrev()
const flipNext = () => flip && flip.flipNext()
/* the EPUB's address: the dev server's GET, or a blob the action's bytes make (cloud mode), so the
   link is there either way rather than quietly absent in the live admin */
const epubUrl = ref('')
watchEffect(async () => {
  const b = cur.value, ed = draftEd.value
  epubUrl.value = ''
  if (!b || !ed || !ed.epub) return
  try { epubUrl.value = await pipe.fileUrl('print', 'pdf', { book: b.slug, edition: ed.edition, file: 'epub' }) } catch (e) { epubUrl.value = '' }
})
</script>

<template>
  <div class="ui-page">
    <!-- ============ the list ============ -->
    <template v-if="!cur">
      <div class="ui-toolbar">
        <span class="ui-count"><b>{{ books.length }}</b> books · <b>{{ onSale }}</b> on sale in print</span>
        <span class="ui-grow" />
        <button type="button" class="ui-btn ui-ghost" @click="load">Refresh</button>
      </div>
      <p v-if="loading" class="ui-muted">Loading…</p>
      <p v-else-if="err" class="ui-err">{{ err }}</p>
      <div v-else class="pr-grid">
        <AgGridVue class="pr-aggrid" :theme="theme" :row-data="books" :column-defs="columnDefs" :default-col-def="defaultColDef" :get-row-id="getRowId"
                   :row-height="54" :suppress-cell-focus="true" @row-clicked="emit('open', $event.data.slug)" />
      </div>
    </template>

    <!-- ============ the editor ============ -->
    <template v-else>
      <div class="ui-toolbar">
        <button type="button" class="ui-crumb" @click="emit('back')">‹ Print editions</button>
        <span class="ui-grow" />
        <label class="ui-switch"><input v-model="form.pr.on" type="checkbox" /><i /><span>{{ form.pr.on ? 'In print' : 'Not in print' }}</span></label>
      </div>
      <div class="pr-head">
        <h2 class="pr-title">{{ cur.title }}</h2>
        <span class="ui-badge" :class="{ 'ui-ok': state(cur).kind === 'ok', 'ui-warn': state(cur).kind === 'warn' }">{{ state(cur).label }}</span>
        <span v-if="cur.edition && cur.edition.editions" class="ui-muted">
          <template v-for="(e, c) in cur.edition.editions" :key="c">{{ CONTENTS_NAMES[c] || c }} <code class="ui-key">{{ e.edition.slice(0, 8) }}</code> · {{ e.pages }} pages<template v-for="(x, f) in (e.printers || {})" :key="f"> · {{ FORMAT_NAMES[f] || f }} {{ cost(x) }} at {{ PRINTER_NAMES[x.provider] || x.provider }}</template> &nbsp; </template>
        </span>
        <span v-else class="ui-muted">no edition set yet</span>
      </div>

      <div class="pr-split" :class="{ 'pr-off': !form.pr.on }">
        <div class="ui-stack">
          <div class="ui-seg" role="tablist">
            <button v-for="[k, label] in PANELS" :key="k" type="button" role="tab" :aria-selected="panel === k" :class="{ 'ui-on': panel === k }" @click="panel = k">{{ label }}</button>
          </div>

          <!-- edition -->
          <div v-show="panel === 'edition'" class="ui-card">
            <div class="ui-cardhead"><h3>The edition</h3><span>what is printed, and how it is made</span></div>
            <div class="ui-field"><span>Contents <small>what the buyer may choose to have in the book — the first is the default, and every one is an edition of its own</small></span>
              <div class="pr-checks">
                <label v-for="c in CONTENTS" :key="c"><input type="checkbox" :checked="form.pr.contents.includes(c)" @change="toggle(form.pr.contents, c, CONTENTS)" /> {{ CONTENTS_NAMES[c] }}<small v-if="c === 'parts'"> — the the site Edition, then the original full text</small><small v-else-if="c === 'both'"> — the original, each chapter followed by its companion</small></label>
              </div>
              <span v-if="issues.contents" class="ui-err">{{ issues.contents }}</span></div>
            <div class="ui-2col">
              <label class="ui-field"><span>Trim</span><select v-model="form.pr.trim" class="ui-select"><option value="6x9">6 × 9 in</option><option value="5x8">5 × 8 in</option></select></label>
              <label class="ui-field"><span>Paper</span><select v-model="form.pr.paper" class="ui-select"><option value="cream">Cream</option><option value="white">White</option></select></label>
            </div>
            <div class="ui-2col">
              <label class="ui-field"><span>Cloth <small>the default, and every cover's ground</small></span>
                <div class="pr-swatches"><button v-for="c in choices.cloth" :key="c" type="button" class="pr-swbtn" :class="{ 'ui-on': form.pr.cloth === c }" :style="{ background: clothHex[c] }" :title="c" @click="form.pr.cloth = c" /></div>
                <small class="ui-help">{{ form.pr.cloth }}</small></label>
              <label class="ui-field"><span>Foil <small>the default, and the title's colour</small></span>
                <div class="pr-swatches"><button v-for="c in choices.foil" :key="c" type="button" class="pr-swbtn" :class="{ 'ui-on': form.pr.foil === c }" :style="{ background: foilHex[c] }" :title="c" @click="form.pr.foil = c" /></div>
                <small class="ui-help">{{ form.pr.foil }}</small></label>
            </div>
            <label class="ui-field" :class="{ 'pr-bad': issues.spine || (spine && !spine.fits) }">
              <span>Spine title <small>when the title is long</small></span>
              <input v-model="form.pr.spine" class="ui-input" type="text" :placeholder="cur.title" :maxlength="spine ? spine.room : 40" />
              <small class="ui-help">The spine and its foil read <b>{{ spine.title }} · {{ spine.edition }}</b>; the foil holds 42 characters of both, so the title may have {{ spine.room }}.</small>
              <span v-if="issues.spine" class="ui-err">{{ issues.spine }}</span>
            </label>
            <label class="ui-switch pr-switch"><input v-model="form.pr.ebook" type="checkbox" /><i /><span>The store page mentions and links the book online</span></label>
          </div>

          <!-- formats & prices -->
          <div v-show="panel === 'sale'" class="ui-card">
            <div class="ui-cardhead"><h3>Formats &amp; prices</h3><span>what is sold, each at its own price, and on what footing</span></div>
            <label class="ui-field"><span>Main offer <small>the one the store page opens on — the rest wait behind "See other formats"</small></span>
              <select v-model="form.pr.main" class="ui-select">
                <option value="online">The book online (the unlock)</option>
                <option v-for="k in FORMATS" :key="k" :value="k" :disabled="!form.pr.formats[k].on">{{ FORMAT_NAMES[k] }}</option>
              </select></label>
            <div v-for="k in FORMATS" :key="k" class="pr-format" :class="{ 'pr-on': form.pr.formats[k].on }">
              <label class="ui-switch"><input v-model="form.pr.formats[k].on" type="checkbox" /><i /><span>{{ FORMAT_NAMES[k] }}</span></label>
              <template v-if="form.pr.formats[k].on">
                <div class="pr-pricerow">
                  <select v-model="form.pr.formats[k].by" class="ui-select ui-sm"><option value="markup">Markup over the printer's cost</option><option value="price">Price as written</option></select>
                  <input v-if="form.pr.formats[k].by === 'markup'" v-model.number="form.pr.formats[k].markup" class="ui-input ui-sm" type="number" min="0" step="1" placeholder="dollars over" />
                  <input v-else v-model.number="form.pr.formats[k].price" class="ui-input ui-sm" type="number" min="0" step="0.01" placeholder="dollars" />
                </div>
                <small class="ui-help">{{ sells(k) }}</small>
                <span v-if="issues['formats.' + k + '.price'] || issues['formats.' + k + '.markup']" class="ui-err">{{ issues['formats.' + k + '.price'] || issues['formats.' + k + '.markup'] }}</span>
                <div v-if="k === 'hardcover'" class="ui-2col">
                  <div class="ui-field"><span>Cloth <small>one, or the buyer's choice</small></span>
                    <div class="pr-swatches"><button v-for="c in choices.cloth" :key="c" type="button" class="pr-swbtn" :class="{ 'ui-on': form.pr.formats.hardcover.cloth.includes(c) }" :style="{ background: clothHex[c] }" :title="c" @click="toggle(form.pr.formats.hardcover.cloth, c, choices.cloth)" /></div>
                    <small class="ui-help">{{ form.pr.formats.hardcover.cloth.join(', ') }}</small></div>
                  <div class="ui-field"><span>Foil <small>one, or the buyer's choice</small></span>
                    <div class="pr-swatches"><button v-for="c in choices.foil" :key="c" type="button" class="pr-swbtn" :class="{ 'ui-on': form.pr.formats.hardcover.foil.includes(c) }" :style="{ background: foilHex[c] }" :title="c" @click="toggle(form.pr.formats.hardcover.foil, c, choices.foil)" /></div>
                    <small class="ui-help">{{ form.pr.formats.hardcover.foil.join(', ') }}</small></div>
                </div>
              </template>
            </div>
            <div class="ui-field"><span>Comes with a printed copy <small>files a buyer of any printed format may download</small></span>
              <div class="pr-checks pr-row">
                <label v-for="f in FILES" :key="f"><input type="checkbox" :checked="form.pr.includes.includes(f)" @change="toggle(form.pr.includes, f, FILES, 0)" /> {{ FORMAT_NAMES[f] }}</label>
              </div></div>
            <label class="ui-field"><span>Key <small>the offers' identity, given once — every format's key is made from it</small></span><input :value="form.pr.key || '— given on save'" class="ui-input ui-mono" type="text" readonly /></label>
            <label class="ui-field" :class="{ 'pr-bad': !String(form.pr.rights || '').trim() }">
              <span>Rights <small>on what footing the text is printed and sold — without this line the book is not for sale</small></span>
              <textarea v-model="form.pr.rights" class="ui-textarea" rows="2" placeholder="Public domain (first published 1908, United States); this edition's introduction and companion are the site's own." />
            </label>
          </div>

          <!-- printers: who makes each format, each printer's own options, a quote as they change -->
          <div v-show="panel === 'printers'" class="ui-card">
            <div class="ui-cardhead"><h3>Printers</h3><span>who makes each printed format — a printer by name, or the cheapest of those with keys — and what each is told; every change is quoted below it, for one copy at the draft's page count</span></div>
            <div v-for="f in printedOn" :key="f" class="pr-format pr-on">
              <label class="ui-field"><span>{{ FORMAT_NAMES[f] }}</span>
                <select v-model="form.pr.printers[f]" class="ui-select">
                  <option value="auto">Cheapest available</option>
                  <option v-for="p in makers(f)" :key="p.id" :value="p.id">{{ p.name }}{{ p.configured ? '' : p.mock ? ' — no keys (mock)' : ' — no keys' }}</option>
                </select></label>
              <ul class="pr-quotes">
                <li v-for="p in (form.pr.printers[f] === 'auto' ? makers(f) : makers(f).filter((x) => x.id === form.pr.printers[f]))" :key="p.id" :class="{ 'pr-q-mock': quoteOf(f, p.id) && quoteOf(f, p.id).mock }">
                  <b>{{ p.name }}</b> <span>{{ quoteLine(quoteOf(f, p.id)) }}</span>
                  <em v-if="priceAt(f, quoteOf(f, p.id))"> → sells for {{ money(priceAt(f, quoteOf(f, p.id))) }}</em>
                  <small v-if="quoteOf(f, p.id) && quoteOf(f, p.id).note"> · {{ quoteOf(f, p.id).note }}</small>
                </li>
              </ul>
            </div>
            <div v-for="id in shownProviders" :key="id" class="pr-provider">
              <div class="pr-provider-head"><h4>{{ PRINTER_NAMES[id] || id }}</h4><span v-if="printers[id] && !printers[id].configured" class="pr-nokeys">{{ printers[id].mock ? 'no keys — every call is mocked' : 'no keys' }}</span><span v-else class="pr-keys">keys present</span><span v-if="printers[id] && printers[id].stateful" class="pr-stateful">keeps a title per book — made once, a setup fee</span></div>
              <div class="pr-options">
                <label v-for="o in optionsFor(id)" :key="o.key" class="ui-field">
                  <span>{{ o.label }}<small v-if="o.help"> · {{ o.help }}</small></span>
                  <select v-if="o.type === 'select'" class="ui-select ui-sm" :value="String(optionValue(id, o))" @change="setOption(id, o, $event.target.value)">
                    <option v-for="c in o.choices" :key="String(c.value)" :value="String(c.value)">{{ c.label }}</option>
                  </select>
                  <label v-else-if="o.type === 'toggle'" class="ui-switch"><input type="checkbox" :checked="!!optionValue(id, o)" @change="setOption(id, o, $event.target.checked)" /><i /><span>{{ optionValue(id, o) ? 'yes' : 'no' }}</span></label>
                  <input v-else class="ui-input ui-sm" type="text" :value="optionValue(id, o) || ''" @change="setOption(id, o, $event.target.value)" />
                </label>
                <p v-if="!optionsFor(id).length" class="ui-help">Nothing to set for this book.</p>
              </div>
            </div>
          </div>

          <!-- jacket -->
          <div v-show="panel === 'jacket'" class="ui-card">
            <div class="ui-cardhead"><h3>The jacket</h3><span>its back and its front flap, written for it — every cover shares them</span></div>
            <label class="ui-field"><span>Back <small>two short paragraphs under the companion's insight, which is set above as a pull quote</small></span>
              <textarea v-model="form.pr.blurb" class="ui-textarea" rows="7" /></label>
            <label class="ui-field"><span>Front flap <small>the book and its author</small></span>
              <textarea v-model="form.pr.flap" class="ui-textarea" rows="5" /></label>
            <p class="ui-help">The back flap says what the edition is, in the edition's own words; the spine says the title and the edition, in capitals.</p>
          </div>

          <!-- note -->
          <div v-show="panel === 'note'" class="ui-card">
            <div class="ui-cardhead"><h3>A Note on This Edition</h3><span>the publisher's page before the text</span></div>
            <label class="ui-field"><span>The note <small>written whole, in the house voice — see AGENTS.md</small></span>
              <textarea v-model="form.pr.note" class="ui-textarea pr-note" rows="16" /></label>
            <div class="ui-helpnotes">
              <p>Three paragraphs: <b>what the book is</b> and what in its prose stands between a reader now and the teaching; <b>what this edition does</b> — the paragraph the series shares; <b>where to begin</b>. Third person, declarative, dry. Book titles in <i>*italics*</i>.</p>
            </div>
          </div>

          <!-- proofs -->
          <div v-show="panel === 'proofs'" class="ui-card">
            <div class="ui-cardhead"><h3>Proofs</h3><span>which edition a printed copy was read and passed at — a record beside the sale, never a gate on it; a changed word is a new edition, and the row says so</span></div>
            <p v-if="!proofs.length || proofs.every((p) => p.state === 'unset')" class="ui-muted">No edition is set yet — save, then Set the editions, then order a proof.</p>
            <div v-for="p in proofs" :key="p.contents" class="pr-proof" :class="'pr-proof-' + p.state">
              <div class="pr-proof-row">
                <b>{{ CONTENTS_NAMES[p.contents] || p.contents }}</b>
                <code v-if="p.edition" class="ui-key">{{ p.edition.slice(0, 8) }}</code>
                <span v-if="p.pages" class="ui-muted">{{ p.pages }} pages</span>
                <span class="ui-badge" :class="{ 'ui-ok': p.state === 'proofed', 'ui-warn': p.state === 'stale' || p.state === 'never' }">{{ PROOF_WORDS[p.state] }}<template v-if="p.state === 'stale'"> · {{ p.was.slice(0, 8) }}</template></span>
                <span class="ui-grow" />
                <button v-if="p.state !== 'unset'" type="button" class="ui-btn ui-ghost" :disabled="!!proofing || !proofFormats.length" @click="orderProof(p)">Order a proof</button>
                <button v-if="p.state === 'never' || p.state === 'stale'" type="button" class="ui-btn" :disabled="!!proofing || dirty" :title="dirty ? 'Save first' : 'Only once a printed copy of this edition has been read'" @click="markProofed(p)">{{ proofing === p.contents ? 'Marking…' : 'Mark proofed' }}</button>
              </div>
              <form v-if="proofForm.contents === p.contents" class="pr-proof-form" @submit.prevent="sendProof">
                <div class="pr-row">
                  <label class="ui-field"><span>Format</span><select v-model="proofForm.format" class="ui-select"><option v-for="f in proofFormats" :key="f" :value="f">{{ FORMAT_NAMES[f] || f }}</option></select></label>
                  <label v-if="proofForm.format === 'hardcover'" class="ui-field"><span>Cloth</span><select v-model="proofForm.cloth" class="ui-select"><option v-for="c in form.pr.formats.hardcover.cloth" :key="c" :value="c">{{ c }}</option></select></label>
                  <label v-if="proofForm.format === 'hardcover'" class="ui-field"><span>Foil</span><select v-model="proofForm.foil" class="ui-select"><option v-for="c in form.pr.formats.hardcover.foil" :key="c" :value="c">{{ c }}</option></select></label>
                  <label class="ui-field"><span>Shipping</span><select v-model="proofForm.level" class="ui-select"><option value="standard">Standard</option><option value="priority">Priority</option><option value="express">Express</option></select></label>
                </div>
                <div class="pr-row">
                  <label class="ui-field"><span>Name</span><input v-model="proofForm.address.name" class="ui-input" required /></label>
                  <label class="ui-field"><span>Phone</span><input v-model="proofForm.address.phone" class="ui-input" /></label>
                </div>
                <label class="ui-field"><span>Address</span><input v-model="proofForm.address.line1" class="ui-input" required /></label>
                <label class="ui-field"><span>Line 2</span><input v-model="proofForm.address.line2" class="ui-input" /></label>
                <div class="pr-row">
                  <label class="ui-field"><span>City</span><input v-model="proofForm.address.city" class="ui-input" required /></label>
                  <label class="ui-field"><span>State</span><input v-model="proofForm.address.state" class="ui-input" /></label>
                  <label class="ui-field"><span>Postal code</span><input v-model="proofForm.address.postal_code" class="ui-input" required /></label>
                  <label class="ui-field"><span>Country</span><input v-model="proofForm.address.country" class="ui-input" maxlength="2" required /></label>
                </div>
                <div class="pr-proof-acts">
                  <span class="ui-muted">One copy, to this address, at the printer's cost — never a sale.</span>
                  <span class="ui-grow" />
                  <button type="button" class="ui-btn ui-ghost" @click="proofForm.contents = ''">Cancel</button>
                  <button type="submit" class="ui-btn ui-primary" :disabled="!!proofing">{{ proofing ? 'Ordering…' : 'Order the proof' }}</button>
                </div>
              </form>
            </div>
            <p v-if="proofMsg" class="pr-proof-msg">{{ proofMsg }}</p>
          </div>

          <div class="ui-savebar">
            <span class="ui-dirty" :class="{ 'ui-clean': !dirty }">{{ dirty ? 'Unsaved changes' : (msg || 'All changes saved') }}</span>
            <span v-if="dirty && msg" class="ui-err">{{ msg }}</span>
            <span class="ui-grow" />
            <button type="button" class="ui-btn ui-ghost" :disabled="!dirty" @click="discard">Discard</button>
            <button type="button" class="ui-btn" :disabled="dirty || saving || setting || !form.pr.on" :title="dirty ? 'Save first' : 'Upload the files, get the printer\'s quotes, put the book on sale'" @click="setEdition">{{ setting ? 'Setting…' : 'Set the editions' }}</button>
            <button type="button" class="ui-btn ui-primary" :disabled="saving || !dirty" @click="save">{{ saving ? 'Saving & rendering…' : 'Save & render' }}</button>
          </div>
        </div>

        <!-- the book itself -->
        <div ref="previewEl" class="pr-preview">
          <div class="ui-toolbar">
            <div class="ui-seg" role="tablist">
              <button type="button" :class="{ 'ui-on': previewOf === 'interior' }" @click="previewOf = 'interior'">Interior</button>
              <button type="button" :class="{ 'ui-on': previewOf === 'jacket' }" @click="previewOf = 'jacket'">Cover</button>
            </div>
            <select v-if="Object.keys(draftEditions).length > 1" v-model="previewContents" class="ui-select ui-sm"><option v-for="(e, c) in draftEditions" :key="c" :value="c">{{ CONTENTS_NAMES[c] || c }}</option></select>
            <select v-if="coverKeys.length > 1" v-model="previewCover" class="ui-select ui-sm"><option v-for="k in coverKeys" :key="k" :value="k">{{ k }}</option></select>
            <span class="ui-count" v-if="pageCount"><b>{{ pageCount }}</b> pages</span>
            <a v-if="epubUrl" class="ui-btn ui-sm ui-ghost" :href="epubUrl" download>EPUB</a>
            <span class="ui-grow" />
            <span v-if="rendering" class="ui-muted">Rendering…</span>
            <span v-else-if="draftEd" class="ui-muted">draft <code class="ui-key">{{ draftEd.edition.slice(0, 8) }}</code></span>
          </div>
          <div v-if="!form.pr.on" class="ui-empty">Switch the book on and save to see it.</div>
          <div v-else-if="previewOf === 'interior'" class="pr-book">
            <div v-if="pages.length" class="pr-nav">
              <button type="button" class="ui-btn ui-sm" :disabled="pageAt <= 0" @click="flipPrev">‹ Previous</button>
              <span class="ui-count"><template v-if="pageAt <= 1">cover</template><template v-else-if="pageAt >= pages.length - 2">back</template><template v-else>page <b>{{ pageAt - 1 }}</b> of {{ pageCount }}</template></span>
              <button type="button" class="ui-btn ui-sm" :disabled="pageAt >= pages.length - 1" @click="flipNext">Next ›</button>
            </div>
            <div v-if="pages.length" ref="bookEl" :key="bookKey" class="pr-flipbook">
              <div v-for="(u, i) in pages" :key="i" class="pr-page" :data-density="i <= 1 || i >= pages.length - 2 ? 'hard' : 'soft'"><img :src="u" alt="" draggable="false" /></div>
            </div>
            <div v-else class="ui-empty">{{ rendering ? 'Rendering the interior…' : 'Save to render the book.' }}</div>
          </div>
          <div v-else class="pr-jacket">
            <img v-if="jacket" :src="jacket" alt="" />
            <div v-else class="ui-empty">{{ rendering ? 'Rendering the cover…' : 'Save to render the cover.' }}</div>
          </div>
        </div>
      </div>
    </template>
  </div>
</template>

<style scoped>
.pr-grid { flex: 1; min-height: 520px; display: flex }
.pr-aggrid { flex: 1; min-height: 0; width: 100% }
.pr-grid :deep(.ag-row) { cursor: pointer }
.pr-grid :deep(.pr-gtitle) { display: block; font-family: var(--fd); font-weight: 600; font-size: 14.5px; line-height: 1.25; padding-top: 7px }
.pr-grid :deep(.pr-gauthor) { display: block; font-size: 11.5px; color: var(--ink3); line-height: 1.25 }
.pr-grid :deep(.pr-gstate) { font-family: var(--m); font-size: 10.5px; letter-spacing: .06em; text-transform: uppercase; padding: 3px 8px; border-radius: 999px; border: 1px solid var(--hair); color: var(--ink2); white-space: nowrap }
.pr-grid :deep(.pr-gstate.pr-ok) { color: #0b6e4f; background: #0b6e4f12; border-color: #0b6e4f33 }
.pr-grid :deep(.pr-gstate.pr-warn) { color: #9a6a10; background: #d8a03a1a; border-color: #d8a03a55 }
.pr-grid :deep(.pr-gsw) { display: inline-block; width: 12px; height: 12px; border-radius: 3px; border: 1px solid #00000022; margin-right: 6px; vertical-align: -1px }
.pr-head { display: flex; align-items: baseline; gap: 12px; flex-wrap: wrap }
.pr-title { font-family: var(--fd); font-weight: 600; font-size: 26px; margin: 0 }
/* the admin's main pane never scrolls: the two columns fill what is left of it and each
   scrolls on its own — the fields on the left, the book on the right */
.pr-split { display: grid; grid-template-columns: minmax(380px, 520px) minmax(0, 1fr); gap: 22px; align-items: stretch; flex: 1; min-height: 0 }
.pr-split > .ui-stack { overflow-y: auto; min-height: 0; padding-right: 4px; padding-bottom: 8px }
/* narrower: one column, the fields then the book, the whole of it scrolling as one */
@media (max-width: 1280px) {
  .pr-split { display: flex; flex-direction: column; overflow-y: auto; padding-right: 4px }
  .pr-split > .ui-stack { overflow: visible; flex: none; padding-right: 0 }
  .pr-preview { overflow: visible; flex: none }
  .pr-book { flex: none }
}
.pr-off .ui-card { opacity: .55; pointer-events: none }
.pr-swatches { display: flex; gap: 6px; padding: 4px 0 }
.pr-swbtn { width: 30px; height: 30px; border-radius: 8px; border: 2px solid transparent; cursor: pointer; box-shadow: inset 0 0 0 1px #00000022 }
.pr-swbtn.ui-on { border-color: var(--accent2); box-shadow: 0 0 0 2px color-mix(in srgb, var(--accent2) 30%, transparent) }
.pr-checks { display: flex; flex-direction: column; gap: 6px; font-size: 13px; color: var(--ink2) } .pr-checks label { display: flex; gap: 8px; align-items: flex-start; cursor: pointer } .pr-checks input { margin-top: 3px } .pr-checks small { color: var(--ink3) }
.pr-checks.pr-row { flex-direction: row; gap: 18px }
.pr-format { border: 1px solid var(--hair); border-radius: 10px; padding: 10px 12px; margin: 0 0 10px; display: flex; flex-direction: column; gap: 8px }
.pr-format.pr-on { border-color: color-mix(in srgb, var(--accent2) 45%, var(--hair)) }
.pr-quotes { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 4px; font-size: 13px }
.pr-quotes b { font-weight: 600; margin-right: 6px } .pr-quotes em { font-style: normal; color: var(--accent2) } .pr-quotes small { color: var(--ink3) }
.pr-q-mock span { color: var(--ink3) }
.pr-provider { border: 1px solid var(--hair); border-radius: 10px; padding: 12px 14px; margin: 0 0 10px }
.pr-proof { border: 1px solid var(--hair); border-radius: 10px; padding: 10px 12px; margin: 0 0 10px }
.pr-proof-proofed { border-color: color-mix(in srgb, var(--ok, #2f8f4e) 45%, var(--hair)) }
.pr-proof-row { display: flex; align-items: center; gap: 10px; flex-wrap: wrap }
.pr-proof-form .pr-row { display: flex; gap: 10px } .pr-proof-form .pr-row .ui-field { flex: 1 }
.pr-proof-form { margin-top: 12px; padding-top: 12px; border-top: 1px dashed var(--hair); display: flex; flex-direction: column; gap: 8px }
.pr-proof-acts { display: flex; align-items: center; gap: 10px; margin-top: 4px }
.pr-proof-msg { margin: 8px 0 0; font-size: 13px; color: var(--ink2) }
.pr-provider-head { display: flex; align-items: baseline; gap: 12px; flex-wrap: wrap; margin-bottom: 8px } .pr-provider-head h4 { margin: 0; font-size: 15px }
.pr-nokeys { font-family: var(--m); font-size: 11px; color: #b0332e } .pr-keys { font-family: var(--m); font-size: 11px; color: var(--ink3) } .pr-stateful { font-family: var(--m); font-size: 11px; color: var(--ink3) }
.pr-options { display: grid; grid-template-columns: repeat(auto-fill, minmax(220px, 1fr)); gap: 8px 14px }
.pr-pricerow { display: flex; gap: 8px; align-items: center } .pr-pricerow .ui-input { max-width: 120px }
.pr-switch { margin-top: 6px }
.pr-preview .ui-select.ui-sm, .pr-pricerow .ui-select { height: 30px; font-size: 12.5px; width: auto; padding: 0 8px }
.pr-bad .ui-input, .pr-bad .ui-textarea { border-color: #b3261e88 }
.pr-note { font-size: 13.5px; line-height: 1.55; min-height: 380px }
.ui-helpnotes p { font-size: 12.5px; line-height: 1.5; color: var(--ink3) }
.pr-preview { display: flex; flex-direction: column; gap: 12px; min-width: 0; min-height: 0; overflow-y: auto }
.pr-book { flex: 1; background: var(--wash); border: 1px solid var(--hair); border-radius: 14px; padding: 14px 12px 12px; min-height: 0; display: flex; flex-direction: column; align-items: center; overflow: hidden }
.pr-flipbook { width: 100%; margin: 0 auto }
.pr-flipbook :deep(.stf__parent) { margin: 0 auto }
.pr-page { background: #f7f4ec; overflow: hidden; box-shadow: inset 0 0 30px -20px #00000040 }
.pr-page img { display: block; width: 100%; height: 100%; object-fit: cover; user-select: none }
.pr-nav { display: flex; align-items: center; justify-content: center; gap: 14px; padding-bottom: 12px }
.pr-jacket { background: var(--wash); border: 1px solid var(--hair); border-radius: 14px; padding: 18px; display: flex; align-items: center; justify-content: center; min-height: 320px }
.pr-jacket img { max-width: 100%; height: auto; box-shadow: 0 20px 50px -20px #00000080 }
</style>
