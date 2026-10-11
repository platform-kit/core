<script setup>
import { md } from './md.js'
import { withBooker } from '@platform-kit/kit/lib/booking.js'
/*
 * Creator: the person behind the instrument — a portrait, a name, what they do,
 * and a short statement in their own voice; a line or two of facts beside it and
 * the way to sit with them. Every word is the page's.
 *
 * Slots for a look's skin (src/lib/look.js): `portrait` and `copy`.
 */
defineProps({
  eyebrow: { type: String, default: '' },
  heading: { type: String, default: '' },
  name: { type: String, default: '' },
  role: { type: String, default: '' },
  image: { type: String, default: '' },
  statement: { type: String, default: '' },     /* the first-person paragraph(s), markdown */
  facts: { type: Array, default: () => [] },     /* [{ label, body }] */
  cta: { type: String, default: '' },
  href: { type: String, default: '' },
  fine: { type: String, default: '' },
})
</script>

<template>
  <section class="lpsec">
    <div id="lpcreator" class="lpwrap lcr">
      <slot name="portrait" :image="image" :name="name" :role="role" :md="md">
      <div class="lcr-port lprv">
        <span class="lphalo"></span>
        <figure class="lcr-fig lpk">
          <img v-if="image" :src="image" :alt="name" loading="lazy" decoding="async" />
          <figcaption><b v-html="md(name)"></b><i v-if="role" v-html="md(role)"></i></figcaption>
        </figure>
      </div>
      </slot>
      <slot name="copy" :eyebrow="eyebrow" :heading="heading" :statement="statement" :facts="facts" :cta="cta" :href="href" :fine="fine" :md="md">
      <div class="lpcol lprv lcr-copy">
        <span v-if="eyebrow" class="lpeyebrow" v-html="md(eyebrow)"></span>
        <h2 class="lps lpk" style="--k: .12s" v-html="md(heading)"></h2>
        <div v-if="statement" class="lcr-say lpk" style="--k: .28s" v-html="md(statement)"></div>
        <dl v-if="facts.length" class="lcr-facts">
          <div v-for="(f, i) in facts" :key="i" class="lpk" :style="{ '--k': (0.45 + i * 0.14) + 's' }">
            <dt v-html="md(f.label)"></dt><dd v-html="md(f.body)"></dd>
          </div>
        </dl>
        <a v-if="cta" :href="withBooker(href)" class="lpbtn text-white lcr-cta lpk" :style="{ '--k': (0.5 + facts.length * 0.14) + 's' }"><span v-html="md(cta)"></span>
          <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M2 8h12M9 3l5 5-5 5" /></svg>
        </a>
        <p v-if="fine" class="lcr-fine lpk" :style="{ '--k': (0.6 + facts.length * 0.14) + 's' }" v-html="md(fine)"></p>
      </div>
      </slot>
    </div>
  </section>
</template>

<style scoped>
.lcr { display: grid; grid-template-columns: minmax(0, .8fr) minmax(0, 1.2fr); gap: 64px; align-items: center }
.lcr-port { position: relative; justify-self: center; width: min(100%, 380px) }
.lcr-fig { position: relative; margin: 0; z-index: 1 }
.lcr-fig img { display: block; width: 100%; aspect-ratio: 1; object-fit: cover; border-radius: 50% 50% 46% 46% / 48% 48% 52% 52%; box-shadow: var(--shhi); border: 1px solid var(--hair) }
.lcr-fig figcaption { position: absolute; left: 50%; bottom: -18px; transform: translateX(-50%); white-space: nowrap; padding: 10px 18px; border-radius: 999px; background: var(--card2); border: 1px solid var(--hair); box-shadow: var(--sh); text-align: center; line-height: 1.15 }
.lcr-fig b { display: block; font-family: var(--fd); font-weight: 600; font-size: 17px; color: var(--ink) }
.lcr-fig i { display: block; font-style: normal; font-family: var(--m); font-size: 10.5px; letter-spacing: .1em; text-transform: uppercase; color: var(--ink3); margin-top: 3px }
.lcr-copy { max-width: none }
.lcr-say { font-size: 18px; line-height: 1.6; color: var(--ink2); margin-top: 14px }
.lcr-say :deep(p) { margin: 0 0 14px; max-width: none }
.lcr-say :deep(p:last-child) { margin-bottom: 0 }
.lcr-facts { display: grid; grid-template-columns: repeat(auto-fit, minmax(180px, 1fr)); gap: 16px 28px; margin: 26px 0 0; padding-top: 22px; border-top: 1px solid var(--hair) }
.lcr-facts dt { font-family: var(--m); font-size: 10.5px; letter-spacing: .12em; text-transform: uppercase; color: var(--accent2) }
.lcr-facts dd { margin: 5px 0 0; font-size: 15px; line-height: 1.5; color: var(--ink2) }
.lcr-cta { margin-top: 28px }
.lcr-fine { margin: 12px 0 0; font-size: 13.5px; color: var(--ink3) }
@media (max-width: 900px) { .lcr { grid-template-columns: 1fr; gap: 48px } .lcr-port { width: min(100%, 300px) } }
</style>
