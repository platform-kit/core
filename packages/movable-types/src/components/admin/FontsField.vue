<!--
  THE THREE FACES, CHOSEN AND SEEN.

  A typeface is a decision with exactly one part — which face — and the thing that would otherwise
  be typed (the fallback stack, the weights, the stylesheet url) is a grammar for the build. So this
  asks for the decision and nothing else, and it asks for it the only way a typeface can honestly be
  asked for: EVERY NAME IS SET IN ITS OWN LETTERFORMS. A list of font names in the admin's own face
  tells you nothing about any of them.

  Two dozen are RECOMMENDED — chosen, each with a note saying what it is for — and they are not a
  limit: searching reaches every one of the 1,949 families Google serves, each with the weights and
  axes it actually has, so the build can always make a request that family can answer.

  Above the three, a SPECIMEN: the heading face, the body face and the mono face set together at
  the sizes they are actually used at, because three names in three lists do not tell you whether
  they look right beside one another — which is the only question that matters.

  Each slot says what it governs ("prose, the reader, every control") rather than its token, since
  `--f` means nothing to the person choosing.
-->
<template>
  <div class="ui-fonts">
    <!-- the three faces as they will actually sit together -->
    <figure class="ui-spec">
      <figcaption class="ui-speccap">{{ W.field.specimen }}</figcaption>
      <p class="ui-spech" :style="{ fontFamily: stackOf('heading') }">{{ W.field['specimen-heading'] }}</p>
      <p class="ui-specb" :style="{ fontFamily: stackOf('body') }">{{ W.field['specimen-body'] }}</p>
      <p class="ui-specm" :style="{ fontFamily: stackOf('mono') }">{{ W.field['specimen-mono'] }}</p>
    </figure>

    <div v-for="s in SLOTS" :key="s.slot" class="ui-fontslot">
      <div class="ui-fonthead">
        <span class="ui-fontname">{{ W.slot[s.slot] }}</span>
        <span class="ui-fontwhat">{{ s.what }}</span>
      </div>

      <button type="button" class="ui-fontpick" :style="{ fontFamily: stackOf(s.slot) }" @click="toggle(s.slot)">
        <span class="ui-fontchosen">{{ chosen(s.slot) }}</span>
        <span v-if="!value[s.slot]" class="ui-fontdefault">{{ W.field.default }}</span>
        <svg viewBox="0 0 20 20" width="14" height="14" aria-hidden="true"><path d="m6 8 4 4 4-4" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/></svg>
      </button>

      <div v-if="open === s.slot" class="ui-fontlist">
        <input
          ref="searchBox" v-model="query" type="search" class="ui-fontsearch"
          :placeholder="W.field.search" :aria-label="W.field.search"
        />

        <div class="ui-fontscroll" role="listbox">
          <button type="button" class="ui-fontopt" :class="{ 'ui-on': !value[s.slot] }" :style="{ fontFamily: defaultStack(s.slot) }" @click="choose(s.slot, '')">
            <span class="ui-fontoptname">{{ W.field.follow }}</span>
            <span class="ui-fontnote">{{ defaultName(s.slot) }} — {{ W.field['follow-note'] }}</span>
          </button>

          <p v-if="found(s.slot).recommended.length" class="ui-fontgroup">{{ W.field.recommended }}</p>
          <button
            v-for="f in found(s.slot).recommended" :key="'r' + f.name" type="button"
            class="ui-fontopt" :class="{ 'ui-on': value[s.slot] === f.name }"
            :style="{ fontFamily: f.stack }" @click="choose(s.slot, f.name)"
          >
            <span class="ui-fontoptname">{{ f.name }}</span>
            <span class="ui-fontnote">{{ f.note }}<template v-if="f.name === defaultName(s.slot)"> · {{ W.field.pinned }}</template></span>
          </button>

          <p v-if="found(s.slot).others.length" class="ui-fontgroup">{{ W.field.everything }}</p>
          <button
            v-for="f in found(s.slot).others" :key="'o' + f.name" type="button"
            class="ui-fontopt" :class="{ 'ui-on': value[s.slot] === f.name }"
            :style="{ fontFamily: f.stack }" @click="choose(s.slot, f.name)"
          >
            <span class="ui-fontoptname">{{ f.name }}</span>
          </button>

          <p v-if="found(s.slot).more" class="ui-fontmore">{{ W.field.more }}</p>
          <p v-if="!found(s.slot).recommended.length && !found(s.slot).others.length" class="ui-fontmore">{{ W.field.none }}</p>
        </div>
      </div>
    </div>

    <p class="ui-fonthelp">{{ W.field.help }}</p>
  </div>
</template>

<script setup>
import { computed, ref, nextTick, watch } from 'vue'
import { us } from '@platform-kit/kit/lib/content.js'
import { DEFAULTS, familyOf, searchFamilies } from '@platform-kit/kit/build/typefaces.mjs'

const SPEC = { heading: '--fd', body: '--f', mono: '--m' }
const props = defineProps({ modelValue: { type: Object, default: () => ({}) } })
const emit = defineEmits(['update:modelValue'])

const W = computed(() => us('pages').fonts || { slot: {}, field: {} })
const value = computed(() => props.modelValue || {})
const open = ref('')
const query = ref('')
const searchBox = ref(null)

const SLOTS = Object.keys(SPEC).map((slot) => ({ slot, what: (us('pages').fonts?.what || {})[slot] || '' }))

