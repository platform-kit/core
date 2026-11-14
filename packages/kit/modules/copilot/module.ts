/* everything copilot is lives in this folder (openspec: modules-as-packages) */
import type { ModuleDeclaration } from '../../build/modules/manifest.mjs'

export default {
  /*
   * A BOT THAT IS SPOKEN TO. The thinking is the bots module's loop, untouched — no second
   * loop, no second provider seam, no second set of tools. This owns only what that loop has
   * never had: a door in a shape a voice front end can speak to, and somewhere to keep what a
   * person told an assistant where its file says to recall.
   *
   * SHAPES. Static has no functions at all, so there is no endpoint to speak to and no run to
   * make — a spoken conversation cannot be had there, and the text surfaces are unaffected.
   * Git and cloud are the same answer, because the grant, the endpoint and the run are rows and
   * a function either way: whether the bot's file is a file or a row is something neither the
   * door nor the loop can tell.
   */
  key: 'copilot', what: 'an assistant that is spoken to', needs: 'a grant, an endpoint and a run — all three need a backend',
  static: false, git: true, cloud: true,
  requires: [{ module: 'bots', why: 'a voice is a way to reach a bot, and without the bots there is nothing to speak to' }],
  owns: {},
} satisfies ModuleDeclaration
