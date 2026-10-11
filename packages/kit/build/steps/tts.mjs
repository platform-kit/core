/* The spoken books: the repository's store brought to the production bucket — only what the bucket lacks is fetched
   from LFS and uploaded — and a book with no recordings yet spoken here, each recording landing in the bucket the
   moment it is done (build/tts.mjs --all); then the voice's weights into the models bucket, the browser's fallback
   (build/tts/setup.mjs --mirror). Off unless TTS=1: speaking a library takes hours, longer than a deploy is allowed. */
export default {
  key: 'tts', title: 'The spoken books', phase: 'after', module: 'tts', after: ['funnels-run'],
  when: (env) => env.TTS === '1', whenText: 'TTS is not 1',
  inputs: ['content/books/**', 'content/companions/**', 'audio/books/**'],
  needs: { env: ['SUPABASE_SERVICE_ROLE_KEY', 'SUPABASE_URL'], tools: ['git-lfs'], packages: ['onnxruntime-node', 'ffmpeg-static'] },
  run: ({ script }) => script('tts.mjs', ['--all']) && script('tts/setup.mjs', ['--mirror']),
}
