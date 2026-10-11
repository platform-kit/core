import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..')
const site = process.cwd()
const sourcePath = path.join(root, 'packages/kit/supabase/functions/social/index.ts')
const assembledPath = path.join(site, 'supabase/functions/social/index.ts')
const source = fs.readFileSync(sourcePath, 'utf8')
const webhookSourcePath = path.join(root, 'packages/kit/supabase/functions/social-webhook/index.ts')
const assembledWebhookPath = path.join(site, 'supabase/functions/social-webhook/index.ts')
const webhookSource = fs.readFileSync(webhookSourcePath, 'utf8')
const automationPath = path.join(root, 'packages/kit/supabase/functions/social-automation/index.ts')
const assembledAutomationPath = path.join(site, 'supabase/functions/social-automation/index.ts')
const automationSource = fs.readFileSync(automationPath, 'utf8')
const workerSourcePath = path.join(root, 'packages/kit/supabase/functions/agent-run/index.ts')
const assembledWorkerPath = path.join(site, 'supabase/functions/agent-run/index.ts')
const workerSource = fs.readFileSync(workerSourcePath, 'utf8')

assert.equal(
  fs.readFileSync(assembledPath, 'utf8'),
  source,
  'the served Social function must be assembled from the kit source',
)
assert.match(source, /Deno\.serve\(async \(req\) => \{/)
assert.doesNotMatch(source, /from\s+['"]node:|from\s+['"](?:fs|path|child_process)['"]/)
assert.equal(
  fs.readFileSync(assembledWebhookPath, 'utf8'),
  webhookSource,
  'the served Social webhook function must be assembled from the kit source',
)
assert.match(webhookSource, /webhooks\.verify/)
assert.match(webhookSource, /social_inbound_events/)
assert.doesNotMatch(webhookSource, /from\s+['"]node:|from\s+['"](?:fs|path|child_process)['"]/)
assert.equal(
  fs.readFileSync(assembledAutomationPath, 'utf8'),
  automationSource,
  'the Social automation processor must be assembled from the kit source',
)
assert.match(automationSource, /social_begin_automation_send/)
assert.match(automationSource, /social_finish_automation_send/)
assert.match(automationSource, /automationDeliveryOutcome/)
assert.match(automationSource, /retryBudget:\s*\{\s*maxAttempts:\s*1/)
assert.match(automationSource, /context:\s*operationContext\(runtime\.backendId\)/)
assert.match(automationSource, /async function validateRule\(body: Row\)/)
assert.match(automationSource, /socialBotAllowsAnonymousSubject\(bot\)/)
assert.match(automationSource, /body\.action === 'validate_rule'/)
assert.match(automationSource, /body\.action === 'deliver_response'[\s\S]*?body\.actorId/)
assert.match(automationSource, /p_actor_id:\s*actorId/)
const deliveryStart = automationSource.indexOf('async function deliverResponse')
const deliveryRouteCheck = automationSource.indexOf('availableSocialAutomationRoutes(', deliveryStart)
const deliveryProviderWrite = automationSource.indexOf('invokeSocialOperation({', deliveryRouteCheck)
assert.ok(
  deliveryStart >= 0 && deliveryRouteCheck > deliveryStart && deliveryProviderWrite > deliveryRouteCheck,
  'automatic and reviewed replies recheck the connected provider route before a provider write',
)
assert.doesNotMatch(automationSource, /from\s+['"]node:|from\s+['"](?:fs|path|child_process)['"]/)
assert.equal(
  fs.readFileSync(assembledWorkerPath, 'utf8'),
  workerSource,
  'the served agent worker must be assembled from the kit source',
)
assert.match(workerSource, /socialAutomationPrompt/)
assert.match(workerSource, /socialBotAllowsAnonymousSubject/)
assert.match(workerSource, /\.from\('social_automation_responses'\)[\s\S]*status: 'draft'/)
assert.doesNotMatch(workerSource, /comments\.write|messages\.write/)

const deskRouteStart = source.indexOf("if (body.action === 'desk_accounts'")
const deskRouteEnd = source.indexOf("if (body.action === 'accept_invitation')", deskRouteStart)
assert.ok(deskRouteStart >= 0 && deskRouteEnd > deskRouteStart, 'Social Desk actions have a route block')
const deskRoute = source.slice(deskRouteStart, deskRouteEnd)
const staffGate = deskRoute.indexOf('spacesStaff(user.id)')
const socialGate = deskRoute.indexOf('hasSocialAccess(user.id)')
const accountGate = deskRoute.indexOf('deskAccountReadFailure(user.id, accountId)')
const providerCall = deskRoute.indexOf("action: 'account_operation'")
assert.ok(staffGate >= 0 && socialGate > staffGate && accountGate > socialGate && providerCall > accountGate,
  'provider operations remain behind Spaces staff, active Social access, and account read permission')
assert.match(source, /account\?\.permissions\?\.view_results === true && account\?\.permissions\?\.publish_now === true/,
  'Desk account lists disclose only connected accounts with Social Admin publish access')
assert.match(source, /for \(const \[permission, label\] of \[\s*\['view_results', 'view results'\],\s*\['publish_now', 'Social Admin publish access'\]/,
  'every Desk capability and operation request rechecks both account permissions')
assert.match(deskRoute, /!\['comments\.read', 'comments\.write', 'messages\.read', 'messages\.write', 'profiles\.read'\]\.includes\(operation\)/)
const automationApiStart = source.indexOf("body.action === 'automation_list'")
const automationApiEnd = source.indexOf("body.action === 'managed_connect'", automationApiStart)
assert.ok(automationApiStart >= 0 && automationApiEnd > automationApiStart,
  'Social automation API routes are inside the Social publisher gate')
const automationApi = source.slice(automationApiStart, automationApiEnd)
assert.match(automationApi, /listAutomations\(body, user\.id\)/)
assert.match(automationApi, /saveAutomation\(body, user\.id\)/)
assert.match(automationApi, /reviewAutomationResponse\(body, user\.id\)/)
assert.match(source, /async function automationPermissionFailure[\s\S]*?'view_results'[\s\S]*?'publish_now'/)
assert.match(source, /userCanDelivery\(userId, responseId, 'publish_now'\)/)
assert.match(source, /admin\.functions\.invoke\('social-automation',\s*\{\s*body: \{ action: 'deliver_response', responseId, actorId: userId \}/)

console.log('Social Edge Runtime source and authorization contract passed')
