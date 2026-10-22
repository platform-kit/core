import assert from 'node:assert/strict'
import fs from 'node:fs'

const adminPage = fs.readFileSync(new URL('../theme/src/pages/AdminPage.vue', import.meta.url), 'utf8')
const adminHead = fs.readFileSync(new URL('../theme/src/components/admin/AdminHead.vue', import.meta.url), 'utf8')
const socialAdmin = fs.readFileSync(new URL('../theme/src/components/admin/SocialAdmin.vue', import.meta.url), 'utf8')
const socialWords = fs.readFileSync(new URL('../theme/src/content/ui/social.md', import.meta.url), 'utf8')

assert.match(
  adminPage,
  /'support',\s*'comments',\s*'spaces',\s*'people',\s*'forms',\s*'form-responses',\s*'form-analytics',\s*'funnel-analytics',\s*'models',\s*'payouts',\s*'social'/,
  'the live-data Social view must not be requested as a content collection',
)
assert.match(socialAdmin, /const activeView = ref\('calendar'\)/)
assert.doesNotMatch(socialAdmin, /calendar-description/)
assert.doesNotMatch(socialWords, /^calendar-description:/m)
assert.match(socialAdmin, /class="ui-page sp-admin"[\s\S]*?<AdminHead :title="PAGE\.title" :sub="PAGE\.lead">/)
assert.match(
  adminHead,
  /v-if="tabs \|\| \$slots\.barLeft \|\| \$slots\.actions" class="ui-pagebar"/,
  'workspace navigation in the page bar must remain visible when a view has no action controls',
)
assert.match(
  socialAdmin,
  /<template #barLeft>[\s\S]*?<nav class="sp-workspace-nav"[\s\S]*?<select[\s\S]*?class="ui-select sp-workspace-select"[\s\S]*?:value="activeView"[\s\S]*?@change="setView\(\$event\.target\.value\)"[\s\S]*?<\/select>[\s\S]*?<\/nav>[\s\S]*?<\/template>/,
  'Social workspaces use a grouped native selector in the admin page bar',
)
assert.match(
  socialAdmin,
  /<nav class="sp-workspace-nav" :aria-label="PAGE\['workspace-navigation'\]">[\s\S]*?class="ui-select sp-workspace-select"/,
  'the workspace selector remains a named navigation landmark',
)
assert.doesNotMatch(socialAdmin, /<nav class="sp-nav"|sp-nav-group|sp-nav-item|class="sp-workbench"|class="sp-side-nav"/)
assert.match(socialAdmin, /const workspaceNavigation = computed\([\s\S]*?canReviewApprovals\.value[\s\S]*?isAdmin\.value/)
assert.match(
  socialAdmin,
  /<template #actions>[\s\S]*?class="sp-page-actions"[\s\S]*?activeView === 'calendar'[\s\S]*?class="sp-tools"[\s\S]*?PAGE\.week[\s\S]*?class="sp-primary sp-create"[\s\S]*?PAGE\['new-post'\]/,
  'New post and Month/Week controls stay in the admin page action bar',
)
assert.match(
  socialAdmin,
  /class="sp-page-actions"\s*:class="\{ 'sp-page-actions-calendar': activeView === 'calendar' \}"/,
)
assert.match(
  socialAdmin,
  /\.sp-page-actions-calendar \.sp-mode,\s*\.sp-page-actions-calendar \.sp-create\s*\{[^}]*width:\s*var\(--sp-control-width\);[^}]*height:\s*var\(--sp-control-height\)/,
  'New post and the Month/Week container have matching dimensions',
)
assert.match(socialAdmin, /\.sp-page-actions-calendar\s*\{[^}]*--sp-control-width:\s*8\.125rem;/)
assert.match(socialAdmin, /\.sp-page-actions-calendar\s*\{[^}]*--sp-control-height:\s*2\.75rem;/)
assert.match(socialAdmin, /\.sp-page-actions-calendar\s*\{[^}]*--sp-control-width:\s*7\.5rem;/)
const calendarToolbar = socialAdmin.match(/<template #actions>([\s\S]*?)<\/template>/)?.[1] || ''
assert.doesNotMatch(calendarToolbar, /PAGE\.timezone|sp-tz-label/)
assert.match(
  socialAdmin,
  /settingsPane === 'calendar'[\s\S]*?PAGE\['calendar-settings-title'\][\s\S]*?PAGE\['calendar-settings-description'\][\s\S]*?PAGE\.timezone[\s\S]*?v-model="timezone"[\s\S]*?timeZones/,
  'the time-zone preference is available in Social Settings and still drives the calendar',
)
assert.match(socialAdmin, /ACCESS\['calendar-settings-tab'\]/)
assert.match(
  socialAdmin,
  /v-if="\['calendar', 'drafts', 'posts'\]\.includes\(activeView\)"[\s\S]*?class="sp-primary sp-create"/,
  'the create-post action appears only in publishing workspaces',
)
assert.match(socialAdmin, /\.sp-tools,\s*\.sp-tz-label\s*\{[^}]*--sp-control-height:\s*2\.75rem;/)
assert.match(socialAdmin, /\.sp-tz-label select\s*\{[^}]*height:\s*var\(--sp-control-height\)/)
assert.match(socialAdmin, /\.sp-mode\s*\{[^}]*height:\s*var\(--sp-control-height\)/)
assert.match(socialAdmin, /\.sp-main > \.sp-view\s*\{[^}]*padding:\s*0;[^}]*border:\s*0;/)
assert.match(socialAdmin, /async function setView\(view\)[\s\S]*?view === 'settings' && !isAdmin\.value/)
assert.match(socialAdmin, /activeView === 'settings' && isAdmin/)
assert.match(socialAdmin, /class="sp-view sp-settings"[\s\S]*?sp-settings-access[\s\S]*?settingsPane === 'access'/)
assert.match(socialAdmin, /\.sp-settings-access\s*\{\s*grid-template-columns:\s*minmax\(0,\s*1fr\)/)
assert.match(
  socialAdmin,
  /@media \(max-width: 720px\) \{[\s\S]*?\.sp-status \{\s*display: none;\s*\}[\s\S]*?\.sp-delivery-card \.sp-status \{\s*display: inline-flex;\s*\}/,
  'delivery status remains visible in the narrow post-detail card',
)
assert.match(socialAdmin, /settingsPane === 'access'[\s\S]*?ACCESS_ACTIONS[\s\S]*?savePublisherPermissions/)
assert.match(socialAdmin, /class="sp-approval-row"[\s\S]*?reviewApproval\(delivery, 'approve'\)[\s\S]*?reviewApproval\(delivery, 'return'\)/)
assert.match(
  socialAdmin,
  /async function reviewApproval\(delivery, decision\)[\s\S]*?social\('review_delivery'[\s\S]*?const updatedDelivery = result\.delivery[\s\S]*?posts\.value = posts\.value\.map[\s\S]*?social\('approval_queue'\)/,
  'review decisions must immediately update shared post, calendar and draft state',
)
assert.match(socialAdmin, /activeView === 'approvals' && canReviewApprovals/)
assert.match(socialWords, /Existing publishers receive no automatic permissions/)
assert.doesNotMatch(socialWords, /They can manage all social drafts and connected accounts/)
assert.match(socialAdmin, /class="sp-overlay"[\s\S]*?class="sp-composer"/)
assert.match(socialAdmin, /class="sp-post-grid"[\s\S]*?postGridRows[\s\S]*?selectedPost\.deliveries/)
assert.match(socialAdmin, /async function loadProviderPosts\(\)[\s\S]*?queryMode: 'list'/)
assert.match(socialAdmin, /async function inspectProviderPost\(item\)[\s\S]*?queryMode: 'post'[\s\S]*?referenceId/)
assert.match(socialAdmin, /async function inspectProviderDelivery\(delivery\)[\s\S]*?queryMode: 'delivery'[\s\S]*?delivery\.provider_post_id/)
assert.match(socialAdmin, /async function loadComments\(\)[\s\S]*?comments\.read[\s\S]*?selectedDelivery\.value\.provider_post_id/)
assert.match(socialAdmin, /async function loadAnalytics\(\)[\s\S]*?analytics\.account\.read[\s\S]*?social_metrics_snapshots[\s\S]*?query\.gte\('collected_at', from\)[\s\S]*?query\.lt\('collected_at', through\)[\s\S]*?analyticsSnapshots\.value = snapshots/)
assert.match(socialAdmin, /select\('id, delivery_id, post_id, account_id, collected_at, views, reads, likes, comments, provider_metrics'\)[\s\S]*?if \(analyticsDelivery\.value\) query = query\.eq\('delivery_id', analyticsDelivery\.value\.id\)/)
assert.match(socialAdmin, /ANALYTICS\['all-posts'\]/)
assert.match(socialAdmin, /function analyticsSnapshotContext\(snapshot\)[\s\S]*?snapshot\.delivery_id[\s\S]*?snapshot\.post_id[\s\S]*?snapshot\.account_id/)
assert.match(socialAdmin, /v-for="snapshot in analyticsSnapshotsInRange"[\s\S]*?analyticsSnapshotContext\(snapshot\)/)
assert.match(socialAdmin, /const analyticsSnapshotsInRange = computed\([\s\S]*?collectedDay >= analyticsFrom\.value[\s\S]*?collectedDay <= analyticsTo\.value/)
assert.match(socialAdmin, /v-for="snapshot in analyticsSnapshotsInRange"/)
assert.match(socialAdmin, /ANALYTICS\['date-from'\][\s\S]*?@change="loadAnalytics"/)
assert.match(socialAdmin, /ANALYTICS\['date-to'\][\s\S]*?@change="loadAnalytics"/)
assert.match(socialAdmin, /ANALYTICS\['collection-cadence'\]/)
assert.doesNotMatch(socialAdmin, /loadAnalyticsReport|analytics\.report\.read|sp-report-form/)
assert.doesNotMatch(socialAdmin, /analytics\.read',\s*\{\s*postId:/)
assert.match(socialAdmin, /async function loadInbox\(\)[\s\S]*?notifications\.read[\s\S]*?messages\.read/)
assert.match(socialAdmin, /async function searchWorkspace\(\)[\s\S]*?search\.posts/)
assert.match(socialAdmin, /async function actOnSelectedProfile\(operation\)[\s\S]*?workspaceSelected\.value[\s\S]*?profileId/)
assert.doesNotMatch(socialAdmin, /class="sp-operation"/)
assert.doesNotMatch(socialAdmin, /field-posts-read-reference-id|operationForm\(|runAccountOperation\(/)
assert.match(
  socialAdmin,
  /class="ui-select sp-workspace-select"[\s\S]*?:value="activeView"[\s\S]*?:aria-label="PAGE\['workspace-navigation'\]"[\s\S]*?@change="setView\(\$event\.target\.value\)"/,
  'the compact workspace selector is accessible and routes through the active view handler',
)
assert.match(socialAdmin, /<optgroup v-for="group in workspaceNavigation"[\s\S]*?<option v-for="item in group\.items"/)
assert.match(
  socialAdmin,
  /@container social-admin \(max-width: 760px\)[\s\S]*?\.sp-admin :deep\(\.ui-pagebarleft\)\s*\{[^}]*width:\s*100%[\s\S]*?\.sp-workspace-nav\s*\{[^}]*flex:\s*1 1 100%[\s\S]*?\.sp-page-actions\s*\{[^}]*grid-template-columns:\s*minmax\(0,\s*1fr\)\s*auto;[\s\S]*?\.sp-tools\s*\{[^}]*grid-column:\s*1\s*\/\s*-1;[\s\S]*?\.sp-create\s*\{[^}]*grid-column:\s*2;[^}]*grid-row:\s*2;[\s\S]*?\.sp-overview-card \+ \.sp-overview-card\s*\{[^}]*border-left:\s*1px solid/,
  'mobile pagebar stacks the workspace selector, calendar controls and New post cleanly',
)
assert.match(socialAdmin, /v-if="mode === 'month'" class="sp-weekdays"/)
assert.match(
  socialAdmin,
  /mode === 'week'[\s\S]*?dayLabel\(day, \{ weekday: 'short' \}\)[\s\S]*?dayLabel\(day, \{ day: 'numeric' \}\)/,
)
assert.match(
  socialAdmin,
  /@container social-admin \(max-width: 760px\)[\s\S]*?\.sp-grid-week\s*\{\s*grid-template-columns:\s*minmax\(0,\s*1fr\)/,
  'the narrow week view becomes a vertical agenda without a redundant seven-day header',
)
assert.doesNotMatch(socialAdmin, /\.sp-tabs\s*\{\s*display:\s*grid/)
assert.match(socialAdmin, /@container social-admin \(max-width: 720px\)[\s\S]*?\.sp-post-workspace[\s\S]*?grid-template-columns:\s*minmax\(0,\s*1fr\)/)
assert.match(
  socialAdmin,
  /\.sp-post-workspace\s*\{[^}]*grid-template-columns:\s*minmax\(0,\s*1fr\)/,
  'the full-width posts grid stays above its selected detail panel',
)
assert.match(socialAdmin, /class="sp-top"[\s\S]*?ACCOUNT_WORDS\.title[\s\S]*?class="sp-panel"/)
assert.match(socialAdmin, /class="sp-top"[\s\S]*?ACCESS\['approvals-title'\][\s\S]*?class="sp-panel"/)
assert.match(socialAdmin, /class="sp-top"[\s\S]*?PAGE\.drafts[\s\S]*?class="sp-panel sp-drafts"/)
assert.match(socialAdmin, /class="sp-top"[\s\S]*?PAGE\['settings-tab'\][\s\S]*?class="ui-pagetabs sp-settings-tabs"/)
assert.match(socialAdmin, /sp-record-workspace-empty/)
assert.match(socialAdmin, /v-else-if="!workspaceLoading"/)
assert.doesNotMatch(socialAdmin, /selectedPost\.id/)
assert.match(socialAdmin, /class="ui-toolbar sp-filterbar"[\s\S]*?ACCOUNT_WORDS\['no-account-selection'\][\s\S]*?COMMENTS\['choose-post'\]/)
assert.match(socialAdmin, /class="ui-toolbar sp-filterbar"[\s\S]*?ANALYTICS\['choose-post'\][\s\S]*?ANALYTICS\['date-from'\]/)
assert.match(socialAdmin, /class="ui-toolbar sp-filterbar"[\s\S]*?INBOX\['inbox-mode'\]/)
assert.match(socialAdmin, /class="ui-toolbar sp-explore-tools"[\s\S]*?EXPLORE\['explore-mode'\]/)
assert.match(socialAdmin, /connectedAccounts\.length \? COMMENTS\['empty-comments'\] : ACCOUNT_WORDS\.empty/)
assert.match(socialAdmin, /!workspaceLoading && !connectedAccounts\.length[\s\S]*?ACCOUNT_WORDS\.empty/)
assert.match(socialAdmin, /class="sp-settings-mobile-nav"[\s\S]*?v-model="settingsPane"/)
assert.match(
  socialAdmin,
  /\.sp-settings \.sp-form\s*\{[^}]*grid-template-columns:\s*minmax\(0,\s*1fr\)/,
  'settings forms keep each provider field readable inside its card',
)
assert.match(socialAdmin, /\.sp-workspace-account\s*\{[^}]*text-transform:\s*uppercase/)
assert.match(socialAdmin, /\.sp-admin button,\s*\.sp-admin input,\s*\.sp-admin select,\s*\.sp-admin textarea\s*\{[^}]*font-family:\s*var\(--f/)
const socialSurfaceStyles = socialAdmin.match(/<style scoped>([\s\S]*?)<\/style>/)?.[1] || ''
assert.ok(socialSurfaceStyles, 'Social admin styles are present')
assert.match(socialSurfaceStyles, /\.sp-view\s*\{[^}]*align-content:\s*start;[^}]*grid-auto-rows:\s*max-content/)
assert.match(socialSurfaceStyles, /\.sp-main\s*\{[^}]*align-content:\s*start/)
assert.match(socialSurfaceStyles, /@container social-admin \(max-width: 760px\) \{[\s\S]*?\.sp-top > \.sp-heading \{\s*flex: 0 1 auto;/)
assert.match(socialSurfaceStyles, /\.sp-settings-tabs\s*\{\s*display:\s*none;/)
assert.match(socialSurfaceStyles, /\.sp-settings-mobile-nav\s*\{\s*display:\s*grid;/)
assert.match(socialSurfaceStyles, /\.sp-drafts\s*\{[^}]*flex-direction:\s*column/)
assert.match(socialSurfaceStyles, /\.sp-draft\s*\{[^}]*border-bottom:\s*1px solid var\(--hair/)
assert.match(socialAdmin, /container-name:\s*social-admin/)
assert.match(socialAdmin, /managed-backend-settings/)
assert.match(socialAdmin, /function backendName\(backend\)/)
assert.match(socialAdmin, /function connectManaged\(\)/)
const accountsStart = socialAdmin.indexOf(`<section v-else-if="activeView === 'accounts'"`)
const draftsStart = socialAdmin.indexOf(`<section v-else-if="activeView === 'drafts'"`, accountsStart)
const calendarStart = socialAdmin.indexOf(`<section v-if="activeView === 'calendar'"`)
assert.ok(accountsStart >= 0 && draftsStart > accountsStart && calendarStart >= 0)
assert.match(socialAdmin.slice(accountsStart, draftsStart), /accountViews\(account\)/)
assert.match(socialAdmin.slice(accountsStart, draftsStart), /openAccountView\(view, account\)/)
assert.doesNotMatch(socialAdmin.slice(calendarStart, accountsStart), /class="sp-operation"/)

console.log('social-admin: shared admin layout, record-driven workspaces, account-scoped capabilities and mobile navigation passed')
