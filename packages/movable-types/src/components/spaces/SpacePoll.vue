<script setup>
/*
 * A question asked of a room, and what came back. The poll IS the message — the question is its
 * body, its options ride on its meta — so this draws inside the line rather than beside it, and
 * everything that is true of a message is true of it: it is searched, threaded, withdrawn and
 * moderated by the rules that already exist.
 *
 * Every number here comes from `tallyPoll`, which is pure and pinned under Node: this component
 * counts nothing. Pressing an option while only one answer is allowed MOVES the answer rather than
 * adding a second, because that is what somebody means by it.
 *
 * Words from spaces.md (poll).
 */
import { computed } from 'vue'
import { us } from '@platform-kit/kit/lib/content.js'
import { tallyPoll } from '@platform-kit/kit/lib/spaces/model.js'

const props = defineProps({
  message: { type: Object, required: true },
  votes: { type: Array, default: () => [] },
  names: { type: Object, default: () => ({}) },
  me: { type: String, default: '' },
  mayClose: { type: Boolean, default: false },
})
const emit = defineEmits(['vote', 'unvote', 'close'])
const W = computed(() => us('spaces').poll.main)
const tally = computed(() => tallyPoll(props.message, props.votes, props.me))

const said = computed(() => {
  const t = tally.value
  if (!t || !t.people) return W.value['none-yet']
  return t.people === 1 ? W.value['people-one'] : (W.value['people-many'] || '').replace('{n}', t.people)
})
const countOf = (n) => (n === 1 ? W.value['votes-one'] : (W.value['votes-many'] || '').replace('{n}', n))
const pct = (share) => Math.round(share * 100)
/* who answered, said as names — a community poll is not a secret ballot, and this is the half of it
   that makes one worth asking */
const whoOf = (o) => (o.who || []).map((id) => props.names[id] || '').filter(Boolean).join(', ')

function press(o) {
  if (!tally.value || tally.value.closed) return
  if (o.mine) emit('unvote', o.key)
  else emit('vote', { key: o.key, multi: tally.value.multi })
}
</script>

<template>
  <div v-if="tally" class="sq" :class="{ shut: tally.closed }">
    <ul class="sq-list">
      <li v-for="o in tally.options" :key="o.key">
        <button
          type="button" class="sq-opt" :class="{ mine: o.mine, leads: o.leads && tally.cast }"
          :disabled="tally.closed" :title="whoOf(o) ? (W.who || '').replace('{names}', whoOf(o)) : ''"
          @click="press(o)">
          <i class="sq-bar" :style="{ width: pct(o.share) + '%' }"></i>
          <span class="sq-text">{{ o.text }}</span>
          <em class="sq-n">{{ pct(o.share) }}% · {{ countOf(o.votes) }}</em>
        </button>
      </li>
    </ul>
    <p class="sq-foot">
      <span>{{ said }}</span>
      <i v-if="tally.multi && !tally.closed">{{ W.several }}</i>
      <i v-if="tally.closed" class="sq-shut">{{ W.closed }}</i>
      <button v-if="mayClose && !tally.closed" type="button" class="sq-close" @click="emit('close')">{{ W.close }}</button>
    </p>
  </div>
</template>

<style scoped>
/* the site's global stylesheet styles bare elements; these say what they want instead */
.sq { margin: 7px 0 2px; max-width: 460px }
.sq-list { list-style: none; margin: 0 0 7px; padding: 0; display: grid; gap: 5px }
/* an option is a bar and its words in one control: the bar is behind the words rather than beside
   them, so a long answer never squeezes the number off the end */
.sq-opt { position: relative; display: flex; align-items: center; gap: 9px; width: 100%; overflow: hidden;
  font: inherit; font-size: 13.5px; text-align: left; color: var(--ink); background: var(--card);
  border: 1px solid var(--hair); border-radius: 9px; padding: 8px 11px; cursor: pointer;
  transition: border-color .12s ease }
.sq-opt:hover:not(:disabled) { border-color: color-mix(in srgb, var(--ink) 30%, transparent) }
.sq-opt:disabled { cursor: default }
.sq-bar { position: absolute; left: 0; top: 0; bottom: 0; z-index: 0; border-radius: 8px;
  background: color-mix(in srgb, var(--ink) 8%, transparent); transition: width .28s cubic-bezier(.2, .8, .2, 1) }
.sq-opt.mine { border-color: color-mix(in srgb, var(--sp-go, #1b7f5a) 55%, transparent) }
.sq-opt.mine .sq-bar { background: color-mix(in srgb, var(--sp-go, #1b7f5a) 16%, transparent) }
.sq-text { position: relative; z-index: 1; flex: 1; min-width: 0 }
.sq-opt.mine .sq-text { font-weight: 650 }
.sq-n { position: relative; z-index: 1; flex: none; font-style: normal; font-family: var(--m);
  font-size: 10.5px; color: var(--ink3); white-space: nowrap }
.sq-foot { display: flex; align-items: center; flex-wrap: wrap; gap: 4px 10px; margin: 0; max-width: none;
  font-size: 11.5px; color: var(--ink3) }
.sq-foot i { font-style: normal }
.sq-shut { font-weight: 700; letter-spacing: .04em; text-transform: uppercase }
.sq-close { width: auto; font: inherit; font-size: 11.5px; font-weight: 600; color: var(--ink3);
  background: transparent; border: 0; padding: 0; text-decoration: underline; cursor: pointer }
.sq-close:hover { color: var(--ink) }
</style>
