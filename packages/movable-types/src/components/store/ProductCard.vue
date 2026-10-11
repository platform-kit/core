<script setup>
/*
 * One product in a grid or a rail: the image (swapping to the second on hover
 * when there is one), the badge, the title, a line of context, the live price,
 * and a quick add for anything that needs no choosing first. Everything else
 * happens on the product's own page.
 */
import { computed, ref, watch } from 'vue'
import { us } from '@platform-kit/kit/lib/content.js'
import { counts as stock, loadStock, offerOut } from '@platform-kit/kit/lib/stock.js'
import { money } from '@platform-kit/kit/lib/commerce.js'
import { coverFor, PRINTED } from '@platform-kit/kit/lib/print-offers.js'
import { hasProduct, userClass } from '@platform-kit/kit/lib/auth.js'
import * as cart from '@platform-kit/kit/lib/cart.js'
import { capture } from '@platform-kit/kit/lib/analytics.js'
import { hardcoverOf, editionOf } from '@platform-kit/kit/lib/storefront.js'
import { bookCoverOf } from '@platform-kit/kit/lib/book-art.js'
import { wash } from '@platform-kit/kit/lib/tint.js'
import Book3D from '../Book3D.vue'
import Stars from '../landing/Stars.vue'

const props = defineProps({
  product: { type: Object, required: true },
  eager: { type: Boolean, default: false } /* above the fold: no lazy loading */,
})
const P = us('store').product.ui
const H = us('store').home.sections
const p = computed(() => props.product)
const second = computed(() => (p.value.images && p.value.images[1]) || null)
/* a book in print: the card shows the printed book (its main offer's cover) and that offer's price,
   whether the card is the unlock's or the print page's */
const printP = computed(() =>
  p.value.kind === 'print' ? p.value : p.value.kind === 'book' ? hardcoverOf(p.value.book) : null,
)
const bookArt = computed(() => {
  const pp = printP.value
  if (!pp || !pp.print) return null
  const ed = editionOf(pp.book)
  const e = ed && ed.editions && ed.editions[pp.print.contents[0]]
  if (!e || !e.art || !e.dims) return null
  const format =
    PRINTED.includes(pp.print.main) && e.printers && e.printers[pp.print.main]
      ? pp.print.main
      : PRINTED.find((f) => e.printers && e.printers[f])
  const cv = format && coverFor(e, format, pp.print.cloth, pp.print.foil)
  return cv
    ? {
        art: cv.art,
        dims: cv.dims,
        binding: cv.binding,
        jacket: cv.jacket,
        cloth: cv.cloth,
        foil: cv.foil,
        foilArt: cv.foilArt,
        edges: cv.edges,
        sheets: cv.sheets,
        trim: pp.print.trim,
        pages: e.pages,
        title: pp.title,
        author: '',
      }
    : null
})
const fallbackArt = computed(() => (p.value.book ? bookCoverOf(p.value.book) : ''))
/*
 * A BOOK STANDS AS A BOOK WHETHER OR NOT IT IS IN PRINT.
 *
 * "Wherever a book stands for itself it is Book3D — the library shelf, the hub, the results page,
 * the landing, the store's cards, the hero and the product gallery alike; never a bare <img> in a
 * shadowed box." A card drew the book only when it had a printed cover sheet to wear, so a shop
 * whose books carry no `print:` block showed photographs of covers in boxes instead. Book3D already
 * takes the plain picture for a book that is not in print — this is the caller catching up.
 */
const plainBook = computed(
  () =>
    !bookArt.value &&
    (p.value.kind === 'book' || p.value.kind === 'print') &&
    p.value.image &&
    p.value.image.src
      ? p.value.image.src
      : '',
)
/* either way the book stands on the paper itself rather than in a card's box */
const asBook = computed(() => !!bookArt.value || !!plainBook.value)
/* "yours" is the book online; a card for a book in print sells the copy whoever holds the ebook */
const owned = computed(
  () =>
    !printP.value &&
    p.value.kind === 'book' &&
    (hasProduct(p.value.book) || userClass.value === 'subscribed'),
)
/* a book in print has choices to make on its page, so a card that shows the printed book never adds
   anything blind — not the copy, and not the unlock it also stands for */
const quick = computed(
  () =>
    p.value.available &&
    !out.value &&
    !owned.value &&
    !printP.value &&
    p.value.kind !== 'membership' &&
    p.value.kind !== 'print' &&
    !(p.value.sizes && p.value.sizes.length),
)
/*
 * SOLD OUT ON THE CARD. A product is sold out only when EVERY shape it sells is gone — one
 * size left is not sold out, however many are missing. Unknown is never sold out, so a static
 * shelf and a shelf whose fetch failed both read exactly as they did before there were counts.
 */
