/* WHAT MAY BE COMMENTED ON, projected: one row of comment_subjects per thing whose file says it
   takes comments. It runs after the spaces are pushed, because a subject may name a forum channel
   and the channel has to exist to be named — build/comments-push.mjs */
export const commentsPushStep = {
  key: 'comments-push', title: 'What may be commented on', phase: 'after',
  after: ['spaces-push', 'events-push'],
  needs: { env: ['SUPABASE_SERVICE_ROLE_KEY'] },
  localProjection: true,
  inputs: [
    'content/comments.md', 'content/articles/**', 'content/books/**', 'content/wiki/**',
    'content/docs/**', 'content/events/**', 'content/spaces/**',
  ],
  run: ({ script }) => script('comments-push.mjs'),
}
export default commentsPushStep
