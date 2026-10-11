/*
 * WHAT TO CALL THE PERSON WHO DELIVERS WHAT THE SITE SELLS.
 *
 * Three layers, and they are asked in this order:
 *
 *   THE KIT calls the role `provider`, because the kit has no idea what the business is. That word
 *   is an identifier — a role, a column, a policy — and a reader never sees it.
 *
 *   THE SITE says what its readers see: Coach, Healer, Therapist, Consultant, Tutor. One record,
 *   `## role / ### provider` in the people scope, with a field for every way the word is ever
 *   said — the theme ships Provider and a site merges its own over the top, key by key, like every
 *   other string.
 *
 *   THE PERSON says what THEY are, on their own profile (`profiles.title`), and wherever a surface
 *   names that person it wins. A practice of five can then have four Therapists and one
 *   Supervisor without the site changing its word, which is the whole point: the class belongs to
 *   the site, the title belongs to the person.
 *
 * So: `roleWord()` for the class — a list, a filter, a heading about the work — and `titleOf(person)`
 * wherever somebody in particular is named. Never a literal in a component; never a second markdown
 * file saying it again.
 */
import { ug } from './content.js'

const EMPTY = {}
/* the site's record, merged over the theme's by the strings pipeline before it ever reaches here */
export const roleWord = () => (ug('people', 'role') || EMPTY).provider || EMPTY

/* the class, by field: roleWord().name, .plural, .a, .your, .work, .session */
export const providerName = () => roleWord().name || ''
export const providerPlural = () => roleWord().plural || ''

/*
 * WHAT TO CALL THIS PERSON. Their own title where they have set one, the site's word otherwise.
 * `person` is any row carrying a title — a profile, a member card, the inbox's peer — so a caller
 * hands over whatever it already has rather than fetching a profile to ask.
 *
 * Trimmed, because a title that is spaces is a title nobody set; capped, because this is drawn
 * beside a name in a row and a paragraph in that slot is not a title. Both are the same decision
 * the database's own check makes, kept here so a surface never draws something the column would
 * have refused.
 */
export const TITLE_MAX = 40
export function titleOf(person) {
  const own = String((person && (person.title || person.provider_title)) || '').trim()
  return own ? own.slice(0, TITLE_MAX) : providerName()
}

/* did THIS person choose their own word, or are they wearing the site's? — for a surface that
   wants to show a title only where somebody actually set one */
export const hasOwnTitle = (person) => !!String((person && (person.title || person.provider_title)) || '').trim()

/*
 * A STRING WITH THE ROLE'S WORD IN IT. The theme's defaults say {provider}, {providers},
 * {a-provider}, {your-provider}, {work} and {session} rather than any English word, so a site that
 * calls them Therapists changes ONE record and every sentence follows. `who` is optional: hand
 * over the person a sentence is about and their own title is used instead of the site's word,
 * which is what makes "Message your supervisor" possible beside "Message your coach".
 *
 *   say(W.heading)              →  "Work through it with a coach."
 *   say(W['chat-link'], peer)   →  "Message your supervisor"
 */
export function say(text, who) {
  const w = roleWord()
  const one = who ? titleOf(who) : (w.name || '')
  const lower = (s) => (s || '').charAt(0).toLowerCase() + (s || '').slice(1)
  return String(text || '')
    .split('{provider}').join(one)
    .split('{providers}').join(w.plural || '')
    .split('{a-provider}').join(who ? one : (w.a || ''))
    .split('{your-provider}').join(who ? one : (w.your || ''))
    .split('{provider-lower}').join(lower(one))
    .split('{work}').join(w.work || '')
    .split('{session}').join(w.session || '')
}
