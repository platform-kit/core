/* What the site's config says about its APIs, read from the pipe's copy of the config (pipe/site.js, a plain module) —
   light enough for every door to import without the content index behind it */
import * as SITE from '../pipe/site.js'
const S = SITE as { modules?: Record<string, unknown>; name?: string; api?: { space?: string; public?: boolean } }
const slug = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')
export const SPACE = String(S.api?.space || slug(S.name || 'site'))
export const PUBLIC = S.api?.public !== false
export const API_ON = (S.modules ?? {}).api !== false
export const FORMS_ON = (S.modules ?? {}).forms !== false
export const SESSIONS_ON = (S.modules ?? {}).sessions !== false
export const STORE_ON = (S.modules ?? {}).store !== false
export const SUPPORT_ON = (S.modules ?? {}).support !== false
/* the Matrix surface is the COMMUNITY served as a homeserver, so it comes and goes with spaces */
export const SPACES_ON = (S.modules ?? {}).spaces !== false
/* …and whether a channel may be SEALED, which is its own switch: encryption costs a site the
   search of a room, the bots in it and the moderating of what nobody can read, so a site that
   wants rooms does not have to take that bargain to get them. With it off the key endpoints answer
   as they did before there was any such thing — honestly empty — rather than storing keys for a
   room that will never be sealed. */
export const ENCRYPTION_ON = (S.modules ?? {})['space-encryption'] !== false
