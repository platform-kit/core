/*
 * The variant grammar, for the build.
 *
 * It LIVES in supabase/functions/_shared/variants.js — plain JavaScript on nothing at all —
 * because the checkout function has to apply exactly the same rule the build applied when it
 * wrote the catalog, and two implementations of "which combinations does this offer sell" is
 * two answers the first time one of them is edited. Same arrangement as ledger-rules.js and the
 * printers: one file, Node on one side and Deno on the other.
 *
 * This is the build's door to it and adds nothing.
 */
export * from '../supabase/functions/_shared/variants.js'
