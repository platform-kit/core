/*
 * PRINT WORKS IN THE CLOUD, PICTURES AND ALL, and this is the claim the whole derivation is tested
 * with — because a debt that has been PAID and is still listed is the exact failure it prevents.
 * That happened: print's cloud path was finished, its entry sat on the debt list for days, and the
 * same wrong belief was then repeated from recollection alone.
 *
 * Every action on the print model branches on `ctx.editions`, the admin's Edge Function hands it
 * in, and print-render does the rendering over the print bucket. It carried a `browser` exception
 * for the three pages of the interior a listing shows, and closing that turned up two more of the
 * same kind nothing had noticed: the cover the shop draws the book from was not made either (the
 * WASM compiler cannot write SVG), and a book set in the cloud never reached the store at all,
 * because print.json is derived and the live layer only refreshes collections.
 *
 * All three are one shape of gap — something a BROWSER has to do, in a mode whose whole point is
 * that no build box exists. The answer is that there IS a browser: the administrator's, in front of
 * the button they just pressed. print-render hands it what the document says about itself and takes
 * back the pictures it drew.
 */
/* everything print is lives in this folder (openspec: modules-as-packages) */
import type { ModuleDeclaration } from '../../build/modules/manifest.mjs'

export default {
  key: 'print', what: 'books in print: editions, covers, quotes, orders', needs: 'an order has nowhere to go and no printer to go to',
  static: false, git: true, cloud: true,
  fills: {
    /* the print editions: every book in print and the files it makes, a book at its own address */
    'core:admin-screen': [{ key: 'print', component: './ui/admin/PrintScreen.vue', path: true, bare: true }],
    'core:admin-rail': [{ key: 'print', sec: 'store', beforeItem: 'sessions', icon: '<path d="M5 3.5h8l2.5 2.5v10.5H5Z"/><path d="M13 3.5V6h2.5"/><path d="M7.5 9h5M7.5 11.5h5M7.5 14h3"/>' }],
  },
  owns: { steps: ['lulu-webhook', 'print-type', 'print'], env: ['LULU_CLIENT_KEY', 'LULU_CLIENT_SECRET', 'MIXAM_USER', 'MIXAM_PASS', 'BOOKVAULT_API_KEY', 'PRINT_MOCK'],
    /* a set is a job that outlives its request: the rows, their lease, and the sweep that picks up a lapsed one */
    cron: [{ name: 'print-jobs', schedule: '* * * * *', command: 'select public.run_print_jobs();' }], },
} satisfies ModuleDeclaration
