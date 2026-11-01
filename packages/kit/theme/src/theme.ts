/* Movable Types's manifest — what the kit reads about the theme, and the contract a second theme
   meets by exporting the same shape from its own theme.js (reached as <theme>/theme.js). Paths are
   relative to this file. The components are not listed here: the kit reads every .vue under src as
   the registry, by file name — which is why every component's name is unique across the theme — and
   a site overrides one by that name in platformkit.config.js (`overrides: { SiteClose: './src/…' }`). */
export default {
  name: 'movable-types',
  /* the entry a site's main.js imports */
  main: './main.js',
  /* the landing sections' schemas (the page builder's forms, the admin server's validation) */
  schemas: './components/landing/schemas.js',
  /* the one design every look shares */
  design: './looks/design.css',
  /* THE THEME'S OWN PALETTE, worn by a site that registers none. The theme ships a working site
     missing only its content, and until this existed it shipped a site missing its colours —
     every token empty, and the landing's button drawing its text in the colour of its own
     background. A site that registers a look overrides this; the two are layers, not
     alternatives. */
  look: { name: 'default', css: './looks/default.css' },
  /* where the theme's default strings live (a site's content/app/ui/*.md are merged over them by key) */
  strings: './content/ui',
  /* the theme's default SKILLS — what a bot knows before a site has taught it anything. A site's
     content/skills/<name>.md replaces one of the same name outright (a skill is a piece of prose
     and half of somebody else's advice is worse than none), and anything it adds is its own. */
  skills: './content/skills',
  /* optional theme-owned module declarations, resolved alongside the site's build.modules */
  modules: [],
  /* what the phone probe lets run to the edge on purpose: rails, shelves, the ground's blobs, the sun, cover art, the widget */
  /* A carousel's neighbouring slides (.lpcr-stage) sit off the page either side on purpose — that is
     what an arc or a coverflow IS, and they are the exception the design rule already allows for a
     horizontal rail. A code block and a wide table scroll sideways on purpose; a ticker (.tk) runs
     past the edge by design. Nothing else: a product rail looked like the same exception and was a
     snap eating the gutter, which is the kind of thing this list must not be used to hide. */
  probe: {
    allow: ['.rail', '.lpt-shelf', '.lpmq', '.lpblobs', '.ac-sun', '.rd-covart', '.sw', '.tk', '.lpcr-stage', 'pre', 'table'],
    /* the scrollers: their cards may leave on the RIGHT and come back with a swipe, and they keep
       their left gutter like everything else */
    rails: ['.lppd-rail'],
  },
}
