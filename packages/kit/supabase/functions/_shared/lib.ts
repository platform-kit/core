/*
 * Shared by every Edge Function: the Stripe client, a service-role Supabase
 * client (bypasses RLS — server-side only, never shipped), CORS, a JSON reply,
 * and the caller resolved from their JWT.
 *
 * SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY are injected by the platform (and by
 * `supabase functions serve` locally). STRIPE_*, CAL_* and APP_URL come from
 * function secrets (`supabase secrets set`, which build/deploy.mjs does from the
 * deploy environment); locally `npm run db:serve` hands the functions the root
 * .env, the one file every secret lives in.
 */
import Stripe from 'npm:stripe@17'
import { createClient } from 'npm:@supabase/supabase-js@2'
import { createSitePaymentProvider } from './payment-provider-registry.ts'
import type { PaymentProviderAdapter } from './payment-provider.d.ts'

/* Stripe is OPTIONAL in local dev: with no STRIPE_SECRET_KEY the store, cart,
   gating and everything else still work; only a real Checkout / Portal / catalog
   sync needs it, and those answer with a clear, coded 503 instead. The client is
   still constructed (the SDK wants a string) but never called unless configured. */
const STRIPE_KEY = Deno.env.get('STRIPE_SECRET_KEY') ?? ''
/* STRIPE_MOCK=1 (local only; the deploy refuses it): no Stripe at all — checkout
   completes on the spot and writes the ledger as the webhook would, the portal
   cancels the mock subscription at once, the catalog push is a no-op. Opt-in, so a
   checkout with no key and no mock still says "not configured". */
/* an id the mock made up (cus_mock_…, sub_mock_…, cs_mock_…): never sent to Stripe */
export const isMockId = (id: unknown) => /^(cus|sub|cs|pi|price)_mock_/.test(String(id ?? ''))
export const stripeMock = /^(1|true|yes|on)$/i.test(Deno.env.get('STRIPE_MOCK') ?? '')
export const stripeConfigured = STRIPE_KEY.length > 0 || stripeMock
/* whether a call would REALLY reach Stripe: the key is set and the mock is not standing in for it.
   Anything that moves money outward asks this rather than stripeConfigured, which is true under the
   mock on purpose. */
export const stripeLive = STRIPE_KEY.length > 0 && !stripeMock
export const stripe = new Stripe(STRIPE_KEY || 'sk_test_unconfigured', {
  apiVersion: '2024-06-20' as Stripe.LatestApiVersion,
  httpClient: Stripe.createFetchHttpClient(),
})
let paymentProviderPromise: Promise<PaymentProviderAdapter> | null = null
export const getPaymentProvider = () => {
  paymentProviderPromise ??= createSitePaymentProvider(Deno.env.toObject(), { stripe })
  return paymentProviderPromise
}
export const stripeUnconfigured = () =>
  json({ error: 'Payments are not configured in this environment (no STRIPE_SECRET_KEY).', code: 'stripe_unconfigured' }, 503)

export const admin = createClient(
  Deno.env.get('SUPABASE_URL') ?? '',
  Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '',
  { auth: { persistSession: false, autoRefreshToken: false } },
)

export const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-support-token, x-form-anon, x-form-origin',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}

export const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...cors, 'Content-Type': 'application/json' } })

export const preflight = (req: Request) =>
  req.method === 'OPTIONS' ? new Response('ok', { headers: cors }) : null

/* the signed-in caller, or null */
/* is the bearer the project's service key? Never by comparing strings: the key the deploy holds and
   the one the runtime injects may be the same secret in two forms (the legacy JWT, the newer
   sb_secret_… key), so the bearer is tried against the admin API — only the service role may list
   users — and is the service key if that answers */
export async function isServiceBearer(req: Request) {
  const token = (req.headers.get('Authorization') ?? '').replace(/^Bearer\s+/i, '')
  if (!token) return false
  if (token === (Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '')) return true
  try {
    const probe = createClient(Deno.env.get('SUPABASE_URL') ?? '', token, { auth: { persistSession: false, autoRefreshToken: false } })
    const { error } = await probe.auth.admin.listUsers({ page: 1, perPage: 1 })
    return !error
  } catch { return false }
}
export async function getUser(req: Request) {
  const token = (req.headers.get('Authorization') ?? '').replace(/^Bearer\s+/i, '')
  if (!token) return null
  const { data, error } = await admin.auth.getUser(token)
  return error ? null : data.user
}

export const appUrl = () => (Deno.env.get('APP_URL') ?? Deno.env.get('VITE_APP_URL') ?? 'http://localhost:5173').replace(/\/+$/, '')
