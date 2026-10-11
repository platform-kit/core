/*
 * POST { items: [{ sku, quantity?, variant? }], country?, return?, success?, booking? } → { url }
 * `country` is where a cart that ships goes (chosen on the site first, since Checkout prices a
 * rate by a flat list, not by the address it collects): the session allows that country alone
 * and offers the store's methods priced for it.
 * to send the buyer to Stripe Checkout. Paid, they land on the app (`success`, a
 * path on this site, else /app; with ?checkout=success — the client reads it,
 * refreshes the entitlements and says thank you); cancelled, back where they
 * started (`return`, likewise, else the pricing page). `booking` — { event, start,
 * timeZone, notes } — is a session paid as it is booked: it rides in the session's
 * metadata, and the Stripe webhook books it through cal.com the moment the
 * payment lands.
 *
 * Sign-in is required (a purchase always attaches to a known user). Every sku is
 * looked up in OUR catalog (catalog.json, from the product files) — amounts and
 * products are never taken from the client, and nothing can be bought that a file
 * does not declare. Stripe is then made to match the file (offers.ts): the price
 * Checkout charges is the one the markdown says, created on the spot if Stripe
 * has never seen it. The mode follows the offers: subscriptions go one at a time
 * through subscription mode, everything else together through payment mode. The
 * Stripe customer is created once and remembered on the profile (service role),
 * so subscriptions, the Billing Portal and later purchases all share it. Physical
 * goods add address capture. A subscriber choosing another membership is SWITCHED —
 * the live subscription's price changed in place, prorated — and answered
 * { switched }, never sent to Checkout for a second subscription; the webhook's
 * customer.subscription.updated then moves the tier.
 */
import { stripe, stripeConfigured, stripeMock, isMockId, stripeUnconfigured, admin, json, preflight, getUser, appUrl } from '../_shared/lib.ts'
import { sessionParams, lineQuantity, trialDaysFor } from '../_shared/checkout-params.js'
import { checkVariant } from '../_shared/variants.js'
import { offer, offerByKey, ensureOffer, ships, printVariant, TIERS, WORDS, LISTS, PROMOTIONS } from '../_shared/offers.ts'
import { shipsTo, ratesFor } from '../_shared/shipping.ts'
import { buyable, stockKey } from '../_shared/stock.js'   /* the one sold-out rule, the page's own */
import { guestSessionSku, mayBookAsGuest } from '../_shared/sessions/guest-booking.js'
import { priceOf } from '../_shared/prices.js'            /* and the one price rule, likewise */
import { apply as applyPromotions } from '../_shared/promotions.js'   /* and the one discount rule */
import { checkoutCompleted, subscriptionChanged, subscriptionDeleted, iso, idOf } from '../_shared/ledger.ts'
import { judge } from '../_shared/cal.ts'
import { coaching as siteCoaching } from '../_shared/pipe/site.js'
import { fresh } from '../_shared/compiled.ts'   /* the compiled artefacts, re-read within a few seconds of a publish */

