<script setup>
import { computed, reactive, ref, watch } from 'vue'
import { supabase } from 'platformkit/lib/supabase.js'
import { us } from 'platformkit/lib/strings.js'

const props = defineProps({
  accounts: { type: Array, default: () => [] },
})

const W = us('social').automations?.main || {}
const busy = ref(false)
const loading = ref(false)
const loadError = ref('')
const actionError = ref('')
const notice = ref('')
const pane = ref('rules')
const accountId = ref('')
const rules = ref([])
const events = ref([])
const responses = ref([])
const bots = ref([])
const routes = ref([])
const routeUnavailable = ref('')
const selectedRuleId = ref('')
const selectedResponseId = ref('')
const responseText = ref('')
const form = reactive({
  id: '',
  eventKind: 'comment',
  keyword: '',
  botSlug: '',
  destinations: [],
  mode: 'draft',
  enabled: true,
})

const viewableAccounts = computed(() =>
  props.accounts.filter((account) => account.permissions?.view_results === true),
)
const selectedAccount = computed(
  () => viewableAccounts.value.find((account) => account.id === accountId.value) || null,
)
const canPublish = computed(() => selectedAccount.value?.permissions?.publish_now === true)
const eventRoutes = computed(() => routes.value.find((route) => route.eventKind === form.eventKind))
const supportedDestinations = computed(() => eventRoutes.value?.destinations || [])
const selectedResponse = computed(
  () => responses.value.find((response) => response.id === selectedResponseId.value) || null,
)
const eventById = computed(() => new Map(events.value.map((event) => [event.id, event])))
const eventForResponse = computed(() =>
  selectedResponse.value ? eventById.value.get(selectedResponse.value.event_id) || null : null,
)
const responseStatus = (response) => {
  if (response.mode === 'automatic' && response.status === 'draft') return W['queued-status']
  return W[`${response.status}-status`] || response.status
}
const destinationLabel = (destination) =>
  destination === 'public_reply' ? W['public-label'] : W['private-label']
const visibilityText = (destination) =>
  destination === 'public_reply' ? W['public-visibility'] : W['private-visibility']
const eventLabel = (kind) =>
  kind === 'comment' ? W['comment-event'] : kind === 'dm' ? W['dm-event'] : ''
const eventExcerpt = (eventId) => eventById.value.get(eventId)?.body || W['empty-text']
const dateLabel = (value) => (value ? new Date(value).toLocaleString() : '')

async function call(action, fields = {}) {
  const { data, error } = await supabase.functions.invoke('social', {
    body: { action, ...fields },
  })
  if (error || data?.error) throw error || new Error(data.error)
  return data || {}
}

function resetForm() {
  Object.assign(form, {
    id: '',
    eventKind: routes.value.some((route) => route.eventKind === 'comment') ? 'comment' : 'dm',
    keyword: '',
    botSlug: bots.value[0]?.slug || '',
    destinations: [],
    mode: 'draft',
    enabled: true,
  })
  selectedRuleId.value = ''
  if (form.eventKind === 'comment') {
    const route = routes.value.find((item) => item.eventKind === 'comment')
    form.destinations = route?.destinations.includes('public_reply') ? ['public_reply'] : []
  } else if (routes.value.some((item) => item.eventKind === 'dm')) {
    form.destinations = ['private_dm']
  }
}

function editRule(rule) {
  selectedRuleId.value = rule.id
  Object.assign(form, {
    id: rule.id,
    eventKind: rule.event_kind,
    keyword: rule.keyword,
    botSlug: rule.bot_slug,
    destinations: [...rule.destinations],
    mode: rule.mode,
    enabled: rule.enabled,
  })
  actionError.value = ''
  notice.value = ''
}

function chooseEvent(eventKind) {
  form.eventKind = eventKind
  const route = routes.value.find((item) => item.eventKind === eventKind)
  form.destinations =
    eventKind === 'dm'
      ? route?.destinations.includes('private_dm')
        ? ['private_dm']
        : []
      : route?.destinations.includes('public_reply')
        ? ['public_reply']
        : []
}

