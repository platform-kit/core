/*
 * The discount rule, for the browser.
 *
 * One implementation, three doors: the build reads it through catalog.mjs, the checkout function
 * imports it directly, and a page imports it here. A discount shown that is not the discount
 * charged is the same class of bug as a price shown that is not the price charged, and the
 * cheapest guard is that there is only one thing to get right.
 *
 * Nothing is added here.
 */
export * from '../../supabase/functions/_shared/promotions.js'
