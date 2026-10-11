/* The host's rewrite rules, from deploy/_redirects (the one list): dist/_redirects with the project's address filled, for
   Netlify, and the nginx template under deploy/nginx (build/rewrites.mjs); a site with no deploy/_redirects keeps none */
import fs from 'node:fs'
import path from 'node:path'
export default {
  key: 'rewrites', title: 'The rewrite rules', phase: 'site',
  when: (env, site) => fs.existsSync(path.join(site.root || process.cwd(), 'deploy', '_redirects')), whenText: 'the site keeps no deploy/_redirects',
  inputs: ['deploy/_redirects', 'platformkit.config.js'],
  run: ({ script }) => script('rewrites.mjs'),
}
