/*
 * THE PRESS'S OWN MODULE — stockists: the shops that carry Northlight books.
 *
 * It is not one of the kit's. Northlight added it in its own tree, and it behaves exactly as one of
 * the kit's does: a switch in the config, a row in the deployment matrix, its route answered and
 * prerendered, its build step run in its phase, its setting asked for at deploy — and all of it
 * taken away again when the switch says false. No file of the kit or the theme was edited to allow
 * any of it.
 *
 * WHAT A MANIFEST SAYS
 *
 *   key      the name of the switch: `modules.stockists` in platformkit.config.js
 *   what     one line, for the deployment matrix and the deploy's reports
 *   needs    why it cannot work in a shape it answers `false` for, in the words a refusal uses
 *   static / git / cloud
 *            its answer in each deployment shape — all three, always, in the commit that adds it
 *   owns     what switching it off takes away. Exclusive, except `env`: a secret belongs to the
 *            deployment, and several modules may need the same one.
 *   requires what it cannot work without, and why. The dependent declares it, so the other module
 *            never has to know who uses it.
 */
export default {
  key: 'stockists',
  what: 'the shops that carry the books, and where to find them',
  needs: 'the list is files in the checkout, so there is nothing it needs kept anywhere',
  static: true,
  git: true,
  cloud: true,
  requires: [{ module: 'books', why: 'a stockist carries the books — with no books there is nothing for a shop to stock' }],
  owns: {
    routes: ['/stockists'],
    steps: ['stockists'],
    admin: ['stockists'],
    env: ['STOCKISTS_DISTRIBUTOR'],
  },
}
