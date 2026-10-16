/*
 * The ledger: what normalized payment outcomes are projected into — purchases, subscriptions,
 * and from them the entitlements the app reads. Stripe webhook objects and
 * normalized provider confirmations reach the same rules. The mock
 * (STRIPE_MOCK=1, local only) makes the same objects up on the spot — so it
 * exercises exactly the code a real payment does, and a purchase made under
 * the mock is indistinguishable in
 * the database from a real one except by its ids (cs_mock_…, sub_mock_…).
 */
import { stripe, admin } from './lib.ts'
import { offer, offerByKey } from './offers.ts'
import { buyerOf, emailOf, offerOfLine, grantsOf, ships, carriesFiles, printVariant, lineSnapshot } from './ledger-rules.js'   /* what a payment means, apart from the writing of it */
import { judge } from './cal.ts'
import { makeBooking } from './booking.ts'
import { submitPrintOrder, editionOf, bookOf } from './print.ts'
import { orderEmail, WORDS, type BoughtLine } from './email.ts'
import { appUrl } from './lib.ts'
import { findProviderEntities, findProviderEntity, linkProviderEntity } from './payment-provider-refs.ts'
import { providerScopedId } from './payment-provider.mjs'
import type { PaymentCheckoutSnapshot, PaymentSubscriptionSnapshot } from './payment-provider.d.ts'

export const iso = (unix?: number | null) => (unix ? new Date(unix * 1000).toISOString() : null)
export const idOf = (x: any) => (typeof x === 'string' ? x : x?.id ?? null)

function checkoutForLedger(snapshot: PaymentCheckoutSnapshot) {
  if (!snapshot.checkoutId || !snapshot.provider || !snapshot.metadata || !Array.isArray(snapshot.lines)) {
    throw new Error('payment provider returned an incomplete checkout snapshot')
  }
  return {
    id: snapshot.checkoutId,
    mode: snapshot.mode,
    customer: snapshot.customerId ?? null,
    payment_intent: snapshot.paymentId ?? null,
    client_reference_id: snapshot.userId ?? null,
    customer_email: snapshot.customerEmail ?? null,
    customer_details: {
      email: snapshot.customerEmail ?? null,
      name: snapshot.customerName ?? null,
      phone: snapshot.customerPhone ?? null,
      address: snapshot.billingAddress ? {
        line1: snapshot.billingAddress.line1 ?? null,
        line2: snapshot.billingAddress.line2 ?? null,
        city: snapshot.billingAddress.city ?? null,
        state: snapshot.billingAddress.state ?? null,
        postal_code: snapshot.billingAddress.postalCode ?? null,
        country: snapshot.billingAddress.country ?? null,
      } : null,
    },
    metadata: snapshot.metadata,
    amount_total: snapshot.amountTotalMinor ?? 0,
    currency: snapshot.currency ?? 'usd',
    shipping_details: snapshot.shippingAddress ? {
      name: snapshot.shippingAddress.name ?? '',
      address: {
        line1: snapshot.shippingAddress.line1 ?? null,
        line2: snapshot.shippingAddress.line2 ?? null,
        city: snapshot.shippingAddress.city ?? null,
        state: snapshot.shippingAddress.state ?? null,
        postal_code: snapshot.shippingAddress.postalCode ?? null,
        country: snapshot.shippingAddress.country ?? null,
      },
    } : null,
    shipping_cost: {
      amount_total: snapshot.shippingAmountMinor ?? 0,
      shipping_rate: null,
    },
    shipping_level: snapshot.shippingLevel ?? null,
    line_items: {
      data: snapshot.lines.map((line) => {
        if (!line.providerPriceId) throw new Error(`payment provider checkout line "${line.offerKey}" has no price reference`)
        return {
          quantity: line.quantity,
          price: {
            id: line.providerPriceId,
            lookup_key: line.offerKey,
            product: line.productId ?? null,
            unit_amount: line.unitAmountMinor,
            currency: line.currency,
            metadata: { ...(line.metadata ?? {}), key: line.offerKey, sku: line.sku },
          },
        }
      }),
    },
  }
}

function subscriptionForLedger(snapshot: PaymentSubscriptionSnapshot) {
  if (!snapshot.subscriptionId || !snapshot.provider || !snapshot.status || !Array.isArray(snapshot.items)) {
    throw new Error('payment provider returned an incomplete subscription snapshot')
  }
  return {
    id: snapshot.subscriptionId,
    customer: snapshot.customerId ?? null,
    status: snapshot.status,
    metadata: snapshot.metadata,
    current_period_start: snapshot.currentPeriodStart ?? null,
    current_period_end: snapshot.currentPeriodEnd ?? null,
    cancel_at_period_end: snapshot.cancelAtPeriodEnd ?? false,
    trial_end: snapshot.trialEnd ?? null,
    schedule: snapshot.scheduleId ?? null,
    items: {
      data: snapshot.items.map((item) => ({
        quantity: item.quantity,
        price: {
          id: item.priceId,
          lookup_key: item.offerKey ?? null,
          unit_amount: item.unitAmountMinor ?? null,
          currency: item.currency ?? null,
          metadata: item.metadata,
        },
      })),
    },
  }
}

