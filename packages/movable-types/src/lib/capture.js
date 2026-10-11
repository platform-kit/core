/*
 * An email captured on a landing page — a newsletter block, a CTA's field, the hero's — is a
 * response to one of the site's forms: the form is named by slug, its first email field takes
 * the address, and the response is closed in the same post, so it lands in Forms → Responses
 * beside every other answer and the form's own delivery (an email, a webhook) runs. A form
 * with no email field cannot take a capture and the block says so in the console, never on
 * the page. A second address from the same person is refused by the form as "already answered"
 * — read here as done, since the person is on the list.
 */
import { forms as FORMS } from '#content'
import { postSlide } from '@platform-kit/kit/lib/forms/api.js'

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
export const isEmail = (s) => EMAIL.test(String(s || '').trim())

export function captureForm(slug) {
  const f = (FORMS || []).find((x) => x.slug === slug && x.published !== false)
  const field = f && (f.model.fields || []).find((x) => x.kind === 'email')
  return f && field ? { form: f, field } : null
}

/* resolves to 'done' | 'already'; rejects with the form's own message */
export async function capture(slug, email, extra = {}) {
  const c = captureForm(slug)
  if (!c) { console.warn('[capture] no form with an email field:', slug); throw new Error('no form') }
  /* any other field the form has and the block gives (a first name), by the field's own name */
  const fields = c.form.model.fields || []
  const more = Object.fromEntries(Object.entries(extra).filter(([k, v]) => v && fields.some((f) => f.name === k)))
  try {
    await postSlide(slug, { ...more, [c.field.name]: String(email).trim() }, { end: true, slide: c.field.slide || 0 })
    return 'done'
  } catch (e) {
    if (e && e.code === 'already') return 'already'
    throw e
  }
}
