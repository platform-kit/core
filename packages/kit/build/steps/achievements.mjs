/* WHAT CAN BE EARNED AND WHAT AN EVENT MEANS, projected: content/achievements/*.md into the
   achievements, content/traits.md into the trait rules and the one setting saying who may look.
   Nothing it writes is anybody's badge — those are acts, written by the trigger on the event
   stream, and a projection has no business rewriting somebody's past — build/achievements-push.mjs */
export const achievementsPushStep = {
  key: 'achievements-push', title: 'What can be earned', phase: 'after',
  needs: { env: ['SUPABASE_SERVICE_ROLE_KEY'] },
  localProjection: true,
  inputs: ['content/achievements/**', 'content/traits.md'],
  run: ({ script }) => script('achievements-push.mjs'),
}
export default achievementsPushStep
