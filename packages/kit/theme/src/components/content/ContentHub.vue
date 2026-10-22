<script setup>
import { ref, computed, watch, onMounted, onBeforeUnmount } from 'vue'
import Book3D from '../Book3D.vue'
import { articleIndex, docTree, contentCorpus, forYou, embedText, warmEmbedder, concepts, booksForConcept, bookShelf, bookProgress, dropFinished, coverTint, us } from 'platformkit/lib/content.js'
import { profileText } from 'platformkit/lib/rank.js'
import { interests, forgetInterests, seenKey, EMPTY as NO_INTERESTS } from 'platformkit/lib/interests.js'
import { signals, invites } from '#site/recommendations'   /* what the site knows of the reader, or the kit's default (nothing) */
import { sessionRev, initRecords, hydrate } from 'platformkit/lib/records.js'
import { isSignedIn, onIdentity } from 'platformkit/lib/auth.js'

const HUB = us('library').hub
const PROG = us('library').progress.label

/*
 * The hub: every kind of content, each visibly its own lane. Everything is the same shelf for
 * everyone; Recommended For You re-ranks every lane against this reader — the tags of what they
 * have read and bought (the kit's own half, on any site) together with whatever the site knows of
 * them (signals(): for the site, the readings), embedded and matched in the browser. It leads for
 * a reader with something behind them, and on a site that can EARN recommendations for somebody who
 * has none it is offered while empty, carrying the invitation instead. It is opt-in; the order is
 * the message, and no item carries a label saying why it surfaced.
 */
/* a shelf is shown when anything published is on it */
const LANE_MIN = 1
const articles = articleIndex().length >= LANE_MIN ? articleIndex().slice(0, 4) : []
const flatten = (node, out = []) => {
  node.docs.forEach((d) => out.push(d))
  node.dirs.forEach((dir) => flatten(dir, out))
  return out
}
const wiki = flatten(docTree('wiki')).length >= LANE_MIN ? flatten(docTree('wiki')).slice(0, 6) : []
const docs = flatten(docTree('docs')).length >= LANE_MIN ? flatten(docTree('docs')).slice(0, 6) : []
const hasBooks = bookShelf().length > 0

/* ---- discovery ---- */
/* WHAT THIS READER IS, AND IT IS NOT FIXED AT SETUP. A reader who signs in on this page has a
   profile a moment later than the page had none, so this is read again on every sessionRev — the
   same revision counter the finding below reads. Called once at setup it froze the page in the
   state it was built in: the reader signed in, the hub still offered them nothing of their own,
   and only a reload put it right. */
const sig = computed(() => { void sessionRev.value; return signals() })

/* the engine is loaded here as on the sheet, and the session rebuilt from the account's rows the
   same way (hydrate), so the lane is right on a page opened before they landed: it is read again on
   every sessionRev. */
initRecords()
/* a reader already signed in when this mounts: initRecords registers for the ARRIVALS, and this is
   the one that has already happened */
if (isSignedIn.value) hydrate()

/*
 * WHETHER THERE IS ANYTHING TO RECOMMEND ON, from either side.
 *
 * Two signals, and either alone is enough: what the SITE knows of the reader (signals() — for
 * the site, the readings) and what the reader's own history says (interests() — the tags of
 * what they have read and bought, weighted by the server). The kit had only the first, which is why
 * a site with nothing registered had an empty lane however much anybody read.
 *
 * The interests come from the server, so they land a moment after the page: `mine` starts empty and
 * is filled, and everything that depends on it follows rather than being decided once.
 */
const mine = ref(NO_INTERESTS)
const askInterests = async () => { mine.value = await interests() }
const canRecommend = computed(() => { void sessionRev.value; return !!((sig.value && sig.value.has) || mine.value.has) })
/*
 * WHETHER THE VIEW IS OFFERED AT ALL. There when there is something in it — and, on a site that can
 * EARN recommendations for somebody who has none, there anyway, because then the empty view is not
 * empty: it carries the invitation to earn them. The kit's answer is no, so a generic site hides
 * the control until it means something rather than showing one that leads nowhere.
 */
