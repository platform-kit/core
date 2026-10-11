/* The printed books: every edition set, quoted and indexed; the store's art redrawn (build/print.mjs --all).
   Playwright's Chromium first: the pages a listing shows are drawn from the print file by pdf.js in it. */
import { spawnSync } from 'node:child_process'
export default {
  key: 'print', title: 'The printed books', phase: 'functions', module: 'print',
  when: (env) => env.PRINT_BUILD === '1', whenText: 'PRINT_BUILD is not 1',
  inputs: ['content/books/**', 'content/companions/**'],
  needs: { packages: ['@myriaddreamin/typst-ts-node-compiler'] },
  run: ({ script, env, site }) => {
    const r = spawnSync('npx', ['playwright', 'install', 'chromium'], { cwd: site.root, stdio: 'inherit', env: { ...process.env, ...env } })
    if (r.status !== 0) throw new Error('playwright install chromium failed')
    env.PRINT_COMMIT = env.PRINT_COMMIT || '1'   /* a title made at a printer is committed and pushed the moment it is: never made twice */
    return script('print.mjs', ['--all'])
  },
}
