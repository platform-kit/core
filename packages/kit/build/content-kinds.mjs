/*
 * Every kind of thing that lives under content/, and how it reaches the site.
 *
 * ONE QUESTION DECIDES WHETHER A CONTENT TYPE IS FINISHED: with no checkout — cloud mode, where
 * every file is a row of public.content — can somebody still CHANGE it? If the answer is no, the
 * type is half-built, however well the rest of it works: the rows exist, the compile reads them,
 * a publish would push them, and nothing on earth can edit them short of writing SQL.
 *
 * This file exists because that mistake is invisible from a developer's machine, where there is
 * always a checkout and always an editor. It was made four times in one night — bots, commands,
 * tools and events all shipped with a working compile and no way to edit them — and prose in
 * AGENTS.md did not stop it. So every directory under content/ must appear here, which means
 * adding one is answering the question in the same commit, and content-kinds.test.mjs refuses a
 * directory that appears in neither list.
 *
 * Each record says:
 *   model       the admin model that edits it (build/models/core/, or a site's own). This is the
 *               one that matters: no model, no editing without a checkout.
 *   collection  the velite collection it compiles to, where the site renders it. Optional —
 *               plenty of content is compiled by a build script instead and never enters velite.
 *   why         for a record with no model: the reason, which must be a reason and not a shrug.
 *   pending     a gap being carried on purpose, naming what will close it. Printed every run so
 *               the debt is loud rather than quiet.
 *
 * The other half of the same rule — that a build script reads content through the STORE and never
 * through fs, or it works on a laptop and not in the cloud — is checked by the same test, because
 * the two halves fail together and are one idea.
 */

/* edited in the admin, so a cloud-only site can change it */
export const KINDS = {
  'content/articles':          { model: 'articles', collection: 'articles' },
  'content/wiki':              { model: 'wiki', collection: 'wiki' },
  'content/docs':              { model: 'docs', collection: 'docs' },
  'content/books':             { model: 'books', collection: 'books' },
  'content/companions':        { model: 'companions', collection: 'companions' },
  'content/ads':               { model: 'ads', collection: 'ads' },
  'content/pages':             { model: 'pages', collection: 'pages' },
  'content/experiments':       { model: 'experiments', collection: 'experiments' },
  'content/achievements':      { model: 'achievements', collection: 'achievements' },
  'content/sessions':          { model: 'sessions', collection: 'sessions' },
  'content/spaces':            { model: 'spaces', collection: 'spaces' },
  'content/teams':             { model: 'teams', collection: null },
  'content/store':             { model: 'storefront', collection: 'storefront' },
  'content/store/products':    { model: 'products', collection: 'products' },
  'content/store/collections': { model: 'collections', collection: 'collections' },
  'content/store/prices': { model: 'prices', collection: 'prices' },
  'content/store/promotions': { model: 'promotions', collection: 'promotions' },
  'content/forms':             { model: 'forms', collection: 'forms' },
  'content/funnels':           { model: 'funnels' },
  'content/blasts':            { model: 'blasts' },
  'content/emails':            { model: 'emails' },
  'content/models':            { model: 'models' },
  'content/app/ui':            { model: 'strings', collection: 'ui' },
  /* THE SINGLE FILES AT CONTENT'S ROOT. They are here for the same reason the directories are, and
     they were not: the test walked directories alone, so content/providers.md shipped with a working
     projection, a working policy and no way at all to edit it without a checkout. A file is as easy
     to forget as a folder and harder to notice. */
  'content/site.md':           { model: 'site', collection: 'site' },
  'content/comments.md':       { model: 'comment-policy' },
  'content/community.md':      { model: 'community' },
  'content/providers.md':      { model: 'providers' },
  'content/traits.md':         { model: 'traits' },
  'content/tags.md':           { model: 'tags' },
  'content/events':            { model: 'events', collection: 'events' },
  'content/bots':              { model: 'bots', collection: 'bots' },
  'content/commands':          { model: 'commands', collection: 'commands' },
  'content/tools':             { model: 'tools', collection: 'tools' },
  'content/skills':            { model: 'skills', collection: 'skills' },
}