export async function grant(
  user_id: string,
  kind: 'class' | 'product',
  key: string,
  source: string,
  source_id: string,
  extra: Record<string, unknown> = {},
  provider = 'stripe',
) {
  const { data, error } = await admin.from('entitlements').upsert(
    { user_id, kind, key, source, source_id: providerScopedId(provider, source_id), active: true, ...extra },
    { onConflict: 'user_id,kind,key,source_id' },
  ).select('id').maybeSingle()
  if (error || !data?.id) throw new Error(`entitlement was not recorded: ${error?.message ?? 'no entitlement id returned'}`)
  return data.id
}
export async function grantUsage(
  user_id: string,
  offer_key: string,
  source: 'purchase' | 'subscription',
  source_id: string,
  units_micros: number,
  period_start: string | null = null,
  expires_at: string | null = null,
  snapshot: Record<string, unknown> = {},
  provider = 'stripe',
) {
  if (!Number.isSafeInteger(units_micros) || units_micros <= 0) throw new Error('usage grant must be a positive safe integer')
  const { error } = await admin.rpc('usage_grant', {
    p_user_id: user_id, p_offer_key: offer_key, p_source: source, p_source_id: providerScopedId(provider, source_id),
    p_units_micros: units_micros, p_period_start: period_start, p_expires_at: expires_at,
    p_usage_unit: snapshot.usage_unit ?? null,
    p_rate_micros: snapshot.rate_micros ?? null,
    p_meter: snapshot.meter ?? null,
    p_overage_price_micros: snapshot.overage_price_micros ?? null,
    p_speech_cost_per_second_micros: snapshot.speech_cost_per_second_micros ?? null,
  })
  if (error) throw new Error(`usage grant was not recorded: ${error.message}`)
}
export async function userByCustomer(customer: any, provider = 'stripe'): Promise<string | null> {
  const id = idOf(customer); if (!id) return null
  const mapped = await findProviderEntity(provider, 'customer', id, 'profiles')
  if (mapped) return mapped
  if (provider !== 'stripe') return null
  const { data, error } = await admin.from('profiles').select('id').eq('stripe_customer_id', id).maybeSingle()
  if (error) throw new Error(`legacy Stripe customer lookup failed: ${error.message}`)
  return data?.id ?? null
}

/* checkout.session.completed: a payment's purchases, the paid class, a book's key,
   a session's credits — and a session paid as it was booked, booked now */
