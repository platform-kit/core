/* The kit's core models, in the rail's order: the twelve collections, then the kinds with a grammar and an editor of
   their own. A site's join them from platformkit.config.js admin.models; the custom models from content/models. */
import { COLLECTION_MODELS } from './collections.mjs'
import forms from './forms.mjs'
import funnels from './funnels.mjs'
import blasts from './blasts.mjs'
import policy from './policy.mjs'
import emails from './emails.mjs'
import strings from './strings.mjs'
import models from './models.mjs'
import print from './print.mjs'
import spaces from './spaces.mjs'
import teams from './teams.mjs'
import providers from './providers.mjs'
import commentPolicy from './comments.mjs'
import { AGENT_MODELS } from './agents.mjs'
export const CORE = [...COLLECTION_MODELS, forms, funnels, blasts, policy, emails, strings, models, print, spaces, teams, providers, commentPolicy, ...AGENT_MODELS]
