/*
 * The variant grammar, for the browser.
 *
 * One implementation, three doors: the build imports it through `build/variants.mjs`, the
 * checkout function imports it directly, and a page imports it here. It lives in
 * `supabase/functions/_shared/variants.js` because the function is the one that must agree with
 * the build to the character — a price shown that is not the price charged is the worst bug this
 * can have, and the cheapest guard against it is that there is only one thing to get right.
 *
 * Same arrangement as print-offers.js and ledger-rules.js. Nothing is added here.
 */
export * from '../../supabase/functions/_shared/variants.js'
