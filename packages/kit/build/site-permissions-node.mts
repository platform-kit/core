/*
 * The Node fallback for #site/permissions: outside Vite — a build script, a test, an Edge Function —
 * a site that registered no rules of its own is answered with rules that add nothing. The kit's own
 * rules are in supabase/functions/_shared/permissions.ts and are never the site's to replace, only
 * to narrow or extend.
 */
export const rules = () => {}
export default { rules }
