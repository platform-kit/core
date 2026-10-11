/*
 * A SUPPLIER THIS SITE ADDED, and nothing in the kit knows it exists.
 *
 * Northlight Press has a bindery down the road that makes short runs by hand. It is not a printing
 * API, it has no account and no webhook, and it would never be worth a module in the kit — which is
 * exactly why it is here. The claim the supplier seam makes is that a shop can add one, and a claim
 * like that is worth what the thing proving it is worth.
 *
 * It answers the same interface Lulu answers. It takes a variant and its artefacts; it does not
 * know what a page is, and does not need to — the bindery is told the page count because a book's
 * kind put it in the artefacts, and a shop binding something else would put something else there.
 *
 * `keys` is how the deploy refuses before it starts: with no BINDERY_EMAIL this supplier cannot
 * send anybody anything, and finding that out at the till is finding it out too late.
 */
export function bindery(env) {
  const configured = () => !!env('BINDERY_EMAIL')
  return {
    id: 'bindery', name: 'The bindery on Mill Lane',
    makes: ['softcover', 'hardcover'], sends: true, stateful: false,
    /* the ARTEFACTS it reads: a bindery is handed made pages and binds them, so it asks for the
       same files a printer does and nothing else. A SITE declares this exactly as the kit's own
       suppliers do, and the registry checks both the same way — which is the only way the seam
       is real rather than a shape the kit's five happen to share. */
    needs: ['files'],
    keys: ['BINDERY_EMAIL'],
    configured,
    mock: () => !configured(),
    levels: { standard: 'post', priority: 'courier', express: 'courier' },
    options: () => [
      { key: 'thread', label: 'Sewn with', type: 'select', choices: [{ value: 'linen', label: 'Linen thread' }, { value: 'cotton', label: 'Cotton thread' }], default: 'linen' },
    ],
    product: ({ chosen = {}, options = {} }) => ({ by: 'bindery', chosen, thread: options.thread || 'linen' }),
    measure: async () => null,
    /* a hand bindery charges by the hour and quotes by eye: it will not pretend otherwise */
    quote: async () => null,
    validate: async ({ artefacts = {} }) => (artefacts.files ? { ok: true } : { ok: false, errors: ['there is nothing to bind'] }),
    order: async ({ externalId }) => ({ id: 'bind_' + String(externalId || Date.now()), status: 'submitted', cost: null, waiting: 'the bindery' }),
    status: async (id) => ({ status: 'submitted', id, tracking: null, cost: null }),
    statusOf: (w) => (['submitted', 'in_production', 'shipped', 'rejected', 'canceled', 'failed'].includes(String(w)) ? String(w) : null),
    webhook: () => null,
    ensureWebhook: async () => null,
  }
}

/*
 * A SECOND ONE, which publishes a catalogue — and so proves the other half of the seam.
 *
 * Ridgeway Garments prints shirts on demand. The thing that makes it different from the bindery
 * is not the goods: it is that the SHOP DOES NOT KNOW WHAT IT SELLS until it asks. Which colours
 * and sizes exist is Ridgeway's to say, it changes without telling anybody, and a shop that types
 * them in by hand is a shop that goes on selling a colour nobody makes any more.
 *
 * So it answers `catalogue()`, and `platformkit`'s refresh writes what comes back into the
 * product's file as ordinary option rows marked `from: ridgeway`. A value Ridgeway drops is marked
 * `gone` rather than deleted — off sale at once, and a cart line naming it still reads as the
 * words the buyer chose.
 *
 * `catalogue()` is the ONE optional method on a supplier, because most publish none: a printer
 * makes what it is sent and has no opinion about colours. Do not confuse it with `options(format)`,
 * which is the SHOP's choices about how a thing is made and is drawn in the admin.
 *
 * The catalogue here is a fixture — a real one is a fetch, and this site has no account. What is
 * NOT a fixture is the shape it answers in, which is the whole of what the seam promises.
 */
const RANGE = {
  colour: [
    { value: 'black', label: 'Black' },
    { value: 'oat', label: 'Oatmeal' },
    /* Slate blue was a run they are not repeating. It is absent HERE and marked `gone` in the
       product's file — which is the state worth shipping in a demo, because it is the one every
       shop that sells somebody else's goods ends up in and the one nothing else models. */
  ],
  size: [
    { value: 's', label: 'S' },
    { value: 'm', label: 'M' },
    { value: 'l', label: 'L' },
    { value: 'xl', label: 'XL' },
  ],
}

export function ridgeway(env) {
  const configured = () => !!env('RIDGEWAY_API_KEY')
  return {
    id: 'ridgeway', name: 'Ridgeway Garments', sends: true, stateful: false,
    makes: ['shirt', 'hoodie'],
    /* the ARTEFACTS it reads: the artwork a kind made for this variant, placed on the garment.
       No page count anywhere — which is the point: this supplier could not be written at all
       while the interface said `pages` and `files`. */
    needs: ['artwork'],
    keys: ['RIDGEWAY_API_KEY'],
    configured,
    mock: () => !configured(),
    levels: { standard: 'ECONOMY', priority: 'STANDARD', express: 'EXPRESS' },
    /* THE SHOP's choices about how it is made — the admin's tab, not the buyer's */
    options: () => [
      { key: 'finish', label: 'Print finish', type: 'select', choices: [{ value: 'dtg', label: 'Direct to garment' }, { value: 'screen', label: 'Screen print' }], default: 'dtg', help: 'screen is cheaper over about fifty' },
    ],
    /* THE BUYER's axes, which are Ridgeway's to say. `chosen` is what the product already holds,
       so a real one could narrow the range to a blueprint the shop picked. */
    catalogue: async () => [
      { name: 'Colour', values: RANGE.colour },
      { name: 'Size', values: RANGE.size },
    ],
    product: ({ chosen = {}, options = {} }) => ({ by: 'ridgeway', chosen, finish: options.finish || 'dtg' }),
    measure: async () => null,
    quote: async ({ quantity = 1, level = 'standard' }) => ({
      print: 1150 * quantity, shipping: level === 'express' ? 1400 : 495, currency: 'USD', days: level === 'express' ? 3 : 8,
    }),
    validate: async ({ artefacts = {} }) => (artefacts.artwork ? { ok: true } : { ok: false, errors: ['there is no artwork to print'] }),
    order: async ({ externalId }) => ({ id: 'rg_' + String(externalId || Date.now()), status: 'submitted', cost: null }),
    status: async (id) => ({ status: 'in_production', id, tracking: null, cost: null }),
    statusOf: (w) => ({ submitted: 'submitted', in_production: 'in_production', dispatched: 'shipped', refused: 'rejected' })[String(w)] || null,
    webhook: (body) => (body && body.reference) || null,
    ensureWebhook: async () => null,
  }
}