export async function checkoutCompleted(o: any, provider = 'stripe') {
  if (o?.provider && o?.checkoutId) {
    if (o.provider !== provider) throw new Error(`checkout snapshot provider "${o.provider}" does not match "${provider}"`)
    o = checkoutForLedger(o as PaymentCheckoutSnapshot)
  }
  if (typeof o.id !== 'string' || !o.id) throw new Error(`provider "${provider}" returned a checkout without an id`)
  const checkoutIdentity = providerScopedId(provider, o.id)
  const userId: string | null = buyerOf(o, await userByCustomer(o.customer, provider))
  if (userId && o.customer) {
    const customerId = idOf(o.customer)
    if (provider === 'stripe') {
      const { error } = await admin.from('profiles').update({ stripe_customer_id: customerId }).eq('id', userId)
      if (error) throw new Error(`Stripe customer reference was not recorded: ${error.message}`)
    }
    await linkProviderEntity(provider, 'customer', customerId, 'profiles', userId)
  }
  if (o.mode !== 'payment') return   /* subscriptions arrive via customer.subscription.* */
  /* provider snapshots include normalized lines; Stripe webhooks may need a line-item fetch */
  const items = o.line_items?.data?.length
    ? o.line_items
    : provider === 'stripe'
      ? await stripe.checkout.sessions.listLineItems(o.id, { limit: 100 })
      : null
  if (!items?.data?.length) throw new Error(`provider "${provider}" returned no checkout lines`)
  /* was this session already in the ledger? then its emails went out with it: a retry of the
     event (or the client's confirm after the webhook) writes the same rows and sends nothing */
  let before = await findProviderEntities(provider, 'checkout', o.id, 'purchases')
  if (!before.length) {
    const { data, error } = await admin.from('purchases').select('id').eq('checkout_identity', checkoutIdentity).limit(1)
    if (error) throw new Error(`purchase checkout identity lookup failed: ${error.message}`)
    before = (data ?? []).map((row) => row.id)
    if (!before.length && provider === 'stripe') {
      const { data: legacyRows, error: legacyError } = await admin.from('purchases').select('id')
        .eq('stripe_checkout_session_id', o.id).limit(1)
      if (legacyError) throw new Error(`legacy Stripe purchase lookup failed: ${legacyError.message}`)
      before = (legacyRows ?? []).map((row) => row.id)
    }
  }
  const seen = before.length > 0
  const boughtLines: BoughtLine[] = []
  /*
   * THE ORDER. `purchases` says what was bought; the order is the thing that has a life after
   * that — an address that may be corrected, two parcels against one basket, money going back.
   * One per paid session (a partial unique index), so the webhook and the client's confirm both
   * find the first rather than opening a second.
   */
  const order = await openOrder(o, userId, provider)
  for (const li of items.data) {
    const priceId = li.price?.id; if (!priceId) continue
    /* the price's lookup key is the offer's key — its identity; the sku is the slug as it read */
    let line = li
    if (provider === 'stripe' && !li.price.metadata?.sku && !li.price.lookup_key && typeof li.price.product === 'string') {
      const product = await stripe.products.retrieve(li.price.product)
      line = { ...li, price: { ...li.price, product } }
    }
    const { offer: bought, key, sku, book, kind } = offerOfLine(line, offerByKey, offer)
    /* the choices on a line, as the session's metadata carried them ("sku:parts.black.goldx1, …") */
    const variant = sku ? variantOf(o.metadata?.variants, sku) : ''
    /*
     * THE LINE, SNAPSHOTTED. One row per line (the conflict target is the session AND the price,
     * since Stripe merges a repeated price into one line with a quantity), carrying what was
     * bought AS IT READ AT THE TIME: the title, the shape's label, the option values and the
     * unit price. A year from now the offer may be renamed, re-priced or gone, and the row must
     * still say what somebody paid for. `amount_total` is this line's total, not the session's.
     */
    const snap = lineSnapshot(bought, line, variant, o)
    /* through the function, not an upsert: the index this conflicts on is PARTIAL, and neither
       Postgres nor PostgREST can infer one from a column list alone (purchase_write says why) */
    /* the same snapshot, as a line of the order. `line` is the line's own identity and survives
       every later version of it; the row is keyed on the session and the sku, so a replayed event
       writes the same line rather than a second one. */
    if (order) await admin.rpc('order_line_write', { p: {
      order_id: order, sku: sku ?? '', key: bought?.key ?? key ?? null, variant: variant || '',
      title: snap.title ?? null, variant_title: snap.variant_title ?? null, options: snap.options ?? null,
      unit_price: snap.unit_price ?? 0, quantity: li.quantity ?? 1,
    } })
    const { data: purchaseId, error: purchaseError } = await admin.rpc('purchase_write', { p: {
      user_id: userId, email: emailOf(o),
      checkout_identity: checkoutIdentity,
      ...(provider === 'stripe' ? {
        stripe_checkout_session_id: o.id,
        stripe_payment_intent_id: idOf(o.payment_intent),
      } : {}),
      price_id: priceId, product_id: idOf(li.price?.product), sku, key: bought?.key ?? key, kind: bought?.kind ?? kind, variant: variant || null,
      ...snap, status: 'paid',
    } })
    if (purchaseError || !purchaseId) throw new Error(`purchase was not recorded: ${purchaseError?.message ?? 'no purchase id returned'}`)
    await linkProviderEntity(provider, 'checkout', o.id, 'purchases', purchaseId)
    const paymentId = idOf(o.payment_intent)
    if (paymentId) await linkProviderEntity(provider, 'payment', paymentId, 'purchases', purchaseId)
    await linkProviderEntity(provider, 'price', priceId, 'purchases', purchaseId)
    const productId = idOf(li.price?.product)
    if (productId) await linkProviderEntity(provider, 'product', productId, 'purchases', purchaseId)
    const grantMicros = Number(li.price?.metadata?.usage_grant_micros ?? bought?.usage?.grant_micros ?? 0)
    const usageKey = String(li.price?.metadata?.usage_offer_key ?? li.price?.metadata?.key ?? bought?.key ?? key ?? '')
    if (userId && usageKey && Number.isSafeInteger(grantMicros) && grantMicros > 0) {
      const totalGrant = grantMicros * Number(li.quantity ?? 1)
      await grantUsage(userId, usageKey, 'purchase', `${o.id}:${priceId}`, totalGrant, null, null, {
        usage_unit: li.price?.metadata?.usage_unit ?? bought?.usage?.unit ?? null,
        rate_micros: Number(li.price?.metadata?.usage_rate_micros ?? bought?.usage?.rate_micros) || null,
        meter: li.price?.metadata?.usage_meter ?? bought?.usage?.meter ?? null,
        overage_price_micros: Number(li.price?.metadata?.usage_overage_price_micros ?? bought?.usage?.overage_price_micros) || null,
        speech_cost_per_second_micros: Number(li.price?.metadata?.usage_speech_cost_per_second_micros ?? bought?.usage?.speech_cost_per_second_micros) || 0,
      }, provider)
    }
    /*
     * THE STOCK COMES OFF HERE, in the same statement that checks it.
     *
     * `inventory_take` with `sold` lowers the count and releases this session's hold at once,
     * and its condition is inside the UPDATE — so a sale that would go below zero takes
     * nothing. It is deliberately NOT a reason to refuse the ledger: the payment has already
     * happened, and the right answer to overselling after the money is taken is a shop that
     * knows (the count stays where it was and the movement is absent) rather than a webhook
     * that throws and makes Stripe retry for ever.
     *
     * `backorder` means the shop does not care, so the count follows the sale without a
     * condition and goes NEGATIVE — which is exactly what the shop then owes. A line whose
     * offer is not tracked writes nothing at all.
     */
    if (bought?.tracked === true) {
      const { data: took } = await admin.rpc('inventory_take', {
        p_sku: sku, p_variant: variant || '', p_qty: li.quantity ?? 1, p_reason: 'sold', p_about: checkoutIdentity,
        p_backorder: bought.backorder === true,
      })
      if (took === false) console.warn('inventory: sold past the count —', sku, variant, 'session', checkoutIdentity)
    }
    /* WHAT THIS LINE GRANTS is decided in ledger-rules.js, where it can be read and checked without
       a database: the class, a book's unlock, a credit per unit for a session, an offering or a
       form, each grant carrying its own source_id so a replayed event writes the same rows. */
    for (const g of grantsOf({ offer: bought, sku, book, quantity: li.quantity ?? 1, sessionId: o.id, userId })) {
      const entitlementId = await grant(userId!, g.kind as 'class' | 'product', g.key, 'purchase', g.source_id, {}, provider)
      await linkProviderEntity(provider, 'checkout', o.id, 'entitlements', entitlementId)
    }
    /* a printed book: an order to the address the checkout collected, sent to the printer at once */
    if (bought?.kind === 'print' && bought.book) await printOrdered(o, bought, li.quantity ?? 1, userId, variant, provider)
    /* the line as the confirmation says it: the book's title, the format and choices, the files it carries */
    const v = bought && (bought.kind === 'print' || bought.kind === 'download') ? printVariant(bought, variant) : null
    boughtLines.push({ title: bought?.book ? (bookOf(bought.book)?.title ?? bought.title) : (bought?.title ?? sku ?? ''), detail: lineDetail(bought, v), qty: li.quantity ?? 1, amount: li.price?.unit_amount ?? 0, currency: li.price?.currency ?? o.currency ?? 'usd', book: bought?.book ?? null, files: carriesFiles(bought), ships: ships(bought) })
  }
  /* WHAT WAS ACTUALLY TAKEN, as one transaction carrying the provider-scoped payment identity — so the same event
     twice is one row (the reference is unique) and the order's payment state, which is a sum of
     these and never a column, comes out right either way. */
  if (order && (o.amount_total ?? 0) > 0) {
    const externalPaymentId = idOf(o.payment_intent) ?? o.id
    const transactionReference = providerScopedId(provider, externalPaymentId)
    let transactionIds = await findProviderEntities(provider, 'payment', externalPaymentId, 'order_transactions')
    if (!transactionIds.length) {
      const { data, error } = await admin.from('order_transactions').select('id').eq('reference', transactionReference).limit(1)
      if (error) throw new Error(`payment transaction identity lookup failed: ${error.message}`)
      transactionIds = (data ?? []).map((row) => row.id)
    }
    if (transactionIds.length > 1) throw new Error(`payment reference ${externalPaymentId} maps to multiple order transactions`)
    if (transactionIds.length) {
      await linkProviderEntity(provider, 'payment', externalPaymentId, 'order_transactions', transactionIds[0])
    } else {
      const { data, error } = await admin.from('order_transactions').insert({
        order_id: order, amount: o.amount_total, currency: o.currency ?? 'usd',
        reason: 'payment', reference: transactionReference,
      }).select('id').maybeSingle()
      if (error || !data) {
        if (error?.code !== '23505') throw new Error(`order payment was not recorded: ${error?.message ?? 'no transaction returned'}`)
        const racedIds = await findProviderEntities(provider, 'payment', externalPaymentId, 'order_transactions')
        if (racedIds.length !== 1) throw new Error(`order payment reference ${transactionReference} could not be reconciled`)
        await linkProviderEntity(provider, 'payment', externalPaymentId, 'order_transactions', racedIds[0])
      } else {
        await linkProviderEntity(provider, 'payment', externalPaymentId, 'order_transactions', data.id)
      }
    }
  }
  /* the confirmation (and the files' letter), once per session, to the address Stripe has */
  if (!seen && boughtLines.length) {
    const first = boughtLines.find((l) => l.book)
    await orderEmail(o, boughtLines, { guest: !userId, url: first?.book ? `${appUrl()}/store/products/${first.book}-print` : null })
  }
  /* A paid session is booked once per Checkout Session. The durable claim precedes any provider
     call, so the webhook and success-page confirmation cannot race into two bookings. */
  if (o.metadata?.booking) {
    const checkoutId = checkoutIdentity
    const email = emailOf(o) ?? ''
    const { data: claim, error: claimError } = await admin.from('booking_checkout_fulfilments').insert({
      checkout_session_id: checkoutId, email: email || null,
    }).select('checkout_session_id').maybeSingle()
    if (claimError?.code === '23505') {
      const { data: priorBooking, error: bookingError } = await admin.from('bookings')
        .select('uid').eq('checkout_identity', checkoutId).maybeSingle()
      if (bookingError) throw new Error(`booking checkout identity lookup failed: ${bookingError.message}`)
      if (priorBooking?.uid) await linkProviderEntity(provider, 'checkout', o.id, 'bookings', priorBooking.uid)
      await linkProviderEntity(provider, 'checkout', o.id, 'booking_checkout_fulfilments', checkoutId)
      return
    }
    if (claimError || !claim) {
      console.error('ledger: could not claim paid booking fulfillment —', claimError?.message ?? checkoutId)
      return
    }
    await linkProviderEntity(provider, 'checkout', o.id, 'booking_checkout_fulfilments', checkoutId)
    const finish = async (status: 'booked' | 'unavailable' | 'failed', bookingUid: string | null = null, message: string | null = null) => {
      const { error } = await admin.from('booking_checkout_fulfilments').update({
        status, booking_uid: bookingUid, error: message, updated_at: new Date().toISOString(),
      }).eq('checkout_session_id', checkoutId)
      if (error) console.error('ledger: could not update paid booking fulfillment —', error.message)
    }
    try {
      if (!email) {
        await finish('failed', null, `provider "${provider}" returned no email address`)
        console.error('ledger: paid guest booking has no provider email —', checkoutId)
        return
      }
      let bk: any
      try { bk = JSON.parse(o.metadata.booking) }
      catch {
        await finish('failed', null, 'Invalid booking metadata')
        console.error('ledger: invalid paid booking metadata —', checkoutId)
        return
      }
      const { data: prof, error: profileError } = userId
        ? await admin.from('profiles').select('email, display_name').eq('id', userId).maybeSingle()
        : { data: null, error: null }
      if (profileError) throw profileError
      const attendeeEmail = userId ? String(prof?.email ?? email).trim().toLowerCase() : email
      const decision = await judge(bk.event, userId, attendeeEmail, null)
      const purchasedSkus = String(o.metadata?.skus ?? '').split(',').filter(Boolean)
      const sessionMatches = !!decision.session?.sku && purchasedSkus.includes(decision.session.sku)
      const eligible = decision.ok || (!userId && decision.reason === 'unpaid' && sessionMatches)
      if (!eligible || !sessionMatches) {
        await finish('unavailable', null, decision.reason || 'session offer mismatch')
        console.warn('ledger: paid booking not made —', decision.reason || 'session offer mismatch', checkoutId)
        return
      }
      const made = await makeBooking(decision.session, {
        start: bk.start,
        attendee: { email: attendeeEmail, name: userId ? (prof?.display_name ?? o.customer_details?.name ?? '') : (o.customer_details?.name ?? ''), timeZone: bk.timeZone || 'UTC' },
        user_id: userId, notes: bk.notes || '', phone: bk.phone || '', credit: userId ? decision.credit : null,
        checkoutIdentity,
        ...(provider === 'stripe' ? { stripeCheckoutSessionId: o.id } : {}),
      })
      await linkProviderEntity(provider, 'checkout', o.id, 'bookings', made.uid)
      await finish('booked', made.uid)
    } catch (e) {
      await finish('failed', null, String((e as any)?.message ?? e).slice(0, 500))
      console.warn('ledger: paid booking not made (the credit remains recoverable) —', (e as any)?.message ?? e)
    }
  }
}

