<script setup>
import ScreenHead from './ScreenHead.vue'

/* One statement, and the ways of answering it. */
defineProps({ screen: { type: Object, required: true } })
const emit = defineEmits(['answer'])
</script>

<template>
  <div class="qzin">
    <ScreenHead
      :eyebrow="screen.eyebrow"
      :headline="screen.headline"
      :sub="screen.sub"
      :headline-style="screen.headlineStyle"
    />

    <div class="qopts">
      <button
        v-for="(o, n) in screen.options"
        :key="o.v"
        class="qopt"
        :style="o.multiline ? 'align-items:flex-start;padding:16px 20px' : null"
        @click="emit('answer', o.v)"
      >
        <span class="k">{{ n + 1 }}</span>
        <span v-if="o.colour" class="sw" :style="{ background: o.colour }" />
        <span class="qoptl">
          {{ o.label }}
          <span v-if="o.sub" class="qopts2">{{ o.sub }}</span>
        </span>
        <span v-if="o.note" class="qoptn">{{ o.note }}</span>
      </button>
    </div>

    <div v-if="screen.hint" class="qsay qhint" v-html="screen.hint" />
  </div>
</template>
