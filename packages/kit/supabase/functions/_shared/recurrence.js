/*
 * THE RECURRENCE RULES, where a function can reach them.
 *
 * The module itself is `src/lib/recurrence.js` — one file, tested under Node, read by the browser,
 * the build and the functions alike, because "every third Friday" must not mean two things.
 *
 * Deno cannot follow a path out of the functions tree, so `assemble.mjs` REPLACES this file with
 * the real one when it writes the site's supabase/. Under Node (a test importing a scheduler
 * straight from the kit) this re-export is what resolves. Two lines, one source of truth, and
 * nothing to keep in step.
 */
export * from '../../../src/lib/recurrence.js'