/*
 * ONE ORDER PER PAID SESSION. Returns its id, or null where the store has no orders table yet —
 * a deployment whose database is behind the code still takes payments and still writes purchases,
 * which is the half that must never depend on the half being added.
 */
async function openOrder(o: any, userId: string | null, provider = 'stripe'): Promise<string | null> {
  const mapped = await findProviderEntity(provider, 'checkout', o.id, 'orders')
  if (mapped) return mapped
  const checkoutIdentity = providerScopedId(provider, String(o.id ?? ''))
  const { data: legacyOrder, error: legacyError } = await admin.from('orders')
    .select('id').eq('checkout_session', checkoutIdentity).maybeSingle()
  if (legacyError) throw new Error(`checkout order lookup failed: ${legacyError.message}`)
  if (legacyOrder?.id) {
    await linkProviderEntity(provider, 'checkout', o.id, 'orders', legacyOrder.id)
    return legacyOrder.id
  }
  const sd = o.shipping_details ?? o.collected_information?.shipping_details ?? null
  const row = {
    user_id: userId, email: emailOf(o),
    currency: o.currency ?? 'usd', checkout_session: checkoutIdentity,
    shipping_level: o.shipping_level ?? 'standard',
    shipping_address: sd ? { name: sd.name ?? '', ...(sd.address ?? {}) } : null,
    billing_address: o.customer_details?.address ?? null,
    shipping_total: o.shipping_cost?.amount_total ?? 0,
  }
  const { data, error } = await admin.from('orders').insert(row).select('id').maybeSingle()
  if (error?.code === '23505') {
    const { data: concurrentOrder, error: lookupError } = await admin.from('orders')
      .select('id').eq('checkout_session', checkoutIdentity).maybeSingle()
    if (lookupError) throw new Error(`checkout order lookup after conflict failed: ${lookupError.message}`)
    if (concurrentOrder?.id) {
      await linkProviderEntity(provider, 'checkout', o.id, 'orders', concurrentOrder.id)
      return concurrentOrder.id
    }
  }
  if (error) { console.warn('ledger: no order written —', error.message); return null }
  if (data?.id) await linkProviderEntity(provider, 'checkout', o.id, 'orders', data.id)
  return data?.id ?? null
}

