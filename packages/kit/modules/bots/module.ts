/* everything bots is lives in this folder (openspec: modules-as-packages) */
import type { ModuleDeclaration } from '../../build/modules/manifest.mjs'

export default {
  key: 'bots', what: 'bots, tools and commands', needs: 'an agent run is rows and a function',
  static: false, git: true, cloud: true,
  pages: [
    { name: 'VoicePage', order: 40, page: './ui/VoicePage.vue', test: 'platformkit/lib/page-routes.js#voice', keyBy: 'route' },
  ],
  owns: {
    steps: ['bots', 'bots-push'],
    cron: [
      { name: 'agents-sweep', schedule: '* * * * *', command: 'select public.run_agents();' },
      { name: 'agents-schedule', schedule: '*/5 * * * *', command: 'select public.run_agent_schedules();' },
    ],
  },
} satisfies ModuleDeclaration
