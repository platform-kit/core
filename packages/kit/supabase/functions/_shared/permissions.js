/*
 * WHAT MAY BE DONE, DECIDED IN ONE PLACE.
 *
 * Four vocabularies used to answer "may this person do this", and none of them was a place a site
 * could stand: the class ladder (guest < authenticated < paid < subscribed) in access.js; the role
 * booleans in lib/auth.js; the ranked tiers; and a space's capabilities, which is the only one of the
 * four that was already a subject-and-action system and is the model the others are brought up to.
 * A site that wanted to change any of it had to fork auth.js or shadow a component. Everything else
 * in the kit answers that with a registration — the printers, the schedulers, the content stores,
 * the graders, and now this.
 *
 * Plain JavaScript over @casl/ability and nothing else, so the same file is the answer in the
 * browser, in a build script and in an Edge Function — the shape access.js, shipping.js and
 * speech.js already have. The rules take an IDENTITY (plain data: what get_my_entitlements said,
 * the account's roles, the classes it clears) and never a session, a store or a request.
 *
 * WHAT THIS IS NOT. It is not enforcement. The database enforces access with its own policies and
 * security-definer functions and goes on doing so; an ability built in a browser is a convenience
 * for the browser and nothing a policy may trust. What this moves is where a rule is WRITTEN.
 *
 * HOW A SITE CHANGES IT. `permissions` in platformkit.config.js names a module exporting
 * `rules(identity, { can, cannot })`, run after the kit's own — so a site adds a rule, narrows one,
 * or revokes one. `cannot` is the common case: everything the kit allows, except this.
 */
import { AbilityBuilder, createMongoAbility } from '@casl/ability'
import { CLASSES, hasClass, requiredBy, classOf } from './access.js'
import { admits } from './sessions/admits.js'   /* who a booking type is for: the one rule, asked and never rewritten */

/*
 * The identity every rule reads. Built from what the app already settles, so nothing new is asked of
 * a caller: `classOf` gives the rung, the roles come from the profile, the tiers and products from
 * the entitlements.
 *
 * `tenant` is a seam and is read by nothing here. One backend serving many sites would make `role`
 * and the entitlements per (person, tenant) rather than per person, and this is where that scope
 * would arrive; a single deployment has one tenant and never names it.
 */
export function identityOf({ signedIn = false, entitlements = null, role = '', roles = [], verified = false, tenant = null } = {}) {
  const e = entitlements || {}
  const cls = classOf(e, !!signedIn)
  return {
    signedIn: !!signedIn,
    verified: !!verified,
    tenant: tenant || null,
    class: cls,
    /* every rung this person clears, so a rule can match a subject's bar with $in rather than arithmetic */
    clears: CLASSES.filter((c) => hasClass(cls, c)),
    role: role || 'user',
    roles: Array.isArray(roles) ? roles : [],
    tiers: Array.isArray(e.tiers) ? e.tiers : [],
    products: Array.isArray(e.products) ? e.products : [],
    credits: Array.isArray(e.credits) ? e.credits : [],
    plan: e.plan || null,
  }
}

/* the subject an entry is, for a rule to match: its own bar on the ladder, as a class name */
export function entrySubject(entry, identity) {
  const owned = entry && entry.kind === 'books' && identity && identity.products.includes(entry.slug)
  return {
    __caslSubjectType__: 'Entry',
    kind: entry && entry.kind,
    slug: entry && entry.slug,
    /* a book bought outright lifts its buyer to paid FOR THAT BOOK, as the reader already does */
    bar: owned ? 'guest' : requiredBy(entry && entry.canAccess),
  }
}

/*
 * THE KIT'S OWN RULES. Every one of them is one of the four vocabularies, said once.
 */
