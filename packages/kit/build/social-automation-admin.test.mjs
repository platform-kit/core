import assert from 'node:assert/strict'
import fs from 'node:fs'
import { join } from 'node:path'
import { parseGroups } from './strings-io.mjs'

const WORKSPACE = new URL('../../..', import.meta.url).pathname
const adminPath = join(WORKSPACE, 'packages/movable-types/src/components/admin/SocialAdmin.vue')
const componentPath = join(WORKSPACE, 'packages/movable-types/src/components/admin/social/SocialAutomations.vue')
const stringsPath = join(WORKSPACE, 'packages/movable-types/src/content/ui/social.md')
const admin = fs.readFileSync(adminPath, 'utf8')
const component = fs.readFileSync(componentPath, 'utf8')
const strings = parseGroups(fs.readFileSync(stringsPath, 'utf8')).automations

assert.match(admin, /canViewAutomations[\s\S]*?permissions\?\.view_results === true/)
assert.match(admin, /W\.automations\?\.main \|\| \{\}/)
assert.match(admin, /key: 'automations', label: AUTOMATIONS\.title/)
assert.match(admin, /'automations',[\s\S]*?view === 'automations'\s*\)\s*return/)
assert.match(
  admin,
  /<SocialAutomations v-if="activeView === 'automations'" :accounts="accounts" \/>/,
)
assert.match(component, /account\.permissions\?\.view_results === true/)
assert.match(component, /us\('social'\)\.automations\?\.main \|\| \{\}/)
assert.match(component, /watch\(\s*accountId,[\s\S]*?\{ immediate: true \},?\s*\)/)
assert.match(component, /selectedAccount\.value\?\.permissions\?\.publish_now === true/)
assert.match(component, /call\('automation_list', \{ accountId: id \}\)/)
assert.match(component, /call\('automation_options', \{ accountId: id \}\)/)
assert.match(component, /call\('automation_save'/)
assert.match(component, /call\('automation_response'/)
assert.match(component, /:disabled="!canPublish/)
assert.match(component, /eventKind === 'dm'[\s\S]*?\['private_dm'\]/)
assert.match(component, /eventRoutes\.value\?\.destinations/)
assert.match(component, /eventForResponse\?\.context\?\.length/)
assert.match(component, /eventForResponse\?\.body/)
assert.match(component, /destinationLabel\(destination\)/)
assert.match(component, /visibilityText\(selectedResponse\.destination\)/)
assert.match(component, /responseStatus\(response\)/)
assert.match(component, /selectedResponse\.last_error/)
assert.match(component, /automatic-warning/)

for (const key of [
  'title',
  'description',
  'account',
  'no-accounts',
  'rules-tab',
  'responses-tab',
  'rules-title',
  'rules-description',
  'new-rule',
  'new-rule-title',
  'edit-rule',
  'no-rules',
  'select-rule',
  'event',
  'comment-event',
  'dm-event',
  'keyword',
  'bot',
  'destinations',
  'public-label',
  'public-visibility',
  'private-label',
  'private-visibility',
  'mode',
  'mode-review',
  'mode-automatic',
  'automatic-warning',
  'enabled',
  'paused',
  'save-rule',
  'saving',
  'cancel-edit',
  'saved',
  'rule-save-failed',
  'no-routes',
  'route-unavailable',
  'read-only',
  'no-bots',
  'responses-title',
  'response-history',
  'no-responses',
  'select-response',
  'loading',
  'load-failed',
  'options-failed',
  'trigger',
  'context',
  'no-context',
  'connected-account',
  'other-participant',
  'draft-status',
  'queued-status',
  'generating-status',
  'sending-status',
  'sent-status',
  'failed-status',
  'uncertain-status',
  'discarded-status',
  'send-response',
  'discard-response',
  'response-sent',
  'response-discarded',
  'response-action-failed',
  'response-text',
  'empty-text',
  'last-error',
])
  assert.ok(strings?.main?.[key], `Social automation string exists: ${key}`)

assert.equal(strings.main['public-label'], 'Public reply')
assert.equal(strings.main['private-label'], 'Private DM')
assert.notEqual(strings.main['public-visibility'], strings.main['private-visibility'])

console.log('Social automation admin contract passed')