const offerForYou = computed(() => canRecommend.value || invites())

/* The Everything / Recommended For You toggle is the recommended-vs-fallback
   switch; it governs the books and the article/wiki/doc lanes alike. */
/* the teachings round comes back asking for Everything (sessionStorage, read once), since its
   finding lives on that view alone — For You is the diagnostics' recommendations */
const askedView = (() => { try { const v = sessionStorage.getItem('dl.hub.view'); sessionStorage.removeItem('dl.hub.view'); return v } catch (e) { return null } })()
/*
 * RECOMMENDED FOR YOU IS NOT OFFERED UNTIL THERE IS SOMETHING IN IT. Not the view, and not the
 * toggle to it: an empty lane behind a control that promises one is worse than no control, because
 * it reads as a thing that is broken rather than a thing not earned yet. A reader with nothing
 * behind them gets Everything and the card saying what would change that.
 *
 * It was the other way round by accident. The comment over the toggle said "only shown when there
 * are recommendations to switch to" and there was no condition on it at all — so a reader with no
 * history landed on an empty For You with a toggle offering to take them back to it.
 */
const mode = ref('all')
const loading = ref(false)
const ranked = ref(null)

/* In the Everything (fallback) state, books are browsed by concept — the
   dropdown lives here and nowhere else. "Everything" leads it and shows the
   whole shelf up to one row, so a reader with no profile lands on real books
   rather than an arbitrary theme. */
const BOOK_ROW = 7
const conceptOptions = [{ slug: 'all', name: HUB.browse['all-books'] }].concat(concepts())
const concept = ref('all')
const conceptBooks = computed(() => {
  const list = concept.value === 'all' ? bookShelf() : booksForConcept(concept.value)
  return dropFinished(list).slice(0, BOOK_ROW).map((b) => ({ ...b, prog: bookProgress(b.slug) }))
})

/* whether the READER picked the view, as against the page picking it for them. Signing in moves
   somebody who has not chosen onto For You — which is the view an account holder leads with — and
   never moves somebody who has, because a page that changes tab under you is worse than a page
   that opens on the wrong one. */
let chose = false
async function show(m, byHand = true) {
  if (byHand) chose = true
  mode.value = m
  if (m === 'foryou') await rank()
}
/* THE RANKING, from both sides at once: the site's words joined to the reader's own tags as the
   query, and the site's themes and prescriptions beside the reader's weights as the lift. A site
   with no registration ranks on the reader's tags alone; a reader with no history on the site's
   words alone; with neither there is nothing to rank and the view is never offered. */
let rankedFor = ''
async function rank() {
  if (!canRecommend.value) return
  const at = { themeTags: (sig.value && sig.value.themeTags) || [], prescribed: (sig.value && sig.value.prescribed) || [], weights: mine.value.weights }
  const text = profileText(mine.value.weights, (sig.value && sig.value.text) || '')
  const key = text + '|' + JSON.stringify(at)
  if (!text || key === rankedFor) return
  rankedFor = key
  loading.value = true
  const [corpus, vec] = await Promise.all([contentCorpus(), embedText(text)])
  ranked.value = forYou(corpus, vec, at)
  loading.value = false
}
/* WHAT IS ALREADY BEHIND THEM IS NOT A RECOMMENDATION. The ranking is built out of what somebody
   read, so without this it leads with the very pieces it learnt from — the five things they just
   read, handed back.

   BEHIND THEM IS A STRICTER CLAIM THAN INTERESTED, and my_reading draws the line by DEPTH: a page
   they got to the end of, not one they opened. A skim counts towards their interests and is still
   offered, which is right — it is the piece they meant to come back to. A book is governed by its
   own rule instead, since a chapter's depth says nothing about the book: it is left in while there
   is progress to continue, and dropFinished takes it once there is not. */
