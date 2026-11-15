/* everything events is lives in this folder (openspec: modules-as-packages) */
import type { ModuleDeclaration } from '../../build/modules/manifest.mjs'

export default {
  key: 'events', what: 'what is on, and who says they are coming', needs: 'there is nowhere to keep who is coming',
  /* an event's audience and its place's entry rule are the community's, and an event happens in a space or beside one */
  requires: [{ module: 'spaces', why: 'an event is the community\u2019s: its place, its rooms and its audience are the spaces\u2019' }],
  static: false, git: true, cloud: true,
  owns: {
    steps: ['events', 'events-push'],
    cron: [{ name: 'event-reminders', schedule: '*/5 * * * *', command: 'select public.run_event_reminders()' }],
  },
} satisfies ModuleDeclaration
