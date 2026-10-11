/*
 * The price rule, for the browser.
 *
 * One implementation, three doors: the build calls it through catalog.mjs, the checkout function
 * imports it directly, and a page imports it here. It lives in
 * `supabase/functions/_shared/prices.js` because the function is the one that must agree with the
 * page to the penny — an amount shown that is not the amount charged is the worst bug this can
 * have, and the cheapest guard against it is that there is only one thing to get right.
 *
 * Same arrangement as variants.js, stock.js and print-offers.js. Nothing is added here.
 */
export * from '../../supabase/functions/_shared/prices.js'