const unread = (r) => !mine.value.read.has(seenKey(r.kind, r.id)) ||
  (r.kind === 'book' && bookProgress(r.id).opened)
const byKind = (k, n) => (ranked.value || []).filter((r) => r.kind === k && unread(r)).slice(0, n)
/* the books lane is the ranking's own books, given back their shelf record — the cover as Book3D
   wants it, the author, and the reader's progress — since a corpus row carries none of those.
   Finished books drop out while enough unfinished remain, so the lane keeps offering something new. */
const recBooks = computed(() => { void sessionRev.value
  const by = Object.fromEntries(bookShelf().map((b) => [b.slug, b]))
  return dropFinished(byKind('book', 12).map((r) => by[r.id]).filter(Boolean))
    .slice(0, BOOK_ROW).map((b) => ({ ...b, prog: bookProgress(b.slug) })) })
/* lead with the recommendations when there are any; that view needs the model,
   so load it. Otherwise stay in browse and just warm it in case they toggle. */
onMounted(async () => {
  await askInterests()
  if (offerForYou.value) { if (canRecommend.value) warmEmbedder(); if (askedView !== 'all' && isSignedIn.value) show('foryou', false) }
})
/* somebody signed in on this page: they have a profile now where a moment ago they had none, so
   the view they were given as a guest is no longer the right one */
/* the recommendations can arrive after this mounts (the session is rebuilt from the account's rows)
   and can go away again on sign-out. Somebody who has not chosen a view follows that; somebody who
   has chosen For You and then loses it is put back rather than left looking at nothing. */
/* the interests land after the page: a reader already looking at For You gets the ranking the
   moment there is something to rank, without touching anything */
watch(canRecommend, (can) => { if (can && mode.value === 'foryou') rank() })
watch(offerForYou, (can) => {
  if (can && !chose && askedView !== 'all' && isSignedIn.value) show('foryou', false)
  else if (!can && mode.value === 'foryou') mode.value = 'all'
})
const offIdentity = onIdentity(async (id) => {
  /* the interests belong to whoever they were read for, so they go with the identity */
  forgetInterests(); mine.value = NO_INTERESTS; ranked.value = null; rankedFor = ''
  if (!id) return
  await askInterests()
  if (chose || askedView === 'all' || !offerForYou.value) return
  if (canRecommend.value) warmEmbedder()
  show('foryou', false)
})
onBeforeUnmount(offIdentity)
const badge = (a) => a.data.media ? (Array.isArray(a.data.media) ? 'Playlist' : (a.data.media.type === 'audio' ? 'Audio' : 'Video')) : null
/* an article's cover: its own hero image, or the poster off its media */
const img = (a) => a.data.image || (Array.isArray(a.data.media) ? a.data.media.find((m) => m.poster)?.poster : a.data.media?.poster) || null
</script>