const defaultName = (slot) => DEFAULTS[slot]
const defaultStack = (slot) => familyOf(DEFAULTS[slot]).stack
const chosen = (slot) => value.value[slot] || DEFAULTS[slot]
const stackOf = (slot) => (familyOf(chosen(slot)) || familyOf(DEFAULTS[slot])).stack

const found = (slot) => searchFamilies(slot, query.value)

const toggle = (slot) => {
  open.value = open.value === slot ? '' : slot
  query.value = ''
  if (open.value) nextTick(() => { const b = [].concat(searchBox.value)[0]; if (b) b.focus() })
}

/* an empty choice is the theme's, and is written as ABSENT rather than as a name — so a site that
   never chose keeps following the theme when the theme's own default changes */
const choose = (slot, name) => {
  const next = { ...value.value }
  if (name) next[slot] = name
  else delete next[slot]
  emit('update:modelValue', next)
  open.value = ''
  query.value = ''
}

/*
 * A FACE CANNOT BE PREVIEWED UNTIL IT IS LOADED, and there are 1,949 of them — loading the lot to
 * show a list would be tens of megabytes for a control somebody opens for ten seconds. So only the
 * families actually ON SCREEN are fetched, as they appear, and only ever once: the search box
 * changes the list, the list asks for what it is about to draw, and a family already asked for is
 * never asked for again.
 *
 * `text=` would be smaller still, but a specimen of a name needs the name's own glyphs and the
 * whole family is what the chooser is judging, so the regular weight of each is the honest ask.
 */
const asked = new Set()
const load = (names) => {
  const want = names.filter((n) => n && !asked.has(n))
  if (!want.length) return
  for (const n of want) asked.add(n)
  const link = document.createElement('link')
  link.rel = 'stylesheet'
  link.href = 'https://fonts.googleapis.com/css2?' + want.map((n) => 'family=' + n.replace(/ /g, '+')).join('&') + '&display=swap'
  document.head.appendChild(link)
}

watch([open, query], () => {
  if (!open.value) return
  const r = found(open.value)
  load([...r.recommended.map((f) => f.name), ...r.others.map((f) => f.name), DEFAULTS[open.value]])
}, { immediate: true })

/* the specimen is three faces and is always on screen, so it is always loaded */
watch(value, () => load(['heading', 'body', 'mono'].map((s) => chosen(s))), { immediate: true, deep: true })
</script>

<style scoped>
.ui-fonts { display: grid; gap: 14px; }

.ui-spec { margin: 0; padding: 14px 16px; border: 1px solid var(--hair); border-radius: 10px; background: var(--wash); display: grid; gap: 6px; }
.ui-speccap { font-size: 10.5px; text-transform: uppercase; letter-spacing: .09em; opacity: .5; font-family: var(--f); }
.ui-spech { margin: 2px 0 0; font-size: 30px; line-height: 1.12; }
.ui-specb { margin: 0; font-size: 14.5px; line-height: 1.5; opacity: .85; }
.ui-specm { margin: 0; font-size: 12.5px; opacity: .6; }

.ui-fontslot { display: grid; gap: 6px; }
.ui-fonthead { display: flex; gap: 8px; align-items: baseline; flex-wrap: wrap; }
.ui-fontname { font-weight: 600; font-size: 13px; }
.ui-fontwhat { font-size: 12px; opacity: .6; }
.ui-fontpick {
  display: flex; align-items: center; gap: 10px; width: 100%; text-align: left;
  padding: 9px 12px; border: 1px solid var(--hair); border-radius: 8px; background: var(--paper);
  color: inherit; cursor: pointer; font-size: 16px;
}
.ui-fontpick:hover { border-color: color-mix(in srgb, var(--accent) 45%, var(--hair)); }
.ui-fontchosen { flex: 1; }
.ui-fontdefault { font-size: 11px; opacity: .55; font-family: var(--f); }

.ui-fontlist { border: 1px solid var(--hair); border-radius: 8px; background: var(--paper); overflow: hidden; }
.ui-fontsearch {
  width: 100%; box-sizing: border-box; padding: 9px 12px; border: 0; border-bottom: 1px solid var(--hair);
  background: transparent; color: inherit; font: inherit; font-family: var(--f); font-size: 13px;
}
.ui-fontsearch:focus { outline: 0; background: var(--wash); }
.ui-fontscroll { display: grid; gap: 2px; max-height: 300px; overflow-y: auto; padding: 4px; }
.ui-fontgroup {
  margin: 6px 0 2px; padding: 0 10px; font-family: var(--f); font-size: 10.5px;
  text-transform: uppercase; letter-spacing: .09em; opacity: .45;
}
.ui-fontopt {
  display: flex; align-items: baseline; gap: 10px; width: 100%; text-align: left;
  padding: 8px 10px; border: 0; border-radius: 6px; background: transparent; color: inherit;
  cursor: pointer; font-size: 17px;
}
.ui-fontopt:hover { background: var(--wash); }
.ui-fontopt.ui-on { background: color-mix(in srgb, var(--accent) 12%, transparent); }
.ui-fontoptname { flex: 0 0 auto; }
.ui-fontnote { font-family: var(--f); font-size: 11.5px; opacity: .55; }
.ui-fontmore { margin: 6px 0; padding: 0 10px; font-family: var(--f); font-size: 11.5px; opacity: .5; }
.ui-fonthelp { margin: 0; font-size: 12px; opacity: .6; }
</style>