/* under content/, and deliberately not a record anybody edits as text */
export const NOT_RECORDS = {
  'content/uploads': { why: 'the media library. A file here is addressed, never edited as text — Content → Media is its surface, and it has the same cloud path through the bucket' },
  'content/app':     { why: 'a folder of folders: content/app/ui is the strings model, and a site\'s own tests and copy are its own models (platformkit.config.js admin.models)' },
  'content/strings': { why: 'the i18next catalogs for long-form site copy, which are edited as translations rather than records', pending: 'a translations surface; today a site with no checkout cannot change them' },
}

/*
 * WHERE fs IS FORBIDDEN, and where it is not.
 *
 * Not everywhere. In cloud mode the deploy exports every row to a file before the build, so a
 * BUILD script may read content with fs and be perfectly correct. The place fs cannot go is the
 * admin's PIPE — the files copied into the `admin` Edge Function (build/pipe-closure.mjs), where
 * there is no filesystem at all and content is only ever rows.
 *
 * So the test computes that closure rather than guessing from the outside. An earlier version of
 * this guard flagged every build script that mentioned a content path and produced three false
 * alarms on its first run; a guard that cries wolf is one people learn to ignore, which is worse
 * than no guard.
 *
 * MAY_USE_FS is for a file IN the pipe that reaches the filesystem on purpose — the store's own
 * halves, and the bridge between rows and files.
 */
