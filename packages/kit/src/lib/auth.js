/*
 * Auth + session + entitlements. One reactive session for the whole app, the
 * sign-in methods over Supabase Auth (email+password, magic link, Google), and
 * the user "class" ladder — guest < authenticated < paid < subscribed — that the
 * gating and ad layers share.
 *
 * The class comes from the entitlements ledger (get_my_entitlements()), which is
 * written only by the service role, so the client can never talk itself into a
 * higher rung. It is cached in the Loro store so a returning reader's gates
 * resolve before the network answers, and refreshed on every session change,
 * on focus, and right after a Checkout success redirect. Signing in attaches the
 * cloud sync (src/lib/sync.js); signing out detaches it and leaves the local
 * copy for the guest.
 */
import { ref, computed } from 'vue'
import { identityBus } from './identity.js'
import { supabase, configured } from './supabase.js'
import { attachSync, detachSync, pushNow } from './sync.js'
import { products as PRODUCTS } from '#content'
import { get as storeGet, set as storeSet, del as storeDel, reset as resetStore } from './store.js'
import { clear as clearCart } from './cart.js'
import { toast } from './toast.js'
import { us } from './content.js'
import { CLASSES, hasClass, classOf } from '../../supabase/functions/_shared/access.js'   /* the ladder, shared with the functions */
import { abilityFor, identityOf, entrySubject } from '../../supabase/functions/_shared/permissions.js'   /* the rules, shared with the functions */
import { rules as siteRules } from '#site/permissions'   /* and the site's own, run after the kit's */

export { CLASSES, hasClass, entrySubject }

/* sign-in methods: email + password is always on; the others are opt-in by env
   (they need an OAuth client / deliverable email respectively) */
const on = (v) => /^(1|true|yes|on)$/i.test(String(v || ''))
export const AUTH_GOOGLE = on(import.meta.env.VITE_AUTH_GOOGLE)
export const AUTH_MAGIC = on(import.meta.env.VITE_AUTH_MAGIC_LINK)

/* 'success' | 'cancel' | null — what Stripe Checkout sent us back with, read
   once at boot before the URL is cleaned, so the store page can say so */
export const checkoutResult = ref(null)

export const session = ref(null)
export const user = computed(() => (session.value ? session.value.user : null))
export const isSignedIn = computed(() => !!user.value)

/* the signed-in reader's role, read from their own profile row (which only
   they can read); the server re-checks it on every admin call, so this only
   decides what to show */
export const isAdmin = ref(false)
/* …or anybody who runs any part of the site at all */
export const isStaff = ref(false)
/* THE ROLES THIS PERSON HOLDS, and what each of them reaches. A person holds a SET — a coach who
   also writes articles holds both and is not thereby an administrator — and nothing outside this
   file compares a role's name: the four below are what a component asks, in the same words the
   database and the Edge Functions use, so the three can never drift apart about what a role means.
   The server re-checks every one of them; these only decide what to show. */
export const roles = ref([])
export const isProvider = ref(false)
export const mayEditContent = ref(false)
export const maySeeFigures = ref(false)
export const isSupport = ref(false)
/* the address is proven (profiles.email_verified_at): the results wait for it.
   Supabase gives a session at sign-up; the proof is our own magic link, and
   mark_email_verified() sets the flag only for a token that came from one */
export const emailVerified = ref(false)
/* the role and the flag have been read for the current session (the lockdown
   waits for this before deciding anyone is not an admin) */
export const roleKnown = ref(false)
/*
 * THE FACE THIS PERSON WEARS, for the chrome that is on every page.
 *
 * It rides along with the role because that read already happens once per session against the
 * same row — so the header costs nothing extra to show somebody their own face. Without it the
 * header drew the first letter of their email, which is the one place a person sees themselves on
 * every page: they could design a face, save it, and still be a letter everywhere. A page that
 * needs the whole profile still asks for it (loadMe in account.js); this is only what is worn.
 */
