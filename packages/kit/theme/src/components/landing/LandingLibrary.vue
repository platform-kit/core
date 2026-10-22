<script setup>
import { md } from './md.js'
/*
 * The library's three ways in, shown: one real chapter of one real book, as
 * the reader shows it — the full text with the line worth noticing marked,
 * the modern summary with its bottom line, and the player — side by side,
 * each with the one promise it makes. The page names the book and the
 * chapter; the words of the passages come from the compiled content, so the
 * section is never a mock of nothing. Every label is the page's.
 */
import { computed } from 'vue'
import { marked } from 'marked'
import { books as BOOKS } from '#content'
import { chapterCompanion } from 'platformkit/lib/companions.js'
import { bookChapters } from 'platformkit/lib/speech.js'
import Trophy from '../Trophy.vue'
/*
 * Slots for a look's skin (src/lib/look.js): `head`, `formats` (the three chapter cards) and `after` (extras, fine line, button). Each wraps a whole block and
 * hands the skin the same data the default markup uses, so a look can rebuild that
 * block and leave the rest — the page's markdown names the section once either way.
 */
const props = defineProps({
  eyebrow: { type: String, default: '' },
  heading: { type: String, default: '' },
  lead: { type: String, default: '' },
  book: { type: String, default: '' },        /* slug of the book shown */
  chapter: { type: String, default: '' },     /* title of the chapter shown; the first when empty */
  formats: { type: Array, default: () => [] },  /* [{ title, body }] — full text, summary, audiobook, in that order */
  bottomLabel: { type: String, default: '' },  /* the summary card's list label */
  playerLabel: { type: String, default: '' },  /* the player's eyebrow */
  extras: { type: Array, default: () => [] },   /* [{ title, body, icon }] — what every book carries beyond its text; icon names a glyph: lines, trophy, highlight, note, bookmark, search, type, place, audio */
  fine: { type: String, default: '' },
  cta: { type: String, default: '' },
  href: { type: String, default: '/content' },
})
/* the chapter's markdown as the reader would show it, marks as wavy underlines */
const marks = (s) => String(s || '').replace(/==(?=\S)([\s\S]*?\S)==(?:\{([a-z]+)\})?/g, (_, t, c) => '<mark class="sys-mark sug-' + (c || 'sun') + '">' + t + '</mark>')
const html = (mdText, paragraphs) => marked.parse(marks(String(mdText || '').split(/\n{2,}/).filter((p) => p.trim()).slice(0, paragraphs).join('\n\n')))
const book = computed(() => (BOOKS || []).find((b) => b.slug === props.book) || null)
const chapter = computed(() => {
  const b = book.value
  if (!b) return null
  const parts = bookChapters(b.raw)   /* the reader's own split */
  return (props.chapter && parts.find((c) => c.title === props.chapter)) || parts[0] || null
})
const companion = computed(() => (book.value && chapter.value ? chapterCompanion(book.value.slug, chapter.value.title) : null))
const text = computed(() => (chapter.value ? html(chapter.value.md, 2) : ''))
const sentences = (mdText, n) => { const p = String(mdText || '').split(/\n{2,}/).find((x) => x.trim()) || ''; const m = p.match(/[^.!?]+[.!?]+(\s|$)/g); return m ? m.slice(0, n).join('').trim() : p }
const summary = computed(() => (companion.value ? html(sentences(companion.value.summaryMd, 2), 1) : ''))
/* what the voice is reading: the opening, the first sentence lit as the spoken part */
const spoken = computed(() => {
  if (!chapter.value) return ''
  const plain = sentences(chapter.value.md, 3).replace(/==(?=\S)([\s\S]*?\S)==(?:\{[a-z]+\})?/g, '$1')
  const m = plain.match(/^[^.!?]+[.!?]+/)
  const first = m ? m[0] : plain
  return '<p><span class="lpl-said">' + marked.parseInline(first) + '</span>' + marked.parseInline(plain.slice(first.length)) + '</p>'
})
const essence = computed(() => ((companion.value && companion.value.essence) || []).slice(0, 2))
/* the chapter's length read aloud: the voice speaks about fifteen characters a second */
const clock = computed(() => {
  const n = chapter.value ? chapter.value.md.replace(/[#*_=>\[\]()`{}]/g, '').length : 0
  const s = Math.round(n / 14.5), m = Math.floor(s / 60)
  return '0:00 / ' + m + ':' + String(s % 60).padStart(2, '0')
})
/* a still waveform, the same picture for the same chapter */
const bars = computed(() => {
  const out = [], n = 64
  let x = (chapter.value ? chapter.value.md.length : 7) % 97 || 7
  for (let i = 0; i < n; i++) { x = (x * 48271) % 2147483647; out.push(6 + (x % 26)) }
  return out
})
const kinds = ['full', 'summary', 'audio']
const link = computed(() => (book.value ? '/content/books/' + book.value.slug : props.href))
</script>

<template>
  <section class="lpsec">
    <div id="lplibrary" class="lpwrap lpl">
      <slot name="head" :eyebrow="eyebrow" :heading="heading" :lead="lead" :md="md">
      <div class="lpcol lprv lpl-head">
        <span v-if="eyebrow" class="lpeyebrow" v-html="md(eyebrow)"></span>
        <h2 class="lps lpk" style="--k: .12s" v-html="md(heading)"></h2>
        <p v-if="lead" class="lpl-lead lpk" style="--k: .28s" v-html="md(lead)"></p>
      </div>
      </slot>
      <slot name="formats" :formats="formats" :kinds="kinds" :chapter="chapter" :text="text" :summary="summary" :spoken="spoken" :essence="essence" :bottomLabel="bottomLabel" :playerLabel="playerLabel" :clock="clock" :bars="bars" :link="link" :md="md">
      <div class="lpl-row lprv lpd1">
        <div v-for="(f, i) in formats.slice(0, 3)" :key="i" class="lpl-way" :class="'lpl-' + kinds[i]">
          <span class="lpl-tag lpk lpk-pop" :style="{ '--k': (0.1 + i * 0.25) + 's' }" v-html="md(f.title)"></span>
          <a class="lpcard lpl-card lpk" :style="{ '--k': (0.2 + i * 0.25) + 's' }" :href="link" :aria-label="f.title">
            <template v-if="kinds[i] === 'full'">
              <b v-if="chapter" class="lpl-ch" v-html="md(chapter.title)"></b>
              <div class="lpl-text" v-html="text"></div>
            </template>
            <template v-else-if="kinds[i] === 'summary'">
              <b v-if="chapter" class="lpl-ch" v-html="md(chapter.title)"></b>
              <div class="lpl-text lpl-sum" v-html="summary"></div>
              <div v-if="essence.length" class="lpl-bottom">
                <span class="lpl-bl" v-html="md(bottomLabel)"></span>
                <ul class="lpl-ess"><li v-for="(e, j) in essence" :key="j" v-html="md(e)"></li></ul>
              </div>
            </template>
            <template v-else>
              <b v-if="chapter" class="lpl-ch" v-html="md(chapter.title)"></b>
              <div class="lpl-player" aria-hidden="true">
                <span class="lpl-play"><svg viewBox="0 0 20 20" width="18" height="18"><path d="M6 4.5v11l9-5.5z" fill="currentColor" /></svg></span>
                <span class="lpl-pbody">
                  <span class="lpl-pline"><span class="lpl-peyebrow" v-html="md(playerLabel)"></span><span class="lpl-ptime lpnum">{{ clock }}</span></span>
                  <span class="lpl-wave"><i v-for="(h, j) in bars" :key="j" :style="{ height: h + 'px' }" :class="{ on: j < 11 }"></i></span>
                </span>
              </div>
              <div class="lpl-text lpl-spoken" v-html="spoken"></div>
            </template>
            <span class="lpl-fade"></span>
          </a>
          <p class="lpl-why lpk" :style="{ '--k': (0.45 + i * 0.25) + 's' }" v-html="md(f.body)"></p>
        </div>
      </div>
      </slot>
      <slot name="after" :extras="extras" :fine="fine" :cta="cta" :href="href" :md="md">
      <div v-if="extras.length" class="lpl-extras lprv lpd2">
        <div v-for="(x, i) in extras" :key="i" class="lpl-extra lpk" :style="{ '--k': (0.15 + i * 0.12) + 's' }">
          <!-- the glyph: named on the item; the first two keep their old ones when unnamed -->
          <span v-if="(x.icon || (i === 0 ? 'lines' : i === 1 ? 'trophy' : '')) === 'lines'" class="lpl-glyph lpl-glyph-lines" aria-hidden="true"><i></i><i></i><i></i></span>
          <span v-else-if="(x.icon || (i === 1 ? 'trophy' : '')) === 'trophy'" class="lpl-glyph" aria-hidden="true"><Trophy tier="gold" :size="28" /></span>
          <span v-else class="lpl-glyph" aria-hidden="true">
            <svg v-if="x.icon === 'highlight'" viewBox="0 0 24 24" class="lpl-svg"><path d="M4 17h9" /><path d="M6 13.5 15.5 4l4.5 4.5L10.5 18H6z" /><path d="M13 6.5 17.5 11" /></svg>
            <svg v-else-if="x.icon === 'note'" viewBox="0 0 24 24" class="lpl-svg"><path d="M5 4h11l3 3v13H5z" /><path d="M8.5 10.5h7M8.5 14h7M8.5 17.5h4" /></svg>
            <svg v-else-if="x.icon === 'bookmark'" viewBox="0 0 24 24" class="lpl-svg"><path d="M6.5 3.5h11v17l-5.5-3.8-5.5 3.8z" /></svg>
            <svg v-else-if="x.icon === 'search'" viewBox="0 0 24 24" class="lpl-svg"><circle cx="10.5" cy="10.5" r="6" /><path d="M15 15l5 5" /></svg>
            <svg v-else-if="x.icon === 'type'" viewBox="0 0 24 24" class="lpl-svg"><path d="M4 19 10 5h1l6 14M6.2 14h8.6" /><path d="M17 8h3M18.5 6.5v3" /></svg>
            <svg v-else-if="x.icon === 'place'" viewBox="0 0 24 24" class="lpl-svg"><path d="M4 5h16v14H4z" /><path d="M12 5v14M7 9h2.5M14.5 9H17M7 12.5h2.5M14.5 12.5H17" /></svg>
            <svg v-else-if="x.icon === 'audio'" viewBox="0 0 24 24" class="lpl-svg"><path d="M4 10v4h3l4 3.5v-11L7 10z" /><path d="M15 9.5a3.5 3.5 0 0 1 0 5M17.5 7a7 7 0 0 1 0 10" /></svg>
            <svg v-else viewBox="0 0 24 24" class="lpl-svg"><circle cx="12" cy="12" r="3.5" /></svg>
          </span>
          <span class="lpl-xt"><b v-html="md(x.title)"></b><span v-html="md(x.body)"></span></span>
        </div>
      </div>
      <p v-if="fine" class="lpl-fine lprv lpd2" v-html="md(fine)"></p>
      <a v-if="cta" :href="href" class="lpbtn text-white lpl-cta lprv lpd2"><span v-html="md(cta)"></span>
        <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M2 8h12M9 3l5 5-5 5" /></svg>
      </a>
      </slot>
    </div>
  </section>
</template>

<style scoped>
.lpl-head { max-width: none }
.lpl-lead { max-width: none; font-size: 18px; line-height: 1.55; color: var(--ink2); margin: 14px 0 0 }
.lpl-row { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 22px; margin-top: 34px; align-items: start }
.lpl-way { display: flex; flex-direction: column; gap: 12px; min-width: 0 }
.lpl-tag { align-self: flex-start; font-family: var(--m); font-size: 10.5px; letter-spacing: .14em; text-transform: uppercase; color: var(--accent2, var(--accent)); padding: 5px 10px; border: 1px solid var(--hair); border-radius: 999px; background: var(--card) }
/* the three cards are one height and each shows a page as the reader does, fading at the foot */
.lpl-card { position: relative; display: block; text-decoration: none; color: inherit; padding: 22px 22px 18px; height: 300px; overflow: hidden; border-radius: 16px }
.lpl-card:hover { transform: translateY(-4px); box-shadow: var(--shhi) }
.lpl-fade { position: absolute; left: 0; right: 0; bottom: 0; height: 64px; background: linear-gradient(to bottom, transparent, var(--card)); pointer-events: none; border-radius: 0 0 16px 16px }
.lpl-ch { display: block; font-family: var(--fd); font-weight: 600; font-size: 12px; letter-spacing: .06em; text-transform: uppercase; color: var(--ink3); margin-bottom: 12px }
.lpl-text { font-family: var(--fd); font-size: 15px; line-height: 1.6; color: var(--ink) }
.lpl-text :deep(p) { margin: 0 0 12px }
.lpl-text :deep(mark.sys-mark) { background-color: transparent; background-image: var(--sug-wave); background-repeat: repeat-x; background-position: left 100%; background-size: 20px 5px; color: inherit; padding-bottom: 3px }
.lpl-text :deep(mark.sug-sun) { --sug-wave: url("data:image/svg+xml,%3Csvg%20xmlns='http://www.w3.org/2000/svg'%20width='20'%20height='5'%3E%3Cpath%20d='M0%203%20Q5%200.7%2010%203%20T20%203'%20fill='none'%20stroke='%23E1A200'%20stroke-width='1.6'%20stroke-linecap='round'/%3E%3C/svg%3E") }
.lpl-text :deep(mark.sug-leaf) { --sug-wave: url("data:image/svg+xml,%3Csvg%20xmlns='http://www.w3.org/2000/svg'%20width='20'%20height='5'%3E%3Cpath%20d='M0%203%20Q5%200.7%2010%203%20T20%203'%20fill='none'%20stroke='%234CA646'%20stroke-width='1.6'%20stroke-linecap='round'/%3E%3C/svg%3E") }
.lpl-text :deep(mark.sug-sky) { --sug-wave: url("data:image/svg+xml,%3Csvg%20xmlns='http://www.w3.org/2000/svg'%20width='20'%20height='5'%3E%3Cpath%20d='M0%203%20Q5%200.7%2010%203%20T20%203'%20fill='none'%20stroke='%23EFAE7A'%20stroke-width='1.6'%20stroke-linecap='round'/%3E%3C/svg%3E") }
.lpl-text :deep(mark.sug-ocean) { --sug-wave: url("data:image/svg+xml,%3Csvg%20xmlns='http://www.w3.org/2000/svg'%20width='20'%20height='5'%3E%3Cpath%20d='M0%203%20Q5%200.7%2010%203%20T20%203'%20fill='none'%20stroke='%231785A0'%20stroke-width='1.6'%20stroke-linecap='round'/%3E%3C/svg%3E") }
.lpl-text :deep(mark.sug-ember) { --sug-wave: url("data:image/svg+xml,%3Csvg%20xmlns='http://www.w3.org/2000/svg'%20width='20'%20height='5'%3E%3Cpath%20d='M0%203%20Q5%200.7%2010%203%20T20%203'%20fill='none'%20stroke='%23DD802F'%20stroke-width='1.6'%20stroke-linecap='round'/%3E%3C/svg%3E") }
/* the summary's bottom line, as the reader draws it, smaller */
.lpl-bottom { margin-top: 6px; padding-top: 12px; border-top: 1px solid var(--hair) }
.lpl-bl { display: block; font-family: var(--m); font-size: 9.5px; letter-spacing: .14em; text-transform: uppercase; color: var(--ink3); margin-bottom: 8px }
.lpl-ess { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 6px }
.lpl-ess li { position: relative; padding: 8px 10px 8px 26px; border: 1px solid var(--hair); border-radius: 10px; font-family: var(--fd); font-size: 13.5px; line-height: 1.4; color: var(--ink) }
.lpl-ess li::before { content: ''; position: absolute; left: 10px; top: 1em; width: 7px; height: 7px; border-radius: 50%; background: var(--accent) }
/* the player, as the reader's, at rest */
.lpl-player { display: grid; grid-template-columns: auto minmax(0, 1fr); align-items: center; gap: 12px; margin-top: 4px; padding: 14px; border: 1px solid var(--hair); border-radius: 14px }
.lpl-play { display: inline-flex; align-items: center; justify-content: center; width: 40px; height: 40px; border-radius: 50%; background: var(--ink); color: var(--card) }
.lpl-pbody { min-width: 0; display: flex; flex-direction: column; gap: 6px }
.lpl-pline { display: flex; justify-content: space-between; align-items: baseline; gap: 8px }
.lpl-peyebrow { font-family: var(--m); font-size: 8.5px; letter-spacing: .08em; text-transform: uppercase; color: var(--ink3); white-space: nowrap; overflow: hidden; text-overflow: ellipsis }
.lpl-ptime { font-family: var(--m); font-size: 10px; color: var(--ink3); white-space: nowrap }
.lpl-wave { display: flex; align-items: center; gap: 2px; height: 36px }
.lpl-wave i { flex: 1 1 0; min-width: 1px; border-radius: 1px; background: var(--hair) }
.lpl-wave i.on { background: var(--accent) }
.lpl-spoken { margin-top: 16px; color: var(--ink3) }
.lpl-spoken :deep(.lpl-said) { color: var(--ink); background: var(--accentbg); box-decoration-break: clone; -webkit-box-decoration-break: clone; padding: 1px 3px; border-radius: 3px }
.lpl-why { margin: 0; font-size: 14.5px; line-height: 1.5; color: var(--ink2) }
/* two more things every book carries, one quiet line each under the cards */
.lpl-extras { display: grid; grid-template-columns: repeat(auto-fit, minmax(300px, 1fr)); gap: 22px 28px; margin-top: 28px; padding-top: 22px; border-top: 1px solid var(--hair) }
.lpl-svg { width: 20px; height: 20px; fill: none; stroke: var(--accent); stroke-width: 1.7; stroke-linecap: round; stroke-linejoin: round }
.lpl-extra { display: flex; align-items: flex-start; gap: 14px; min-width: 0 }
.lpl-xt { display: block; font-size: 14.5px; line-height: 1.5; color: var(--ink2) }
.lpl-xt b { display: block; font-family: var(--fd); font-weight: 600; font-size: 15.5px; color: var(--ink); margin-bottom: 2px }
.lpl-glyph { flex: none; display: inline-flex; align-items: center; justify-content: center; width: 40px; height: 40px; border-radius: 12px; border: 1px solid var(--hair); background: var(--card); margin-top: 1px }
.lpl-glyph-lines { flex-direction: column; gap: 3px; align-items: flex-start; padding-left: 11px }
.lpl-glyph-lines i { display: block; height: 3px; border-radius: 2px; background: var(--accent); width: 18px; opacity: .9 }
.lpl-glyph-lines i:nth-child(2) { width: 13px; opacity: .6 } .lpl-glyph-lines i:nth-child(3) { width: 16px; opacity: .35 }
.lpl-fine { margin: 22px 0 0; font-size: 13.5px; color: var(--ink3) }
.lpl-cta { margin-top: 22px }
@media (max-width: 900px) { .lpl-row { grid-template-columns: 1fr; gap: 26px } .lpl-extras { grid-template-columns: 1fr } }
</style>
