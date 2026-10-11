/*
 * A form's model → the screens the runner shows, by its page mode. A slide is a screen (kind `form`):
 * its blocks in order — copy, fields, divs — with the slide's own directives; the fields in it are
 * asked together, as forms.md shows a slide. `form-slides` (the default) posts each slide's answers as
 * it goes; `slides` shows the same slides and posts nothing (a presentation with fields on it);
 * `single` is the whole document on one screen. A slide's jump condition is the runner's skip: the
 * screen is passed over when the condition does not hold at the moment it would be shown, which is
 * how forms.md finds the next slide. The start slides come first, the body slides after, and the end
 * slide — the document's, or the default — last, marked `end`, so the host knows the form is done
 * when the screen before it is answered. Pure; the context (data + answers) is a function the host
 * gives, read when a skip is decided.
 */
import { holds } from './logic.js'

const walkFields = (blocks, out = []) => { for (const b of blocks || []) { if (b.type === 'field') out.push(b); if (b.blocks) walkFields(b.blocks, out) } return out }

/* the slide's progress, as forms.md says it: its own `|>`, else 0% on the first and 100% on the end */
function progressOf(slide, i, n) {
  if (slide.progress) return parseFloat(slide.progress)
  if (i === 0) return 0
  if (slide.type === 'end') return 100
  return Math.round((100 * i) / Math.max(n - 1, 1))
}

export function formScreens(model, ctx) {
  const settings = model.settings || {}
  const page = settings.page || 'form-slides'
  const isForm = page === 'form-slides'
  const restart = settings['restart-button'] === 'show'
  const submitText = settings['submit-button-text'] || ''
  if (page === 'single') {
    const blocks = model.slides.flatMap((s) => s.blocks)
    return [{ kind: 'form', id: 'single', index: 0, type: 'single', blocks, fields: walkFields(blocks), isForm: false, post: false, end: true, single: true, progress: 100, align: settings['button-alignment'] || '' }]
  }
  const slides = model.slides
  const hasEnd = slides.some((s) => s.type === 'end')
  const list = hasEnd ? slides : [...slides, { type: 'end', blocks: [], head: [], jump: '', progress: '', align: '', post: false, disablePrev: false, button: '', redirect: '', defaultEnd: true }]
  const n = list.length
  return list.map((s, i) => {
    const fields = walkFields(s.blocks)
    const next = list[i + 1]
    const screen = {
      kind: 'form', id: 'slide:' + i, index: i, type: s.type, blocks: s.blocks, fields,
      isForm: isForm && s.type !== 'end', post: isForm && s.type === 'body',
      end: s.type === 'end', last: !!(next && next.type === 'end'), first: i === 0,
      jump: s.jump || '', progress: progressOf(s, i, n), align: s.align || settings['button-alignment'] || '',
      disablePrev: !!s.disablePrev, button: s.button || '', redirect: s.redirect || '', restart, submitText, defaultEnd: !!s.defaultEnd,
      skip: s.jump ? () => !holds(s.jump, ctx ? ctx() : {}) : undefined,
    }
    return screen
  })
}

/* the answers a slide's fields hold, from the whole set: what one screen posts */
export function slideAnswers(screen, answers) {
  const out = {}
  for (const f of screen.fields) if (f.name in answers) out[f.name] = answers[f.name]
  return out
}