export const myFace = ref(null)
/* who is here is known: the session read and, for a signed-in reader, the role and the entitlements
   answered (or refused) — the header shows nothing that depends on the person until this is true, so
   the buttons arrive together instead of popping in one database answer at a time */
export const authSettled = ref(false)
/*
 * WHO IS HERE, SAID ONCE, TO WHOEVER HOLDS SOMETHING OF THEIRS.
 *
 * Every module that keeps a person's data needs telling twice: somebody left, so discard it;
 * somebody arrived, so load it. There was only the first half (beforeSignOut), and signing out
 * ALSO reloads the page, so the missing half was invisible — a member who signed in on the
 * community page was told they were not in a space yet until they navigated, because nothing ever
 * told the spaces module that anybody had arrived.
 *
 * The rule itself is in lib/identity.js, pure and pinned by build/identity.test.mjs. This is the
 * one place in the app that drives it, and it drives it from settle() because settle() is where
 * the reads for a person begin and end. A watcher on isSignedIn would be wrong: that is true the
 * instant the session object exists, which is before the role and the entitlements have answered.
 *
 * Each hook is called detached and its failure swallowed: one module's trouble must not stop the
 * next being told, and none of them may fail a sign-in.
 */
const bus = identityBus()
export const onIdentity = (fn) => bus.on(fn)
const detached = (fn, id) => Promise.resolve().then(() => fn(id)).catch(() => { /* not another module's problem */ })

/* starts the reads for a session (or settles a guest at once); true when it started them */
function settle(s) {
  const id = s ? s.user.id : null
  if (!bus.begin(id)) return false
  if (!s) { authSettled.value = true; bus.settle(id, detached); return true }
  authSettled.value = false
  Promise.all([refreshEntitlements(), refreshRole().then(markVerified)]).finally(() => {
    /* a late answer for somebody who has already gone announces nobody: the bus drops it */
    if (bus.settle(id, detached)) authSettled.value = true
  })
  return true
}
function setRoles(held) {
  const has = (r) => held.includes(r)
  roles.value = held
  isAdmin.value = has('admin')
  isStaff.value = held.length > 0
  /* 'coach' is the old word for it: a row written before the rename may still hold it, and the
     database's is_provider() accepts both the same way. It goes when the backfill has run
     everywhere, by a change of its own. */
  isProvider.value = has('provider') || has('coach') || has('admin')
  mayEditContent.value = has('editor') || has('admin')
  maySeeFigures.value = has('analyst') || has('admin')
  isSupport.value = has('support') || has('admin')
}
const clearRoles = () => setRoles([])

async function refreshRole() {
  if (!configured || !session.value) { clearRoles(); emailVerified.value = false; roleKnown.value = false; myFace.value = null; return }
  roleKnown.value = false
  try {
    const { data } = await supabase.from('profiles').select('roles, role, email_verified_at, email, avatar, avatar_style, avatar_seed, avatar_options').eq('id', session.value.user.id).maybeSingle()
    /*
     * THE FACE, THROUGH THE FUNCTION. A select cannot answer the seed a person has when they have
     * chosen none — the database makes it from their address, and every other surface is given it
     * already made. Drawn from the raw columns the header fell back to the id and drew a face
     * nobody else was looking at, which reads as the site showing the wrong avatar, because it is.
     */
    try {
      const { data: mine } = await supabase.rpc('my_profile')
      myFace.value = mine || null
    } catch { myFace.value = data ? { id: session.value.user.id, email: data.email, avatar: data.avatar, avatar_style: data.avatar_style, avatar_seed: data.avatar_seed, avatar_options: data.avatar_options } : null }
    /* `role` is what this replaced: read as a fallback so the app works against a database the
       backfill has not reached yet. It is dropped by a change of its own. */
    const held = Array.isArray(data && data.roles) && data.roles.length ? data.roles
      : data && data.role && data.role !== 'user' ? [data.role] : []
    setRoles(held)
    emailVerified.value = !!(data && data.email_verified_at)
    roleKnown.value = true
  } catch (e) { /* offline — keep what we had */ }
}
/* a session that came from the confirmation link (or a provider) proves the
   address; the server reads the proof off the token itself */