async function loadAccount(id) {
  if (!id) return
  loading.value = true
  loadError.value = ''
  actionError.value = ''
  routeUnavailable.value = ''
  selectedResponseId.value = ''
  try {
    const result = await call('automation_list', { accountId: id })
    rules.value = result.automations || []
    events.value = result.events || []
    responses.value = result.responses || []
    bots.value = result.bots || []
    if (!rules.value.some((rule) => rule.id === selectedRuleId.value)) resetForm()
    if (!responses.value.some((response) => response.id === selectedResponseId.value))
      selectedResponseId.value = responses.value[0]?.id || ''
    try {
      const options = await call('automation_options', { accountId: id })
      routes.value = options.routes || []
      routeUnavailable.value = options.unavailable ? W['route-unavailable'] : ''
    } catch {
      routes.value = []
      routeUnavailable.value = W['options-failed']
    }
    if (!rules.value.some((rule) => rule.id === selectedRuleId.value)) resetForm()
  } catch {
    loadError.value = W['load-failed']
    rules.value = []
    events.value = []
    responses.value = []
    bots.value = []
    routes.value = []
  } finally {
    loading.value = false
  }
}

async function saveRule() {
  busy.value = true
  actionError.value = ''
  notice.value = ''
  try {
    const result = await call('automation_save', {
      id: form.id || undefined,
      accountId: accountId.value,
      eventKind: form.eventKind,
      keyword: form.keyword,
      botSlug: form.botSlug,
      destinations: form.destinations,
      mode: form.mode,
      enabled: form.enabled,
    })
    notice.value = W.saved
    await loadAccount(accountId.value)
    if (result.automation) editRule(result.automation)
  } catch {
    actionError.value = W['rule-save-failed']
  } finally {
    busy.value = false
  }
}

async function reviewResponse(decision) {
  if (!selectedResponse.value) return
  busy.value = true
  actionError.value = ''
  notice.value = ''
  try {
    await call('automation_response', {
      responseId: selectedResponse.value.id,
      decision,
      ...(decision === 'send' ? { text: responseText.value } : {}),
    })
    notice.value = decision === 'send' ? W['response-sent'] : W['response-discarded']
    await loadAccount(accountId.value)
    selectedResponseId.value = ''
  } catch {
    actionError.value = W['response-action-failed']
  } finally {
    busy.value = false
  }
}

watch(
  () => props.accounts,
  (accounts) => {
    if (
      !accounts.some(
        (account) => account.id === accountId.value && account.permissions?.view_results,
      )
    )
      accountId.value = accounts.find((account) => account.permissions?.view_results)?.id || ''
  },
  { immediate: true },
)
watch(
  accountId,
  (id) => {
    if (id) loadAccount(id)
  },
  { immediate: true },
)
watch(selectedResponse, (response) => {
  responseText.value = response?.body || ''
})
</script>