<template>
  <div class="wrapwide">
    <header style="border:none;">
      <h1>{{ HUB.page.heading }}</h1>
      <p class="subtitle">{{ HUB.page.subtitle }}</p>
    </header>

    <!-- the toggle is the recommended-vs-fallback switch, and it really is only shown when there
         are recommendations to switch to -->
    <div class="disc">
      <div v-if="offerForYou" class="disc-toggle">
        <button type="button" :class="{ on: mode === 'all' }" @click="show('all')">{{ HUB.toggle.everything }}</button>
        <button type="button" :class="{ on: mode === 'foryou' }" @click="show('foryou')">{{ HUB.toggle.foryou }}</button>
      </div>
      <span v-if="mode === 'foryou' && canRecommend" class="disc-note">
        {{ HUB.toggle.note }}
      </span>
    </div>
  </div>

  <!-- ===================== THE EMPTY STATE OF "FOR YOU" =====================
       The card is what that view holds before it holds recommendations, so it appears only where
       the view itself does — on a site that can EARN them (invites()). A site that cannot never
       offers the view, and so never shows this either: there is no card, no toggle and no mention
       of recommendations until there are some. The cards sit inside the measure, never as the
       measure — a card that is the .wrapwide itself has its border at the screen's edge on a
       phone. -->
  <div v-if="!canRecommend && mode === 'foryou'" class="wrapwide">
  <!-- until the reader has something to draw on: what would arrange the shelf around them -->
  <div class="find find-diag">
    <div class="find-txt">
      <span class="find-eyebrow">{{ HUB.nudge.eyebrow }}</span>
      <span class="find-h">{{ HUB.nudge.heading }}</span>
      <span class="find-subtitle">{{ HUB.nudge.subtitle }}</span>
    </div>
    <a class="find-cta" href="/app">{{ HUB.nudge.cta }} &rarr;</a>
  </div>
  </div>

  <!-- ============================= FOR YOU ============================= -->
  <div v-if="mode === 'foryou'" class="wrapwide hub">
    <section class="lane" v-if="recBooks.length">
      <div class="lane-head"><h2>{{ HUB.lanes.books }}</h2></div>
      <div class="shelf">
        <a v-for="b in recBooks" :key="b.slug" class="thumb" :href="b.href">
          <span class="thumb-img" :style="b.cover ? null : { backgroundImage: coverTint(b.slug) }">
            <Book3D v-if="b.cover" :slug="b.slug" :art="b.cover.src" :alt="b.title + ' cover'" :title="b.title" :author="b.author" mode="still" />
            <span v-else class="thumb-ph">{{ b.title }}</span>
          </span>
          <b>{{ b.title }}</b>
          <span v-if="b.author" class="thumb-author">{{ b.author }}</span>
          <span v-if="b.prog && b.prog.opened" class="thumb-prog" :aria-label="b.prog.pct + '% ' + PROG['aria-read']">
            <span class="thumb-prog-fill" :style="{ width: b.prog.pct + '%' }" />
          </span>
        </a>
      </div>
    </section>

    <p v-if="loading" class="disc-loading">{{ HUB.lanes.loading }}</p>
    <template v-else>
      <section class="lane" v-if="byKind('article', 4).length >= LANE_MIN">
        <div class="lane-head"><h2>{{ HUB.lanes.articles }}</h2></div>
        <div class="art-grid">
          <a v-for="a in byKind('article', 4)" :key="a.href" class="art-card" :href="a.href">
            <span class="art-cardimg" :class="{ ph: !a.image }">
              <img v-if="a.image" :src="a.image" alt="" loading="lazy" />
            </span>
            <span class="art-cardbody">
              <h3>{{ a.title }}</h3>
              <p>{{ a.sub }}</p>
            </span>
          </a>
        </div>
      </section>

      <div class="lane-pair" :class="{ 'lane-pair-solo': !(byKind('wiki', 5).length >= LANE_MIN && byKind('doc', 5).length >= LANE_MIN) }" v-if="byKind('wiki', 5).length >= LANE_MIN || byKind('doc', 5).length >= LANE_MIN">
        <section class="lane" v-if="byKind('wiki', 5).length >= LANE_MIN">
          <div class="lane-head"><h2>{{ HUB.lanes.wiki }}</h2></div>
          <ul class="page-list">
            <li v-for="w in byKind('wiki', 5)" :key="w.href">
              <a :href="w.href">{{ w.title }}</a>
            </li>
          </ul>
        </section>
        <section class="lane" v-if="byKind('doc', 5).length >= LANE_MIN">
          <div class="lane-head"><h2>{{ HUB.lanes.docs }}</h2></div>
          <ol class="doc-list">
            <li v-for="d in byKind('doc', 5)" :key="d.href">
              <a :href="d.href">{{ d.title }}</a>
            </li>
          </ol>
        </section>
      </div>
    </template>
  </div>

  <!-- ============================ EVERYTHING =========================== -->
  <div v-else class="wrapwide hub">
    <section class="lane" v-if="hasBooks">
      <div class="lane-head lane-head-filter">
        <h2>{{ HUB.browse.heading }}</h2>
        <div class="book-filter">
          <span class="concept-select">
            <select v-model="concept" :aria-label="HUB.browse['filter-aria']">
              <option v-for="o in conceptOptions" :key="o.slug" :value="o.slug">{{ o.name }}</option>
            </select>
            <svg viewBox="0 0 12 8" width="10" height="7" aria-hidden="true"><path d="M1 1.5 6 6.5 11 1.5" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/></svg>
          </span>
          <a class="lane-more" href="/content/books">{{ HUB.browse['whole-shelf'] }} &rarr;</a>
        </div>
      </div>
      <div class="shelf" v-if="conceptBooks.length">
        <a v-for="b in conceptBooks" :key="b.slug" class="thumb" :href="'/content/books/' + b.slug">
          <span class="thumb-img" :style="b.cover ? null : { backgroundImage: coverTint(b.slug) }">
            <Book3D v-if="b.cover" :slug="b.slug" :art="b.cover.src" :alt="b.title + ' cover'" :title="b.title" :author="b.author" mode="still" />
            <span v-else class="thumb-ph">{{ b.title }}</span>
          </span>
          <b>{{ b.title }}</b>
          <span v-if="b.author" class="thumb-author">{{ b.author }}</span>
          <span v-if="b.prog && b.prog.opened" class="thumb-prog" :aria-label="b.prog.pct + '% ' + PROG['aria-read']">
            <span class="thumb-prog-fill" :style="{ width: b.prog.pct + '%' }" />
          </span>
        </a>
      </div>
      <p v-else class="disc-empty">{{ HUB.browse['empty-pre'] }} <a href="/content/books">{{ HUB.browse['empty-link'] }}</a>.</p>
    </section>

    <section class="lane" v-if="articles.length">
      <div class="lane-head">
        <h2>{{ HUB.browse['lane-articles'] }}</h2>
        <a class="lane-more" href="/content/articles">{{ HUB.browse['more-articles'] }} &rarr;</a>
      </div>
      <div class="art-grid">
        <a v-for="a in articles" :key="a.id" class="art-card" :href="'/content/articles/' + a.id">
          <span class="art-cardimg" :class="{ ph: !img(a) }">
            <img v-if="img(a)" :src="img(a)" alt="" loading="lazy" />
            <span v-if="badge(a)" class="art-badge art-badge-over">{{ badge(a) }}</span>
          </span>
          <span class="art-cardbody">
            <h3>{{ a.title }}</h3>
            <p>{{ a.description }}</p>
            <span class="art-date" v-if="a.date">{{ a.date }}</span>
          </span>
        </a>
      </div>
    </section>

    <div class="lane-pair" :class="{ 'lane-pair-solo': !(wiki.length && docs.length) }" v-if="wiki.length || docs.length">
      <section class="lane" v-if="wiki.length">
        <div class="lane-head">
          <h2>{{ HUB.browse['lane-wiki'] }}</h2>
          <a class="lane-more" href="/content/wiki">{{ HUB.browse['more-wiki'] }} &rarr;</a>
        </div>
        <ul class="page-list">
          <li v-for="w in wiki" :key="w.id"><a :href="'/content/wiki/' + w.id">{{ w.title }}</a></li>
        </ul>
      </section>
      <section class="lane" v-if="docs.length">
        <div class="lane-head">
          <h2>{{ HUB.browse['lane-docs'] }}</h2>
          <a class="lane-more" href="/content/docs">{{ HUB.browse['more-docs'] }} &rarr;</a>
        </div>
        <ol class="doc-list">
          <li v-for="d in docs" :key="d.id"><a :href="'/content/docs/' + d.id">{{ d.title }}</a></li>
        </ol>
      </section>
    </div>

  </div>
