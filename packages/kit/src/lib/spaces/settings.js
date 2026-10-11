/*
 * THE COMMUNITY AS A WHOLE — everything about the spaces surface that is not one space.
 *
 * What it is called, the cover behind its front page, the six colours its chrome wears, what that
 * page opens on and which of its features this site runs. It is CONTENT (content/community.md) and
 * not config, because every one of those is a decision an owner makes about how their community
 * feels, and none of them is a decision a developer makes about how the code is put together —
 * so all of it is edited in the admin, and none of it needs a deploy.
 *
 * platformkit.config.js keeps only what a deployment decides: whether the module exists at all,
 * where coaching is answered, which avatar collection is drawn.
 *
 * A site that writes no file gets the kit's own answers, and every field falls through on its own:
 * a file that names one colour changes one colour.
 */
import { community } from '#content'

const FILE = () => (Array.isArray(community) ? community[0] : community) || {}

/* the kit's own, which are what a site gets before it has said anything */
export const DEFAULTS = {
  colours: {},
  home: { opens: 'feed', greeting: true, facts: true, compose: true, events: true, people: true },
  features: { events: true, huddles: true, polls: true, voice: true, files: true, tickets: true, forum: true, moderation: true },
}

export const settings = () => {
  const f = FILE()
  return {
    name: f.name || '',
    tagline: f.tagline || '',
    cover: f.cover || '',
    colours: { ...DEFAULTS.colours, ...(f.colours || {}) },
    home: { ...DEFAULTS.home, ...(f.home || {}) },
    features: { ...DEFAULTS.features, ...(f.features || {}) },
    body: f.body || '',
  }
}

/* IS THIS FEATURE ON HERE. Asked by every component that draws a button for one, so that switching
   a feature off takes its button, its place and its keyboard shortcut with it rather than leaving a
   control that does nothing. A feature the file does not name is on: a site says what it does not
   want, never what it does. */
export const has = (feature) => settings().features[feature] !== false

/* THE SIX COLOURS, as custom properties to stamp on the surface's root. Only the ones the file
   names are returned, so the stylesheet's own defaults answer for the rest — which is why a site
   that sets one colour is not made to set all six. */
const VARS = { rail: '--spaces-rail', side: '--spaces-side', ink: '--spaces-side-ink',
  on: '--spaces-side-on', link: '--spaces-link', badge: '--spaces-badge', go: '--spaces-go' }
export function paint(colours = settings().colours) {
  const out = {}
  for (const [k, v] of Object.entries(VARS)) if (colours[k]) out[v] = String(colours[k])
  return out
}
