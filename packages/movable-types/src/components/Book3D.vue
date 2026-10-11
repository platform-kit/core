<script setup>
/*
 * A book, as the reference draws one (the "Animated 3D Book Collection" pen by filipz, after
 * realvjy's book-cover effect — the look, redone here): the cover square to the reader on a
 * back board, five leaves behind it, a crease of light by the spine. Under the pointer the cover
 * lifts a little toward the reader and the leaves fan out one after another, each its own sheet
 * with its own edge and shadow, the deepest standing out furthest, the shadow deepening. The back
 * board wears the cover's own picture, darkened — so the book keeps its colour at the fore-edge
 * and the board reads apart from the cream of the leaves. No WebGL, no scene: a few elements and
 * one transition each.
 *
 * The cover is the e-book's picture, or — for a book in print — the front panel of its printed
 * cover sheet, placed by the printer's dimensions: given a `slug`, the book wears its softcover as
 * the store prints it (the picture with the mark and the edition line) wherever it stands. The
 * markdown cover sits beneath that generated art as a fallback when it is missing. The leaves can
 * carry the listing's pictures of printed pages. `flat` gives the plain picture (a share card).
 */
import { computed } from 'vue'
import { bookCoverOf, printedArtOf } from '@platform-kit/kit/lib/book-art.js'

const props = defineProps({
  slug: { type: String, default: '' },                /* the book: its printed softcover is worn when it has one */
  art: { type: String, default: '' },                 /* the cover: a picture, or the printed sheet */
  fallbackArt: { type: String, default: '' },          /* the ordinary cover from the book's markdown */
  dims: { type: Object, default: null },              /* the sheet's dimensions in points: { width, height, spine, bleed, flap } */
  trim: { type: String, default: '6x9' },
  pages: { type: Number, default: 120 },              /* thickness: how far the leaves and the back board stand out */
  binding: { type: String, default: 'softcover' },
  title: { type: String, default: '' },
  alt: { type: String, default: '' },
  sheets: { type: Array, default: () => [] },         /* pictures of printed pages, on the leaves */
  flat: { type: Boolean, default: false },
  eager: { type: Boolean, default: false },
  /* kept for the callers: this book has one face */
  cloth: { type: String, default: '' }, foil: { type: String, default: '' }, foilLayer: { type: String, default: '' }, jacket: { type: Boolean, default: true },
  edges: { type: [String, Object], default: null }, endpapers: { type: [String, Object], default: null }, paper: { type: String, default: 'cream' },
  mode: { type: String, default: 'still' }, pose: { type: Object, default: null }, fill: { type: Number, default: 0.8 },
  anchor: { type: String, default: 'center' },        /* where the book stands in a wider room: center, or left — against the words under it */ author: { type: String, default: '' }, words: { type: Object, default: () => ({}) },
})

const TRIM_PT = { '6x9': { w: 432, h: 648 }, '5x8': { w: 360, h: 576 }, '6.14x9.21': { w: 442, h: 663 } }
/* what the book wears: the printed softcover by slug, else what the caller passed */
const printed = computed(() => (props.slug && !props.flat ? printedArtOf(props.slug) : null))
const art = computed(() => (printed.value ? printed.value.art : props.art))
const dims = computed(() => (printed.value ? printed.value.dims : props.dims))
const binding = computed(() => (printed.value ? printed.value.binding : props.binding))
const trim = computed(() => (printed.value ? printed.value.trim : props.trim))
const pages = computed(() => (printed.value ? printed.value.pages : props.pages))
const sheets = computed(() => (printed.value && !props.sheets.length ? printed.value.sheets : props.sheets))
const ordinaryCover = computed(() => props.fallbackArt || (props.slug && !props.flat ? bookCoverOf(props.slug) : ''))
/* the front panel of a printed sheet — [back flap] [back] [spine] [front] [front flap] with a
   bleed round it — as a background sized and placed to show that panel alone. The markdown cover
   sits beneath it, so a deploy without generated print art still has a real cover to show. */
