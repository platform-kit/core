/* The courses a site declares, projected into the tables the database answers readers from (./push.mts).
   The projection needs a database, so it waits for the deploy, as the teams' does. */
import { fileURLToPath } from 'node:url'

export default [{
  key: 'courses-push', title: 'The courses a site declares, made real', phase: 'after', module: 'courses',
  after: ['push-catalog'],
  needs: { env: ['SUPABASE_SERVICE_ROLE_KEY'] },
  localProjection: true,
  inputs: ['content/courses/**'],
  run: ({ script }: any) => script(fileURLToPath(new URL('./push.mjs', import.meta.url))),
}]
