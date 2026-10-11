/*
 * Which provider a room gets — pure, no imports, so the functions (Deno) and the kit's tests (Node)
 * read the same rule. It lives apart from index.js because that binds the providers themselves, and
 * one of them reaches for a Deno-only package.
 *
 * A cal.com type keeps cal.com's own. Anything else on this site takes LiveKit **where the site has
 * an account** and the mesh where it has none: a call needs no account, and a site that never signed
 * up for one still holds every call it can hold directly. The choice is made from the environment,
 * so it is one setting and never a branch in a page.
 */
export const VIDEO_IDS = ['livekit', 'cal-video', 'mesh']

export const hasVideoAccount = (env) => !!(env && env('LIVEKIT_URL') && env('LIVEKIT_API_KEY') && env('LIVEKIT_API_SECRET'))

export function videoIdOf(type, env) {
  if (!type) return null
  if (type.scheduler === 'cal' || (!type.scheduler && type.url)) return 'cal-video'
  if (!(type.where && type.where.kind === 'video')) return null
  return hasVideoAccount(env) ? 'livekit' : 'mesh'
}
