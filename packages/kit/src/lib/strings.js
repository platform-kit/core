/*
 * App UI strings, bound from content/app/ui/*.md (the `ui` velite collection).
 *
 * Every reader-facing label, caption, button, prompt and explainer paragraph
 * that used to be hardcoded in a component is looked up here by scope + group,
 * so the words live in markdown and can be edited (or translated) in one place.
 * This is separate from the results-interpretation copy in content/app/**\/results.md
 * and never touches it.
 */
import { ui as UI } from '#content'
import { groups as THEME } from '#site/strings-default'

const BY = {}
;(UI || []).forEach((f) => { BY[f.scope] = f.groups })

/*
 * THE THEME'S OWN WORDS ARE THE FLOOR, and this is what makes a missing string impossible rather
 * than merely unlikely.
 *
 * The site's `content/app/ui/*.md` is merged over the theme's when the `ui` collection is compiled,
 * so in the ordinary case everything is already here. What is not covered by that is the gap
 * between the two: a key the theme gained since this site last compiled its content, a scope a site
 * overrode wholesale and left a field out of, a dev server that has not rebuilt. In every one of
 * those the lookup used to answer `undefined`, and `undefined` on a label is a blank — on a button
 * whose label is the whole control, a control nobody can see or press. That is not a theoretical
 * failure: it folded the face designer behind an invisible button and read as the feature having
 * been deleted.
 *
 * So the theme's defaults are shipped as data and merged UNDER the compiled collection, field by
 * field. The site still wins wherever it has said anything, and no component carries an English
 * word to fall back on.
 */
const under = (over, base) => {
  if (!base) return over || {}
  if (!over) return base
  const out = { ...base }
  for (const [k, v] of Object.entries(over)) {
    out[k] = (v && typeof v === 'object' && !Array.isArray(v)) ? under(v, base[k]) : v
  }
  return out
}
const merged = {}
const scopeOf = (scope) => {
  if (merged[scope]) return merged[scope]
  merged[scope] = under(BY[scope], (THEME || {})[scope])
  return merged[scope]
}

/* one group as a plain { key: {fields} } object — the common case */
export function ug(scope, group) { return scopeOf(scope)[group] || {} }

/* the whole scope, for a component that reads several groups */
export function us(scope) { return scopeOf(scope) }
