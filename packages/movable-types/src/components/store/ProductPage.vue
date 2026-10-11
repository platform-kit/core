<script setup>
/*
 * One product: its gallery, what it costs (live), the choices before buying
 * (a size, a quantity), the way into the bag or straight to checkout, what the
 * page says about it (the body, with its `## ` sections as panels), and what
 * else might suit. A book knows its author and chapters and points to its free
 * chapters; the membership has its own way in; a book in print (kind print, derived
 * from the book's print block) is one page with its formats as the choice on it —
 * hardcover, casewrap, softcover, which ship like a good; pdf, epub, which download —
 * and the choices inside a format (what the book holds, a linen's cloth and foil),
 * says what the edition is, offers a buyer their files, and points at the book online
 * when the block allows — and the book's unlock points back.
 * A draft from the admin's live preview arrives through inject in place of the
 * compiled product.
 */
import { ref, computed, inject, watch } from 'vue'
import { books as BOOKS } from '#content'
import CommentThread from '../content/CommentThread.vue'
import { us } from '@platform-kit/kit/lib/content.js'
import { product, resolveProduct, related, collectionOf, ready, ships, hardcoverOf, byBook, editionOf, ONLINE } from '@platform-kit/kit/lib/storefront.js'
import { money, checkout, subscribe, openPortal } from '@platform-kit/kit/lib/commerce.js'
import { isSignedIn, userClass, hasProduct } from '@platform-kit/kit/lib/auth.js'
import { PRINTED, variantOf, coverFor } from '@platform-kit/kit/lib/print-offers.js'
import { bookCoverOf } from '@platform-kit/kit/lib/book-art.js'
import { normaliseOptions, variantKey } from '@platform-kit/kit/lib/variants.js'
import { counts as stock, loadStock, buyable } from '@platform-kit/kit/lib/stock.js'
import { priceOf } from '@platform-kit/kit/lib/prices.js'
import { lists as priceLists, promotions as promoList, priceContext } from '@platform-kit/kit/lib/storefront.js'
import { apply as applyPromotions } from '@platform-kit/kit/lib/promotions.js'
import VariantPicker from './VariantPicker.vue'
import { filesFor } from '@platform-kit/kit/lib/downloads.js'
import { guestCart } from '@platform-kit/kit/lib/shipto.js'
import { renderer } from '@platform-kit/kit/lib/markdown.js'
import { chapterCompanion } from '@platform-kit/kit/lib/companions.js'
import { bookChapters } from '@platform-kit/kit/lib/speech.js'
import * as cart from '@platform-kit/kit/lib/cart.js'
import { capture, contentView } from '@platform-kit/kit/lib/analytics.js'
import { ROUTES } from '../../router.js'
import Carousel from './Carousel.vue'
import ProductCard from './ProductCard.vue'
import ShipTo from './ShipTo.vue'
import Book3D from '../Book3D.vue'
import PrintPagePreview from './PrintPagePreview.vue'

const props = defineProps({ id: { type: String, required: true } })
const T = us('store')
const HD = T.page.head
const P = T.product.ui
const HC = T.product.print || {}
const fill = (s, m) => String(s || '').replace(/\{(\w+)\}/g, (_, k) => (m[k] == null ? '' : m[k]))
const S = T.home.sections
const PR = T.home.promise
const preview = inject('dl-preview', null)

const p = computed(() => (preview ? (preview.value ? resolveProduct(preview.value) : null) : product(props.id)))
const col = computed(() => (p.value ? collectionOf(p.value) : null))
const others = computed(() => (p.value && !preview ? related(p.value, 6) : []))
const isMember = computed(() => userClass.value === 'subscribed')
/* one book, one page: the unlock's page carries the book's print formats, and the print page
   the unlock (when its block allows) — so every way to have the book is a format on the page */
const printP = computed(() => (!p.value || preview ? null : p.value.kind === 'print' ? p.value : p.value.kind === 'book' ? hardcoverOf(p.value.book) : null))
/* the book online as a format: the unlock's own page always; a print page's only when its block
   allows and the store offers the book online at all */
const unlockP = computed(() => (!p.value || preview ? null : p.value.kind === 'book' ? p.value : p.value.kind === 'print' && ONLINE && p.value.print && p.value.print.ebook ? byBook(p.value.book) : null))
const edition = computed(() => (printP.value ? editionOf(printP.value.book) : null))
const fallbackArt = computed(() => (printP.value ? bookCoverOf(printP.value.book) : ''))
const pr = computed(() => (printP.value ? printP.value.print : null))
/* the book online, already this reader's */
const ownedOnline = computed(() => !!unlockP.value && (hasProduct(unlockP.value.book) || isMember.value))
/* the formats on the page: the book online first, then what is printed and what downloads */
const formats = computed(() => [
  ...(unlockP.value && unlockP.value.available ? [{ format: 'online', kind: 'book', sku: unlockP.value.sku, price: unlockP.value.unit_amount / 100 }] : []),
  ...(pr.value ? pr.value.formats : []),
])
/* the format chosen, what goes inside a printed one, a linen's colours — the offer on the page
   is the chosen format's, and a print line carries the rest as its variant */
const fmt = ref(''), cnt = ref(''), cloth = ref(''), foil = ref('')
/* the page opens on the block's main offer; the rest wait behind "see other formats" */
const showFormats = ref(false)
watch([formats, pr], ([list, v]) => {
  if (list.some((f) => f.format === fmt.value)) return
  const main = v && list.find((f) => f.format === v.main)
  fmt.value = (main || list[0] || {}).format || ''
}, { immediate: true })
const otherFormats = computed(() => formats.value.filter((f) => f.format !== fmt.value))
watch(pr, (v) => { if (v && !v.contents.includes(cnt.value)) cnt.value = v.contents[0] || 'parts' }, { immediate: true })
const offer = computed(() => formats.value.find((f) => f.format === fmt.value) || null)
const isOnline = computed(() => fmt.value === 'online')
const isPrint = computed(() => !!offer.value && offer.value.format !== 'online')
watch(offer, (o) => {
  if (!o) return
  if (o.cloth && !o.cloth.includes(cloth.value)) cloth.value = o.cloth[0]
  if (o.foil && !o.foil.includes(foil.value)) foil.value = o.foil[0]
}, { immediate: true })
const shipsNow = computed(() => (formats.value.length ? PRINTED.includes(fmt.value) : ships(p.value)))
const chosen = computed(() => (pr.value ? { contents: cnt.value, cloth: fmt.value === 'hardcover' ? cloth.value : '', foil: fmt.value === 'hardcover' ? foil.value : '' } : null))
const pagesOf = computed(() => { const e = edition.value && edition.value.editions && edition.value.editions[cnt.value]; return e && e.pages ? e.pages : 0 })
const editionLine = computed(() => {
  if (!pr.value || !isPrint.value) return ''
  const c = chosen.value
  const line = fill(HC['edition-' + fmt.value] || '', { trim: String(pr.value.trim || '').replace('x', ' × '), paper: pr.value.paper, cloth: HC['cloth-' + c.cloth] || c.cloth, foil: HC['foil-' + c.foil] || c.foil })
  return pagesOf.value && PRINTED.includes(fmt.value) ? line + ' · ' + fill(HC.pages, { n: pagesOf.value }) : line
})
/* what the chosen format comes with: the files, worded */
const comesWith = computed(() => {
  if (!isPrint.value || !offer.value.includes || !offer.value.includes.length) return ''
  const names = offer.value.includes.map((f) => HC['file-' + f] || f.toUpperCase())
  return fill(HC['comes-with'], { files: names.length > 1 ? names.slice(0, -1).join(', ') + ' ' + (HC.and || 'and') + ' ' + names[names.length - 1] : names[0] })
})
/* the line as the store shows it: the format, the colours, what is inside */
const lineLabel = computed(() => {
  if (!isPrint.value) return ''
  const c = chosen.value
  return [HC['format-' + fmt.value] || fmt.value, c.cloth ? (HC['cloth-' + c.cloth] || c.cloth) + ' · ' + (HC['foil-' + c.foil] || c.foil) : '', HC['contents-' + c.contents] || c.contents].filter(Boolean).join(' · ')
})
/* "yours" only while the book online is the format in hand */
const owned = computed(() => isOnline.value && ownedOnline.value)
const priceText = computed(() => {
  if (!p.value || (!offer.value && !p.value.available)) return P.unavailable
  /* print prices by format; everything else by the chosen variant — and before a choice is
     made, the cheapest with "from", since any single number would be one somebody is not
     charged. Where every shape costs the same there is nothing to qualify. */
  const chosenAll = pickedOptions.value.length > 0 && pickedOptions.value.every((o) => picked.value[o.name])
  const amount = offer.value ? Math.round(offer.value.price * 100)
    : (pickedOptions.value.length && !chosenAll && everyShapeCosts.value == null) ? fromAmount.value
      : variantAmount.value
  const m = money(amount, p.value.currency)
  const loose = pickedOptions.value.length && !chosenAll && everyShapeCosts.value == null
  if (p.value.recurring) return m + ' ' + (S['per-' + (p.value.interval || 'month')] || '')
  return loose ? fill(P['from-price'] || '{price}', { price: m }) : m
})
/* a buyer's files: asked for once they are signed in, on a print page */
const files = ref(null)
watch([printP, isSignedIn], async ([v, on]) => { files.value = null; if (v && on) { try { files.value = await filesFor(v.book) } catch (e) { files.value = [] } } }, { immediate: true })

