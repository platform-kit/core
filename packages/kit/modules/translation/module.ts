/* translation: everything it is lives in this folder (openspec: modules-as-packages) */
import type { ModuleDeclaration } from '../../build/modules/manifest.mjs'

export default {
  key: 'translation', what: 'reserved — a coming change', needs: 'not built',
  static: false, git: false, cloud: false,
  owns: {},
} satisfies ModuleDeclaration
