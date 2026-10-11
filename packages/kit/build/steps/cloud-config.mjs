/* Where cloud mode publishes to, declared rather than clicked (build/cloud-config.mjs) */
export default {
  key: 'cloud-config', title: 'Where cloud mode publishes to', phase: 'functions',
  inputs: ['platformkit.config.js'],
  run: ({ script }) => script('cloud-config.mjs'),
}
