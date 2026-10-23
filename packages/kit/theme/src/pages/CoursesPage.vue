<!--
  COURSES ON PAGES OF THEIR OWN (openspec: courses): /courses the library, a course's overview and the lesson player —
  CoursesView, framed by the site — and a certificate at /certificates/<id>, a public address anyone given it can check.
  The community's Courses place (CoursesPlace) draws the same, in its own frame.
-->
<template>
  <SiteLayout>
    <div class="pageshell crs-page">
      <!-- a certificate -->
      <div v-if="isCert" class="crs-wrap crs-cert">
        <p v-if="loading" class="crs-quiet">…</p>
        <template v-else-if="cert">
          <div class="crs-cert-card">
            <p class="crs-kicker">{{ C.title }}</p>
            <p class="crs-cert-line">{{ C.line }}</p>
            <p class="crs-cert-name">{{ cert.name }}</p>
            <p class="crs-cert-line">{{ C.completed }}</p>
            <p class="crs-cert-course"><a :href="ROUTES.courses + '/' + cert.slug">{{ cert.course }}</a></p>
            <p class="crs-cert-line">{{ C.on }} {{ day(cert.issued_at) }}</p>
            <p class="crs-cert-by">{{ SITE_NAME }}</p>
          </div>
          <div class="crs-cert-foot">
            <p class="crs-quiet">{{ C.check }}</p>
            <button type="button" class="btn solid" @click="downloadPdf">{{ C.download }}</button>
          </div>
        </template>
        <div v-else class="crs-empty"><h2>{{ C.missing }}</h2><a class="btn" :href="ROUTES.courses">{{ L.title }}</a></div>
      </div>

      <CoursesView v-else :base="ROUTES.courses" :path="rest" />
    </div>
  </SiteLayout>
</template>

<script setup>
import { computed, ref, watch } from 'vue'
import { route, ROUTES } from 'platformkit/lib/router.js'
import { us } from 'platformkit/lib/content.js'
import { supabase } from 'platformkit/lib/supabase.js'
import { setHead } from 'platformkit/lib/seo.js'
import { certificatePdf } from 'platformkit/lib/certificate-pdf.js'
import site from '#site'
import SiteLayout from '../layouts/SiteLayout.vue'
import CoursesView from '../components/courses/CoursesView.vue'

const SITE_NAME = (site && site.name) || ''
const W = computed(() => us('courses').page || {})
const L = computed(() => W.value.list || {}), C = computed(() => W.value.certificate || {})
const day = (iso) => { try { return new Intl.DateTimeFormat(undefined, { day: 'numeric', month: 'long', year: 'numeric' }).format(new Date(iso)) } catch { return String(iso || '') } }

const isCert = computed(() => route.value.startsWith(ROUTES.certificates + '/'))
const rest = computed(() => (route.value.startsWith(ROUTES.courses + '/') ? route.value.slice(ROUTES.courses.length + 1) : ''))
const loading = ref(false), cert = ref(null)
watch(route, async () => {
  if (!isCert.value) return
  loading.value = true
  try { const { data } = supabase ? await supabase.rpc('certificate_public', { p_id: route.value.slice(ROUTES.certificates.length + 1) }) : { data: null }; cert.value = data || null } catch { cert.value = null }
  setHead({ title: cert.value ? `${cert.value.name} — ${cert.value.course}` : C.value.title })
  loading.value = false
}, { immediate: true })

function downloadPdf() {
  const c = cert.value; if (!c) return
  const bytes = certificatePdf({ heading: C.value.title, line: C.value.line, name: c.name, completed: C.value.completed, course: c.course, on: C.value.on, date: day(c.issued_at), by: SITE_NAME, check: C.value.check, url: location.origin + location.pathname })
  const a = document.createElement('a')
  a.href = URL.createObjectURL(new Blob([bytes], { type: 'application/pdf' }))
  a.download = `certificate-${c.slug}.pdf`
  a.click()
  setTimeout(() => URL.revokeObjectURL(a.href), 1000)
}
</script>

<style scoped>
.crs-page > .crs-wrap { padding: 48px 24px 88px; width: 100%; max-width: 760px; margin: 0 auto; box-sizing: border-box; }
.crs-quiet { color: var(--ink3); font-size: 14px; margin: 0; }
.crs-kicker { font-family: var(--m); font-size: 11px; letter-spacing: .14em; text-transform: uppercase; color: var(--ink3); margin: 0 0 10px; }
.crs-empty { border: 1px dashed var(--hair); border-radius: 16px; padding: 40px 32px; display: grid; gap: 10px; justify-items: start; }
.crs-empty h2 { margin: 0; font-size: 20px; }
/* the certificate */
.crs-cert { max-width: 760px; }
.crs-cert-card { position: relative; text-align: center; padding: 64px 32px; border: 1px solid var(--hair); border-radius: 6px; background: var(--card); box-shadow: inset 0 0 0 8px var(--card), inset 0 0 0 9px var(--hair); }
.crs-cert-card p { margin: 0 auto; max-width: none; }
.crs-cert-by { margin-top: 28px !important; padding-top: 18px; border-top: 1px solid var(--hair); display: inline-block; font-family: var(--m); font-size: 11px; letter-spacing: .14em; text-transform: uppercase; color: var(--ink3); }
.crs-cert-card .crs-kicker { margin-bottom: 36px; }
.crs-cert-line { color: var(--ink2); font-size: 15px; }
.crs-cert-name { font-size: clamp(30px, 5vw, 44px); font-weight: 700; color: var(--ink); margin: 12px 0 14px !important; line-height: 1.1; }
.crs-cert-course { font-size: clamp(20px, 3vw, 26px); font-weight: 600; margin: 10px 0 18px !important; }
.crs-cert-course a { color: var(--ink); }
.crs-cert-foot { display: flex; flex-wrap: wrap; align-items: center; justify-content: space-between; gap: 16px; margin-top: 20px; }

@media (max-width: 560px) {
  .crs-page > .crs-wrap { padding: 28px 16px 64px; }
  .crs-cert-card { padding: 44px 18px; }
}
</style>