export const MAY_USE_FS = {
  /* THE 'fs' HERE IS A PARAMETER, not an import — the file has none. `fileCache` is the CLI's
     backing and is handed fs and path by the script; `runCache`, which is the one a function uses,
     writes the agent run's own state and touches nothing. The module refuses outright when it is
     asked for a file cache with no fs, so the case this guard is really about cannot happen here. */
  'build/enrich-cache.mjs': "the file backing takes fs as a parameter; the cloud backing is the run's own row, and the module refuses a file cache where there is no fs",
  /* IN THE PIPE FOR THE BUNDLER ALONE. catalog.mjs names it as a literal `import('./fonts.mjs')`
     inside its CLI guard, and the edge runtime resolves a literal specifier whether the branch runs
     or not — so the file has to be there or the runtime will not boot. Nothing in the function calls
     it: the three faces, the mark and the accent arrive compiled, as pipe/theme-brand.json. */
  'build/fonts.mjs': 'copied so the runtime can resolve catalog.mjs\'s literal import; never called there — the function reads theme-brand.json',
  /* AND THE FILE fonts.mjs ITSELF NAMES. fontsOf() reaches the site's chosen faces through a literal
     import('./site-fonts.mjs'), so the closure carries that too, for the same reason and on the same
     terms: the faces are needed to write the HTML head, which only happens where there IS a
     checkout. In cloud mode nothing rebuilds, so the head was written by the last build that ran. */
  'build/site-fonts.mjs': "read by fonts.mjs, which the function never calls; the faces are needed to write the head, and a head is only ever written where there is a checkout",
  /* the store's own three: one of them has to be the filesystem or there is no filesystem half */
  'build/store/index.mjs': 'the store itself — the thing everything else goes through',
  'build/store/git.mjs':   "the store's git half: it IS the filesystem, for a site that has one",
  'build/store/rows.mjs':  "the store's cloud half",

  /* a module with BOTH halves. The fs path is the one a checkout takes; the store path is the one
     the function takes. Each of these was read and the store path confirmed — an entry here is a
     claim about a file, not a way of quietening the check. */
  'build/strings-io.mjs':  'readSiteScopes() is the store; readScopes() reads the THEME\'s own defaults, which in the function are handed in as theme-strings.json instead',
  'build/bots.mjs':        "readSkills() takes the site's skills through the store; the fs branch reads the THEME PACKAGE's own defaults, which in the function are handed in as theme-skills.json instead (assemble.mjs bundles them, the admin function passes them as themeSkills) — the same arrangement strings-io has, and checked the same way: the function's path was run, not assumed",
  'build/assets.mjs':      'resolveAsset() caches a remote file to disk for a build; the pipe imports only addressOf() and assetUsage(), which are pure',
  'build/models.mjs':      'reads and writes the derived models JSON under dist — a build output, never content',
  'build/product-keys.mjs': 'the store is its read; the fs half is the command-line pass over a checkout',

  /* not content at all, and in the function not reached */
  'build/theme.mjs':       "the theme PACKAGE's own files (its manifest, its overrides), which ship with the code and are never a row",
  'build/tts/storage.mjs': 'reads .env on a machine that has one; in a function the environment is the environment',
  'build/spaces-disk.mjs': 'the three things the spaces compile wants from a disk, in one place so spaces.mjs wants none: the catalog and the forms it checks a declaration against (both the BUILD\'s own outputs, never content) and its own output file. On the publish path spaces.mjs takes all three as data and never reaches for this module — st.kind === \'rows\' is the branch, and the projection writes to the database rather than a file',
  'build/write-if-changed.mjs': 'writes a build output only where the bytes differ, so the watched edge runtime is not restarted for nothing; reached only from the machine side of a compile',

  /* by design, and said so */
  'build/models/core/print.mjs': 'an edition is rendered by Typst, sharp and a headless browser on a machine that has them; a cloud-only site cannot set one at all, which is the point of the print work in the cloud-parity change rather than something to paper over here',

  /* DEGRADED IN CLOUD MODE, and the one entry here that is a defect rather than a design.
     areaList() walks content/app/tests/diagnostics with readdirSync, so in a function it returns
     nothing: a companion's area field offers no choices and validates against nothing. It is sync
     because zod schemas are built from it and a schema cannot await. Named by the cloud-parity
     change; until that lands the failure is silent, which is why it is written down here. */
  'build/quiz-io.mjs':     'areaList() is sync because zod schemas are built from it and a schema cannot await, so it reads the diagnostics directory and returns [] in a function. It no longer VALIDATES anything there: the companions model checks its premise area through areaListOf(store), which is async and works either side. What is left of the sync list is the schema\'s choices, and the pipe answers those from the store too.',
}

/* the files above that are known to be WRONG rather than fine, printed every run so the debt stays
   loud in the way declarations.mjs keeps its own */
export const FS_DEBT = {
}

/*
 * WHAT CANNOT PROJECT WITHOUT A MACHINE IS NOT A LIST ANY MORE.
 *
 * A projected table needs its model to carry `projected(ctx)`, or the declaration never reaches the
 * database on a deployment that does not build (cloud mode, repository out of the cycle, no deploy
 * hook). There was a hand-written PROJECTION_DEBT here naming the ones that could not — spaces,
 * events, bots, achievements, the search index — and it is gone, along with the habit it encoded.
 *
 * It is gone because a hand-written list is a second opinion, and the second opinion is the one that
 * goes stale: print's entry outlived its finished cloud path by days, was then read back off the
 * list, and repeated as fact. The question is now worked out from the code in two places that cannot
 * disagree with it — the check below, which requires the hook of every projected table a model owns,
 * and build/modes.test.mjs, which requires it of every module claiming `cloud`. A gap carried on
 * purpose is declared in build/modes.mjs as an exception with its kind and the change that closes
 * it, and the guard holds you to that: an exception whose change is archived with the gap still open
 * fails the run. Do not reintroduce a list here.
 */

export const allKinds = () => ({ ...KINDS, ...NOT_RECORDS })
/* what is owed: a kind carrying a named gap */
export const pendingOf = () => Object.entries(allKinds()).filter(([, v]) => v && v.pending)
