<script setup>
import ScreenHead from './ScreenHead.vue'

/* A screen that explains rather than measures — the offer of the microphone, the
   handover between sections, the close. Its body and footer carry markup. */
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

    <p v-if="screen.body" class="qp" v-html="screen.body" />

    <div class="qopts">
      <button
        v-for="(o, n) in screen.options || []"
        :key="o.v"
        class="qopt"
        @click="emit('answer', o.v)"
      >
        <span class="k">{{ n + 1 }}</span>
        <span class="qoptl">
          {{ o.label }}
          <span v-if="o.sub" class="qopts2">{{ o.sub }}</span>
        </span>
        <span v-if="o.note" class="qoptn">{{ o.note }}</span>
      </button>
    </div>

    <div v-if="screen.footer" v-html="screen.footer" />
  </div>
</template>
