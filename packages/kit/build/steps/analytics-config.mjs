/* The analytics config beside the functions: a site's own events and the drop-in script's sources (build/analytics-config.mjs) */
export default {
  key: 'analytics-config', title: 'The analytics config', phase: 'functions',
  inputs: ['platformkit.config.js'],
  run: ({ script }) => script('analytics-config.mjs'),
}
