/*
 * The embed: a form of this site mounted on another site's page, no iframe — the form's runner in
 * the site's design, posting to the site's own backend. Built by build/form-embed.mjs into dist/form.js
 * (with dist/form.css beside it), and put on a page with the snippet the admin shows:
 *
 *   <div data-platformkit-form="contact"></div>
 *   <script src="https://the-site/form.js" data-site="https://the-site" async></script>
 *
 * The forms, the words and the site's Supabase address are baked into the bundle at build (the
 * `forms` collection, the `forms` strings scope, the client's env), so the script needs nothing but
 * the slug; the look's tokens come with it and go on the host page's root (unless it wears a look
 * of its own). The function checks where the page is (its Origin) against the form's allowed origins
 * and refuses the rest, which the runner shows.
 */
import { createApp, h } from 'vue'
import { forms as FORMS } from '#content'
import FormRun from './components/forms/FormRun.vue'
import { setFormClient } from '@platform-kit/kit/lib/forms/api.js'
import { supabase } from '@platform-kit/kit/lib/supabase.js'
import { look, applyLook } from '@platform-kit/kit/lib/look.js'
import { us } from '@platform-kit/kit/lib/strings.js'
import './tokens.css'   /* the design's tokens: without them the widget wears the host page's, and loses its hairlines and its ink */
import './looks/design.css'
import '#site/looks'

const W = (us('forms').embed || {}).refused || {}
const STATE = (us('forms').end || {}).state || {}
function mount(el) {
  const slug = el.getAttribute('data-platformkit-form')
  const form = (FORMS || []).find((f) => f.slug === slug && f.published !== false)
  if (!document.documentElement.dataset.look) applyLook(look.value)
  const app = createApp({
    render: () => (form ? h(FormRun, { form, embed: true }) : h('div', { class: 'qz frun frun-embed' }, [h('div', { class: 'qzstage' }, [h('div', { class: 'qzin fend' }, [h('h3', { class: 'qh' }, STATE.off || '')])])])),
  })
  app.mount(el)
  el.setAttribute('data-platformkit-mounted', '')
  return app
}
function mountAll() { document.querySelectorAll('[data-platformkit-form]:not([data-platformkit-mounted])').forEach(mount) }
/* the stylesheet beside the script, once */
const me = document.currentScript
if (me && me.src && !document.querySelector('link[data-platformkit-form-css]')) { const l = document.createElement('link'); l.rel = 'stylesheet'; l.href = me.src.replace(/form\.js(\?.*)?$/, 'form.css'); l.setAttribute('data-platformkit-form-css', ''); document.head.appendChild(l) }
setFormClient(supabase, typeof location !== 'undefined' ? location.origin : '')
if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', mountAll); else mountAll()
window.PlatformKitForm = { mount, mountAll }