const cover = computed(() => {
  const d = dims.value
  const fallback = ordinaryCover.value && art.value !== ordinaryCover.value
  const backgroundImage = fallback ? `url("${art.value}"), url("${ordinaryCover.value}")` : `url("${art.value}")`
  if (!d || !d.width) return fallback
    ? { backgroundImage, backgroundSize: 'cover, cover', backgroundPosition: 'center, center', backgroundRepeat: 'no-repeat, no-repeat' }
    : { backgroundImage }
  const t = TRIM_PT[trim.value] || TRIM_PT['6x9'], bleed = d.bleed || 0, flap = d.flap || 0, spine = Math.max(d.spine || 0, 6)
  const x = bleed + flap + t.w + spine, y = bleed, w = t.w, h = d.height - 2 * bleed
  const size = `${(d.width / w) * 100}% ${(d.height / h) * 100}%`
  const position = `${(x / (d.width - w)) * 100}% ${(y / (d.height - h)) * 100}%`
  return {
    backgroundImage,
    backgroundSize: fallback ? `${size}, cover` : size,
    backgroundPosition: fallback ? `${position}, center` : position,
    backgroundRepeat: fallback ? 'no-repeat, no-repeat' : 'no-repeat',
  }
})
/* the leaves' pictures: the listing's pages, their right edge toward the fore-edge */
const leaf = (i) => (sheets.value[i] ? { '--leaf': `url("${sheets.value[i]}")` } : null)
const LEAVES = 6
/* how far the block stands out, from the pages: a thin book a little, a thick one more */
const thick = computed(() => Math.max(2.5, Math.min(6, 2 + pages.value / 90)))
</script>

<template>
  <span v-if="flat || !art" class="b3 b3-flat">
    <img v-if="art" :src="props.art" :alt="alt" :loading="eager ? 'eager' : 'lazy'" decoding="async" />
    <span v-else class="b3-ph">{{ title }}</span>
  </span>
  <span v-else class="b3" :class="['b3-' + binding, 'b3-at-' + anchor]" :style="{ '--thick': thick + '%' }">
    <span class="b3-book">
      <i class="b3-back" aria-hidden="true" :style="cover"></i>
      <span class="b3-inside" aria-hidden="true">
        <i v-for="n in LEAVES" :key="n" class="b3-page" :style="leaf(LEAVES - n)"></i>
      </span>
      <span class="b3-cover" role="img" :aria-label="alt" :style="cover">
        <i class="b3-crease" aria-hidden="true"></i>
        <i class="b3-light" aria-hidden="true"></i>
      </span>
    </span>
  </span>
</template>

