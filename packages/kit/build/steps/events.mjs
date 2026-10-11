/* WHAT IS ON, in two halves like the spaces: the files compiled into what the site draws, and then
   — once there is a database to write to — the occurrences expanded from each repeat over a rolling
   year. The compile is part of the build; the projection needs the spaces to exist first, because
   an event belongs to one. */
export const eventsCompileStep = {
  key: 'events', title: 'What is on, compiled', phase: 'functions', module: 'events',
  inputs: ['content/events/**', 'content/spaces/**', 'content/store/products/**'],
  run: ({ script }) => script('events.mjs'),
}
export const eventsPushStep = {
  key: 'events-push', title: 'The calendar, made real', phase: 'after', module: 'events',
  after: ['spaces-push'],
  needs: { env: ['SUPABASE_SERVICE_ROLE_KEY'] },
  localProjection: true,
  inputs: ['content/events/**', 'content/spaces/**', 'content/store/products/**'],
  run: ({ script }) => script('events-push.mjs'),
}
export default eventsCompileStep
