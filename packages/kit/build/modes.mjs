/*
 * THE THREE SHAPES A SITE SHIPS IN, AND WHAT EACH ONE CARRIES.
 *
 *   static  a checkout, a build, a static host. No Supabase at all. Only what is a file.
 *   git     a repository and a backend. A publish commits and the commit rebuilds. Everything.
 *   cloud   a backend and no repository. Nothing ever builds again. Everything that needs no build.
 *
 * There are four ARRANGEMENTS and three COLUMNS, which is not a mistake. A backend with content in
 * the checkout and a backend with content in rows and git still in the cycle are different
 * arrangements and identical in what they support, because the question a column asks is *does
 * anything ever rebuild*. Both do. So they share the `git` column, and `deployment.content` is what
 * tells them apart.
 *
 * WHY THIS FILE EXISTS. Five registries each asked one shape's question sideways and none of them
 * named a shape: declarations.mjs (file or row), content-kinds.mjs (editable with no checkout),
 * artefacts.mjs (reaches the functions with no build), deploy-checks.mjs (what the environment
 * needs), and the admin function's MACHINE list (what cloud cannot do). Every one was maintained by
 * memory, and memory failed: print's cloud path was finished, its debt entry stayed for days, was
 * removed in fba547ec — and the same wrong belief was then stated again from recollection alone.
 *
 * So the rule here is one rule: THIS FILE DECLARES THE CLAIM, AND modes.test.mjs DERIVES WHETHER THE
 * CODE BACKS IT. Nothing below is a list of what is broken. A module claiming `cloud` with a
 * projected table and no projected() hook fails; the moment the hook lands it passes, with no list
 * edited by anybody. PROJECTION_DEBT, the FIXED artefacts and MACHINE become outputs of that
 * derivation rather than things to remember.
 *
 * A cell is one of three answers:
 *   true                        it works in that shape
 *   false                       it does not, and is absent — not broken, absent
 *   { kind, except, change, why }
 *                               it works apart from one named operation, and a LIVE change closes
 *                               it. The guard fails when that change is archived with the gap still
 *                               open, so an exception cannot quietly become permanent.
 *
 * `kind` says what sort of gap it is, and that is what decides whether the guard can check it is
 * still owed rather than taking the word of whoever wrote it:
 *   projection  a declaration that does not reach the database on a publish — DERIVED, so a stale
 *               one fails the moment the hook lands
 *   artefact    a compiled file the functions read that a publish cannot change — derived
 *   editing     content with no admin model — derived
 *   machine     an action only a machine runs; declared by a site's own models, so not derived here
 *   browser     it needs a browser, which no Edge Function has; answered by its own change
 */

/* the modules themselves, and the reader that holds them to their shape. Both are pure — no fs, no
   environment — because this file is assembled into the functions' pipe. */
import { MODULES } from './modules/kit.mjs'
import { readManifests } from './modules/manifest.mjs'

export const MODES = {
  static: 'a checkout, a build, a static host — no backend at all',
  git: 'a repository and a backend; a publish commits and the commit rebuilds',
  cloud: 'a backend and no repository; nothing ever builds again',
}

/* the shape's three facts, and what each is worth where it is absent — today's behaviour, so a site
   that declares nothing is the site it already was */
export const DEPLOYMENT_DEFAULTS = { backend: true, content: 'files', repo: true }

const anywhere = { static: true, git: true, cloud: true }
const backed = { static: false, git: true, cloud: true }

/*
 * EVERY MODULE, AND ITS CLAIM IN EACH SHAPE.
 *
 * `needs` is the reason a module cannot be static, in the words a refusal uses — the deploy says
 * "the store is on and there is nowhere to keep an order", never "SUPABASE_URL is missing".
 */
/*
 * EVERY MODULE, AND ITS CLAIM IN EACH SHAPE — READ OFF THE MANIFESTS, not written here.
 *
 * This was a literal of twenty-four entries, and a module was therefore a name in this file as well
 * as in its own. Two places agreeing by hand is the fault the manifests exist to end: the entry and
 * the module could disagree, and whichever was read first won.
 *
 * So the claim now lives with the module that makes it, and this is the same claim in the shape
 * every reader of this file already expects. NOTHING about what is checked moves: modes.test.mjs
 * goes on asking the CODE whether a claim is true, in both directions — a projected table with no
 * hook fails the module that claims cloud, and an exception whose gap has closed fails too. A
 * manifest saying `cloud` does not make it so; it only says where the claim is written down.
 *
 * `needs` is the reason a module cannot be static, in the words a refusal uses — the deploy says
 * "the store is on and there is nowhere to keep an order", never "SUPABASE_URL is missing".
 *
 * A malformed manifest throws here rather than being skipped, because a module quietly missing from
 * the matrix is a module nothing holds to any shape at all.
 */
const KIT = readManifests(MODULES.map((m) => ({ manifest: m, where: 'the kit' })))
if (KIT.faults.length) throw new Error("the kit's module manifests are malformed:\n  " + KIT.faults.join('\n  '))