</template>

<style scoped>
.hub { padding-bottom: 80px }
.lane { margin: 0 0 54px }
/* the nudge card: one strip, never a card that pushes the shelf down */
.find { display: flex; align-items: center; gap: 22px; flex-wrap: wrap; margin: 0 auto 30px; padding: 14px 20px; border: 1px solid var(--hair); border-radius: 14px; background: color-mix(in srgb, var(--accent2) 6%, var(--paper)) }
.find-txt { display: flex; flex-direction: column; gap: 2px; flex: 1 1 220px; min-width: 200px }
.find-eyebrow { font-family: var(--m); font-size: 10px; letter-spacing: .14em; text-transform: uppercase; color: var(--accent2) }
.find-h { font-family: var(--fd); font-size: 18px; font-weight: 700; letter-spacing: -.01em; line-height: 1.2; color: var(--ink) }
.find-subtitle { font-size: 13.5px; color: var(--ink3); max-width: 60ch }
.find-cta { flex: none; font-size: 13.5px; font-weight: 600; color: var(--paper); background: var(--ink); border-radius: 999px; padding: 9px 16px; text-decoration: none; white-space: nowrap }
.find-cta:hover { opacity: .9 }
@media (max-width: 640px) { .find { padding: 14px 16px } }
.lane-head { display: flex; align-items: baseline; justify-content: space-between; margin: 0 0 18px }
.lane-head h2 { font-size: 21px }
.lane-more { font-family: var(--m); font-size: 11px; letter-spacing: .1em; text-transform: uppercase;
  color: var(--accent2); text-decoration: none }