/* the body: the opening is "About"; each ## section is a panel of its own */
const panels = computed(() => {
  const html = (p.value && p.value.body) || ''
  const parts = html.split(/(?=<h2\b)/)
  const out = []
  /* a printed format: what this edition is comes first; the unlock's own sections (what you get
     online) are the book online's, and stay off a printed copy's page */
  if (isPrint.value) out.push({ title: P.details, html: '<p>' + editionLine.value + '</p><p>' + (HC['includes-' + cnt.value] || HC.includes || '') + '</p>' + (comesWith.value ? '<p>' + comesWith.value + '</p>' : '') })
  if (parts[0] && parts[0].trim()) out.push({ title: isPrint.value ? HC['about-book'] || P.about : P.about, html: parts[0] })
  if (!isPrint.value) for (const part of parts.slice(1)) {
    const m = /^<h2[^>]*>([\s\S]*?)<\/h2>([\s\S]*)$/.exec(part)
    if (m) out.push({ title: m[1].replace(/<[^>]+>/g, '').trim(), html: m[2] })
  }
  if (shipsNow.value) out.push({ title: P.shipping, html: '<p>' + (isPrint.value ? HC['ships-body'] : P['shipping-body']) + '</p>' })
  return out
})
const openPanel = ref(0)

/* the book as an object: the chosen edition's cover art (the format's binding and colours, or
   the first cover there is when the format in hand is not a printed one), with its dimensions */
const bookArt = computed(() => {
  const ed = edition.value && edition.value.editions && edition.value.editions[cnt.value]
  if (!ed || !ed.art || !ed.dims) return null
  const format = PRINTED.includes(fmt.value) && ed.printers && ed.printers[fmt.value] ? fmt.value : (pr.value && PRINTED.includes(pr.value.main) && ed.printers && ed.printers[pr.value.main] ? pr.value.main : PRINTED.find((f) => ed.printers && ed.printers[f]))
  return format ? coverFor(ed, format, cloth.value, foil.value) : null
})
/* gallery: the book first, then pages of it — a chapter's first page in this edition, the same
   chapter in the other, the page with the most highlights — each with its caption; a good with
   no print shows its pictures. The site's cover art never stands for the printed object. */
