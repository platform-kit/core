/*
 * A DOWNLOAD — a supplier that has already finished.
 *
 * The other end of the range from the post room, and here for the same reason: it proves the seam
 * by being as unlike a printer as a supplier can be. Nothing is made, nothing is sent, nobody
 * packs anything. The moment it is paid for it is done.
 *
 * Which makes it worth having rather than special-casing. A download handled OUTSIDE the supplier
 * seam would need its own branch in every place an order is read: the admin's list, the status
 * words, what counts as outstanding, what a customer is shown. As a supplier it is a row like any
 * other that happens to be `shipped` on arrival, and every one of those surfaces needs no branch
 * at all.
 *
 * It needs no keys. The files are the kind's artefacts and are already in the bucket.
 */
export function download(env) {
  return {
    /* it MAKES a file, in the sense that asking for one is how you get one; it sends nothing */
    id: 'download', name: 'A download', formats: ['pdf', 'epub'], makes: ['pdf', 'epub'], sends: false, stateful: false,
    /* the ARTEFACTS it reads from whatever kind it is paired with — the files are the whole of it. Matched
       against a kind's `produces` when the shop is configured, never at the till. */
    needs: ['files'],
    keys: [],   /* no account, so nothing to set */
    configured: () => true,
    mock: () => false,
    /* nothing travels, so no shipping word means anything here */
    levels: { standard: null, priority: null, express: null },
    options: () => [],
    product: ({ chosen = {} }) => ({ by: 'download', chosen }),
    measure: async () => null,
    /* FREE TO SUPPLY, which is a real zero rather than an unknown — the file costs nothing to send
       and nothing to make again. The post room's null and this zero are different answers and the
       difference matters: one means "ask somebody else", the other means "nothing". */
    quote: async () => ({ print: 0, shipping: 0, currency: 'USD', days: 0 }),
    /* the files are the kind's artefacts; a download with none is the one thing that can be wrong */
    validate: async ({ artefacts = {} }) => {
      const files = artefacts.files || {}
      const has = Object.values(files).filter(Boolean).length
      return has ? { ok: true } : { ok: false, errors: ['there is no file to give them'] }
    },
    /* DONE ON ARRIVAL. Not "submitted and then shipped a moment later" — there is no moment. */
    order: async ({ externalId }) => ({ id: 'dl_' + String(externalId || Date.now()), status: 'shipped', cost: { print: 0, shipping: 0, currency: 'USD' } }),
    status: async (id) => ({ status: 'shipped', id, tracking: null, cost: null }),
    statusOf: (w) => (['submitted', 'in_production', 'shipped', 'rejected', 'canceled', 'failed'].includes(String(w)) ? String(w) : null),
    webhook: () => null,
    ensureWebhook: async () => null,
  }
}