export function rules(identity, { can, cannot }) {
  const me = identity

  /* an administrator may do anything — the role the whole admin already turns on */
  if (me.role === 'admin') can('manage', 'all')

  /* the desk: whoever is on it may read and answer a support conversation, and nothing else of an
     administrator's. `is_staff()` in the database is this rule's counterpart. */
  if (me.role === 'admin' || me.role === 'support') {
    can(['read', 'answer', 'assign', 'resolve'], 'SupportConversation')
    can('read', 'Contact')
  }

  /* the granular staff grants an administrator hands out, each its own ref in the app today */
  if (me.roles.includes('editor')) can(['read', 'edit', 'publish'], 'Content')
  if (me.roles.includes('analyst')) can('read', 'Figures')
  if (me.roles.includes('provider')) can(['sell', 'schedule'], 'Offering')

  /* THE CLASS LADDER, as a rule rather than a comparison: an entry carries the rung it asks for and
     a reader carries every rung they clear, so the match is $in and the monotonicity is in the data */
  can('read', 'Entry', { bar: { $in: me.clears } })

  /* a chapter past a book's allowance for this class is the same rule with a number on it, and the
     number belongs to the book, so the subject carries it */
  can('read', 'Chapter', { bar: { $in: me.clears } })

  /* what a reader may do with their own account */
  if (me.signedIn) {
    can(['read', 'update'], 'Profile')
    can('read', 'Answer')
    can('write', 'Answer')
  }
  /* the app's own confirmation of an address gates the reading, not the taking */
  if (!me.verified) cannot('read', 'Results')
  else if (me.signedIn) can('read', 'Results')

  /*
   * MEMBERSHIP: WHO A BOOKING TYPE IS FOR IS ALREADY ONE RULE, and this does not write a second.
   *
   * `admits()` in sessions/admits.js is the rule the app's picker and the functions' judge both ask,
   * and it says more than a tier check: `guest` means no membership, `authenticated` means signed in
   * AND no membership, a list of tiers means exactly those with no ladder implied, and `below` caps
   * the type for anybody already at that tier. A rule written again here would have got three of
   * those wrong — the first draft of this file did — and two sides of a gate that disagree are not a
   * gate. So the subject carries that rule's own verdict and this matches it, exactly as a channel
   * carries the capabilities the database answered. What the ability adds is the seam: a site may
   * narrow or revoke booking without touching the rule.
   *
   * The allowance — how many a week, how many a month — is a count the server keeps and is asked
   * beside this, never instead of it.
   */
  can('book', 'Session', { admitted: true })
  /* a paid one-off needs a credit for it rather than a tier */
  can('book', 'PaidSession', { key: { $in: me.credits } })

  /* the chat a membership carries */
  if (me.class === 'subscribed') can(['read', 'write'], 'CoachingConversation')
  else if (me.signedIn) can('read', 'CoachingConversation')

  /*
   * A SPACE'S CAPABILITIES ARE THE DATABASE'S ANSWER, not this module's: `space_may(channel, cap)`
   * reads the roles and grants of that channel and only the database holds them. So a channel is
   * handed here with the capabilities it already answered, and the rule matches them. Re-deriving
   * them in the browser would be a second opinion on a question that has an authority.
   */
  can('do', 'Channel', { may: { $exists: true } })
}

/*
 * The ability for an identity: the kit's rules, then the site's, then the run's. Later rules win, so
 * a site's `cannot` narrows what the kit allowed, which is what an override is for.
 */
export function abilityFor(identity, extra = null) {
  const me = identity && identity.clears ? identity : identityOf(identity || {})
  const builder = new AbilityBuilder(createMongoAbility)
  rules(me, builder)
  for (const fn of [].concat(extra || [])) if (typeof fn === 'function') fn(me, builder)
  return builder.build({ detectSubjectType: (s) => (s && s.__caslSubjectType__) || s })
}

/*
 * A BOOKING TYPE AS A SUBJECT, carrying `admits()`'s own verdict. `ranks` is the tier ladder the
 * caller holds — the catalog's on the server, the storefront's in the browser — because the ranks
 * are data and not a rule.
 */
export const sessionSubject = (session, identity, ranks, admitted) => ({
  __caslSubjectType__: 'Session',
  slug: session && session.slug,
  /*
   * THE CALLER MAY KNOW MORE THAN `admits()` DOES, and then it says so. The functions' judge asks
   * `forRank()`, which is `admits()` plus one thing only the server holds: a tier whose own listing
   * names this type admits it whatever the type's rules say. Computing `admits()` here instead
   * would quietly drop that, which is the sort of difference a gate is not allowed to have — so a
   * verdict passed in wins, and `admits()` is the answer only when nobody brought one.
   */
  admitted: admitted !== undefined ? !!admitted : admits(session, { tiers: identity.tiers, signed: identity.signedIn, ranks: ranks || {} }),
})

/* a channel as a subject, carrying what the database said this person may do in it */
export const channelSubject = (channel, caps) => ({ __caslSubjectType__: 'Channel', id: channel && channel.id, may: caps || {} })

/* the capability question, answered by the database's own answer and not by a second opinion */
export const mayInChannel = (caps, capability) => !!(caps && caps[capability])
