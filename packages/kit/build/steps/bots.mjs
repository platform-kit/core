/*
 * THE BOTS, TOOLS AND COMMANDS A SITE DECLARES, compiled into four files: the worker's two (the
 * bots with their prompts, the commands with theirs) and the browser's two (`.velite/agents.json`,
 * `.velite/commands.json` — enough to offer a bot and draw a command's form, and deliberately not
 * the prompts).
 *
 * It runs in PREPARE, beside the funnels, and not in `functions` — because velite's clean wipes
 * `.velite` and only the prepare phase runs again after it. A compile that writes there and runs
 * later is a compile whose output the dev server never has: the composer offers no commands, the
 * mention list no bots, and nothing says why. The funnels step has the same shape for the same
 * reason.
 *
 * The module is off by default: a site with no bots ships no bots.
 */
export const botsStep = {
  key: 'bots', title: 'The bots, compiled', phase: 'prepare', module: 'bots',
  inputs: ['content/bots/**', 'content/tools/**', 'content/commands/**'],
  run: ({ script }) => script('bots.mjs'),
}
/* and the bots themselves into the table the database asks when somebody summons one — a
   projection, one way, the files owning it */
export const botsPushStep = {
  key: 'bots-push', title: 'The bots a site declares, made summonable', phase: 'after', module: 'bots',
  after: ['spaces-push'],
  needs: { env: ['SUPABASE_SERVICE_ROLE_KEY'] },
  localProjection: true,
  inputs: ['content/bots/**', 'content/tools/**', 'content/commands/**'],
  run: ({ script }) => script('bots-push.mjs'),
}
export default botsStep
