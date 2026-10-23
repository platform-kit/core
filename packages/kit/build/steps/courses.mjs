/* The courses a site declares, projected into the tables the database answers readers from (build/courses-push.mjs).
   The projection needs a database, so it waits for the deploy, as the teams' does. */
export default {
  key: 'courses-push', title: 'The courses a site declares, made real', phase: 'after', module: 'courses',
  after: ['push-catalog'],
  needs: { env: ['SUPABASE_SERVICE_ROLE_KEY'] },
  localProjection: true,
  inputs: ['content/courses/**'],
  run: ({ script }) => script('courses-push.mjs'),
}