Deno.serve(async (req) => {
  await fresh()
  const pre = preflight(req); if (pre) return pre
  if (req.method !== 'POST') return json({ error: 'method not allowed' }, 405)

  /* a guest may buy print or downloads, or one public paid session when this site opted in;
     an account made later can claim the purchase only after proving its email. */
  const user = await getUser(req)

  let body: any
  try { body = await req.json() } catch { return json({ error: 'bad request' }, 400) }
  const items: Array<{ sku: string; quantity?: number; variant?: string }> = Array.isArray(body?.items) ? body.items : []
  if (!items.length) return json({ error: 'empty cart' }, 400)
  /* a path on this site only — never an address the client chose */
  const path = (v: unknown, dflt: string) => (typeof v === 'string' && /^\/(?!\/)[^\s]*$/.test(v) ? v.split('#')[0] : dflt)
  const back = path(body?.return, '/pricing'), done = path(body?.success, user ? '/app' : '/store')
  /* a session paid as it is booked: what to book once the payment lands */
  const bk = body?.booking && typeof body.booking === 'object' ? body.booking : null
  const booking = bk && typeof bk.event === 'string' && typeof bk.start === 'string' && !Number.isNaN(Date.parse(bk.start))
    ? JSON.stringify({ event: bk.event, start: bk.start, timeZone: typeof bk.timeZone === 'string' ? bk.timeZone : 'UTC', notes: typeof bk.notes === 'string' ? bk.notes.slice(0, 300) : '', phone: typeof bk.phone === 'string' ? bk.phone.trim().slice(0, 40) : '' }).slice(0, 500) : null

  /*
   * A PROVIDER'S OWN OFFERING IS PRICED BY ITS ROW, not by the catalog — because it is a row and
   * not a file, and the catalog is built from files. The price is read here, on the server, from the
   * offering itself: a client never sends an amount, exactly as it never does for anything else.
   *
   * Everything after this treats it as an offer like any other: one line, one purchase, one credit,
   * and book-session spends that credit. The one difference is that Stripe is given the price
   * inline (price_data) rather than a catalog price id, since there is no catalog entry to make.
   */
  const dynamic = new Map<string, any>()
  for (const it of items) {
    const sku = String(it.sku ?? '')
    if (!sku.startsWith('offering:') || dynamic.has(sku) || offer(sku)) continue
    const { data: off } = await admin.from('provider_offerings').select('id, title, price_cents, currency, state, provider_id').eq('id', sku.slice('offering:'.length)).maybeSingle()
    if (!off || off.state !== 'live') return json({ error: 'that is not for sale', code: 'gone' }, 404)
    const { data: may } = await admin.rpc('provider_may_sell', { p_user: off.provider_id })
    if (may === false) return json({ error: 'that is not for sale', code: 'gone' }, 404)
    if (!(Number(off.price_cents) > 0)) return json({ error: 'that one is free — book it without paying', code: 'free' }, 400)
    dynamic.set(sku, { sku, key: off.id, kind: 'session', billing: 'once', title: off.title, unit_amount: Number(off.price_cents), currency: String(off.currency || 'usd'), tier: null, book: null })
  }
  const offerOf = (sku: string) => offer(sku) ?? dynamic.get(sku) ?? null

  /* one line per sku (a size is a variant of one offer, not an offer of its own),
     quantities merged; which sizes were chosen rides in the session's metadata
     for the order to be fulfilled from */
  const merged = new Map<string, number>()
  const variants: string[] = []
  let needsShipping = false, subscriptions = 0, once = 0
  for (const it of items) {
    const sku = String(it.sku ?? '')
    const o = offerOf(sku)
    if (!o) return json({ error: `unknown offer ${sku}` }, 400)
    if (o.billing === 'subscription') subscriptions++; else once++
    const goods = ships(o)
    if (goods) needsShipping = true
    const qty = goods ? Math.max(1, Math.min(10, Number(it.quantity) || 1)) : 1
    merged.set(sku, goods ? Math.min(10, (merged.get(sku) ?? 0) + qty) : 1)
    /* a book in print: the choices on the line must be ones the offer sells */
    if (o.kind === 'print' || o.kind === 'download') { const v = printVariant(o, String(it.variant ?? '')); if (!v) return json({ error: `${sku}: not offered that way` }, 400); variants.push(`${sku}:${[v.contents, v.cloth, v.foil].filter(Boolean).join('.')}x${qty}`); continue }
    /*
     * A GARMENT: its product type is its supplier's fact, so an offer that names none, or whose
     * axes were typed rather than taken from a catalogue, has had its type invented somewhere and
     * is not sellable. Both facts are in the catalog, so this waits on nothing — the rule a
     * product page lives by applies at the door as well.
     */
    if (o.kind === 'apparel') {
      if (!o.blueprint) return json({ error: `${sku}: no product type — it has to come from the supplier's catalogue` }, 400)
      if (!(o.options ?? []).some((x: any) => x && x.from)) return json({ error: `${sku}: its shapes were not taken from the supplier's catalogue` }, 400)
      const v = checkVariant(o.options ?? [], String(it.variant ?? ''))
      if (!v) return json({ error: `${sku}: not made in that` }, 400)
    }
    if (it.variant) variants.push(`${sku}:${String(it.variant).replace(/[^\w.-]/g, '').slice(0, 24)}x${qty}`)
  }
  /*
   * AND THE SHOP MUST STILL HAVE IT. The page already refused — the button is dead and the chip
   * is dimmed — but a page is a picture of a moment and this is the door. Somebody with the tab
   * open since this morning, a second buyer a second behind the first, a request made by hand:
   * all of them arrive here, and here is where a payment is or is not taken for a thing that
   * does not exist.
   *
   * The same rule the page used, from the same module, so the two cannot drift. It is advisory
   * about everything it does not know: an untracked offer, a backordered one, a count with no
   * row — all sell, as they do everywhere else.
   */
  /* the shape a sku was added at, out of the metadata line the cart built ("sku:variantxN") */
  const variantOfSku = (list: string[], sku: string) => {
    const m = new RegExp(sku.replace(/[.*+?^${}()|[\]\\]/g, String.raw`\  {
    const tracked = [...merged.keys()].filter((sku) => offerOf(sku)?.tracked === true)`) + String.raw`:([\w.-]+?)x\d+`).exec(list.join(', '))
    return m ? m[1] : ''
  }

  {
    const tracked = [...merged.keys()].filter((sku) => offerOf(sku)?.tracked === true)
    if (tracked.length) {
      const { data: rows } = await admin.from('inventory').select('sku, variant, stocked, reserved').in('sku', tracked)
      const counts: Record<string, { stocked: number; reserved: number }> = {}
      for (const r of rows ?? []) counts[stockKey(r.sku, r.variant)] = { stocked: r.stocked, reserved: r.reserved }
      for (const sku of tracked) {
        const o = offerOf(sku)!
        const m = new RegExp(sku.replace(/[.*+?^${}()|[\]\\]/g, String.raw`\  if (!user && (booking || items.some((it) => {`) + String.raw`:([\w.-]+?)x\d+`).exec(variants.join(', '))
        if (!buyable(o, m ? m[1] : '', counts)) return json({ error: `${sku}: sold out`, code: 'sold_out', sku }, 409)
      }
    }
  }
  const guestSessionSkuValue = !user && merged.size === 1
    ? guestSessionSku(items, booking, siteCoaching.requireAuthToBook, offerOf)
    : null
  const guestSessionOffer = guestSessionSkuValue ? offerOf(guestSessionSkuValue) : null
  const guestSessionBooking = !!guestSessionOffer
  if (!user && booking && !guestSessionBooking) return json({ error: 'guest checkout can only book one paid session', code: 'guest_session_cart' }, 400)
  if (!user && items.some((it) => {
    const o = offerOf(String(it.sku ?? ''))
    return !o || (o.kind !== 'print' && o.kind !== 'download' && !(guestSessionBooking && o.kind === 'session'))
  })) return json({ error: 'sign in to buy', code: 'signin' }, 401)
  if (subscriptions && once) return json({ error: 'a membership is bought on its own' }, 400)
  if (subscriptions > 1) return json({ error: 'one membership at a time' }, 400)
  const mode = subscriptions ? 'subscription' : 'payment'
  /* where it ships, and what that costs by method */
  const country = String(body?.country ?? '').toUpperCase()
  if (needsShipping && !shipsTo(country)) return json({ error: country ? `we do not ship to ${country}` : 'choose where it ships', code: 'ship_to' }, 400)
  const rates = needsShipping ? ratesFor(country) : []

  /* already a subscriber: the plan is switched, not doubled */
  let { data: live } = mode === 'subscription' && user
    ? await admin.from('subscriptions').select('id, sku, key, next_sku, next_key, current_period_end').eq('user_id', user.id).in('status', ['active', 'trialing', 'past_due']).order('updated_at', { ascending: false }).limit(1).maybeSingle()
    : { data: null }
  /* a subscription the mock made, met with Stripe switched on: Stripe never heard of it,
     so it is ended in the ledger here and the person subscribes for real */
  if (live && !stripeMock && isMockId(live.id)) { await subscriptionDeleted(live.id); live = null }
  if (live && user) {
    const sku = [...merged.keys()][0]
    if (!stripeConfigured) return stripeUnconfigured()
    const o = offer(sku)!, from = (live.key ? offerByKey(live.key) : null) ?? offer(live.sku)
    /* up or down: by the tiers' ranks (a switch between offers of one tier counts as up — now, prorated) */
    const up = !from?.tier || !o.tier || (TIERS[o.tier] ?? 0) >= (TIERS[from.tier] ?? 0)
    /* their own plan again while a step down is pending: the step down is called off */
    const keep = from?.key === o.key
    if (keep && !live.next_key) return json({ error: 'already on this plan', code: 'same-plan' }, 400)
    if (stripeMock) {
      if (keep || !up) { await admin.from('subscriptions').update(keep ? { next_sku: null, next_key: null, next_at: null } : { next_sku: sku, next_key: o.key, next_at: live.current_period_end }).eq('id', live.id); return json({ switched: true, from: live.sku, to: sku, kept: keep, at: keep ? null : live.current_period_end, mock: true }) }
      await subscriptionChanged({ id: live.id, status: 'active', customer: 'cus_mock_' + user.id.slice(0, 8), metadata: { user_id: user.id }, items: { data: [{ quantity: 1, price: { id: 'price_mock_' + sku, lookup_key: o.key, unit_amount: o.unit_amount, currency: o.currency, metadata: { key: o.key, sku, tier: o.tier } } }] }, current_period_end: Math.floor(Date.now() / 1000) + (o.period === 'weekly' ? 7 : 30) * 86400, cancel_at_period_end: false })
      return json({ switched: true, from: live.sku, to: sku, mock: true })
    }
    try {
      const sub: any = await stripe.subscriptions.retrieve(live.id)
      const item = sub.items.data[0]
      /* whatever step down was waiting is dropped first: one pending switch at most */
      if (sub.schedule) await stripe.subscriptionSchedules.release(idOf(sub.schedule))
      if (keep) {
        await admin.from('subscriptions').update({ next_sku: null, next_key: null, next_at: null }).eq('id', live.id)
        return json({ switched: true, from: live.sku, to: sku, kept: true })
      }
      const { price } = await ensureOffer(sku)
      if (up) {
        /* now: the rest of the period on the new plan, less the rest on the old, invoiced and
           charged at once; a card that fails leaves the plan as it was */
        const updated = await stripe.subscriptions.update(live.id, { items: [{ id: item.id, price }], proration_behavior: 'always_invoice', payment_behavior: 'error_if_incomplete', metadata: { user_id: user.id } })
        await subscriptionChanged(updated)   /* the webhook says the same a moment later */
        return json({ switched: true, from: live.sku, to: sku })
      }
      /* down: the plan already paid for runs to the end of its period, then the new one
         begins — a schedule of two phases, released once the second has begun */
      const sched: any = await stripe.subscriptionSchedules.create({ from_subscription: live.id })
      await stripe.subscriptionSchedules.update(sched.id, {
        end_behavior: 'release',
        phases: [
          { items: [{ price: item.price.id, quantity: item.quantity ?? 1 }], start_date: sched.phases[0].start_date, end_date: sub.current_period_end, proration_behavior: 'none' },
          { items: [{ price, quantity: 1 }], iterations: 1, proration_behavior: 'none', metadata: { user_id: user.id } },
        ],
      })
      const at = iso(sub.current_period_end)
      await admin.from('subscriptions').update({ next_sku: sku, next_key: o.key, next_at: at }).eq('id', live.id)
      return json({ switched: true, from: live.sku, to: sku, at })
    } catch (e) { return json({ error: `Stripe: ${(e as any)?.message ?? e}` }, 502) }
  }

  /* a session paid as it is booked is judged BEFORE anyone pays — the tier, the
     week's or month's allowance — so a refusal never comes after the money; only
     "unpaid" is expected here, since paying is what happens next */
  if (booking && user) {
    const bk = JSON.parse(booking)
    if (Date.parse(bk.start) < Date.now()) return json({ error: 'that time has passed', code: 'past' }, 400)
    const v = await judge(bk.event, user.id, user.email ?? null, null)
    if (!v.ok && v.reason !== 'unpaid') return json({ error: v.reason, code: v.reason, next: (v as any).next ?? null, allowance: (v as any).allowance ?? null }, 403)
    if (v.ok || !v.session || !v.session.sku || !merged.has(v.session.sku)) return json({ error: 'the session being booked is not the one being paid for', code: 'mismatch' }, 400)
  }
  if (booking && guestSessionBooking) {
    const bk = JSON.parse(booking)
    if (Date.parse(bk.start) < Date.now()) return json({ error: 'that time has passed', code: 'past' }, 400)
    const v = await judge(bk.event, null, null, null)
    if (!v.session || v.session.sku !== guestSessionSkuValue || !mayBookAsGuest(siteCoaching.requireAuthToBook, v.session.requires) || (!v.ok && v.reason !== 'unpaid')) {
      return json({ error: v.ok ? 'the session being booked is not the one being paid for' : v.reason, code: v.ok ? 'mismatch' : v.reason }, 403)
    }
  }

  /*
   * WHAT THIS BUYER PAYS, decided here and nowhere else.
   *
   * The client never sends an amount, so this is not about trusting it. It is that the lists
   * carry windows and audiences, and the answer for THIS person at THIS moment is the server’s
   * to give: a sale that ended while the tab was open must not still be honoured, and a
   * members’ price must not be had by asking for it.
   *
   * The same function the page called, over the same lists, so the amount shown and the amount
   * charged cannot differ — which is the worst bug this change could ship.
   */
  /* who they are, as a rule may ask: their live tiers come from the entitlements, never from
     anything the client said about itself */
  const myTiers: string[] = await (async () => {
    if (!user) return []
    const { data } = await admin.from('entitlements').select('key').eq('user_id', user.id).eq('kind', 'class').eq('active', true)
    return (data ?? []).map((r: any) => String(r.key)).filter((k: string) => k !== 'paid')
  })()
  const who = {
    customer: { class: user ? (myTiers.length ? 'subscribed' : 'authenticated') : 'guest', tiers: myTiers },
    shipping_address: { country },
  }

  /* WHAT EACH LINE STANDS AT, before any discount: the price lists, by the same rule the page
     used. A caller must name the sku, or the resolver answers nothing rather than guessing. */
  const standing = (sku: string, variant: string, quantity: number) => {
    const o = offerOf(sku)!
    const r = priceOf(LISTS, { sku, variant, currency: o.currency || 'usd', quantity, context: who })
    return r ? r.amount : o.unit_amount
  }

  /*
   * AND THEN THE DISCOUNTS, over the cart as a whole.
   *
   * This has to happen after every line has a standing price, because a promotion may depend on
   * the cart's total — "£10 off orders over £50" is the commonest discount there is. An earlier
   * version passed `item_total: 0` as a literal, which made every `gte` rule dead and every
   * `lte` rule match ALWAYS: a discount meant for small baskets was given to every basket, and
   * nothing said so. The total is computed here, from the same prices the buyer was shown.
   */
  const cart = [...merged].map(([sku, quantity]) => {
    const variant = variantOfSku(variants, sku)
    return { sku, variant, quantity, unit_price: standing(sku, variant, quantity) }
  })
  /*
   * A BUDGET IS TAKEN BEFORE THE DISCOUNT IS GIVEN, not after.
   *
   * A promotion with a limit is a promise about how much it may cost, and a promise nothing
   * counts is a decoration. The take and the check are one statement in the database, so two
   * checkouts finishing together cannot both be the last one under the limit.
   *
   * It is taken for the amount this cart WOULD get, which means working the discount out twice:
   * once to know what it is worth, and again over only the promotions whose budget allowed it.
   * A promotion refused for budget simply is not applied, and the buyer pays the undiscounted
   * price rather than seeing an error about somebody else having spent the money.
   */
  /* the budget is taken BEFORE the session exists, so it is booked against a token the session
     then carries in its metadata — which is what lets an expiry give it back */
  const sessionAbout = 'hold_' + crypto.randomUUID().replace(/-/g, '').slice(0, 24)
  const wanted = applyPromotions(cart, PROMOTIONS, { context: who })
  const allowed: any[] = []
  const took: string[] = []
  for (const promo of PROMOTIONS) {
    if (!promo.budget || !promo.budget.limit) { allowed.push(promo); continue }
    const worth = wanted.lines.reduce((n: number, l: any) => n + (l.by.includes(promo.name) ? l.discount : 0), 0)
    if (worth <= 0) { allowed.push(promo); continue }
    const { data: got } = await admin.rpc('promotion_take', {
      p_promotion: promo.name, p_kind: promo.budget.kind || 'usage', p_limit: Math.round(Number(promo.budget.limit)),
      p_amount: worth, p_about: sessionAbout, p_user: user?.id ?? null,
    })
    if (got !== false) { allowed.push(promo); took.push(promo.name + ':' + (promo.budget.kind || 'usage') + ':' + worth) }
    else console.warn('promotions: budget spent —', promo.name)
  }
  const discounted = applyPromotions(cart, allowed, { context: who })
  const paid = (sku: string, variant: string, quantity: number) => {
    const line = discounted.lines.find((l: any) => l.sku === sku && (l.variant || '') === (variant || ''))
    if (!line) return standing(sku, variant, quantity)
    /* the discount is on the LINE; Stripe charges a unit price and multiplies, so it is spread
       back over the units and the remainder goes nowhere a buyer can see it */
    const q = Math.max(1, Number(quantity) || 1)
    return Math.max(0, Math.round((line.subtotal - line.discount) / q))
  }

  /* the cart is valid — from here on we need Stripe itself */
  if (!stripeConfigured) return stripeUnconfigured()

  /* the mock: the purchase completes here, written by the same ledger code the
     webhook runs, with Stripe's objects made up; the buyer lands where a paid
     checkout would (and a mock subscription runs for a period from now) */
  if (stripeMock) {
    const id = 'cs_mock_' + crypto.randomUUID().replace(/-/g, '').slice(0, 24)
    const customer = user ? 'cus_mock_' + user.id.slice(0, 8) : 'cus_mock_guest'
    const skus = [...merged.keys()]
    const lines = [...merged].map(([sku, quantity]) => { const o = offerOf(sku)!; const v = variantOfSku(variants, sku); return { quantity, price: { id: 'price_mock_' + sku, lookup_key: o.key, product: 'prod_mock_' + sku, unit_amount: paid(sku, v, quantity), currency: o.currency, metadata: { key: o.key, sku, kind: o.kind, ...(o.tier ? { tier: o.tier } : {}), ...(o.book ? { book: o.book } : {}) } } } })
    const total = lines.reduce((n, l) => n + l.price.unit_amount * l.quantity, 0)
    /* a guest under the mock has the address Checkout would have asked for */
    const email = user ? user.email ?? null : 'guest@example.com'
    await checkoutCompleted({ id, mode, customer, client_reference_id: user?.id ?? null, metadata: { ...(user ? { user_id: user.id } : { guest: '1' }), skus: skus.join(','), ...(variants.length ? { variants: variants.join(', ').slice(0, 500) } : {}), ...(booking ? { booking } : {}) }, line_items: { data: lines }, amount_total: total, currency: lines[0]?.price.currency ?? 'usd', customer_details: { email, name: user?.user_metadata?.full_name ?? null }, customer_email: email, payment_intent: 'pi_mock_' + id.slice(8),
      /* something ships: the address Checkout would have collected, the first method at its price */
      ...(needsShipping ? { shipping_details: { name: user?.user_metadata?.full_name ?? 'Example Buyer', address: { line1: '1 Example Street', line2: '', city: 'Anytown', state: 'NY', postal_code: '10001', country } }, shipping_level: rates[0]?.level ?? 'standard', shipping_cost: { amount_total: rates[0]?.amount ?? 0 } } : {}) })
    if (mode === 'subscription' && user) {
      const o = offerOf(skus[0])!
      const days = o.period === 'weekly' ? 7 : 30
      await subscriptionChanged({ id: 'sub_mock_' + id.slice(8), status: 'active', customer, metadata: { user_id: user.id }, items: { data: [lines[0]] }, current_period_end: Math.floor(Date.now() / 1000) + days * 86400, cancel_at_period_end: false })
    }
    return json({ url: `${appUrl()}${done}${done.includes('?') ? '&' : '?'}checkout=success`, mock: true })
  }

  try {
    /* Stripe made to match the files, then the price ids Checkout wants */
    const line_items: Array<{ price?: string; price_data?: any; quantity: number; adjustable_quantity?: { enabled: boolean; minimum: number; maximum: number } }> = []
    for (const [sku, quantity] of merged) {
      /* an offering has no catalog entry to make a price from, so Stripe is given the amount inline */
      const d = dynamic.get(sku)
      if (d) { line_items.push({ price_data: { currency: d.currency, unit_amount: d.unit_amount, product_data: { name: d.title, metadata: { sku, kind: 'session' } } }, quantity }); continue }
      /*
       * THE PRICE THE PAGE SHOWED, resolved again here by the same function over the same
       * lists. Not because the client is not trusted with an amount — it never sends one — but
       * because the lists carry windows and audiences, and the answer for THIS person at THIS
       * moment is a thing only the server should decide. A sale that ended while the tab was
       * open must not still be honoured, and a members’ price must not be had by asking.
       */
      const o = offerOf(sku)!
      const v = variantOfSku(variants, sku)
      const amount = paid(sku, v, quantity)
      const { price } = await ensureOffer(sku)
      /*
       * A LIST PRICE IS CHARGED INLINE, and the catalog price is used where no list moved it.
       *
       * Stripe has one price per offer and we keep it that way — it is the identity every
       * purchase, subscription and lookup key hangs off, and minting a second price per sale
       * would scatter that. So a line the lists re-priced is `price_data` carrying the SAME
       * metadata the catalog price carries, and `offerOfLine` finds the offer by it exactly as
       * it finds one by a lookup key. Nothing downstream can tell the difference, which is the
       * point: the ledger must not learn about pricing.
       */
      if (amount !== o.unit_amount) {
        const marks = { key: o.key, sku, kind: o.kind, ...(o.tier ? { tier: o.tier } : {}), ...(o.book ? { book: o.book } : {}) }
        line_items.push({ price_data: {
          currency: o.currency, unit_amount: amount, metadata: marks,
          ...(o.billing === 'subscription' ? { recurring: { interval: o.period === 'weekly' ? 'week' : 'month' } } : {}),
          product_data: { name: o.title ?? sku, metadata: marks },
        }, quantity })
        continue
      }
      /* the buyer's to change, where the offer says so and within its own bounds */
      const adjustable = lineQuantity(o)
      line_items.push({ price, quantity, ...(adjustable ? { adjustable_quantity: adjustable } : {}) })
    }

    /* the Stripe customer, created once and remembered; a guest has none — Checkout asks
       their email, and the ledger keeps it on the purchase for the account that claims it */
    let customer: string | null = null
    if (user) {
      const { data: prof } = await admin.from('profiles').select('stripe_customer_id, email').eq('id', user.id).maybeSingle()
      customer = prof?.stripe_customer_id as string | null
      if (!customer || isMockId(customer)) {   /* none yet, or the mock's — Stripe gets a real one */
        const c = await stripe.customers.create({ email: user.email ?? prof?.email ?? undefined, metadata: { user_id: user.id } })
        customer = c.id
        await admin.from('profiles').update({ stripe_customer_id: customer }).eq('id', user.id)
      }
    }
    /* the four, resolved from the offers in this cart by the one pure module the kit's test reads
       too (_shared/checkout-params.js — the cart decisions and why they went that way are there) */
    const inCart = [...merged.keys()].map((sku) => offerOf(sku)).filter(Boolean) as any[]
    const { trial: offered, automaticTax: wantsAutoTax, taxId: wantsTaxId, methods } = sessionParams(inCart, mode)
    /* ONE TRIAL PER PERSON PER TIER: the keys of this person's subscriptions that ever had one.
       A guest cannot be subscribing, so there is nobody to have trialled before. */
    let trialDays = offered
    if (offered && user) {
      const { data: past } = await admin.from('subscriptions').select('key').eq('user_id', user.id).eq('trialed', true)
      const taken = (past || []).map((r: any) => r.key).filter(Boolean)
      const withTrial = inCart.find((o) => o?.trial)
      trialDays = trialDaysFor(withTrial, taken, (k) => (offerByKey(k)?.tier ?? null))
    }

    const session = await stripe.checkout.sessions.create({
      mode,
      ...(customer ? { customer } : {}),
      line_items,
      ...(user ? { client_reference_id: user.id } : {}),
      metadata: { ...(user ? { user_id: user.id } : { guest: '1' }), skus: [...merged.keys()].join(',').slice(0, 500), ...(variants.length ? { variants: variants.join(', ').slice(0, 500) } : {}), ...(booking ? { booking } : {}), ...(took.length ? { promos: took.join(','), hold: sessionAbout } : {}) },
      /* Stripe fills in the session's id, and the client confirms it on landing (confirm-checkout) */
      success_url: `${appUrl()}${done}${done.includes('?') ? '&' : '?'}checkout=success&session={CHECKOUT_SESSION_ID}`,
      cancel_url: `${appUrl()}${back}${back.includes('?') ? '&' : '?'}checkout=cancel`,
      allow_promotion_codes: true,
      ...(mode === 'subscription' && (user || trialDays)
        ? { subscription_data: { ...(user ? { metadata: { user_id: user.id } } : {}), ...(trialDays ? { trial_period_days: trialDays } : {}) } }
        : {}),
      /* tax: automatic_tax needs an address to work from, and with a remembered customer Stripe
         refuses unless it is allowed to update that customer's address from the session */
      ...(wantsAutoTax ? { automatic_tax: { enabled: true }, ...(customer ? { customer_update: { address: 'auto' } } : {}) } : {}),
      ...(wantsTaxId ? { tax_id_collection: { enabled: true } } : {}),
      /* and the methods, only where every offer in the cart accepts them */
      ...(methods.length ? { payment_method_types: methods } : {}),
      /* something ships: the store's own line under the pay button — made to order, all sales final */
      ...(needsShipping && WORDS.final ? { custom_text: { submit: { message: WORDS.final.slice(0, 1200) } } } : {}),
      /* something ships: the address in the chosen country alone, the phone (the printer's
         carrier wants one), and the store's methods priced for that country — each rate
         carrying the printer's shipping level, which the ledger reads back for the order */
      ...(needsShipping ? {
        shipping_address_collection: { allowed_countries: [country] as any },
        phone_number_collection: { enabled: true },
        shipping_options: rates.map((r) => ({ shipping_rate_data: {
          type: 'fixed_amount' as const, display_name: r.label, fixed_amount: { amount: r.amount, currency: offer([...merged.keys()][0])!.currency },
          metadata: { level: r.level },
          ...(r.min_days && r.max_days ? { delivery_estimate: { minimum: { unit: 'business_day' as const, value: r.min_days }, maximum: { unit: 'business_day' as const, value: r.max_days } } } : {}),
        } })),
      } : {}),
    })
    /*
     * THE UNITS ARE HELD FOR THIS SESSION, and Stripe will tell us when to let them go.
     *
     * Checkout holds nothing for us. Without a reservation the last unit stays sellable while
     * somebody is typing their card in, and two people buy it; with one and no release, an
     * abandoned basket holds it until the session expires a day later. Stripe emits
     * `checkout.session.expired`, which is the hook, and the webhook releases on it.
     *
     * A reservation that cannot be taken does NOT fail the checkout here: the count may have
     * gone between the page and this call, and the sale itself is the thing that must be
     * refused — `inventory_take` with `sold` does that atomically when the payment lands. This
     * is a hold, and a hold that cannot be placed simply is not placed.
     */
    await reserve(session.id, merged, variants)
    return json({ url: session.url })
  } catch (e) {
    /* a Stripe-side failure (bad key, declined config, outage) — say so, don't 500 */
    return json({ error: `Stripe: ${(e as any)?.message ?? e}` }, 502)
  }
})

/* hold what is tracked for this session; a shape with no count is not tracked and is skipped */
async function reserve(sessionId: string, merged: Map<string, number>, variants: string[]): Promise<void> {
  for (const [sku, quantity] of merged) {
    const o = offer(sku)
    if (!o || o.tracked !== true) continue
    const m = new RegExp(sku.replace(/[.*+?^${}()|[\]\\]/g, String.raw`\$&`) + String.raw`:([w.-]+?)x(d+)`).exec(variants.join(
))
    const variant = m ? m[1] : ''
    try {
      await admin.rpc('inventory_take', { p_sku: sku, p_variant: variant, p_qty: quantity, p_reason: 'reserved', p_about: sessionId })
    } catch (e) {
      /* a hold is a courtesy; the sale is what must be atomic, and it is */
      console.warn('inventory: could not hold', sku, variant, (e as any)?.message ?? e)
    }
  }
}