/* a line's second line in the confirmation: the format, a linen's colours, the contents — from
   the catalog's own words for the offer (its title carries the format) and the variant */
const lineDetail = (bought: any, v: { contents: string; cloth: string; foil: string } | null) => {
  if (!bought) return ''
  const P = WORDS.print || {}
  const fmt = bought.format ? P['format-' + bought.format] ?? bought.format : ''
  return [fmt, v?.cloth ? `${P['cloth-' + v.cloth] ?? v.cloth} · ${P['foil-' + v.foil] ?? v.foil}` : '', v?.contents ? P['contents-' + v.contents] ?? v.contents : ''].filter(Boolean).join(' · ')
}

/* a print line of a paid session: the order row (once per session and offer — a retry of
   the event finds it) and the printer's job; the address is the session's shipping details */
/* the variant a sku was bought at, from the session's metadata */
const variantOf = (variants: unknown, sku: string) => { const m = new RegExp('(?:^|, )' + sku.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + ':([\\w.-]+?)x\\d+(?:,|$)').exec(String(variants ?? '')); return m ? m[1] : '' }
async function printOrdered(o: any, bought: any, quantity: number, userId: string | null, variant = '', provider = 'stripe') {
  const sd = o.shipping_details ?? o.collected_information?.shipping_details ?? null
  const a = sd?.address ?? {}
  const address = { name: sd?.name ?? o.customer_details?.name ?? '', line1: a.line1 ?? '', line2: a.line2 ?? '', city: a.city ?? '', state: a.state ?? '', postal_code: a.postal_code ?? '', country: a.country ?? '', phone: o.customer_details?.phone ?? '' }
  /* the method the buyer chose: the mock says it; a real session names its shipping rate, whose metadata carries the level */
  let level = String(o.shipping_level ?? '')
  if (!level && provider === 'stripe' && o.shipping_cost?.shipping_rate) { try { const r = await stripe.shippingRates.retrieve(idOf(o.shipping_cost.shipping_rate)); level = String(r.metadata?.level ?? '') } catch { /* stays MAIL */ } }
  /* this line's own row — there is one per line now, so asking for `the` session's would throw */
  const purchaseIds = await findProviderEntities(provider, 'checkout', o.id, 'purchases')
  const checkoutIdentity = providerScopedId(provider, String(o.id ?? ''))
  let purchaseQuery = admin.from('purchases').select('id').eq('key', bought.key).order('created_at').limit(1)
  if (purchaseIds.length) purchaseQuery = purchaseQuery.in('id', purchaseIds)
  else purchaseQuery = purchaseQuery.eq('checkout_identity', checkoutIdentity)
  const { data: purchase, error: purchaseError } = await purchaseQuery.maybeSingle()
  if (purchaseError) throw new Error(`print purchase lookup failed: ${purchaseError.message}`)
  const { data: had } = await admin.from('fulfilments').select('id').eq('purchase_id', purchase?.id ?? '00000000-0000-0000-0000-000000000000').eq('key', bought.key).maybeSingle()
  if (had) return
  /* what was chosen: the contents (its own edition), a linen's cloth and foil */
  const v = printVariant(bought, variant) ?? { contents: bought.contents?.[0] ?? 'parts', cloth: bought.cloth?.[0] ?? '', foil: bought.foil?.[0] ?? '' }
  const ed = editionOf(bought.book, v.contents)
  const { data: row, error } = await admin.from('fulfilments').insert({
    purchase_id: purchase?.id ?? null, user_id: userId, email: o.customer_details?.email ?? o.customer_email ?? null,
    key: bought.key, quantity, address, status: 'new', shipping_level: level || 'standard',
    /* the variant as the store names it everywhere else, and beside it what the book's kind
       derived from it — the generic pair every kind writes, never columns of print's own */
    variant: variant || [v.contents, v.cloth, v.foil].filter(Boolean).join('.'),
    chosen: { book: bought.book, edition: ed?.edition ?? '', format: bought.format ?? 'hardcover', contents: v.contents, cloth: v.cloth || '', foil: v.foil || '' },
    /* whoever the edition says makes it. No fallback: a row with no provider fails in
       submitPrintOrder with a line naming what to run, and a guessed printer would instead bill
       an account that never made the book. */
    supplier: ed?.printers?.[bought.format ?? 'hardcover']?.provider ?? '',
  }).select().single()
  if (error || !row) { console.warn('ledger: print order not written —', error?.message); return }
  await submitPrintOrder(row, bought.title)
}