export const FEATURES = Object.fromEntries(
  [...KIT.modules.values()].map((m) => [
    m.key,
    { static: m.static, git: m.git, cloud: m.cloud, what: m.what, ...(m.needs ? { needs: m.needs } : {}) },
  ]),
)

/*
 * THE CROSS-CUTTING SURFACES — not modules with a switch, but things a shape either carries or does
 * not, and the matrix is worthless if it only answers for the switchable half.
 */
export const SURFACES = {
  accounts: { ...backed, what: 'signing in, profiles, roles', needs: 'there is nobody to sign in' },
  admin: { ...backed, what: 'the admin and everything edited in it', needs: 'the admin is an Edge Function; a static site is edited in its repository' },
  analytics: { ...backed, what: 'events and the dashboards', needs: 'there is nowhere to record an event' },
  comments: { ...backed, what: 'comments and votes', needs: 'there is nowhere to keep a comment' },
  achievements: { ...backed, tables: ['achievements', 'trait_rules'], what: 'awards and traits', needs: 'an award is held on an account' },
  search: { ...anywhere, what: "the palette's search", why: 'the index is built from content, and cloud rebuilds it from the rows at boot — no backend needed for a reader to search' },
  /*
   * A VARIANT IS A FILE, AND WHAT IS LEFT OF ONE IS A ROW.
   *
   * The options, the combinations, the keys and the per-variant price and sku are all DECLARED,
   * so there is nothing about a variant that needs a backend to describe. What needs one is
   * SELLING it — an order has to go somewhere — and that is the store's answer, not a separate
   * one: this is false in static for the store's own reason and no other. Saying it carries a
   * gap of its own was the first draft and was wrong; a count is state, which is not one of the
   * five kinds of gap because it is not a gap, it is a thing a static site does not have.
   *
   * In cloud mode nothing builds and nothing needs to: a picker reads the compiled collection
   * like every other page, and an axis taken from a supplier's catalogue is written by the
   * ADMIN rather than a build step, so adding a colour needs no deploy.
   */
  variants: {
    static: false, git: true, cloud: true,
    what: 'the shapes a thing is sold in, their keys and their prices',
    needs: 'the shapes are declared and need nothing, but selling one puts an order somewhere',
  },  /* THE SERVER-SIDE INDEX IS NOT THE PALETTE. content_search is the table a bot asks, drawn from six
     collections at once, so no single content directory owns it and it is named here instead. A
     reader searching a static site uses the palette and never touches this. */
  'content-index': { ...backed, tables: ['content_search'], what: 'the index a bot searches', needs: 'a server-side index is a table' },
  /* PAID. A record published since the last build still gets its own picture: the prerender sidecar
     photographs the app's own card where one can run, and the share-image function draws it where
     none can — the same faces, the same mark, the same numbers out of SharePage's stylesheet. */
  'share-images': { ...anywhere, what: 'the picture a link shows' },
  /*
   * NOT A MISSING FEATURE — A HOSTING REQUIREMENT, and it carries no change because there is
   * nothing to build.
   *
   * A crawler that runs no JavaScript needs the page rendered for it. The prerender sidecar does
   * that, and a host that can run a container can run it (deploy/nginx, the cloud profile). A host
   * that serves static files and Edge Functions and nothing else cannot, and there a crawler asking
   * for a record published since the last build is served the shell. The PICTURE is still that
   * record's own, because the function draws it; the title and description in the head are the
   * site's defaults.
   *
   * Nothing in the kit can close that. It is closed by choosing a host that will run the sidecar,
   * which is why this says so rather than naming a change that would never land.
   */
  prerender: {
    static: true, git: true,
    cloud: { kind: 'browser', except: "a crawler's own title and description, on a host that cannot run the sidecar", change: null, why: 'rendering a page for a crawler takes a browser; the sidecar is one, and a host that cannot run a container has nowhere to put it' },
    what: 'the baked pages a crawler reads',
  },
}

export const ALL = () => ({ ...FEATURES, ...SURFACES })

/* the answer for one thing in one shape, and what it is worth reading back */
export const cellOf = (name, mode) => {
  const f = ALL()[name]
  if (!f) return null
  return Object.prototype.hasOwnProperty.call(f, mode) ? f[mode] : null
}
export const worksIn = (name, mode) => cellOf(name, mode) !== false && cellOf(name, mode) !== null
export const exceptionOf = (name, mode) => {
  const c = cellOf(name, mode)
  return c && typeof c === 'object' ? c : null
}
/* every gap carried on purpose, printed on every run so the debt is loud rather than quiet */
export const exceptions = () => {
  const out = []
  for (const [name, f] of Object.entries(ALL())) {
    for (const mode of Object.keys(MODES)) {
      const c = f[mode]
      if (c && typeof c === 'object') out.push({ name, mode, ...c })
    }
  }
  return out
}

/* which shape a resolved deployment is: the column the matrix is read by */
export const modeOf = ({ backend = true, repo = true } = {}) => (!backend ? 'static' : repo ? 'git' : 'cloud')
