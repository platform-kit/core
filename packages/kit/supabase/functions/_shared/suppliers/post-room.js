/*
 * THE SHOP'S OWN POST ROOM — a supplier that is a shelf and a person.
 *
 * It exists for two reasons. The first is that most shops are this: somebody picks the thing off a
 * shelf, puts it in a jiffy bag and writes the address by hand. A store whose only suppliers are
 * printing APIs cannot describe the commonest shop there is.
 *
 * The second is that it proves the seam. Everything here answers the same interface Lulu answers,
 * and nothing in it knows what a page is — because this supplier has no idea what it is sending.
 * It takes a variant and its artefacts, says it cannot quote and does not need to validate, and
 * then WAITS: an order is `submitted` until a person marks it sent. That waiting is the whole
 * behaviour, and it is exactly what a supplier with no API looks like.
 *
 * It needs no keys, so it is never unconfigured and never mocked: a shelf is always there.
 */
export function postRoom(env) {
  return {
    /*
     * IT MAKES NOTHING, and that is the point of saying so. `providersFor(format)` asks who can
     * MAKE a thing; a post room has no idea what is on the shelf and could not make it if it
     * did. It is chosen by name, by an offer that says this is how it is sent — never offered
     * as an alternative to a printer.
     */
    id: 'post-room', name: 'Our own post room', formats: [], makes: [], sends: true, stateful: false,
    /* the ARTEFACTS it reads from whatever kind it is paired with — a shelf reads nothing: whatever is on it is already made. Matched
       against a kind's `produces` when the shop is configured, never at the till. */
    needs: [],
    keys: [],   /* no account, so nothing to set */
    configured: () => true,
    /* NEVER MOCKED. A mock stands in for a service that is not there; this service is a person,
       and they are there. Saying `mock: true` would make the deploy checks think it was a stub. */
    mock: () => false,
    levels: { standard: 'standard', priority: 'priority', express: 'express' },
    options: () => [
      { key: 'note', label: 'A note for whoever packs it', type: 'text', help: 'printed on the picking slip' },
    ],
    product: ({ chosen = {}, options = {} }) => ({ by: 'post-room', chosen, note: options.note || null }),
    /* no shape to give: a post room does not know what it is sending until it picks it up */
    measure: async () => null,
    /*
     * IT CANNOT QUOTE, AND SAYS SO RATHER THAN GUESSING. A zero here would read as "free" to the
     * storefront and to the admin's quote column alike; null is the honest answer and the caller
     * falls back to the shop's own shipping table, which is where a hand-posted thing is priced.
     */
    quote: async () => null,
    /* nothing to check: there are no files, and the thing is already made */
    validate: async () => ({ ok: true }),
    /*
     * AND THE ORDER IS A NOTE TO A PERSON. It is accepted immediately and goes no further: the
     * status stays `submitted` until somebody in the admin says it has gone. Every other supplier
     * moves itself along; this one is moved.
     */
    order: async ({ externalId }) => ({ id: 'post_' + String(externalId || Date.now()), status: 'submitted', cost: null, waiting: 'a person' }),
    status: async (id) => ({ status: 'submitted', id, tracking: null, cost: null }),
    statusOf: (w) => (['submitted', 'in_production', 'shipped', 'rejected', 'canceled', 'failed'].includes(String(w)) ? String(w) : null),
    webhook: () => null,
    ensureWebhook: async () => null,
  }
}