.lane-more:hover { text-decoration: underline; text-underline-offset: 4px }
/* the books filter: a native select, styled as a quiet pill with a chevron */
.lane-head-filter { align-items: center }
.book-filter { display: flex; align-items: center; gap: 18px }
.concept-select { position: relative; display: inline-flex; align-items: center }
.concept-select select {
  appearance: none; -webkit-appearance: none; cursor: pointer;
  font: inherit; font-size: 14px; color: var(--ink); background: var(--card, #fff);
  border: 1px solid var(--hair, #00000018); border-radius: 999px;
  padding: 7px 30px 7px 15px; line-height: 1.2;
}
.concept-select select:hover { border-color: var(--ink3) }
.concept-select select:focus-visible { outline: 2px solid var(--accent2); outline-offset: 1px }
.concept-select svg { position: absolute; right: 13px; color: var(--ink3); pointer-events: none }
.disc-empty { color: var(--ink3); font-size: 15px }
.disc-empty a { color: var(--accent2) }
.lane-pair { display: grid; grid-template-columns: 1fr 1fr; gap: 44px }
.lane-pair-solo { grid-template-columns: 1fr }   /* a lone remaining lane spans full width */
@media (max-width: 760px) { .lane-pair { grid-template-columns: 1fr } }

/* discovery control */
.disc { display: flex; align-items: center; gap: 16px; margin: 4px 0 34px; flex-wrap: wrap }
.disc-toggle { display: inline-flex; background: var(--wash); border: 1px solid var(--hair); border-radius: 999px; padding: 3px }
.disc-toggle button { font: inherit; font-size: 12.5px; color: var(--ink3); background: none; border: 0;
  border-radius: 999px; padding: 7px 16px; cursor: pointer }
.disc-toggle button.on { color: var(--ink); background: var(--paper); box-shadow: 0 1px 2px #0000000f }
.disc-note { font-size: 12.5px; color: var(--ink3) }
.disc-prompt { font-family: var(--m); font-size: 11px; letter-spacing: .08em; text-transform: uppercase;
  color: var(--accent2); text-decoration: none }
.disc-prompt:hover { text-decoration: underline; text-underline-offset: 4px }
.disc-loading { color: var(--ink3); font-size: 15px }

/* magazine lane */
.art-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(240px, 1fr)); gap: 14px }
.art-card { display: flex; flex-direction: column; background: var(--card); border: 1px solid var(--hair);
  border-radius: 16px; overflow: hidden; text-decoration: none; color: var(--ink);
  transition: transform .18s ease, box-shadow .18s ease }
.art-card:hover { transform: translateY(-2px); box-shadow: 0 14px 30px -18px #0c0d0b33 }
/* the cover: an article's hero image (or a soft placeholder when it has none) */
.art-cardimg { position: relative; display: block; aspect-ratio: 16 / 9; flex: none;
  background: linear-gradient(150deg, var(--accentbg), var(--wash)) }
.art-cardimg img { width: 100%; height: 100%; object-fit: cover; display: block }
.art-cardbody { display: block; padding: 18px 20px 16px }
.art-badge { font-family: var(--m); font-size: 9.5px; letter-spacing: .13em; text-transform: uppercase;
  color: var(--accent2); border: 1px solid var(--hair); border-radius: 999px; padding: 3px 9px;
  display: inline-block; margin-bottom: 12px }
/* the media badge, laid over the cover */
.art-badge-over { position: absolute; left: 12px; top: 12px; margin: 0; color: #F4F6F1;
  background: #0a0d0bAA; border-color: #ffffff33; backdrop-filter: blur(6px) }
.art-card h3 { font-size: 17.5px; line-height: 1.3; margin: 0 0 8px }
.art-card p { font-size: 13.5px; color: var(--ink2); line-height: 1.55; margin: 0 0 12px }
.art-date { font-family: var(--m); font-size: 10.5px; color: var(--ink3) }

/* wiki lane */
.page-list { list-style: none; margin: 0; padding: 0 }
.page-list li { border-top: 1px solid var(--hair) }
.page-list a { display: block; padding: 11px 2px; color: var(--ink2); text-decoration: none; font-size: 15px }
.page-list a:hover { color: var(--ink) }

/* docs lane */
.doc-list { list-style: none; margin: 0; padding: 0; counter-reset: d }
.doc-list li { counter-increment: d; border-top: 1px solid var(--hair); display: flex; gap: 12px; align-items: baseline }
.doc-list li::before { content: counter(d, decimal-leading-zero); font-family: var(--m);
  font-size: 11px; color: var(--accent2); padding-top: 13px }
.doc-list a { display: block; padding: 11px 0; color: var(--ink2); text-decoration: none; font-size: 15px }
.doc-list a:hover { color: var(--ink) }

/* shelf */
.shelf { display: grid; grid-template-columns: repeat(auto-fill, minmax(200px, 1fr)); gap: 18px }
@media (max-width: 640px) { .shelf { grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 16px 12px } }   /* two to a row on a phone */
.thumb { display: block; text-decoration: none; color: var(--ink) }
/* the stage the book stands on: room for its tilt, no box of its own; a book with no
   cover keeps the generated tint as a flat board */
.thumb-img { position: relative; display: block; padding: 3% 9% 7% 1%; border-radius: 8px 12px 12px 8px; transition: transform .18s ease }
.thumb-img[style] { padding: 0; aspect-ratio: 2 / 3; overflow: hidden; box-shadow: inset 5px 0 0 #00000022, var(--sh) }
.thumb:hover .thumb-img { transform: translateY(-4px) }
.thumb-img img { width: 100%; height: 100%; object-fit: cover; display: block }
.thumb-ph { display: flex; align-items: flex-end; height: 100%; padding: 18px 16px;
  color: #F6FBF6; font-weight: 700; font-size: 16px; line-height: 1.3; letter-spacing: -.01em }
.thumb b { display: block; font-size: 15.5px; letter-spacing: -.01em; margin-top: 10px }
.thumb-author, .thumb-why { display: block; font-family: var(--m); font-size: 9.5px; letter-spacing: .1em;
  text-transform: uppercase; color: var(--ink3); margin-top: 3px }
.thumb-why { color: var(--accent2) }
/* reading progress, hugging the foot of the cover */
/* how far the book is read: a thin bar under the caption, in the accent */
.thumb-prog { display: block; margin-top: 8px; height: 4px; border-radius: 2px; background: color-mix(in srgb, var(--ink) 14%, transparent); overflow: hidden }
.thumb-prog-fill { display: block; height: 100%; background: var(--accent); transition: width .3s ease }
</style>
