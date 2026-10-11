/*
 * WHO IS HERE — the rule, with nothing else in it.
 *
 * Six modules hold something that belongs to a person: their spaces, their coaching threads, their
 * support threads, the desk's queue, and the two caches of urls signed for them. Each has to be
 * told twice — somebody left, so discard it; somebody arrived, so load it — and getting the second
 * half wrong is invisible, because signing out reloads the page and signing in does not.
 *
 * The rule is small enough to state in three sentences, and all three are the reason this is its
 * own file rather than three lines inside auth.js:
 *
 *   A CHANGE OF PERSON IS A CHANGE OF ID, and nothing else. A refreshed token, a revisited tab and
 *   a re-read of entitlements all arrive with the same id and must tell nobody. Guest is an id
 *   too — null — so guest → person and person → guest are both changes, and the first load of a
 *   page by a guest is a change from "nothing known yet", which is NOT the same as null.
 *
 *   THE READS COME FIRST. begin() marks who the reads are for; settle() broadcasts only once they
 *   have answered, so a module asking what this person may see asks it of a role already in hand.
 *
 *   A LATE ANSWER FOR THE PREVIOUS PERSON IS DROPPED. Somebody signing in twice quickly, or
 *   signing out while their role is still in flight, leaves an in-flight read that must not be
 *   allowed to announce a person who has already gone.
 */

export function identityBus() {
  const hooks = []
  let current                 /* the id the reads were last started for */
  let started = false         /* ...and whether anything has been started at all */

  return {
    /* register; the returned function unregisters */
    on(fn) {
      hooks.push(fn)
      return () => { const i = hooks.indexOf(fn); if (i >= 0) hooks.splice(i, 1) }
    },
    /* Is this somebody new? Marks them as the person the reads are now for, and answers whether
       anything needs doing. The same id twice in a row is a refresh, not an arrival. */
    begin(id) {
      if (started && id === current) return false
      current = id
      started = true
      return true
    },
    /* The reads for `id` have answered. Tells every hook — unless somebody else has begun since,
       in which case this answer is stale and belongs to a person who has already gone. `call` is
       how each hook is invoked, which is the caller's business (detached, and failures swallowed,
       in the app; straight through in a test). */
    settle(id, call) {
      if (!started || current !== id) return false
      for (const fn of hooks.slice()) call(fn, id)
      return true
    },
    /* for a test, and for nothing else */
    _state: () => ({ current, started, hooks: hooks.length }),
  }
}