<template>
  <section class="sa-automations">
    <header class="sa-heading">
      <div>
        <h2>{{ W.title }}</h2>
        <p>{{ W.description }}</p>
      </div>
      <label class="sa-account">
        <span>{{ W.account }}</span>
        <select v-model="accountId" class="ui-select">
          <option v-for="account in viewableAccounts" :key="account.id" :value="account.id">
            {{ account.name }} · {{ account.username }}
          </option>
        </select>
      </label>
    </header>

    <p v-if="notice" class="sa-notice" role="status">{{ notice }}</p>
    <p v-if="actionError" class="sa-error" role="alert">{{ actionError }}</p>
    <p v-if="loadError" class="sa-error" role="alert">{{ loadError }}</p>
    <p v-if="loading" class="sa-empty">{{ W.loading }}</p>
    <p v-else-if="!viewableAccounts.length" class="sa-empty">{{ W['no-accounts'] }}</p>
    <template v-else-if="!loadError">
      <nav class="sa-tabs" :aria-label="W.title">
        <button type="button" :aria-pressed="pane === 'rules'" @click="pane = 'rules'">
          {{ W['rules-tab'] }}
        </button>
        <button type="button" :aria-pressed="pane === 'responses'" @click="pane = 'responses'">
          {{ W['responses-tab'] }}
          <span v-if="responses.some((item) => item.status === 'draft')" class="sa-count">
            {{ responses.filter((item) => item.status === 'draft').length }}
          </span>
        </button>
      </nav>

      <div v-if="pane === 'rules'" class="sa-workspace">
        <aside class="sa-list">
          <header class="sa-list-head">
            <div>
              <h3>{{ W['rules-title'] }}</h3>
              <p>{{ W['rules-description'] }}</p>
            </div>
            <button
              v-if="canPublish"
              type="button"
              class="sa-add"
              :aria-label="W['new-rule']"
              @click="resetForm"
            >
              +
            </button>
          </header>
          <p v-if="!rules.length" class="sa-list-empty">{{ W['no-rules'] }}</p>
          <button
            v-for="rule in rules"
            :key="rule.id"
            type="button"
            class="sa-rule-row"
            :class="{ selected: selectedRuleId === rule.id }"
            @click="editRule(rule)"
          >
            <span class="sa-rule-main">
              <strong>{{ rule.keyword }}</strong>
              <small
                >{{ eventLabel(rule.event_kind) }} ·
                {{ bots.find((bot) => bot.slug === rule.bot_slug)?.name || rule.bot_slug }}</small
              >
            </span>
            <span class="sa-rule-meta">
              <span class="sa-mode" :class="{ automatic: rule.mode === 'automatic' }">
                {{ rule.mode === 'automatic' ? W['mode-automatic'] : W['mode-review'] }}
              </span>
              <span class="sa-state" :class="{ paused: !rule.enabled }">
                {{ rule.enabled ? W.enabled : W.paused }}
              </span>
              <span class="sa-destination-tags">
                <span
                  v-for="destination in rule.destinations"
                  :key="destination"
                  class="sa-visibility"
                  :class="destination === 'public_reply' ? 'public' : 'private'"
                >
                  {{ destinationLabel(destination) }}
                </span>
              </span>
            </span>
          </button>
        </aside>

        <form class="sa-editor" @submit.prevent="saveRule">
          <header class="sa-editor-head">
            <div>
              <h3>{{ form.id ? W['edit-rule'] : W['new-rule-title'] }}</h3>
              <p>{{ W['select-rule'] }}</p>
            </div>
            <span v-if="!canPublish" class="sa-readonly">{{ W['read-only'] }}</span>
          </header>
          <p v-if="routeUnavailable" class="sa-warning" role="status">{{ routeUnavailable }}</p>
          <p v-else-if="!routes.length" class="sa-warning">{{ W['no-routes'] }}</p>
          <p v-if="!bots.length" class="sa-warning">{{ W['no-bots'] }}</p>
          <label class="sa-field">
            <span>{{ W.event }}</span>
            <select
              :value="form.eventKind"
              class="ui-select"
              :disabled="!canPublish || !routes.length"
              @change="chooseEvent($event.target.value)"
            >
              <option v-if="routes.some((route) => route.eventKind === 'comment')" value="comment">
                {{ W['comment-event'] }}
              </option>
              <option v-if="routes.some((route) => route.eventKind === 'dm')" value="dm">
                {{ W['dm-event'] }}
              </option>
            </select>
          </label>
          <label class="sa-field">
            <span>{{ W.keyword }}</span>
            <input v-model="form.keyword" maxlength="100" :disabled="!canPublish" />
          </label>
          <label class="sa-field">
            <span>{{ W.bot }}</span>
            <select
              v-model="form.botSlug"
              class="ui-select"
              :disabled="!canPublish || !bots.length"
            >
              <option v-for="bot in bots" :key="bot.slug" :value="bot.slug">{{ bot.name }}</option>
            </select>
          </label>
          <fieldset class="sa-destinations" :disabled="!canPublish">
            <legend>{{ W.destinations }}</legend>
            <label
              v-for="destination in supportedDestinations"
              :key="destination"
              class="sa-destination"
            >
              <input v-model="form.destinations" type="checkbox" :value="destination" />
              <span>
                <strong>{{ destinationLabel(destination) }}</strong>
                <small>{{ visibilityText(destination) }}</small>
              </span>
            </label>
            <p v-if="!supportedDestinations.length && !form.enabled" class="sa-muted">
              {{ W['route-unavailable'] }}
            </p>
          </fieldset>
          <fieldset class="sa-modes" :disabled="!canPublish">
            <legend>{{ W.mode }}</legend>
            <label>
              <input v-model="form.mode" type="radio" value="draft" />
              <span>{{ W['mode-review'] }}</span>
            </label>
            <label>
              <input v-model="form.mode" type="radio" value="automatic" />
              <span>{{ W['mode-automatic'] }}</span>
            </label>
            <p v-if="form.mode === 'automatic'" class="sa-warning">{{ W['automatic-warning'] }}</p>
          </fieldset>
          <label class="sa-enabled">
            <input v-model="form.enabled" type="checkbox" :disabled="!canPublish" />
            <span>{{ form.enabled ? W.enabled : W.paused }}</span>
          </label>
          <footer class="sa-form-actions">
            <button
              class="sa-save"
              type="submit"
              :disabled="
                !canPublish ||
                busy ||
                !form.keyword.trim() ||
                !form.botSlug ||
                !form.destinations.length ||
                (form.enabled && !supportedDestinations.length)
              "
            >
              {{ busy ? W.saving : W['save-rule'] }}
            </button>
            <button v-if="form.id" type="button" class="sa-cancel" @click="resetForm">
              {{ W['cancel-edit'] }}
            </button>
          </footer>
        </form>
      </div>

      <div v-else class="sa-workspace sa-response-workspace">
        <aside class="sa-list">
          <header class="sa-list-head">
            <div>
              <h3>{{ W['responses-title'] }}</h3>
              <p>{{ W['response-history'] }}</p>
            </div>
          </header>
          <p v-if="!responses.length" class="sa-list-empty">{{ W['no-responses'] }}</p>
          <button
            v-for="response in responses"
            :key="response.id"
            type="button"
            class="sa-response-row"
            :class="{ selected: selectedResponseId === response.id }"
            @click="selectedResponseId = response.id"
          >
            <span class="sa-response-top">
              <span
                class="sa-visibility"
                :class="response.destination === 'public_reply' ? 'public' : 'private'"
              >
                {{ destinationLabel(response.destination) }}
              </span>
              <small>{{ responseStatus(response) }}</small>
            </span>
            <strong>{{ eventExcerpt(response.event_id) }}</strong>
            <small>{{ dateLabel(response.created_at) }}</small>
          </button>
        </aside>

        <article v-if="selectedResponse" class="sa-review">
          <header class="sa-review-head">
            <div>
              <span
                class="sa-visibility"
                :class="selectedResponse.destination === 'public_reply' ? 'public' : 'private'"
              >
                {{ destinationLabel(selectedResponse.destination) }}
              </span>
              <h3>{{ W['trigger'] }} · {{ eventLabel(eventForResponse?.event_kind) }}</h3>
              <p>{{ visibilityText(selectedResponse.destination) }}</p>
            </div>
            <span class="sa-status" :class="selectedResponse.status">{{
              responseStatus(selectedResponse)
            }}</span>
          </header>

          <section class="sa-context">
            <h4>{{ W.context }}</h4>
            <div v-if="eventForResponse?.context?.length" class="sa-context-lines">
              <p
                v-for="(item, index) in eventForResponse.context"
                :key="`${eventForResponse.id}-${index}`"
              >
                <small>{{
                  item.author_id && item.author_id === selectedAccount?.external_id
                    ? W['connected-account']
                    : W['other-participant']
                }}</small>
                <span>{{ item.body || item.text }}</span>
              </p>
            </div>
            <p v-else class="sa-muted">{{ W['no-context'] }}</p>
            <blockquote>{{ eventForResponse?.body || W['empty-text'] }}</blockquote>
          </section>

          <label class="sa-field sa-response-field">
            <span>{{ W['response-text'] }}</span>
            <textarea
              v-model="responseText"
              rows="5"
              maxlength="10000"
              :disabled="
                !canPublish ||
                selectedResponse.mode !== 'draft' ||
                selectedResponse.status !== 'draft'
              "
            />
          </label>
          <p v-if="selectedResponse.last_error" class="sa-warning">
            <strong>{{ W['last-error'] }}</strong> · {{ selectedResponse.last_error }}
          </p>
          <footer
            v-if="selectedResponse.mode === 'draft' && selectedResponse.status === 'draft'"
            class="sa-form-actions"
          >
            <button
              class="sa-save"
              type="button"
              :disabled="!canPublish || busy || !responseText.trim()"
              @click="reviewResponse('send')"
            >
              {{ busy ? W.saving : W['send-response'] }}
            </button>
            <button
              class="sa-cancel"
              type="button"
              :disabled="!canPublish || busy"
              @click="reviewResponse('discard')"
            >
              {{ W['discard-response'] }}
            </button>
          </footer>
        </article>
        <p v-else class="sa-review sa-muted">{{ W['select-response'] }}</p>
      </div>
    </template>
  </section>
