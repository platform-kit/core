<script setup>
/*
 * Form: a form of the site inline on a landing page — the runner in the page, under an optional
 * eyebrow, heading and lead of the page's own. The form is chosen by slug from content/forms in the
 * page builder; one the site no longer has leaves the section quiet.
 */
/* Slots for a look's skin: `head` (the words above) and `form` (the runner). */
import { computed, defineAsyncComponent } from 'vue'
import { forms as FORMS } from '#content'
/* the runner and its logic engine come as their own chunk, fetched only where a Form section is on the page */
const FormRun = defineAsyncComponent(() => import('../forms/FormRun.vue'))
const props = defineProps({
  eyebrow: { type: String, default: '' },
  heading: { type: String, default: '' },
  lead: { type: String, default: '' },
  form: { type: String, default: '' },
})
const form = computed(() => (FORMS || []).find((f) => f.slug === props.form && f.published !== false) || null)
</script>

<template>
  <section class="lpsec lpform" :class="{ 'lprv': true }">
    <div class="lpwrap">
      <slot name="head" :eyebrow="eyebrow" :heading="heading" :lead="lead">
        <div v-if="eyebrow || heading || lead" class="lpform-head">
          <span v-if="eyebrow" class="lpeyebrow">{{ eyebrow }}</span>
          <h2 v-if="heading" class="lph2">{{ heading }}</h2>
          <p v-if="lead" class="lplead">{{ lead }}</p>
        </div>
      </slot>
      <slot name="form" :form="form">
        <FormRun v-if="form" :form="form" embed />
      </slot>
    </div>
  </section>
</template>

<style scoped>
.lpform { padding: 56px 0 }
.lpform:first-child { padding-top: calc(var(--headh, 72px) + 40px) }   /* first on the page: under the header, not behind it */
.lpform-head { max-width: 720px; margin: 0 auto 22px }
.lpform :deep(.frun) { min-height: 0 }
</style>
