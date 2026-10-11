/* The teams: the declaration under content/teams compiled (build/teams.mjs), then projected into
   the table the booking types and the sweep read (build/teams-push.mjs). The compile is part of the
   build and needs the catalog, because a team's fill may name a tier the site sells; the projection
   needs a database, so it waits for the deploy. */
export const teamsCompileStep = {
  key: 'teams', title: 'The teams, compiled', phase: 'functions', module: 'sessions',
  inputs: ['content/teams/**', 'content/store/products/**', 'supabase/functions/_shared/catalog.json'],
  after: ['catalog'],
  run: ({ script }) => script('teams.mjs'),
}
export const teamsPushStep = {
  key: 'teams-push', title: 'The teams a site declares, made real', phase: 'after', module: 'sessions',
  after: ['push-catalog'],
  needs: { env: ['SUPABASE_SERVICE_ROLE_KEY'] },
  localProjection: true,
  inputs: ['content/teams/**', 'content/store/products/**'],
  run: ({ script }) => script('teams-push.mjs'),
}
export default teamsCompileStep