async function markVerified() {
  if (!configured || !session.value || emailVerified.value) return
  try {
    const { data } = await supabase.rpc('mark_email_verified')
    if (data === true) emailVerified.value = true
  } catch (e) { /* offline */ }
}

/* hasClass — monotonic: a subscriber also clears every lower bar — is the shared rule's, re-exported above */

/* ---- entitlements ---- */
const ENT_KEY = 'dl.entitlements.v1'
function readCached() {
  try { const raw = storeGet(ENT_KEY); return raw ? JSON.parse(raw) : null } catch (e) { return null }
}
export const entitlements = ref(readCached())

export async function refreshEntitlements() {
  if (!configured || !session.value) { entitlements.value = null; return }
  try {
    const { data, error } = await supabase.rpc('get_my_entitlements')
    if (error || !data) return
    entitlements.value = { ...data, at: Date.now() }
    storeSet(ENT_KEY, JSON.stringify(entitlements.value))
  } catch (e) { /* offline — the cached answer stands */ }
}

/* the rung the user stands on; a signed-in user with no grants is 'authenticated' */
export const userClass = computed(() => classOf(entitlements.value, !!user.value))
export const canAccess = (required) => hasClass(userClass.value, required || 'guest')

/*
 * WHAT THIS PERSON MAY DO, as one ability rather than four vocabularies.
 *
 * The identity is what this module has already settled — the session, the role, the grants the
 * database returned — and the rules are the kit's (supabase/functions/_shared/permissions.js, the
 * same file the Edge Functions ask) followed by whatever the site registered as `permissions`. The
 * direction is one way and has to stay that way: the database says what is true, this module settles
 * it into an identity, the identity builds the ability, and everything else asks the ability. A ref
 * here is never computed back out of it.
 *
 * It is a convenience for the browser and not enforcement; the policies enforce, as they always did.
 */
export const identity = computed(() => identityOf({
  signedIn: !!user.value,
  verified: emailVerified.value,
  entitlements: entitlements.value,
  role: isAdmin.value ? 'admin' : isSupport.value ? 'support' : 'user',
  roles: roles.value,
}))
export const ability = computed(() => abilityFor(identity.value, siteRules))
/* the one question the rest of the app asks: `can('read', entrySubject(entry))` */
export const can = (action, subject) => ability.value.can(action, subject)
export const cannot = (action, subject) => ability.value.cannot(action, subject)
/* the membership tiers the account holds (the Stripe price's `tier`, kept by the
   webhook); a subscriber with no tier on the price holds none, and still counts as
   subscribed for the class ladder */
export const memberTiers = computed(() => (entitlements.value && Array.isArray(entitlements.value.tiers) ? entitlements.value.tiers : []))
export const hasTier = (slug) => memberTiers.value.includes(slug)
export const hasProduct = (key) =>
  !!(entitlements.value && Array.isArray(entitlements.value.products) && entitlements.value.products.includes(key))
/* the plan a subscriber is on: the live subscription's sku, or '' */
export const plan = computed(() => (entitlements.value && entitlements.value.plan) || '')
/* …and its identity: the offer's key, which a renamed sku never changes */
export const planKey = computed(() => (entitlements.value && entitlements.value.plan_key) || '')
/* a step down waiting for the period end: the plan it goes to, and when */
export const planNext = computed(() => (entitlements.value && entitlements.value.plan_next) || '')
export const planNextKey = computed(() => (entitlements.value && entitlements.value.plan_next_key) || '')
export const planNextAt = computed(() => (entitlements.value && entitlements.value.plan_next_at) || '')
/* paid sessions bought and not yet booked: { 'session:<sku>': n } */
export const credits = computed(() => (entitlements.value && entitlements.value.credits) || {})
/* credits are kept by the offer's key; asked for by sku, as the sessions name it */
const keyOf = (sku) => { const p = (PRODUCTS || []).find((x) => x.sku === sku); return p && p.key ? p.key : sku }
export const creditsFor = (sku) => Number(credits.value['session:' + keyOf(sku)] || 0)