</template>

<style scoped>
.sa-automations {
  display: grid;
  align-content: start;
  grid-auto-rows: max-content;
  gap: 1rem;
  min-width: 0;
  padding: 0;
  color: var(--ink, #25241f);
}
.sa-heading,
.sa-list-head,
.sa-editor-head,
.sa-review-head,
.sa-form-actions,
.sa-response-top {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 0.8rem;
}
.sa-heading {
  padding: 0;
}
.sa-heading h2,
.sa-list h3,
.sa-editor h3,
.sa-review h3 {
  margin: 0;
  color: var(--ink, #25241f);
}
.sa-heading p,
.sa-list-head p,
.sa-editor-head p,
.sa-review-head p {
  margin: 0.3rem 0 0;
  color: var(--ink2, #77736b);
  font-size: 0.88rem;
}
.sa-account,
.sa-field {
  display: grid;
  gap: 0.35rem;
  color: var(--ink2, #77736b);
  font-size: 0.82rem;
}
.sa-account {
  min-width: min(100%, 17rem);
}
.sa-account select,
.sa-field input,
.sa-field select,
.sa-field textarea {
  width: 100%;
  min-width: 0;
  box-sizing: border-box;
  border: 1px solid var(--line, #ded9cf);
  border-radius: 0.55rem;
  padding: 0.65rem 0.75rem;
  color: var(--ink, #25241f);
  background: var(--paper, #fffdf8);
  font: inherit;
}
.sa-account select {
  height: 2.75rem;
  padding: 0 0.75rem;
}
.sa-field select {
  height: 2.25rem;
  padding: 0 0.75rem;
}
.sa-tabs {
  display: flex;
  width: fit-content;
  gap: 0.25rem;
  padding: 0.2rem;
  border: 1px solid var(--line, #ded9cf);
  border-radius: 0.7rem;
  background: var(--wash, #f2eee5);
}
.sa-tabs button,
.sa-add,
.sa-save,
.sa-cancel {
  border: 0;
  border-radius: 0.5rem;
  padding: 0.6rem 0.8rem;
  font: inherit;
  cursor: pointer;
}
.sa-tabs button {
  color: var(--ink2, #77736b);
  background: transparent;
}
.sa-tabs button[aria-pressed='true'] {
  color: var(--ink, #25241f);
  background: var(--paper, #fffdf8);
  box-shadow: 0 1px 3px #00000012;
}
.sa-count {
  display: inline-grid;
  min-width: 1.2rem;
  height: 1.2rem;
  margin-left: 0.35rem;
  place-items: center;
  border-radius: 999px;
  color: var(--ink, #25241f);
  background: var(--wash, #f2eee5);
  font-size: 0.72rem;
}
.sa-workspace {
  display: grid;
  grid-template-columns: minmax(15rem, 0.8fr) minmax(0, 1.2fr);
  gap: 1rem;
  align-items: start;
}
.sa-list,
.sa-editor,
.sa-review {
  min-width: 0;
  border: 1px solid var(--line, #ded9cf);
  border-radius: 0.85rem;
  background: var(--paper, #fffdf8);
}
.sa-list {
  overflow: hidden;
}
.sa-list-head,
.sa-editor,
.sa-review {
  padding: 1rem;
}
.sa-list-head {
  align-items: start;
  border-bottom: 1px solid var(--line, #ded9cf);
}
.sa-list-head h3,
.sa-editor-head h3,
.sa-review-head h3 {
  font-size: 1rem;
}
.sa-list-head p {
  max-width: 24rem;
}
.sa-add {
  flex: none;
  width: 2.2rem;
  height: 2.2rem;
  padding: 0;
  color: var(--ink, #25241f);
  background: var(--wash, #f2eee5);
  font-size: 1.35rem;
}
.sa-rule-row,
.sa-response-row {
  display: grid;
  width: 100%;
  gap: 0.55rem;
  padding: 0.8rem 1rem;
  border: 0;
  border-bottom: 1px solid var(--line, #ded9cf);
  text-align: left;
  color: var(--ink, #25241f);
  background: transparent;
  font: inherit;
  cursor: pointer;
}
.sa-rule-row:last-child,
.sa-response-row:last-child {
  border-bottom: 0;
}
.sa-rule-row.selected,
.sa-response-row.selected {
  background: var(--wash, #f2eee5);
}
.sa-rule-main,
.sa-rule-meta {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 0.45rem 0.65rem;
}
.sa-rule-main {
  justify-content: space-between;
}
.sa-rule-main strong,
.sa-response-row > strong {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.sa-rule-main small,
.sa-response-row small {
  color: var(--ink2, #77736b);
  font-size: 0.78rem;
}
.sa-mode,
.sa-state,
.sa-visibility,
.sa-status,
.sa-readonly {
  display: inline-flex;
  align-items: center;
  max-width: 100%;
  width: fit-content;
  padding: 0.22rem 0.5rem;
  border-radius: 999px;
  font-size: 0.72rem;
  line-height: 1.3;
}
.sa-mode {
  color: var(--ink2, #77736b);
  background: var(--wash, #f2eee5);
}
.sa-mode.automatic {
  color: var(--ink, #25241f);
  background: color-mix(in srgb, var(--accent, #c56c52) 16%, var(--paper, #fffdf8));
}
.sa-state {
  color: var(--ink, #25241f);
  background: color-mix(in srgb, #438366 14%, var(--paper, #fffdf8));
}
.sa-state.paused {
  color: var(--ink2, #77736b);
  background: var(--wash, #f2eee5);
}
.sa-destination-tags {
  display: flex;
  flex-wrap: wrap;
  gap: 0.35rem;
}
.sa-visibility.public {
  color: #734734;
  background: #f5e9dd;
}
.sa-visibility.private {
  color: #3b5661;
  background: #e6eff1;
}
.sa-editor {
  display: grid;
  gap: 0.85rem;
}
.sa-editor-head {
  align-items: start;
}
.sa-readonly {
  color: var(--ink2, #77736b);
  background: var(--wash, #f2eee5);
}
.sa-field {
  font-size: 0.78rem;
}
.sa-destinations,
.sa-modes {
  display: grid;
  gap: 0.6rem;
  margin: 0;
  padding: 0;
  border: 0;
}
.sa-destinations legend,
.sa-modes legend,
.sa-context h4 {
  margin-bottom: 0.5rem;
  color: var(--ink2, #77736b);
  font-size: 0.8rem;
  font-weight: 600;
}
.sa-destination {
  display: flex;
  gap: 0.6rem;
  align-items: start;
  padding: 0.65rem;
  border: 1px solid var(--line, #ded9cf);
  border-radius: 0.65rem;
}
.sa-destination input,
.sa-modes input,
.sa-enabled input {
  margin-top: 0.18rem;
  accent-color: var(--accent, #c56c52);
}
.sa-destination span {
  display: grid;
  gap: 0.15rem;
}
.sa-destination strong {
  font-size: 0.84rem;
}
.sa-destination small,
.sa-muted {
  color: var(--ink2, #77736b);
  font-size: 0.78rem;
}
.sa-modes label,
.sa-enabled {
  display: flex;
  align-items: start;
  gap: 0.55rem;
  color: var(--ink, #25241f);
  font-size: 0.84rem;
}
.sa-enabled {
  align-items: center;
  padding-top: 0.25rem;
}
.sa-warning,
.sa-error,
.sa-notice {
  margin: 0;
  padding: 0.65rem 0.75rem;
  border-radius: 0.6rem;
  font-size: 0.82rem;
  line-height: 1.45;
}
.sa-warning {
  color: var(--ink2, #77736b);
  background: var(--wash, #f2eee5);
}
.sa-error {
  color: #842f2f;
  background: #f8e9e6;
}
.sa-notice {
  color: var(--ink, #25241f);
  background: color-mix(in srgb, #438366 14%, var(--paper, #fffdf8));
}
.sa-form-actions {
  justify-content: start;
  flex-wrap: wrap;
  padding-top: 0.2rem;
}
.sa-save {
  color: var(--paper, #fffdf8);
  background: var(--accent, #c56c52);
}
.sa-cancel {
  color: var(--ink, #25241f);
  background: var(--wash, #f2eee5);
}
.sa-save:disabled,
.sa-cancel:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}
.sa-list-empty,
.sa-empty {
  margin: 0;
  padding: 1rem;
  color: var(--ink2, #77736b);
  font-size: 0.85rem;
}
.sa-response-top {
  justify-content: space-between;
}
.sa-response-top small {
  text-align: right;
}
.sa-review {
  display: grid;
  gap: 1rem;
}
.sa-review-head {
  align-items: start;
}
.sa-review-head h3 {
  margin-top: 0.6rem;
}
.sa-status {
  color: var(--ink2, #77736b);
  background: var(--wash, #f2eee5);
}
.sa-status.sent {
  color: var(--ink, #25241f);
  background: color-mix(in srgb, #438366 14%, var(--paper, #fffdf8));
}
.sa-status.uncertain,
.sa-status.failed {
  color: #842f2f;
  background: #f8e9e6;
}
.sa-context {
  display: grid;
  gap: 0.55rem;
}
.sa-context h4 {
  margin: 0;
}
.sa-context-lines {
  display: grid;
  gap: 0.4rem;
}
.sa-context-lines p,
.sa-review blockquote {
  display: grid;
  gap: 0.25rem;
  margin: 0;
  padding: 0.7rem 0.8rem;
  border-left: 2px solid var(--line, #ded9cf);
  border-radius: 0.2rem 0.55rem 0.55rem 0.2rem;
  background: var(--wash, #f2eee5);
  font-size: 0.85rem;
  line-height: 1.5;
  overflow-wrap: anywhere;
}
.sa-context-lines small {
  color: var(--ink2, #77736b);
  font-size: 0.72rem;
}
.sa-review blockquote {
  border-left-color: var(--accent, #c56c52);
  background: var(--paper, #fffdf8);
}
.sa-response-field textarea {
  resize: vertical;
  line-height: 1.5;
}
@media (max-width: 760px) {
  .sa-heading {
    align-items: stretch;
    flex-direction: column;
  }
  .sa-account {
    min-width: 0;
  }
  .sa-workspace {
    grid-template-columns: minmax(0, 1fr);
  }
  .sa-rule-main {
    align-items: start;
    flex-direction: column;
  }
  .sa-review-head {
    flex-direction: column;
  }
}
</style>
