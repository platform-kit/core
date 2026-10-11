/* The spaces: the declaration under content/spaces compiled (build/spaces.mjs), then projected into
   the tables the surface reads (build/spaces-push.mjs). The compile is part of the build; the
   projection needs a database, so it waits for the deploy. */
export const spacesCompileStep = {
  key: 'spaces', title: 'The spaces, compiled', phase: 'functions', module: 'spaces',
  inputs: ['content/spaces/**', 'content/store/products/**', 'supabase/functions/_shared/catalog.json'],
  after: ['catalog'],
  run: ({ script }) => script('spaces.mjs'),
}
export const spacesPushStep = {
  key: 'spaces-push', title: 'The rooms a site declares, made real', phase: 'after', module: 'spaces',
  after: ['push-catalog'],
  needs: { env: ['SUPABASE_SERVICE_ROLE_KEY'] },
  localProjection: true,
  inputs: ['content/spaces/**', 'content/store/products/**'],
  run: ({ script }) => script('spaces-push.mjs'),
}
export default spacesCompileStep
