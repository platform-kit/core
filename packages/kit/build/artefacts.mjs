/*
 * WHAT THE FUNCTIONS READ THAT IS COMPILED RATHER THAN CONTENT, and how each reaches them where
 * nothing builds.
 *
 * The build writes these beside the functions and the deploy ships them, which is right: an Edge
 * Function that recompiled the catalog per request would read a hundred records to answer one
 * question. But cloud mode with the repository out of the cycle and no deploy hook never builds
 * again, and there the file the deployment shipped with is the last one it will ever have.
 *
 * So every artefact is one of two things and must say which:
 *   published  — a publish compiles it into public.compiled and the functions read that row over
 *                the file (_shared/compiled.ts). Its key here is the key in that table, and the
 *                model keys that feed it are FEEDS in build/models/index.mjs.
 *   live       — the function builds it from the rows itself when it needs it, so it never goes
 *                stale and nothing has to publish it.
 *   fixed      — it is not content and does not change without a deploy, with the reason. A build
 *                setting, a vendored template, the deployment's own shape.
 *
 * artefacts.test.mjs refuses a .json beside the functions that is in neither list, so adding one is
 * answering the question in the same commit — the same rule content-kinds.mjs holds for content.
 */
export const PUBLISHED = {
  catalog: 'what is for sale, the booking types, the tiers, the editions, the checkout\'s words',
  forms: 'every form as the runner and the API read it',
  funnels: 'the funnels, the blasts, the chat prompts and the email policy',
  emails: 'every email design compiled to html',
}

export const LIVE = {
  'content/index.json': 'the content API\'s index: in cloud mode the content function builds it from the rows on the read (build/content-json.mjs, _shared/content-index.ts), and this file is what a deployment that builds ships instead',
}

export const FIXED = {
  'cloud.json': 'where this deployment publishes — its own shape, from platformkit.config.js, not content',
  'webhooks.json': 'the subscriptions this deployment ships, naming the variable a secret is in; configuration',
  'analytics.json': 'the analytics sources and their keys: configuration, and a key is not edited in the admin',
  'strings.json': 'the words the functions carry, compiled from the strings a publish already updates in content; the functions read the row for the words that matter and this is the fallback',
  'emails/strings.json': 'the same, for the mailer',
  'spaces.json': 'the spaces declaration the functions read; it moves with the spaces projection, which is named debt in content-kinds.mjs',
  'teams.json': 'the teams declaration; nothing in a function reads it — the scheduler asks team_members, which a publish projects',
  'bots.json': 'the bots and their skills; it moves with the bots projection, named debt in content-kinds.mjs',
  'commands.json': 'the commands; the same debt',
  'print/templates.json': 'the printed book\'s Typst templates and fonts: a build artefact of the kit itself, not of a site\'s content',
  'pipe/theme-strings.json': 'the theme\'s own default strings, which are the theme\'s and change with it',
  'pipe/build/google-fonts.json': 'the Google Fonts catalogue the typeface picker searches: a data file of the KIT, shipped with its code and refreshed by a kit release, never by a publish and never from the rows',
  'pipe/theme-brand.json': 'the theme\'s own faces and the site\'s mark, which the share-image function sets the card in; the theme\'s and it changes with it',
  'pipe/theme-skills.json': 'the theme\'s own default skills for the bots, which are the theme\'s and change with it',
  'pipe/kit-designs.json': 'the kit\'s own fallback email designs, which are the kit\'s and change with it',
  'pipe/enrichment-briefs.json': 'the six stage prompts the enrichment writes in: the SITE\'s voice, but code — a module it names in its config, not a record anybody edits. A publish cannot change them, and a prompt that changed without a deploy would quietly make every cached stage result stale.',
}
