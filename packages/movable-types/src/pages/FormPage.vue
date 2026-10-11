<script setup>
/* A form on its own page: /form/<slug> (and /to/<slug>, Typeform's address shape, where its embed looks), no site
   chrome — the form fills the window in the site's design. The head is the form's title. A slug no published form
   has lands on a quiet "no such form". Under Typeform's embed (?typeform-embed=…) the runner speaks its messages. */
import { computed } from 'vue'
import { forms as FORMS } from '#content'
import { ROUTES } from '../router.js'
import { setHead } from '@platform-kit/kit/lib/seo.js'
import { us } from '@platform-kit/kit/lib/strings.js'
import FormRun from '../components/forms/FormRun.vue'
const props = defineProps({ path: { type: String, required: true } })
const slug = computed(() => props.path.slice((props.path.startsWith(ROUTES.to + '/') ? ROUTES.to : ROUTES.form).length + 1).split('/')[0])
const form = computed(() => (FORMS || []).find((f) => f.slug === slug.value && f.published !== false) || null)
const W = (us('forms').end || {}).state || {}
setHead({ title: form.value ? form.value.title : (W.off || ''), description: form.value ? (form.value.model.settings['meta-description'] || '') : '', path: props.path, noindex: !form.value })
</script>

<template>
  <div class="fpage">
    <FormRun v-if="form" :form="form" />
    <div v-else class="qz frun"><div class="qzstage"><div class="qzin fend"><h3 class="qh">{{ W.off }}</h3></div></div></div>
  </div>
</template>

<style scoped>
.fpage { min-height: 100vh }
.fpage :deep(.qzstage) { align-items: center }
</style>
