/* NO MODULE CARRIES AN EXCEPTION ANY MORE. Enrichment was the last one: the cache, the store and
   the worker branch that walks the stages inside a run are all done, proved by one book enriched
   end to end in cloud mode. A run in the cloud
   writes a DRAFT, which is where the discipline lives — nobody sees a generated companion until
   an administrator publishes it.
   WHAT FORCED THIS CLOSED is modes.test.mjs section 4: an exception must name a change that is
   still LIVE, so archiving the change fails the suite until the claim is raised to true. Note
   which guard that is, because the other one could not have done it: section 3 asks the
   derivation whether the gap is still real, and for `kind: 'machine'` it asks the admin's MACHINE
   list — which still holds `enrich`, correctly, because the button that SPAWNS the script is
   machine-only even now that the button that posts a RUN is not. One module, two actions, one
   list: unfalsifiable from that direction, and the archive guard is what caught it. */
/* everything enrichment is lives in this folder (openspec: modules-as-packages) */
import type { ModuleDeclaration } from '../../build/modules/manifest.mjs'

export default {
  key: 'enrichment', what: 'the introductions and the companions', needs: 'a run is rows, and the book is read through the store',
  static: false, git: true, cloud: true,
  owns: {},
} satisfies ModuleDeclaration