const redirectTo = (target = '') => {
  const fallback = import.meta.env.VITE_APP_URL || window.location.origin
  if (!target) return fallback
  const url = new URL(target, window.location.origin)
  return url.origin === window.location.origin ? url.href : fallback
}
/* the address as the page opened: supabase-js reads a link's tokens out of the hash as it
   initialises (before any listener is on) and clears them, so what the link was for is noted
   here first — a password reset's landing says type=recovery */
const BOOT_HASH = typeof window !== 'undefined' ? window.location.hash || '' : ''

let started = false
/* read the persisted session (no network wait for first paint), attach sync +
   entitlements if signed in, and follow every later change */
export async function initAuth() {
  if (started) return
  if (!configured) { authSettled.value = true; return }
  started = true

  /* back from Stripe Checkout: the webhook has (or is about to have) written the
     ledger; mint a fresh token and re-read entitlements, never trust the URL alone */
  const params = new URLSearchParams(window.location.search)
  const fromCheckout = params.get('checkout') === 'success'
  const checkoutSession = fromCheckout ? params.get('session') : null   /* Stripe's id of what was just paid */
  if (params.has('checkout')) {
    checkoutResult.value = fromCheckout ? 'success' : 'cancel'
    if (fromCheckout) clearCart()
    /* a cancel is said at once; a success is said once the session is confirmed below,
       since what it says depends on what was bought */
    const W = (us('store').page || {}).head || {}
    if (!fromCheckout) toast({ kind: 'note', title: W['cancel-heading'], body: W['cancel-subtitle'], dismiss: W.dismiss || '' })
    params.delete('checkout'); params.delete('session')
    const q = params.toString()
    window.history.replaceState({}, '', window.location.pathname + (q ? '?' + q : '') + window.location.hash)
  }

  const { data } = await supabase.auth.getSession()
  session.value = data.session
  if (!data.session) settle(null)   /* a guest: nothing more to read */
  /* back from the reset email with a session: the new-password form, not the page */
  if (data.session && /[#&]type=recovery(&|$)/.test(BOOT_HASH)) recovery.value = true
  if (data.session) {
    attachSync(data.session)
    if (fromCheckout) await supabase.auth.refreshSession().catch(() => {})
    /* the buyer's own confirmation of the session, written to the ledger before the
       entitlements are read — so what was paid for is theirs on landing, whether or not
       the webhook has arrived (locally it may never, with no forwarder running) */
    let bought = null
    if (checkoutSession) bought = await supabase.functions.invoke('confirm-checkout', { body: { session: checkoutSession } }).then((r) => (r && r.data) || null).catch(() => null)
    settle(data.session)
    /* said in a toast, since the buyer may land anywhere (the app, the pricing page):
       a membership, or a purchase — the confirmation says which; the mock says nothing */
    if (fromCheckout) {
      const W = (us('store').page || {}).head || {}
      const purchase = bought && bought.mode === 'payment'
      toast({ kind: 'ok', title: W['success-heading'], body: purchase ? (W['success-subtitle-purchase'] || W['success-subtitle']) : W['success-subtitle'], dismiss: W.dismiss || '' })
    }
  } else if (fromCheckout) {
    /* a guest's purchase: confirmed the same way (the function accepts a guest's session), and
       told that an account made with the address they gave will hold the order and the files */
    if (checkoutSession) await supabase.functions.invoke('confirm-checkout', { body: { session: checkoutSession } }).catch(() => null)
    const W = (us('store').page || {}).head || {}
    toast({ kind: 'ok', title: W['success-heading'], body: W['success-subtitle-guest'] || W['success-subtitle'], dismiss: W.dismiss || '' })
  }
  /* the work is deferred a tick: supabase-js holds its auth lock while it calls this,
     and a call that needs the lock from inside (any request, which asks for the
     session) can deadlock — the documented pattern is to leave the callback first */
  supabase.auth.onAuthStateChange((event, s) => {
    session.value = s
    /* back from the password-reset email: the link signed them in for the one purpose of
       choosing a new password, and the modal opens on that form (AuthModal watches this) */
    if (event === 'PASSWORD_RECOVERY') recovery.value = true
    setTimeout(() => {
      if (s) { attachSync(s); if (!settle(s)) { refreshEntitlements(); refreshRole().then(markVerified) } }
      else { detachSync(); entitlements.value = null; clearRoles(); emailVerified.value = false; roleKnown.value = false; storeDel(ENT_KEY); settle(null) }
    }, 0)
  })
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible' && session.value) refreshEntitlements()
  })
}