<style scoped>
.b3 { position: relative; display: flex; align-items: center; justify-content: center; width: 100%; aspect-ratio: 2 / 3; container-type: size; --ease: cubic-bezier(.215, .61, .355, 1); --thick: 4% }
.b3-at-left { justify-content: flex-start }
.b3-at-left .b3-book { margin-left: 0 }
.b3-flat { display: block; border-radius: 4px; overflow: hidden; background: var(--card, #eee) }
.b3-flat img, .b3-ph { display: block; width: 100%; height: 100%; object-fit: cover }
.b3-ph { display: grid; place-items: center; padding: 8%; text-align: center; font-family: var(--fd); font-weight: 600; font-size: clamp(11px, 1.4em, 22px); line-height: 1.15; color: var(--ink); background: var(--card2, var(--card)) }
/* the book is the cover's size, 2:3, as tall as its room allows and no wider — a block in its own
   right, so a caller that makes the root a block (a shelf's slot) still gets a book, centred */
.b3-book { position: relative; display: block; height: min(100cqh, 150cqw); aspect-ratio: 2 / 3; flex: none; margin: 0 auto }
/* the back board: a hair larger than the leaves, the cover's own picture darkened to a board */
.b3-back { position: absolute; inset: 1.5% 1% 1.5% 2%; background-color: #14120f; background-size: cover; background-position: center; filter: brightness(.67) saturate(.88); border-radius: 0 6px 6px 0; box-shadow: 2px 2px 5px #00000040; z-index: 0; transition: transform .7s var(--ease) }
/* the leaves: five, at the fore-edge, each a sheet with its own edge and its own shadow; the
   deepest stands out furthest when the cover lifts, and they settle one after another */
.b3-inside { position: absolute; left: 5%; top: 3%; width: 90%; height: 94%; z-index: 1 }
/* each leaf is cream — or the listing's page, filling it edge to edge — with its fore-edge shaded
   over whatever it carries and ruled, so where one ends and the next begins is a
   line whatever the size; the fan is in the leaf's own width, never pixels, so six leaves show as
   six on a card and in the gallery alike: the lifted cover uncovers 14% of the book, and the
   leaves step 1.8% at a time from just inside its edge back to the board, which shows 2% beyond them. The motion is the pen's,
   and one motion: the leaves move with the cover — the same 0.7 s, the same power2.out, no delay —
   since a fan that lags the cover, or falls into place leaf by leaf, is not how a book moves (a
   stagger was tried and rejected as unnatural) */
.b3-page { position: absolute; top: 0; right: 0; width: 98%; height: 100%; background-color: #fbf8f0; background-image: linear-gradient(90deg, #0000 0%, #0000 86%, #00000010 96%, #00000030 100%), var(--leaf, none); background-size: 100% 100%, auto 100%; background-position: 0 0, right center; background-repeat: no-repeat; border: 1px solid #00000040; border-right-color: #00000070; border-radius: 0 6px 6px 0; box-shadow: 2px 0 3px #00000038, 0 1px 3px #00000026; transform-origin: right center; transition: transform .7s var(--ease) }
.b3-page:nth-child(1) { --dx: 2.3% } .b3-page:nth-child(2) { --dx: .2% } .b3-page:nth-child(3) { --dx: -1.8% } .b3-page:nth-child(4) { --dx: -3.9% } .b3-page:nth-child(5) { --dx: -5.9% } .b3-page:nth-child(6) { --dx: -7.9% }
/* the cover: the picture, the crease of light by the spine, a wash of light across it */
.b3-cover { position: absolute; inset: 0; z-index: 2; border-radius: 2px 6px 6px 2px; background-size: cover; background-position: center; background-color: var(--card2, #ddd); transform-origin: left center; box-shadow: 10px 5px 20px #00000026, 20px 0 30px #00000026; transition: transform .7s var(--ease), box-shadow .7s var(--ease) }
/* the crease where the cover bends at the binding: a soft hollow of shadow, a soft rise of light
   beside it — no line anywhere */
.b3-crease { position: absolute; top: 0; bottom: 0; left: 0; width: 16%; background: linear-gradient(90deg, #00000012 0%, #0000001c 12%, #0000000e 24%, #ffffff0a 34%, #ffffff20 46%, #ffffff14 60%, #ffffff06 80%, #ffffff00 100%); transition: left .7s var(--ease); pointer-events: none }
.b3-light { position: absolute; inset: 0; border-radius: 2px 6px 6px 2px; background: linear-gradient(90deg, #ffffff00, #ffffff80); mix-blend-mode: overlay; opacity: .15; transition: opacity .7s var(--ease); pointer-events: none }
/* under the pointer: the cover lifts toward the reader, the leaves fan, the shadow deepens */
.b3:hover .b3-cover { transform: translateX(-9%) scaleX(.95); box-shadow: 14px 4px 18px #00000040, 28px 0 30px #0000001f }
.b3:hover .b3-page { transform: translateX(var(--dx)) }
.b3:hover .b3-crease { left: -1% }
.b3:hover .b3-light { opacity: .2 }
@media (prefers-reduced-motion: reduce) { .b3 * { transition: none !important } }
</style>