watch(() => p.value && p.value.sku, (sku) => { if (sku && p.value.tracked) loadStock(sku) }, { immediate: true })
const out = computed(() => offerOut(p.value, p.value.variants || [], stock.value))
const inBag = computed(() => p.value.available && cart.hasProduct(p.value.sku))
const HC = us('store').product.print || {}
const priceText = computed(() => {
  /* a book in print: its main offer's price — "from" it when other printed formats cost more */
  if (printP.value && printP.value.available) {
    const m = money(printP.value.unit_amount, printP.value.currency)
    const more = (printP.value.print.formats || []).some(
      (f) => f.kind === 'print' && f.price * 100 > printP.value.unit_amount,
    )
    return more && HC['main-price'] ? HC['main-price'] + ' ' + m : m
  }
  if (!p.value.available) return P.unavailable
  if (out.value) return P['sold-out']
  const m = money(p.value.unit_amount, p.value.currency)
  return p.value.recurring ? m + ' ' + (H['per-' + (p.value.interval || 'month')] || '') : m
})
const context = computed(
  () => (p.value.bookMeta && p.value.bookMeta.author) || p.value.subtitle || '',
)
const added = ref(false)
function quickAdd(e) {
  e.preventDefault()
  e.stopPropagation()
  cart.add({
    sku: p.value.sku,
    slug: p.value.id,
    name: p.value.title,
    variant: '',
    unit_amount: p.value.unit_amount,
    currency: p.value.currency,
    kind: p.value.kindKey,
    image: p.value.image ? p.value.image.src : null,
  })
  capture('click', { kind: 'add_to_cart', product_id: p.value.sku, from: 'card' })
  added.value = true
  setTimeout(() => {
    added.value = false
  }, 1400)
  cart.openCart()
}
</script>

<template>
  <a
    class="pc"
    :class="{ 'pc-book': p.kind === 'book' || p.kind === 'print', 'pc-print': asBook }"
    :href="p.href"
  >
    <div class="pc-media">
      <Book3D
        v-if="bookArt"
        class="pc-mock"
        :art="bookArt.art"
        :fallback-art="fallbackArt"
        :dims="bookArt.dims"
        :binding="bookArt.binding"
        :cloth="bookArt.binding !== 'softcover' ? bookArt.cloth || 'black' : ''"
        :foil="bookArt.binding === 'softcover' ? '' : bookArt.foil || 'gold'"
        :foil-layer="bookArt.foilArt || ''"
        :jacket="bookArt.jacket"
        :edges="bookArt.edges"
        :sheets="bookArt.sheets || []"
        :trim="bookArt.trim"
        :pages="bookArt.pages"
        :title="bookArt.title"
        :author="bookArt.author"
        mode="still"
        :fill="0.78"
        anchor="left"
      />
      <Book3D
        v-else-if="plainBook"
        class="pc-mock"
        :slug="p.book || ''"
        :art="plainBook"
        binding="softcover"
        :title="p.title"
        mode="still"
        :fill="0.78"
        anchor="left"
      />
      <img
        v-else-if="p.image"
        class="pc-img"
        :src="p.image.src"
        :alt="p.title"
        :loading="eager ? 'eager' : 'lazy'"
        decoding="async"
        :style="
          p.image.blur
            ? { backgroundImage: 'url(' + p.image.blur + ')', backgroundSize: 'cover' }
            : null
        "
      />
      <div v-else class="pc-img pc-ph" :style="wash(p.title || p.sku)"><span>{{ p.title }}</span></div>
      <img
        v-if="second && !asBook"
        class="pc-img pc-alt"
        :src="second.src"
        alt=""
        loading="lazy"
        decoding="async"
      />
      <span v-if="p.badge" class="pc-badge">{{ p.badge }}</span>
      <button v-if="quick" type="button" class="pc-quick" :class="{ on: added }" @click="quickAdd">
        {{ added ? P.added : P.add }}
      </button>
    </div>
    <div class="pc-body">
      <h3 class="pc-title">{{ p.title }}</h3>
      <p v-if="context" class="pc-ctx">
        {{
          (p.kind === 'book' || p.kind === 'print') && p.bookMeta && p.bookMeta.author
            ? P['book-by'] + ' ' + context
            : context
        }}
      </p>
      <p class="pc-price" :class="{ owned, off: !p.available || out }">
        <template v-if="owned">{{ P.owned }}</template>
        <template v-else
          >{{ priceText }}<s v-if="p.compare && p.available" class="pc-was">{{ p.compare }}</s><span v-if="inBag" class="pc-inbag"> · {{ P['in-bag'] }}</span></template
        >
      </p>
      <Stars v-if="p.rating" :value="Number(p.rating)" :line="p.reviews ? (P.reviews || '').replace('{n}', p.reviews) : ''" class="pc-stars" />
    </div>
  </a>
</template>

