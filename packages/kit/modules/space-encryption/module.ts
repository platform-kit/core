/* everything space-encryption is lives in this folder (openspec: modules-as-packages) */
import type { ModuleDeclaration } from '../../build/modules/manifest.mjs'

export default {
  key: 'space-encryption', what: 'a channel whose messages the server cannot read', needs: 'a key lives on a device and the cipher in a row',
  /*
   * ITS OWN SWITCH, AND NOT PART OF SPACES. End-to-end encryption costs a site things it may
   * want more than it wants secrecy: there is no search of an encrypted channel, no bot in one,
   * and no moderating what nobody can read. A site that wants rooms should not have to take
   * that bargain to get them, and a site that wants it should take it deliberately. So the
   * module is separate, and `encrypted: true` with it off is refused at the build rather than
   * quietly ignored — a channel a site believes is sealed and is not is the worst of the three
   * possible states.
   */
  requires: [{ module: 'spaces', why: 'there is no channel to encrypt without the rooms it belongs to' }],
  static: false, git: true, cloud: true,
  owns: {},
} satisfies ModuleDeclaration
