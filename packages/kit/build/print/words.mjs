/* the printed book's words: `## print / ### book` in the library scope, read as every other scope is
   — the theme's defaults with the site's merged over them, through the store, so the admin's server
   reads them in cloud mode where there is no content directory to open. Used by the build, by the
   catalog, and by the admin to check a spine title against the edition line's length.

   NOTHING HERE HAS A WORD OF ENGLISH IN IT. The edition line's default is the theme's
   (`spine-edition` in its library.md); a site says its own over the top. The literal that used to
   stand in for a failed read said one site's own edition name — in the kit, shown to every
   other site whenever the read did not work, which in cloud mode was always. */
import { uiScope } from '../strings-io.mjs'

/* store may be a site root or a store; `theme` is the theme's scopes where there is no manifest to read */
export async function printWords(store = process.cwd(), { theme } = {}) {
  try { return ((await uiScope('library', store, theme ? { theme } : {})) || {}).print?.book || {} }
  catch { return {} }
}
export const SPINE_EDITION = (w) => (w && w['spine-edition']) || ''
