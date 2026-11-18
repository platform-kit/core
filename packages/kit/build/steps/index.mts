/* The kit's build steps, in declaration order — one record each (build/steps.mjs reads them). What a
   step does lives in its script; the record is the wiring: where it runs, what it follows, its module,
   its condition, what it reads and what it needs. A site's or a theme's steps join this list at load. */
import icons from './icons.mjs'
import embedContent from './embed-content.mjs'
import sales from './sales.mjs'
import tokens from './tokens.mjs'
import chatEmailStrings from './chat-email-strings.mjs'
import emails from './emails.mjs'
import catalog from './catalog.mjs'
import analyticsConfig from './analytics-config.mjs'
import cloudConfig from './cloud-config.mjs'
import contentJson from './content-json.mjs'
import forms from './forms.mjs'
import rewrites from './rewrites.mjs'
import authConfig from './auth-config.mjs'
import pushCatalog from './push-catalog.mjs'
import formEmbed from './form-embed.mjs'
import commentsSdk from './comments-sdk.mjs'
import { commentsPushStep } from './comments.mjs'
import { achievementsPushStep } from './achievements.mjs'
import analyticsSdk from './analytics-sdk.mjs'
import modelsJson from './models-json.mjs'
import prerender from './prerender.mjs'
import { webhooksConfigStep, webhooksPushStep } from './webhooks.mjs'
import { spacesCompileStep, spacesPushStep } from './spaces.mjs'
import { teamsCompileStep, teamsPushStep } from './teams.mjs'
import { searchPushStep } from './search.mjs'
/* a moved module's steps, at its place (openspec: modules-as-packages) */
import { STEPS as MODULE_STEPS } from '../../modules/registry.mjs'
import { inPlace } from '../modules/in-place.mjs'
export const STEPS = inPlace([icons, tokens, embedContent, sales, 'funnels#funnels', chatEmailStrings, emails, 'print#print', 'print#print-type', catalog, analyticsConfig,
  cloudConfig, webhooksConfigStep, spacesCompileStep, teamsCompileStep, 'events#events', 'bots#bots', contentJson, forms, 'print#lulu-webhook', authConfig, pushCatalog, webhooksPushStep, spacesPushStep, teamsPushStep, 'courses', 'events#events-push', commentsPushStep, achievementsPushStep, 'bots#bots-push', searchPushStep, 'funnels#funnels-run', 'tts', rewrites, formEmbed, 'support', commentsSdk, analyticsSdk, modelsJson, prerender], MODULE_STEPS, 'build steps')
