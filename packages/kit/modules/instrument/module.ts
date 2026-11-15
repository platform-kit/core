/* everything instrument is lives in this folder (openspec: modules-as-packages) */
import type { ModuleDeclaration } from '../../build/modules/manifest.mjs'

export default {
  key: 'instrument', what: 'a site\'s own readings', needs: 'an answer is written to an account',
  /* the instrument runs on the forms module's runner — one without the other cannot serve. The
     DEPENDENT declares it, so forms need not know who uses it. */
  requires: [{ module: 'forms', why: 'the instrument runs on the forms module\u2019s runner \u2014 one without the other cannot serve' }],
  static: false, git: true, cloud: true,
} satisfies ModuleDeclaration