const at = ref(0)
const images = computed(() => (p.value && p.value.images) || [])
const shots = computed(() => { const ed = edition.value && edition.value.editions && edition.value.editions[cnt.value]; return ed && ed.shots ? ed.shots : null })
const missingPageArt = ref({})
const previewRenderer = renderer()
const markPattern = /==(?=\S)([\s\S]*?\S)==(?:\{(sun|leaf|sky|ocean|ember)\})?/g
const previewWords = 220
function chapterKey(title) {
  return String(title || '').normalize('NFKD').replace(/[\u0300-\u036f]/g, '')
    .replace(/^\s*(?:chapter\s+)?(?:\d+|[ivxlcdm]+)(?=[.)\s:–—-])(?:[.)\s:–—-]+)/i, '')
    .toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim()
}
function chapterNumber(chapters, index) {
  const ownNumber = /^(?:chapter\s+)?(\d+)[.:)]\s+/i
  const titles = chapters.map((chapter) => String(chapter.title || '').trim())
  const bare = titles.every((title) => /^(?:[ivxlcdm]+|\d+)$/i.test(title))
  const structured = titles.filter((title) => /^(?:part|lesson|book|section|letter)\s+(?:\d+|[ivxlc]+|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve)\b/i.test(title)).length >= titles.length / 2
  if (bare || structured) return null
  const own = ownNumber.exec(titles[index])
  if (own) return Number(own[1])
  return titles.some((title) => ownNumber.test(title)) ? null : index + 1
}
function boundedMarkdown(markdown) {
  const blocks = String(markdown || '').trim().split(/\n\s*\n/).filter(Boolean)
  const excerpt = []
  let remaining = previewWords
  for (const block of blocks) {
    const words = block.match(/\S+/g) || []
    if (words.length <= remaining) {
      excerpt.push(block)
      remaining -= words.length
    } else {
      if (!excerpt.length && remaining) {
        excerpt.push(words.slice(0, remaining).join(' ').replace(/(?:==|[*_`])/g, '') + '…')
      }
      break
    }
    if (!remaining) break
  }
  return excerpt.join('\n\n')
}
function previewHtml(markdown) {
  const marks = []
  const source = String(markdown || '').replace(markPattern, (_, text) => {
    const token = `DLPREVIEWMARK${marks.length}TOKEN`
    marks.push({ token, text })
    return token
  })
  let html = String(previewRenderer.parse(source))
  for (const { token, text } of marks) {
    const safeText = text.replace(/[&<>"']/g, (character) => ({
      '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
    })[character])
    html = html.replace(token, `<mark class="print-preview-mark">${safeText}</mark>`)
  }
  return html
}
function sourcePreview(page, title, marks = false) {
  const book = BOOKS.find((entry) => entry.slug === (printP.value && printP.value.book))
  if (!book) return {
    title, html: '', page: Number(page.page) || 0, number: null, chapterWord: HC['chapter-word'] || '',
    previewLabel: HC['shot-preview-label'] || '',
  }
  const contents = ['full', 'summary', 'parts', 'both'].includes(page.contents) ? page.contents : 'both'
  const chapters = bookChapters(book.raw)
  const chapterIndex = chapters.findIndex((entry) => chapterKey(entry.title) === chapterKey(title))
  const chapter = chapters[chapterIndex]
  if (!chapter) return {
    title, html: '', page: Number(page.page) || 0, number: null, chapterWord: HC['chapter-word'] || '',
    previewLabel: HC['shot-preview-label'] || '',
  }

  const companion = chapterCompanion(book.slug, chapter.title)
  const summary = companion && companion.summaryMd
  const displayTitle = chapter.title.replace(/^(?:chapter\s+)?\d+[.:)]\s+/i, '').trim()
  let markdown
  if (marks) {
    const sources = contents === 'parts' || contents === 'both'
      ? [chapter.md, summary]
      : [contents === 'summary' ? summary : chapter.md]
    const highlighted = sources.flatMap((source) => [...String(source || '').matchAll(markPattern)]
      .map((match) => `==${match[1]}=={${match[2] || 'sun'}}`))
    markdown = highlighted.length ? highlighted.join('\n\n') : chapter.md
  } else if (contents === 'full') {
    markdown = chapter.md
  } else if (contents === 'both') {
    markdown = [chapter.md, summary].filter(Boolean).join('\n\n')
  } else {
    markdown = summary || chapter.md
  }
  return {
    title: displayTitle,
    html: previewHtml(boundedMarkdown(markdown)),
    page: Number(page.page) || 0,
    number: chapterNumber(chapters, chapterIndex),
    chapterWord: HC['chapter-word'] || '',
    previewLabel: HC['shot-preview-label'] || '',
  }
}
function pageArtFailed(art) {
  if (!art || missingPageArt.value[art]) return
  missingPageArt.value = { ...missingPageArt.value, [art]: true }
}
function zoomPage(slide) {
  zoom.value = slide.page.art && !missingPageArt.value[slide.page.art]
    ? { art: slide.page.art }
    : { preview: slide.preview }
}
const slides = computed(() => {
  if (!bookArt.value) {
    const ims = images.value
    /*
     * A BOOK STANDS AS A BOOK EVEN WITH NO PRINTED EDITION.
     *
     * "Wherever a book stands for itself it is Book3D — the store's cards, the hero and the
     * product gallery alike; never a bare <img> in a shadowed box", and the component already
     * takes the plain picture for a book that is not in print. This branch forgot the second half:
     * with no printed art it dropped to the flat image for everything, so a shop whose books carry
     * no `print:` block — the demo's four, among others — showed its books as photographs of
     * covers rather than as books.
     */
    const kind = p.value && p.value.kind
    if ((kind === 'book' || kind === 'print') && ims.length) {
      return [{ book: { plain: true, art: ims[0].src, key: 'plain' }, caption: '' },
        ...ims.slice(1).map((im) => ({ image: im, caption: '' }))]
    }
    return ims.map((im) => ({ image: im, caption: '' }))
  }
  const out = [{ book: bookArt.value, caption: HC['shot-book'] || '' }]
  const sh = shots.value
  if (sh) {
    const cap = (k) => fill(HC['shot-' + k] || '', { chapter: sh.chapter || '' })
    const previewThumb = (contents) => ({
      full: HC['shot-thumb-full'],
      summary: HC['shot-thumb-summary'],
      parts: HC['shot-thumb-parts'],
      both: HC['shot-thumb-both'],
    })[contents] || HC['shot-thumb-page'] || ''
    if (sh.edition) out.push({ page: sh.edition, preview: sourcePreview(sh.edition, sh.chapter), thumbLabel: previewThumb(sh.edition.contents), caption: cap(sh.edition.contents) })
    if (sh.other) out.push({ page: sh.other, preview: sourcePreview(sh.other, sh.chapter), thumbLabel: previewThumb(sh.other.contents), caption: cap(sh.other.contents) })
    if (sh.marks) out.push({ page: sh.marks, preview: sourcePreview(sh.marks, sh.chapter, true), thumbLabel: HC['shot-thumb-highlights'] || '', caption: cap('marks') })
  }
  return out
})
const caption = computed(() => (slides.value[at.value] && slides.value[at.value].caption) || '')
/* a page, large: the print file's page at full size over the page, until a click or Escape */
const zoom = ref(null)
function onKey(e) { if (e.key === 'Escape') zoom.value = null }
watch(zoom, (v) => { if (v) window.addEventListener('keydown', onKey); else window.removeEventListener('keydown', onKey) })
const rail = ref(null)
function show(i) { at.value = i; const el = rail.value; if (el && el.children[i]) el.children[i].scrollIntoView({ behavior: 'smooth', inline: 'start', block: 'nearest' }) }
function onRailScroll() { const el = rail.value; if (!el) return; const w = el.clientWidth || 1; at.value = Math.round(el.scrollLeft / w) }
function slideLabel(sl, i) {
  if (sl.book) return HC['mock-thumb'] || String(i + 1)
  if (sl.page) return sl.thumbLabel || fill(HC['shot-thumb-page'] || '', { n: sl.page.page }) || String(i + 1)
  return String(i + 1)
}
let gallerySwipe = null
function startGallerySwipe(e) {
  if (e.pointerType !== 'touch' || !rail.value) return
  gallerySwipe = { id: e.pointerId, x: e.clientX, y: e.clientY, left: rail.value.scrollLeft, slide: at.value, horizontal: false }
}
function moveGallerySwipe(e) {
  const swipe = gallerySwipe, el = rail.value
  if (!swipe || !el || e.pointerId !== swipe.id) return
  const dx = e.clientX - swipe.x, dy = e.clientY - swipe.y
  if (!swipe.horizontal) {
    if (Math.abs(dx) < 10 || Math.abs(dx) <= Math.abs(dy)) return
    swipe.horizontal = true
    el.setPointerCapture(e.pointerId)
  }
  e.preventDefault()
  el.scrollLeft = swipe.left - dx
}
function endGallerySwipe(e) {
  const swipe = gallerySwipe, el = rail.value
  if (!swipe || !el || e.pointerId !== swipe.id) return
  gallerySwipe = null
  if (!swipe.horizontal) return
  const dx = e.clientX - swipe.x
  const threshold = Math.max(36, el.clientWidth * 0.12)
  const next = Math.abs(dx) < threshold ? swipe.slide : swipe.slide + (dx < 0 ? 1 : -1)
  show(Math.max(0, Math.min(slides.value.length - 1, next)))
  const stop = (event) => { event.stopPropagation(); event.preventDefault() }
  el.addEventListener('click', stop, { capture: true, once: true })
  setTimeout(() => el.removeEventListener('click', stop, { capture: true }), 0)
}
function cancelGallerySwipe(e) {
  if (gallerySwipe && e.pointerId === gallerySwipe.id) gallerySwipe = null
}

/* choosing */
/* WHAT IS CHOSEN, an option name to a value. `sizes` is one option now (build/variants.mjs
   folds it in), so there is no separate size any more and no second code path for it. */
const picked = ref({})
const needSize = ref(false)
const qty = ref(1)
const sku = computed(() => (offer.value ? offer.value.sku : p.value ? p.value.sku : ''))
/* the key the cart carries. Print composes it from its own controls; everything else from the
   picker — both through the one grammar, so the string means the same thing either way. */
const pickedOptions = computed(() => normaliseOptions((p.value && p.value.options) || []))
/* the chosen variant's own price, in cents, or the offer's where it has none. One rule, and it
   is the rule the build wrote into the catalog — a price shown that is not the price charged is
   the worst bug this page can have. */
const variantAmount = computed(() => resolved.value ? resolved.value.amount : 0)
/*
 * WHAT THIS PERSON PAYS, from the lists — the same function the checkout calls, over the same
 * lists, so the amount shown and the amount charged cannot differ. The offer's own prices are a
 * list too (the base one), so there is no case here for "the price on the variant".
 */
const resolved = computed(() => {
  if (!p.value) return null
  const ctx = priceContext()
  /* FIRST what this person stands at — the price lists — and THEN what comes off, which is a
     different question with a different answer. The checkout does exactly this, in this order,
     with the same two modules, so what is shown is what is charged. */
  const stood = priceOf(priceLists(), { sku: p.value.sku, variant: variant.value, currency: p.value.currency || 'usd', quantity: qty.value, context: ctx })
    || { amount: p.value.unit_amount, original: null, standing: p.value.unit_amount }
  const line = { sku: p.value.sku, variant: variant.value, unit_price: stood.amount, quantity: qty.value }
  const cut = applyPromotions([line], promoList(), { context: { ...ctx, item_total: (ctx.item_total || 0) + stood.amount * qty.value } })
  const each = Math.max(0, Math.round((cut.lines[0].subtotal - cut.lines[0].discount) / Math.max(1, qty.value)))
  return {
    ...stood,
    amount: each,
    /* struck through: what they would have paid without the discount — their own standing price,
       which for a member is THEIR rate and not the shop's */
    original: cut.discount > 0 ? stood.amount : stood.original,
  }
})
/* a sale strikes the old price through; an override simply IS the price and strikes nothing */
const wasAmount = computed(() => (resolved.value && resolved.value.original) || null)
/* and what it says before anything is chosen: the cheapest, so "from" is true rather than a
   number somebody will not be charged */
const fromAmount = computed(() => {
  if (!p.value || !pickedOptions.value.length) return p.value ? p.value.unit_amount : 0
  const all = Object.values(p.value.variants || {}).map((v) => (v && v.price != null ? Math.round(Number(v.price) * 100) : null)).filter((n) => n != null)
  return Math.min(p.value.unit_amount, ...(all.length ? all : [p.value.unit_amount]))
})
const everyShapeCosts = computed(() => {
  if (!p.value || !pickedOptions.value.length) return null
  const amounts = new Set([p.value.unit_amount, ...Object.values(p.value.variants || {}).map((v) => (v && v.price != null ? Math.round(Number(v.price) * 100) : p.value.unit_amount))])
  return amounts.size === 1 ? [...amounts][0] : null
})
const variant = computed(() => (isPrint.value
  ? variantOf(chosen.value.contents, chosen.value.cloth, chosen.value.foil)
  : variantKey(pickedOptions.value.map((o) => ({ value: picked.value[o.name] || '' })))))
const inBag = computed(() => p.value && p.value.available && cart.hasProduct(sku.value))
const added = ref(false)
const busy = ref(false)
const error = ref('')
const errorCode = ref('')
function line() {
  if (isPrint.value) return { sku: sku.value, slug: printP.value.id, name: printP.value.title, variant: variant.value, label: lineLabel.value, unit_amount: Math.round(offer.value.price * 100),
    currency: printP.value.currency, kind: offer.value.kind === 'print' ? 'print' : 'download', image: printP.value.image ? printP.value.image.src : null }
  if (isOnline.value) return { sku: unlockP.value.sku, slug: unlockP.value.id, name: unlockP.value.title, variant: '', unit_amount: unlockP.value.unit_amount,
    currency: unlockP.value.currency, kind: unlockP.value.kindKey, image: unlockP.value.image ? unlockP.value.image.src : null }
  /*
   * THE LINE CARRIES WHAT THIS PERSON STANDS AT, NOT WHAT THEY WILL PAY.
   *
   * A discount belongs to the BAG, because it can depend on the whole of it — "£10 off orders
   * over £50" is not a property of any one line. So the line holds the standing price and the
   * bag takes the discount off, once. Carrying the discounted price here meant the bag
   * discounted it again: $18 shown as $14.40, put in the bag, and offered at $11.52.
   */
  return { sku: p.value.sku, slug: p.value.id, name: p.value.title, variant: variant.value, unit_amount: (resolved.value && resolved.value.standing) ?? variantAmount.value,
    currency: p.value.currency, kind: p.value.kindKey, image: p.value.image ? p.value.image.src : null }
}
/*
 * WHAT THE SHOP HAS. Asked of the rows, never of the build: a count baked into a page is wrong
 * by the time anybody reads it. With no backend nothing is asked and nothing is tracked, which
 * is why a static shop sells everything — it has nowhere to keep a count and so cannot have run
 * out of anything.
 */
watch(() => p.value && p.value.sku, (sku) => { if (sku) loadStock([sku, ...(unlockP.value ? [unlockP.value.sku] : [])]) }, { immediate: true })

/* can the shape in front of them be had? The one rule, the same one the checkout applies. */
const inStock = computed(() => buyable(p.value, variant.value, stock.value))

function canAdd() {
  if (!(offer.value || p.value.available)) return false
  if (pickedOptions.value.some((o) => !picked.value[o.name])) { needSize.value = true; return false }
  /* the page already refuses by the button being dead; this is the second door, for a click
     that got through on a count that moved underneath them */
  if (!inStock.value) return false
  return true
}
function addToBag() {
  if (!canAdd()) return
  cart.add(line(), qty.value)
  capture('click', { kind: 'add_to_cart', product_id: sku.value, variant: variant.value || undefined, quantity: qty.value })
  added.value = true; setTimeout(() => { added.value = false }, 1600)
  cart.openCart()
}
async function run(fn, evt, guestOk = false) {
  if (!isSignedIn.value && !guestOk) { if (window.DLauth) window.DLauth.open(); return }
  busy.value = true; error.value = ''; errorCode.value = ''
  if (evt) capture('click', evt)
  try { await fn() } catch (e) { error.value = (e && e.message) || HD['error-heading']; errorCode.value = (e && e.code) || '' } finally { busy.value = false }
}
function buyNow() {
  if (!canAdd()) return
  if (!cart.has(sku.value, variant.value)) cart.add(line(), qty.value)
  /* a printed copy or a file is bought with no account (the whole bag must be such lines) */
  run(() => checkout(cart.items.value), { kind: 'buy_now', product_id: sku.value }, guestCart(cart.items.value))
}
const join = () => run(() => subscribe(p.value.sku), { kind: 'subscribe', product_id: p.value.sku })
const manage = () => run(() => openPortal())

watch(p, (v) => {
  if (!v || preview) return
  contentView({ kind: 'product', id: v.id, title: v.title, tags: v.tags })
}, { immediate: true })
watch(picked, () => { needSize.value = false }, { deep: true })
</script>

<template>
  <div v-if="p" class="pp">
    <!-- a page of the book, large -->
    <div v-if="zoom" class="pp-zoom" role="dialog" aria-modal="true" @click="zoom = null">
      <img v-if="zoom.art" :src="zoom.art" alt="" />
      <PrintPagePreview v-else-if="zoom.preview" v-bind="zoom.preview" :zoom="true" />
      <button type="button" class="pp-zoom-x" :aria-label="HC['shot-close']" @click.stop="zoom = null">×</button>
    </div>
    <div class="pp-in wrapwide">
      <nav class="pp-crumb" aria-label="">
        <a :href="ROUTES.store">{{ P['breadcrumb-store'] }}</a>
        <template v-if="col"><span>/</span><a :href="col.href">{{ col.title }}</a></template>
        <span>/</span><span class="cur">{{ p.title }}</span>
      </nav>

      <div class="pp-grid">
        <!-- gallery -->
        <div class="pp-gallery" :class="{ 'pp-book': p.kind === 'book' || p.kind === 'print', 'pp-plan': p.kind === 'membership' }">
          <div ref="rail" class="pp-main" @scroll.passive="onRailScroll" @pointerdown="startGallerySwipe" @pointermove="moveGallerySwipe" @pointerup="endGallerySwipe" @pointercancel="cancelGallerySwipe">
            <div v-for="(sl, i) in slides" :key="sl.book ? 'book' : i" class="pp-slide" :class="{ 'pp-slide-book': sl.book }">
              <Book3D v-if="sl.book && sl.book.plain" :key="'plain' + cnt" :slug="p.book || ''" :art="sl.book.art" :fallback-art="fallbackArt" binding="softcover" :title="p.title" :fill="0.82" />
              <Book3D v-else-if="sl.book" :key="sl.book.key + cnt" :art="sl.book.art" :fallback-art="fallbackArt" :dims="sl.book.dims" :binding="sl.book.binding" :cloth="sl.book.binding !== 'softcover' ? (sl.book.cloth || cloth || 'black') : ''" :foil="sl.book.binding === 'softcover' ? '' : (sl.book.foil || foil || 'gold')" :foil-layer="sl.book.foilArt || ''" :jacket="sl.book.jacket" :edges="sl.book.edges" :sheets="sl.book.sheets || []" :trim="pr ? pr.trim : '6x9'" :pages="pagesOf || 100" :title="p.title" mode="turn" :fill="0.82" :words="{ front: HC['mock-front'], spine: HC['mock-spine'], back: HC['mock-back'], hint: HC['mock-hint'] }" />
              <div v-else-if="sl.page" class="pp-sheet">
                <button v-if="sl.page.art && !missingPageArt[sl.page.art]" type="button" class="pp-sheet-btn" :aria-label="HC['shot-zoom']" @click="zoomPage(sl)">
                  <img :src="sl.page.art" :alt="sl.caption" loading="lazy" decoding="async" @error="pageArtFailed(sl.page.art)" />
                </button>
                <button v-else type="button" class="pp-sheet-btn pp-sheet-fallback" :aria-label="HC['shot-zoom']" @click="zoomPage(sl)">
                  <PrintPagePreview v-bind="sl.preview" />
                </button>
              </div>
              <img v-else :src="sl.image.src" :alt="p.title" :loading="i === 0 ? 'eager' : 'lazy'" decoding="async"
                   :style="sl.image.blur ? { backgroundImage: 'url(' + sl.image.blur + ')', backgroundSize: 'cover' } : null" />
            </div>
            <div v-if="!slides.length" class="pp-slide pp-ph" />
          </div>
          <div v-if="slides.length > 1" class="pp-thumbs">
            <button v-for="(sl, i) in slides" :key="i" type="button" class="pp-thumb" :class="{ on: at === i, 'pp-thumb-book': sl.book, 'pp-thumb-page': sl.page }" :aria-label="slideLabel(sl, i)" @click="show(i)">
              <img v-if="sl.image" :src="sl.image.src" alt="" loading="lazy" decoding="async" />
              <img v-else-if="sl.page && sl.page.art && !missingPageArt[sl.page.art]" :src="sl.page.art" alt="" loading="lazy" decoding="async" @error="pageArtFailed(sl.page.art)" />
              <span v-else-if="sl.page && sl.preview" class="pp-thumb-preview">{{ sl.thumbLabel }}</span>
              <span v-else>{{ HC['mock-thumb'] }}</span>
            </button>
          </div>
          <div v-if="slides.length > 1" class="pp-dots">
            <button v-for="(sl, i) in slides" :key="i" type="button" class="pp-dot" :class="{ on: at === i }" :aria-label="slideLabel(sl, i)" :aria-pressed="at === i" @click="show(i)"><i /></button>
          </div>
          <!-- what the slide in view is -->
          <p v-if="caption" class="pp-caption">{{ caption }}<template v-if="slides[at] && slides[at].page"> <button type="button" class="pp-link" @click="zoomPage(slides[at])">{{ HC['shot-zoom'] }}</button></template></p>
        </div>

        <!-- the buy column -->
        <div class="pp-buy">
          <div class="pp-sticky">
            <span v-if="col" class="pp-eyebrow">{{ col.title }}</span>
            <h1 class="pp-title">{{ p.title }}</h1>
            <p v-if="isPrint ? printP.subtitle : p.subtitle" class="pp-sub">{{ isPrint ? printP.subtitle : p.subtitle }}</p>
            <p v-if="(p.kind === 'book' || p.kind === 'print') && p.bookMeta" class="pp-bookmeta">
              <template v-if="p.bookMeta.author">{{ P['book-by'] }} {{ p.bookMeta.author }} · </template>{{ p.bookMeta.chapters }} {{ P['book-chapters'] }}
            </p>

            <div class="pp-pricerow">
              <p class="pp-price" :class="{ off: !p.available }">
                <template v-if="owned">{{ P.owned }}</template>
                <template v-else>{{ priceText }}<s v-if="wasAmount" class="pp-was">{{ money(wasAmount, p.currency) }}</s></template>
              </p>
              <span v-if="isPrint" class="pp-pricenote">{{ HC['format-' + fmt] }}<template v-if="pagesOf"> · {{ fill(HC.pages, { n: pagesOf }) }}</template></span>
            </div>

            <!-- the membership -->
            <template v-if="p.kind === 'membership'">
              <template v-if="isMember">
                <span class="pp-note-active">{{ P['membership-active'] }}</span>
                <button type="button" class="pp-btn ghost" :disabled="busy" @click="manage">{{ P['membership-manage'] }}</button>
              </template>
              <button v-else type="button" class="pp-btn" :disabled="busy || !p.available" @click="join">{{ P['membership-cta'] }}</button>
            </template>

            <!-- a book or a good -->
            <template v-else>
              <!-- the format in hand, and every other way to have the book behind one line -->
              <div v-if="formats.length > 1" class="pp-opt pp-format">
                <span class="pp-optlabel">{{ HC.format }}</span>
                <p class="pp-formatnow"><b>{{ HC['format-' + fmt] || fmt }}</b>
                  <button type="button" class="pp-link" :aria-expanded="showFormats" @click="showFormats = !showFormats">{{ showFormats ? HC['fewer-formats'] : HC['other-formats'] }}</button></p>
                <ul v-if="showFormats" class="pp-formats">
                  <li v-for="f in formats" :key="f.format" :class="{ on: fmt === f.format }">
                    <button type="button" role="radio" :aria-checked="fmt === f.format" @click="fmt = f.format; showFormats = false">
                      <span class="pp-fname"><i class="pp-fdot" aria-hidden="true" />{{ HC['format-' + f.format] || f.format }}</span>
                      <span class="pp-fdesc">{{ f.format === 'online' ? P['book-unlock'] : (HC['edition-' + f.format] ? fill(HC['edition-' + f.format], { trim: String(pr.trim || '').replace('x', ' × '), paper: pr.paper, cloth: HC['cloth-' + (f.cloth ? f.cloth[0] : pr.cloth)], foil: HC['foil-' + (f.foil ? f.foil[0] : pr.foil)] }) : '') }}</span>
                      <span class="pp-fprice">{{ f.format === 'online' && ownedOnline ? P.owned : money(Math.round(f.price * 100), p.currency) }}</span>
                    </button>
                  </li>
                </ul>
              </div>
              <template v-if="pr && isPrint">
                <label v-if="pr.contents.length > 1" class="pp-opt pp-selopt">
                  <span class="pp-optlabel">{{ HC.contents }}</span>
                  <select v-model="cnt" class="pp-select">
                    <option v-for="c in pr.contents" :key="c" :value="c">{{ HC['contents-' + c] || c }}</option>
                  </select>
                </label>
                <div v-if="offer && offer.cloth && offer.cloth.length > 1" class="pp-opt">
                  <span class="pp-optlabel">{{ HC.cloth }}</span>
                  <div class="pp-chips">
                    <button v-for="c in offer.cloth" :key="c" type="button" class="pp-chip pp-swatch" :class="{ on: cloth === c }" :aria-pressed="cloth === c" @click="cloth = c"><i :class="'sw-' + c" />{{ HC['cloth-' + c] || c }}</button>
                  </div>
                </div>
                <div v-if="offer && offer.foil && offer.foil.length > 1" class="pp-opt">
                  <span class="pp-optlabel">{{ HC.foil }}</span>
                  <div class="pp-chips">
                    <button v-for="c in offer.foil" :key="c" type="button" class="pp-chip pp-swatch" :class="{ on: foil === c }" :aria-pressed="foil === c" @click="foil = c"><i :class="'sw-' + c" />{{ HC['foil-' + c] || c }}</button>
                  </div>
                </div>
              </template>
              <!-- every shape this is sold in, whatever its options are; print's own choices are
                   above, because a binding is shown with its cover rather than as a chip -->
              <VariantPicker v-if="!isPrint" v-model="picked" :offer="p" :warn="needSize" :stock="stock" />
              <ShipTo v-if="shipsNow" class="pp-ship" />
              <!-- the book online, already this reader's -->
              <a v-if="owned" class="pp-btn" :href="'/content/books/' + p.book">{{ P.owned }}</a>
              <div v-else class="pp-ctas">
                <div class="pp-ctarow">
                  <div v-if="shipsNow" class="pp-qty" :aria-label="P.qty">
                    <button type="button" :disabled="qty <= 1" @click="qty--">−</button><span>{{ qty }}</span><button type="button" :disabled="qty >= 10" @click="qty++">+</button>
                  </div>
                  <button type="button" class="pp-btn" :class="{ on: added }" :disabled="!p.available || !inStock" @click="addToBag">{{ !inStock ? P['sold-out'] : added ? P.added : P.add }}</button>
                </div>
                <button v-if="inStock" type="button" class="pp-btn ghost" :disabled="busy || !p.available" @click="buyNow">{{ busy ? T.cart.ui.working : P['buy-now'] }}</button>
              <!-- a shape that has run out says so where the second button was, rather than leaving a dead control -->
              <p v-else class="pp-out">{{ P['sold-out-note'] }}</p>
              </div>
              <p v-if="inBag && !added && !owned" class="pp-inbag">{{ P['in-bag'] }} · <button type="button" class="pp-link" @click="cart.openCart()">{{ T.cart.ui.title }}</button></p>
              <p v-if="isOnline" class="pp-unlock">{{ P['book-unlock'] }} <a :href="'/content/books/' + p.book">{{ P['book-sample'] }} →</a></p>
              <!-- the files a buyer already has -->
              <div v-if="files && files.length" class="pp-files">
                <span class="pp-optlabel">{{ HC['files-title'] }}</span>
                <p class="pp-files-subtitle">{{ HC['files-subtitle'] }}</p>
                <ul>
                  <li v-for="f in files" :key="f.contents + f.format"><a :href="f.url" download>{{ HC['download-' + f.format] || HC['download-file'] }}</a> <span>· {{ HC['contents-' + f.contents] || f.contents }}</span></li>
                </ul>
              </div>
            </template>
            <!-- the same book in its other form -->
            <p v-if="error" class="pp-err">{{ errorCode === 'stripe_unconfigured' ? HD['unconfigured-heading'] : error }}</p>

            <ul class="pp-trust">
              <li v-if="isOnline"><i class="pp-ti">✦</i>{{ PR.unlock }}</li>
              <li v-if="isPrint"><i class="pp-ti">✦</i>{{ HC['made-to-order'] }}</li>
              <li><i class="pp-ti">✦</i>{{ PR.secure }}</li>
              <li v-if="shipsNow"><i class="pp-ti">✦</i>{{ PR.ships }}</li>
              <li v-if="shipsNow"><i class="pp-ti">✦</i>{{ PR.final }}</li>
            </ul>

            <div class="pp-panels">
              <section v-for="(pn, i) in panels" :key="i" class="pp-panel" :class="{ open: openPanel === i }">
                <button type="button" class="pp-panel-h" :aria-expanded="openPanel === i" @click="openPanel = openPanel === i ? -1 : i">
                  {{ pn.title }}
                  <svg viewBox="0 0 20 20" width="14" height="14" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"><path d="M5 8l5 5 5-5" /></svg>
                </button>
                <div v-show="openPanel === i" class="pp-panel-b" v-html="pn.html" />
              </section>
            </div>
          </div>
        </div>
      </div>

      <section v-if="others.length" class="pp-related">
        <h2>{{ P.related }}</h2>
        <Carousel :items="others" class="pp-rail">
          <template #item="{ item }"><ProductCard :product="item" /></template>
        </Carousel>
      </section>
      <!-- what people say about it, where the file says it takes comments -->
      <CommentThread class="pp-comments" kind="product" :subject="id" />
    </div>
  </div>
  <div v-else-if="ready || preview" class="pp wrapwide pp-missing">
    <h1>{{ HD['not-found'] }}</h1>
    <a class="pp-link" :href="ROUTES.store">{{ HD['not-found-cta'] }}</a>
  </div>
</template>

<style scoped>
.pp { padding: 22px 0 clamp(56px, 8vw, 110px) }
.pp-crumb { display: flex; gap: 10px; font-family: var(--m); font-size: 11px; letter-spacing: .08em; text-transform: uppercase; color: var(--ink3); margin-bottom: 22px; min-width: 0 }
.pp-crumb a { color: inherit; text-decoration: none } .pp-crumb a:hover { color: var(--ink) }
.pp-crumb .cur { color: var(--ink2); overflow: hidden; text-overflow: ellipsis; white-space: nowrap }
.pp-grid { display: grid; grid-template-columns: minmax(0, 7fr) minmax(0, 5fr); gap: clamp(24px, 4vw, 64px); align-items: start }

/* gallery */
.pp-main { display: flex; overflow-x: auto; scroll-snap-type: x mandatory; scrollbar-width: none; border-radius: 22px; background: var(--wash); touch-action: pan-y }
.pp-main::-webkit-scrollbar { display: none }
.pp-slide { flex: 0 0 100%; scroll-snap-align: start; aspect-ratio: 4 / 5; position: relative }
.pp-slide img { position: absolute; inset: 0; width: 100%; height: 100%; object-fit: cover; display: block }
/* the book itself: the mockup fills the slide; its own images are the cover's panels, not the slide's picture */
.pp-slide-book { display: flex } .pp-slide-book > * { position: absolute; inset: 8% 12%; width: auto; height: auto; aspect-ratio: auto }   /* air on every side of the book */
.pp-book .pp-slide-book img { object-fit: unset; padding: 0; filter: none }
/* a page of the book: the sheet on the gallery's ground, with its shadow */
.pp-sheet { position: absolute; inset: 0; display: flex; align-items: stretch; justify-content: center }
.pp-sheet-btn { display: block; height: 100%; max-width: 100%; padding: 0; border: 0; background: transparent; cursor: zoom-in }
.pp-sheet-fallback { width: 80% }
.pp-sheet img { position: static; width: auto; height: 100%; max-width: 100%; object-fit: contain; background: #fff; box-shadow: 0 0 0 1px #0000000d, 0 0 40px #0000001a; padding: 0; filter: none }
.pp-zoom { position: fixed; inset: 0; z-index: 90; background: rgba(12, 10, 8, .86); display: flex; align-items: center; justify-content: center; padding: 24px; cursor: zoom-out; backdrop-filter: blur(4px) }
.pp-zoom img { max-height: 94vh; max-width: 96vw; height: auto; width: auto; background: #fff; box-shadow: 0 40px 100px -30px #000 }
.pp-zoom-x { position: absolute; top: 14px; right: 18px; width: 40px; height: 40px; border-radius: 50%; border: 1px solid #ffffff44; background: #00000055; color: #fff; font-size: 24px; line-height: 1; cursor: pointer }

.pp-thumb-page img { object-fit: cover; object-position: top; padding: 0 !important; background: #fff }
.pp-thumb-preview { display: flex; align-items: center; justify-content: center; width: 100%; height: 100%; padding: 5px; box-sizing: border-box; color: var(--ink2); font-family: var(--fd); font-size: 10px; line-height: 1.2; text-align: center; background: var(--paper) }
.pp-caption { margin: 14px 4px 0; font-size: 13.5px; line-height: 1.5; color: var(--ink2); max-width: 60ch }
.pp-thumb-book { display: flex; align-items: center; justify-content: center; font-family: var(--m); font-size: 9.5px; letter-spacing: .08em; text-transform: uppercase; color: var(--ink3); text-align: center; padding: 6px }
/* nothing to show: the words come first, not an empty frame. This was written for narrow screens
   alone, and the empty frame stood at every other width. */
.pp-gallery:has(.pp-ph) { display: none }
.pp-book .pp-main { background: color-mix(in srgb, var(--ink) 6%, var(--paper)) }
.pp-book .pp-slide img { object-fit: contain; padding: 8% 16%; filter: drop-shadow(0 30px 40px #00000040) }
.pp-book .pp-sheet img { padding: 0; filter: none; object-fit: contain }
.pp-plan .pp-slide { aspect-ratio: 4 / 5 }
.pp-thumbs { display: flex; gap: 10px; margin-top: 12px }
.pp-thumb { width: 72px; aspect-ratio: 4 / 5; border-radius: 10px; overflow: hidden; padding: 0; border: 1px solid var(--hair); background: var(--wash); cursor: pointer; opacity: .7; transition: opacity .15s, border-color .15s }
.pp-thumb img { width: 100%; height: 100%; object-fit: cover; display: block }
.pp-book .pp-thumb img { object-fit: contain; padding: 8% }
.pp-thumb.on, .pp-thumb:hover { opacity: 1; border-color: var(--ink) }
.pp-dots { display: none; justify-content: center; gap: 4px; margin-top: 10px }
.pp-dot { display: grid; place-items: center; width: 36px; height: 36px; padding: 0; border: 0; border-radius: 50%; background: transparent; cursor: pointer }
.pp-dot i { width: 6px; height: 6px; border-radius: 50%; background: var(--hair); transition: transform .15s, background .15s }
.pp-dot.on i { background: var(--ink); transform: scale(1.2) }
.pp-dot:focus-visible { outline: 2px solid var(--accent2); outline-offset: 1px }

/* the buy column */
.pp-sticky { position: sticky; top: 84px }
.pp-eyebrow { display: block; font-family: var(--m); font-size: 10.5px; letter-spacing: .16em; text-transform: uppercase; color: var(--accent2); margin-bottom: 12px }
.pp-title { font-family: var(--fd); font-weight: 600; font-size: clamp(32px, 3.6vw, 46px); line-height: 1.02; letter-spacing: -.03em; margin: 0 0 10px; text-wrap: balance }
.pp-sub { font-size: 16.5px; color: var(--ink2); margin: 0 0 6px; line-height: 1.45 }
.pp-bookmeta { font-family: var(--m); font-size: 12px; letter-spacing: .04em; color: var(--ink3); margin: 0 0 6px }
.pp-pricerow { display: flex; align-items: baseline; gap: 12px; flex-wrap: wrap; margin: 16px 0 22px }
.pp-price { font-family: var(--fd); font-weight: 600; font-size: 28px; letter-spacing: -.01em; margin: 0; font-variant-numeric: tabular-nums }
.pp-pricenote { font-size: 13.5px; color: var(--ink3) }
.pp-price.off { color: var(--ink3); font-size: 18px }
.pp-btn { display: inline-flex; align-items: center; justify-content: center; width: 100%; font: inherit; font-size: 15.5px; font-weight: 600; color: var(--paper); background: var(--ink);
  border: 1px solid var(--ink); border-radius: 999px; padding: 14px 22px; cursor: pointer; text-decoration: none; transition: transform .14s, box-shadow .14s, background .15s }
.pp-btn:hover { transform: translateY(-1px); box-shadow: 0 12px 28px -14px #000a }
.pp-btn:disabled { opacity: .55; cursor: default; transform: none; box-shadow: none }
.pp-out { margin: 0; font-size: 14px; color: var(--ink3) }
.pp-was { margin-left: 10px; font-size: .62em; color: var(--ink3); text-decoration-thickness: 1px }
.pp-btn.ghost { color: var(--ink); background: transparent; border-color: var(--hair) } .pp-btn.ghost:hover { border-color: var(--ink3) }
.pp-btn.on { background: var(--accent2); border-color: var(--accent2) }
.pp-ctas { display: grid; gap: 10px; margin-top: 4px }
.pp-ctarow { display: flex; gap: 10px; align-items: stretch } .pp-ctarow .pp-btn { flex: 1 }
.pp-ctarow .pp-qty { flex: none; height: 50px; border-radius: 999px } .pp-ctarow .pp-qty button { height: 48px; width: 40px }
.pp-opt { margin: 0 0 18px }
.pp-optlabel { display: block; font-family: var(--m); font-size: 11px; letter-spacing: .1em; text-transform: uppercase; color: var(--ink3); margin-bottom: 10px }
.pp-opt.warn .pp-optlabel { color: #b45309 } .pp-optlabel em { font-style: normal }
.pp-chips { display: flex; gap: 8px; flex-wrap: wrap }
.pp-chip { min-width: 46px; font: inherit; font-size: 13.5px; font-weight: 500; color: var(--ink2); background: transparent; border: 1px solid var(--hair); border-radius: 999px; padding: 9px 14px; cursor: pointer; transition: border-color .12s, color .12s, background .12s }
.pp-chip:hover { border-color: var(--ink3); color: var(--ink) }
.pp-chip.on { color: var(--paper); background: var(--ink); border-color: var(--ink) }
.pp-opt.warn .pp-chips { animation: pp-shake .3s }
@keyframes pp-shake { 25% { transform: translateX(-3px) } 75% { transform: translateX(3px) } }
.pp-qty { display: inline-flex; align-items: center; border: 1px solid var(--hair); border-radius: 999px; overflow: hidden }
.pp-qty button { width: 38px; height: 38px; font: inherit; font-size: 18px; color: var(--ink2); background: none; border: 0; cursor: pointer }
.pp-qty button:disabled { color: var(--hair); cursor: default }
.pp-qty span { min-width: 30px; text-align: center; font-family: var(--m); font-size: 14px }
.pp-inbag { margin: 12px 0 0; font-size: 13.5px; color: var(--ink3) }
.pp-caption .pp-link { margin-left: .4em }
.pp-link { font: inherit; font-size: inherit; color: var(--accent2); background: none; border: 0; padding: 0; cursor: pointer; text-decoration: none }
.pp-link:hover { text-decoration: underline; text-underline-offset: 3px }
.pp-formatnow { margin: 0; font-size: 14.5px; display: flex; align-items: baseline; gap: 12px; flex-wrap: wrap } .pp-formatnow b { font-weight: 600 }
.pp-formats { list-style: none; margin: 10px 0 0; padding: 0; border: 1px solid var(--hair); border-radius: 12px; overflow: hidden }
.pp-formats li + li { border-top: 1px solid var(--hair) }
.pp-formats button { display: grid; grid-template-columns: minmax(0, 1fr) auto; grid-template-areas: "n p" "d p"; column-gap: 12px; width: 100%; text-align: left; font: inherit; color: var(--ink); background: transparent; border: 0; padding: 10px 14px; cursor: pointer }
.pp-formats button:hover { background: var(--wash) }
.pp-formats li.on button { background: var(--wash) }
.pp-fname { grid-area: n; font-weight: 600; font-size: 14px; display: flex; align-items: center; gap: 9px }
.pp-fdot { width: 14px; height: 14px; border-radius: 50%; border: 1.5px solid var(--ink3); flex: none; position: relative }
.pp-formats li.on .pp-fdot { border-color: var(--ink) } .pp-formats li.on .pp-fdot::after { content: ''; position: absolute; inset: 3px; border-radius: 50%; background: var(--ink) }
.pp-fdesc { padding-left: 23px } .pp-fdesc { grid-area: d; font-size: 12.5px; color: var(--ink3); line-height: 1.4 } .pp-fprice { grid-area: p; align-self: center; font-family: var(--m); font-size: 12.5px; color: var(--ink2); text-align: right; max-width: 110px }
.pp-selopt { display: block } .pp-select { width: 100%; font: inherit; font-size: 14px; color: var(--ink); background: var(--paper); border: 1px solid var(--hair); border-radius: 10px; padding: 10px 12px }
.pp-chip small { font-family: var(--m); font-size: 11px; font-weight: 400; opacity: .7; margin-left: 4px }
.pp-swatch i { display: inline-block; width: 11px; height: 11px; border-radius: 50%; margin-right: 7px; vertical-align: -1px; border: 1px solid rgba(0,0,0,.15) }
.sw-navy { background: #1f2a44 } .sw-gray { background: #8a8a86 } .sw-red { background: #7a1f24 } .sw-black { background: #1a1a1a } .sw-tan { background: #c9b48c } .sw-forest { background: #22432f } .sw-gold { background: #c9a44a } .sw-white { background: #f4f1ea }
.pp-files { margin: 18px 0 0; padding: 14px 16px; border: 1px solid var(--hair); border-radius: 12px }
.pp-files-subtitle { margin: -4px 0 8px; font-size: 13px; color: var(--ink3) }
.pp-files ul { list-style: none; margin: 0; padding: 0 } .pp-files li { font-size: 13.5px; line-height: 1.7 } .pp-files li span { color: var(--ink3) }
.pp-files a { color: var(--accent2); text-decoration: none } .pp-files a:hover { text-decoration: underline; text-underline-offset: 3px }
.pp-unlock { margin: 14px 0 0; font-size: 13.5px; line-height: 1.5; color: var(--ink2) }
.pp-unlock a { color: var(--accent2); text-decoration: none; white-space: nowrap } .pp-unlock a:hover { text-decoration: underline; text-underline-offset: 3px }
.pp-ship { margin: 14px 0 6px }
.pp-twin { margin: 12px 0 0; padding-top: 12px; border-top: 1px solid var(--hair); font-size: 13.5px; line-height: 1.5; color: var(--ink2) }
.pp-twin a { color: var(--accent2); text-decoration: none; white-space: nowrap } .pp-twin a:hover { text-decoration: underline; text-underline-offset: 3px }
.pp-note-active { display: block; font-family: var(--m); font-size: 11px; letter-spacing: .12em; text-transform: uppercase; color: var(--accent2); margin-bottom: 10px }
.pp-err { margin: 12px 0 0; font-size: 13.5px; color: #b45309 }
.pp-trust { list-style: none; margin: 22px 0 0; padding: 16px 0 0; border-top: 1px solid var(--hair); display: flex; flex-direction: column; gap: 7px; font-size: 13px; color: var(--ink3) }
.pp-trust svg {margin-top:5px; }
.pp-trust li { display: flex; gap: 10px; align-items: baseline; line-height: 1.45 }
.pp-ti { font-style: normal; color: var(--accent2); font-size: 10px; flex: none }
.pp-panels { margin-top: 22px; border-top: 1px solid var(--hair) }
/* the site's stylesheet owns bare section (56px of padding, a rule under): none of that here */
.pp-panel { padding: 0; border: 0; border-bottom: 1px solid var(--hair) }
.pp-panel-h { width: 100%; display: flex; align-items: center; justify-content: space-between; gap: 12px; font: inherit; font-size: 15px; font-weight: 600; color: var(--ink); background: none; border: 0; padding: 15px 0; cursor: pointer; text-align: left }
.pp-panel-h svg { color: var(--ink3); transition: transform .18s } .pp-panel.open .pp-panel-h svg { transform: rotate(180deg) }
.pp-panel-b { padding: 0 0 18px; font-size: 15px; line-height: 1.6; color: var(--ink2) }
.pp-panel-b :deep(p) { margin: 0 0 10px } .pp-panel-b :deep(ul) { margin: 0 0 10px; padding-left: 18px } .pp-panel-b :deep(li) { margin: 0 0 4px }

/* related */
.pp-related { margin-top: clamp(56px, 8vw, 110px) }
.pp-related h2 { font-family: var(--fd); font-weight: 600; font-size: clamp(24px, 2.8vw, 32px); letter-spacing: -.025em; margin: 0 0 22px }
.pp-rail { --rail-item: 260px; --rail-arrow-y: 36% }
.pp-missing { padding-top: 80px; text-align: center }
.pp-missing h1 { font-family: var(--fd); font-weight: 600; font-size: 30px; margin: 0 0 12px }

@media (max-width: 900px) {
  .pp-grid { grid-template-columns: 1fr; gap: 26px }
  .pp-sticky { position: static }
  .pp-thumbs { display: none } .pp-dots { display: flex }
  .pp-rail { --rail-item: 66vw }
}
</style>