const must = ({ error }) => { if (error) throw error }

export async function signInWithPassword(email, password) {
  must(await supabase.auth.signInWithPassword({ email, password }))
}
/* Resolves to what Supabase said about the new account:
   'confirm'  — made and signed in (Supabase confirms the address at sign-up),
                and the app's own confirmation — a magic link — is on its way;
                the results wait for it
   'exists'   — this email already has an account (Supabase answers a sign-up
                for a known email with a user that has no identities, rather
                than saying so outright) */
export async function signUpWithPassword(email, password, returnTo = '') {
  const { data, error } = await supabase.auth.signUp({ email, password, options: { emailRedirectTo: redirectTo(returnTo) } })
  if (error) throw error
  if (data.user && Array.isArray(data.user.identities) && data.user.identities.length === 0) return 'exists'
  await sendConfirmation(email, returnTo).catch(() => { /* the gate offers it again */ })
  return 'confirm'
}
/* the confirmation: a magic link to the address; following it proves it */
export async function sendConfirmation(email, returnTo = '') {
  must(await supabase.auth.signInWithOtp({ email, options: { shouldCreateUser: false, emailRedirectTo: redirectTo(returnTo) } }))
}
export const resendConfirmation = sendConfirmation
export async function signInWithMagicLink(email, returnTo = '') {
  must(await supabase.auth.signInWithOtp({ email, options: { emailRedirectTo: redirectTo(returnTo) } }))
}
/* a forgotten password: the reset email (the "recovery" design under admin → Emails) carries a
   link back to the site; following it raises `recovery`, and the new password is set with the
   session it made */
export const recovery = ref(false)
export async function requestPasswordReset(email) {
  must(await supabase.auth.resetPasswordForEmail(email, { redirectTo: redirectTo() }))
}
export async function setPassword(password) {
  must(await supabase.auth.updateUser({ password }))
  recovery.value = false
}
export async function signInWithGoogle(returnTo = '') {
  must(await supabase.auth.signInWithOAuth({ provider: 'google', options: { redirectTo: redirectTo(returnTo) } }))
}
/* Signing out leaves the device as a fresh guest: push whatever is unsaved,
   end the session (which detaches the sync), throw the local document away —
   keeping device preferences — and reload so every module re-hydrates clean.
   Only an explicit sign-out does this; a session that merely expires is left
   alone so nothing vanishes unexpectedly. */
/* things that must drain before the local document is thrown away — the answers
   outbox registers here, so auth never has to import the engine */
export const beforeSignOut = []
export async function signOut() {
  await Promise.all(beforeSignOut.map((fn) => Promise.resolve().then(fn).catch(() => {})))
  await pushNow().catch(() => { /* offline — the last debounced push already ran */ })
  await supabase.auth.signOut()
  detachSync()
  await resetStore()
  try { sessionStorage.removeItem('dl.sid') } catch (e) { /* private mode */ }
  window.location.reload()
}