/* customer.subscription.created / updated: the subscription row and the subscribed entitlement, its tier from the price */
export async function subscriptionChanged(o: any, provider = 'stripe') {
  let paymentMethodId: string | undefined
  if (o?.provider && o?.subscriptionId) {
    if (o.provider !== provider) throw new Error(`subscription snapshot provider "${o.provider}" does not match "${provider}"`)
    paymentMethodId = (o as PaymentSubscriptionSnapshot).paymentMethodId
    o = subscriptionForLedger(o as PaymentSubscriptionSnapshot)
  }
  const userId: string | null = o.metadata?.user_id ?? (await userByCustomer(o.customer, provider))
  if (!userId) return
  const customerId = idOf(o.customer)
  if (customerId) {
    if (provider === 'stripe') {
      const { error } = await admin.from('profiles').update({ stripe_customer_id: customerId }).eq('id', userId)
      if (error) throw new Error(`Stripe customer reference was not recorded: ${error.message}`)
    }
    await linkProviderEntity(provider, 'customer', customerId, 'profiles', userId)
  }
  const externalSubscriptionId = idOf(o)
  if (!externalSubscriptionId) throw new Error('subscription event has no provider subscription id')
  const mappedSubscriptionId = await findProviderEntity(provider, 'subscription', externalSubscriptionId, 'subscriptions')
  const subscriptionId = mappedSubscriptionId
    ?? (provider === 'stripe' ? externalSubscriptionId : providerScopedId(provider, externalSubscriptionId))
  const items = o.items?.data ?? []
  const usageItem = items.find((i: any) =>
    i.price?.metadata?.usage === 'metered' ||
    String(i.price?.lookup_key ?? '').endsWith('_usage') ||
    (provider === 'hyperswitch' && !!i.price?.metadata?.usage_meter))
  const item = items.find((i: any) => i !== usageItem) ?? items[0]
  const priceId = item?.price?.id ?? null
  const amount = item?.price?.unit_amount ?? null
  const active = ['active', 'trialing', 'past_due'].includes(o.status)
  /* THAT A TRIAL HAPPENED IS STICKY. The question asked later is "has this person ever trialled
     this tier", and a cancelled subscription's row is the only record of it — so this is only ever
     set, never cleared. Stripe says so two ways: the status while it runs, and trial_end after. */
  const trialed = o.status === 'trialing' || !!(o as any).trial_end
  const periodEnd = iso(o.current_period_end)
  const key = item?.price?.lookup_key ?? item?.price?.metadata?.key ?? null
  const known = (key ? offerByKey(key) : null) ?? (item?.price?.metadata?.sku ? offer(item.price.metadata.sku) : null)
  const sku = known?.sku ?? item?.price?.metadata?.sku ?? null
  const usageMeta = usageItem?.price?.metadata ?? {}
  if (usageItem && usageMeta.usage_offer_key && key && usageMeta.usage_offer_key !== key) {
    throw new Error(`subscription ${o.id} has a metered price for a different offer`)
  }
  /* a switch waiting for the period end (a schedule on the subscription) is kept until
     the subscription is on that price or the schedule is gone */
  const { data: was, error: wasError } = await admin.from('subscriptions').select('next_key').eq('id', subscriptionId).maybeSingle()
  if (wasError) throw new Error(`subscription lookup failed: ${wasError.message}`)
  const pending = !!o.schedule && !!was?.next_key && was.next_key !== (known?.key ?? key)
  const { error: subscriptionError } = await admin.from('subscriptions').upsert({
    id: subscriptionId, user_id: userId, status: o.status, price_id: priceId, sku, key: known?.key ?? key, plan_amount: amount,
    current_period_start: iso(o.current_period_start), current_period_end: periodEnd,
    usage_price_id: usageItem?.price?.id ?? null,
    usage_meter: usageItem ? usageMeta.usage_meter ?? null : null,
    usage_unit: usageItem ? usageMeta.usage_unit ?? null : null,
    usage_rate_micros: usageItem ? Number(usageMeta.usage_rate_micros) || null : null,
    usage_included_micros: usageItem ? Number(usageMeta.usage_included_micros) || 0 : 0,
    usage_overage_price_micros: usageItem ? Number(usageMeta.usage_overage_price_micros) || null : null,
    usage_incremental_charge_minor: usageItem ? Number(usageMeta.usage_incremental_charge_minor) || null : null,
    usage_incremental_charge_currency: usageItem && usageMeta.usage_incremental_charge_minor
      ? String(usageMeta.usage_incremental_charge_currency ?? usageItem.price?.currency ?? known?.currency ?? '').toLowerCase() || null
      : null,
    usage_speech_cost_per_second_micros: usageItem ? Number(usageMeta.usage_speech_cost_per_second_micros) || 0 : 0,
    cancel_at_period_end: !!o.cancel_at_period_end, updated_at: new Date().toISOString(),
    ...(trialed ? { trialed: true } : {}),
    ...(pending ? {} : { next_sku: null, next_key: null, next_at: null }),
  })
  if (subscriptionError) throw new Error(`subscription was not recorded: ${subscriptionError.message}`)
  await linkProviderEntity(provider, 'subscription', externalSubscriptionId, 'subscriptions', subscriptionId)
  if (paymentMethodId) await linkProviderEntity(provider, 'payment_method', paymentMethodId, 'subscriptions', subscriptionId)
  if (priceId) await linkProviderEntity(provider, 'price', priceId, 'subscriptions', subscriptionId)
  if (usageItem?.price?.id) await linkProviderEntity(provider, 'price', usageItem.price.id, 'subscriptions', subscriptionId)
  if (usageItem && usageMeta.usage_meter) await linkProviderEntity(provider, 'meter', usageMeta.usage_meter, 'subscriptions', subscriptionId)
  const { data: entitlement, error: entitlementError } = await admin.from('entitlements').upsert({
    user_id: userId, kind: 'class', key: 'subscribed', source: 'subscription', source_id: providerScopedId(provider, externalSubscriptionId),
    tier: item?.price?.metadata?.tier ?? null, plan_amount: amount, active, expires_at: periodEnd,
  }, { onConflict: 'user_id,kind,key,source_id' }).select('id').maybeSingle()
  if (entitlementError || !entitlement?.id) throw new Error(`subscription entitlement was not recorded: ${entitlementError?.message ?? 'no entitlement id returned'}`)
  await linkProviderEntity(provider, 'subscription', externalSubscriptionId, 'entitlements', entitlement.id)
}
export async function subscriptionDeleted(id: string, provider = 'stripe') {
  const mappedId = await findProviderEntity(provider, 'subscription', id, 'subscriptions')
  const subscriptionId = mappedId ?? (provider === 'stripe' ? id : null)
  if (!subscriptionId) return
  const { error } = await admin.from('subscriptions').update({ status: 'canceled', updated_at: new Date().toISOString() }).eq('id', subscriptionId)
  if (error) throw new Error(`subscription cancellation was not recorded: ${error.message}`)
  const { error: entitlementError } = await admin.from('entitlements').update({ active: false })
    .eq('source_id', providerScopedId(provider, id)).eq('kind', 'class').eq('key', 'subscribed')
  if (entitlementError) throw new Error(`subscription entitlement cancellation was not recorded: ${entitlementError.message}`)
}