<style scoped>
.pc {
  display: block;
  color: inherit;
  text-decoration: none;
  min-width: 0;
}
.pc-media {
  position: relative;
  aspect-ratio: 4 / 5;
  border-radius: 14px;
  overflow: hidden;
  background: var(--wash);
  isolation: isolate;
}
.pc-book .pc-media {
  background: color-mix(in srgb, var(--ink) 6%, var(--paper));
}
.pc-mock {
  position: absolute;
  inset: 0;
  width: 100%;
  height: 100%;
  aspect-ratio: auto;
  transition: transform 0.7s cubic-bezier(0.2, 0.8, 0.2, 1);
}
.pc:hover .pc-mock {
  transform: translateY(-2%) scale(1.03);
}
/* a printed book stands on the paper itself: no box, no ground — at the left of its room, so its
   spine lines up with the words under it; its badge floats on the cover's corner */
.pc-print .pc-media {
  background: transparent;
  border-radius: 0;
  overflow: visible;
  /* the room IS the book: a book is 2:3, and a 4:5 box left a margin of bare paper either side of
     it that nothing explained — and that the quick-add pill, which spans the room, floated over */
  aspect-ratio: 2 / 3;
}
.pc-print .pc-body {
  padding: 8px 0 0;
  margin-top: 4px;
} /* the words flush with the spine */
.pc-print:hover .pc-mock {
  transform: none;
} /* the book's own lift is the card's hover */
@media (min-width: 768px) {
  .pc-print .pc-badge {
    top: 10px;
    left: -10px;
    color: var(--ink);
    background: var(--paper);
    box-shadow: 0 2px 8px #00000040;
  }
}
.pc-print .pc-badge {
  top: 10px;
  left: 10px;
  color: var(--ink);
  background: var(--paper);
  box-shadow: 0 2px 8px #00000040;
}
.pc-img {
  position: absolute;
  inset: 0;
  width: 100%;
  height: 100%;
  object-fit: cover;
  transition:
    transform 0.7s cubic-bezier(0.2, 0.8, 0.2, 1),
    opacity 0.35s ease;
}
.pc-book .pc-img {
  object-fit: contain;
  padding: 9% 14%;
  filter: drop-shadow(0 18px 26px #00000033);
}
.pc-ph {
  background: linear-gradient(150deg, var(--a), var(--b));
  display: grid;
  place-items: center;
  padding: 12% 14%;
}
.pc-ph span {
  font-family: var(--fd);
  font-weight: 600;
  font-size: clamp(17px, 2.1vw, 23px);
  line-height: 1.16;
  letter-spacing: -0.02em;
  text-align: center;
  text-wrap: balance;
  color: var(--ink);
}
.pc-alt {
  opacity: 0;
}
.pc:hover .pc-img:not(.pc-alt) {
  transform: scale(1.04);
}
.pc:hover .pc-alt {
  opacity: 1;
  transform: scale(1.04);
}
.pc-badge {
  position: absolute;
  top: 12px;
  left: 12px;
  z-index: 3; /* over the book's cover (z 2) */
  font-family: var(--m);
  font-size: 10px;
  letter-spacing: 0.14em;
  text-transform: uppercase;
  color: var(--paper);
  background: var(--ink);
  border-radius: 999px;
  padding: 5px 9px;
}
.pc-quick {
  position: absolute;
  left: 12px;
  right: 12px;
  bottom: 12px;
  z-index: 3; /* over the book's cover (z 2), as the badge is — under it the button is unpressable */
  font: inherit;
  font-size: 13.5px;
  font-weight: 600;
  color: var(--ink);
  background: color-mix(in srgb, var(--paper) 88%, transparent);
  backdrop-filter: blur(10px);
  border: 1px solid var(--hair);
  border-radius: 999px;
  padding: 10px 14px;
  cursor: pointer;
  opacity: 0;
  transform: translateY(8px);
  transition:
    opacity 0.18s,
    transform 0.18s,
    background 0.15s;
}
.pc:hover .pc-quick,
.pc:focus-within .pc-quick {
  opacity: 1;
  transform: none;
}
.pc-quick:hover {
  background: var(--paper);
}
.pc-quick.on {
  color: var(--paper);
  background: var(--ink);
  border-color: var(--ink);
}
@media (hover: none) {
  .pc-quick {
    opacity: 1;
    transform: none;
  }
}
.pc-body {
  padding: 14px 4px 0;
}
.pc-title {
  font-family: var(--fd);
  font-weight: 600;
  font-size: 17px;
  letter-spacing: -0.01em;
  line-height: 1.2;
  margin: 0 0 3px;
  text-wrap: balance;
}
.pc-ctx {
  font-size: 13.5px;
  color: var(--ink3);
  margin: 0 0 6px;
  overflow: hidden;
  display: -webkit-box;
  -webkit-box-orient: vertical;
  -webkit-line-clamp: 2;
  line-clamp: 2;
}
.pc-price {
  font-family: var(--m);
  font-size: 13px;
  color: var(--ink2);
  margin: 0;
  font-variant-numeric: tabular-nums;
}
.pc-was { margin-left: 8px; font-weight: 400; opacity: .5 }
.pc-stars { margin-top: 4px; font-size: 12px }
.pc-price.owned {
  color: var(--accent2);
}
.pc-price.off {
  color: var(--ink3);
}
.pc-inbag {
  color: var(--accent2);
}
</style>
