/* everything recommendations is lives in this folder (openspec: modules-as-packages) */
import type { ModuleDeclaration } from '../../build/modules/manifest.mjs'

export default {
  key: 'recommendations', what: 'Recommended For You, and the recommendations tab', needs: 'it is derived from what an account has read and bought',
  static: false, git: true, cloud: true,
  owns: {},
} satisfies ModuleDeclaration
