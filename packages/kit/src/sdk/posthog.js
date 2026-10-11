/*
 * The drop-in: window.posthog with posthog-js's public surface, name for name — a page written for PostHog changes
 * the script's URL (<site>/analytics.js, or PostHog's own snippet with api_host set to the site, which loads
 * <site>/static/array.js) and nothing else. What we do — init, capture, identify, alias, reset, the super properties,
 * the person properties, groups, the opt-out, exceptions, $pageview and $pageleave — does the work through the shared
 * core (sdk/core.js) into the site's one door, <api_host>/api/events, under the key the site registered for this
 * source. What we do not do — feature flags, surveys, session recording, autocapture, the toolbar, early access — is
 * there with PostHog's names and return shapes (false, undefined, [], null, this) and never throws. The one place the
 * meaning differs, on purpose: opting out turns the fingerprint off and sends the events on under a random id, where
 * PostHog falls silent. build/analytics-sdk.test.mjs reads posthog-js's declarations and checks every name is here.
 */
import { createCore, localStore, pageProps } from './core.js'

const noop = () => {}
const now = () => new Date().toISOString()

function makePosthog() {
  let core = null, config = {}, key = '', pending = []
  const ph = {}
  const ready = () => !!core
  const run = (fn) => { if (ready()) fn(); else pending.push(fn) }

  ph.init = function (token, options, name) {
    if (core) return ph
    key = String(token || '')
    config = { api_host: '', capture_pageview: true, capture_pageleave: true, persistence: 'localStorage', debug: false, autocapture: false, ...(options || {}) }
    const host = String(config.api_host || '').replace(/\/+$/, '')
    core = createCore({
      endpoint: host + '/api/events', key, prefix: 'ph_' + key + '_',
      store: config.persistence === 'memory' ? undefined : localStore('ph_' + key + '_'), persistence: config.persistence,
      fingerprint: config.fingerprint !== false, debug: !!config.debug,
      beforeSend: config.before_send ? (row) => { const r = config.before_send({ event: row.type, properties: row.props, timestamp: row.occurred_at, uuid: row.session_id }); if (!r) return null; return { ...row, type: r.event || row.type, props: r.properties || row.props } } : null,
    })
    core.start()
    for (const fn of pending) fn(); pending = []
    if (config.capture_pageview !== false) ph.capture('$pageview')
    if (config.capture_pageleave !== false && typeof window !== 'undefined') window.addEventListener('pagehide', () => ph.capture('$pageleave'))
    if (config.capture_pageview === 'history_change' || config.capture_pageview === true) hookHistory()
    if (typeof config.loaded === 'function') { try { config.loaded(ph) } catch (e) { /* theirs */ } }
    if (typeof window !== 'undefined' && name) window[name] = ph
    return ph
  }
  /* a single-page app's route changes are page views, as PostHog counts them */
  let lastPath = ''
  function hookHistory() {
    if (typeof history === 'undefined') return
    lastPath = location.pathname + location.search
    const fire = () => { const p = location.pathname + location.search; if (p !== lastPath) { lastPath = p; ph.capture('$pageview') } }
    for (const m of ['pushState', 'replaceState']) { const orig = history[m]; history[m] = function (...a) { const r = orig.apply(this, a); setTimeout(fire, 0); return r } }
    window.addEventListener('popstate', () => setTimeout(fire, 0))
  }

  /* ---- what does the work ---- */
  ph.capture = function (event, properties, options) {
    run(() => core.capture(String(event), { ...pageProps(), ...(properties || {}) }, { startType: '$pageview', noStart: String(event) === '$pageview' }))
    return { uuid: '', event: String(event), properties: properties || {}, timestamp: now() }
  }
  ph.identify = function (distinct_id, set, set_once) {
    run(() => {
      const was = core.distinctId()
      if (distinct_id != null) core.identify(distinct_id)
      const props = {}
      if (set && typeof set === 'object') props.$set = set
      if (set_once && typeof set_once === 'object') props.$set_once = set_once
      if (distinct_id != null && distinct_id !== was) core.capture('$identify', { ...pageProps(), ...props, $anon_distinct_id: core.anonId() }, { noStart: true })
      else if (Object.keys(props).length) core.capture('$set', { ...pageProps(), ...props }, { noStart: true })
    })
  }
  ph.alias = function (alias, original) { run(() => core.capture('$create_alias', { ...pageProps(), alias: String(alias), distinct_id: original != null ? String(original) : core.distinctId() }, { noStart: true })) }
  ph.reset = function (reset_device_id) { run(() => { core.reset(); if (reset_device_id) { core.store.remove('anon'); core.store.remove('fp') } }) }
  ph.register = function (properties, days) { run(() => core.register(properties || {})) }
  ph.register_once = function (properties, default_value, days) { run(() => core.register(properties || {}, true)) }
  ph.register_for_session = function (properties) { run(() => core.register(properties || {})) }
  ph.unregister = function (property) { run(() => core.unregister(property)) }
  ph.unregister_for_session = function (property) { run(() => core.unregister(property)) }
  ph.get_distinct_id = function () { return ready() ? (core.distinctId() || core.anonId()) : '' }
  ph.get_session_id = function () { return ready() ? core.session() : '' }
  ph.get_property = function (property) { return ready() ? core.superProps()[property] : undefined }
  ph.getSessionProperty = function (property) { return undefined }
  ph.setPersonProperties = function (set, set_once) { ph.identify(undefined, set, set_once) }
  ph.unsetPersonProperties = function (props) { run(() => core.capture('$set', { ...pageProps(), $unset: Array.isArray(props) ? props : [props] }, { noStart: true })) }
  ph.setIdentity = function (distinct_id, set, set_once) { ph.identify(distinct_id, set, set_once) }
  ph.clearIdentity = function () { ph.reset() }
  ph.createPersonProfile = function () { run(() => core.capture('$set', { ...pageProps(), $set: {} }, { noStart: true })) }
  ph.people = { set: (props, to, cb) => { ph.setPersonProperties(typeof props === 'string' ? { [props]: to } : props); if (typeof cb === 'function') cb() }, set_once: (props, to, cb) => { ph.setPersonProperties(undefined, typeof props === 'string' ? { [props]: to } : props); if (typeof cb === 'function') cb() } }
  ph.group = function (group_type, group_key, group_properties) { run(() => { const groups = { ...(core.superProps().$groups || {}), [group_type]: group_key }; core.register({ $groups: groups }); if (group_properties) core.capture('$groupidentify', { ...pageProps(), $group_type: group_type, $group_key: group_key, $group_set: group_properties }, { noStart: true }) }) }
  ph.resetGroups = function () { run(() => core.unregister('$groups')) }
  ph.getGroups = function () { return ready() ? (core.superProps().$groups || {}) : {} }
  ph.opt_out_capturing = function () { run(() => core.optOut()) }
  ph.opt_in_capturing = function (options) { run(() => { core.optIn(); if (options && options.captureEventName !== false && options.captureEventName !== undefined) ph.capture(typeof options.captureEventName === 'string' ? options.captureEventName : '$opt_in') }) }
  ph.has_opted_out_capturing = function () { return ready() ? core.optedOut() : false }
  ph.has_opted_in_capturing = function () { return ready() ? !core.optedOut() : false }
  ph.clear_opt_in_out_capturing = function () { run(() => core.optIn()) }
  ph.get_explicit_consent_status = function () { return ready() ? (core.optedOut() ? 'denied' : 'granted') : 'pending' }
  ph.is_capturing = function () { return ready() }
  ph.captureException = function (error, additionalProperties) { const e = error instanceof Error ? error : new Error(String(error)); ph.capture('$exception', { $exception_list: [{ type: e.name, value: e.message, stacktrace: { type: 'raw', frames: [] } }], ...(additionalProperties || {}) }) }
  ph.addExceptionStep = noop
  ph.captureLog = noop
  ph.captureTraceFeedback = function (trace_id, feedback) { ph.capture('$ai_feedback', { $ai_trace_id: trace_id, $ai_feedback_text: feedback }) }
  ph.captureTraceMetric = function (trace_id, metric_name, metric_value) { ph.capture('$ai_metric', { $ai_trace_id: trace_id, $ai_metric_name: metric_name, $ai_metric_value: metric_value }) }
  ph.calculateEventProperties = function (event_name, event_properties) { return { ...pageProps(), ...(ready() ? core.superProps() : {}), ...(event_properties || {}) } }
  ph.set_config = function (options) { config = { ...config, ...(options || {}) }; if (options && 'debug' in options && core) core.debug = !!options.debug }
  ph.debug = function (debug) { config.debug = debug !== false; try { localStorage.setItem('ph_debug', config.debug ? 'true' : 'false') } catch (e) { /* none */ } }
  ph.push = function (item) { if (Array.isArray(item) && typeof ph[item[0]] === 'function') ph[item[0]](...item.slice(1)) }
  ph.getPageViewId = function () { return ready() ? core.session() : undefined }
  ph.on = function (event, cb) { return noop }
  ph.onSessionId = function (cb) { return noop }
  ph.toString = function () { return 'posthog' }
  ph.shutdown = noop
  ph.setInternalOrTestUser = noop
  ph.loadToolbar = function () { return false }

  /* ---- what we do not do, with PostHog's shape ---- */
  ph.getFeatureFlag = function () { return undefined }
  ph.getFeatureFlagPayload = function () { return undefined }
  ph.getFeatureFlagResult = function () { return undefined }
  ph.getAllFeatureFlags = function () { return {} }
  ph.isFeatureEnabled = function () { return false }
  ph.reloadFeatureFlags = noop
  ph.updateFlags = noop
  ph.onFeatureFlags = function (cb) { if (typeof cb === 'function') { try { cb([], {}, { errorsLoading: false }) } catch (e) { /* theirs */ } } return noop }
  ph.setPersonPropertiesForFlags = noop
  ph.resetPersonPropertiesForFlags = noop
  ph.setGroupPropertiesForFlags = noop
  ph.resetGroupPropertiesForFlags = noop
  ph.getEarlyAccessFeatures = function (cb) { if (typeof cb === 'function') cb([]) }
  ph.updateEarlyAccessFeatureEnrollment = noop
  ph.getSurveys = function (cb) { if (typeof cb === 'function') cb([]) }
  ph.getActiveMatchingSurveys = function (cb) { if (typeof cb === 'function') cb([]) }
  ph.onSurveysLoaded = function (cb) { if (typeof cb === 'function') { try { cb([], { isLoaded: true }) } catch (e) { /* theirs */ } } return noop }
  ph.renderSurvey = noop
  ph.displaySurvey = noop
  ph.cancelPendingSurvey = noop
  ph.canRenderSurvey = function () { return { visible: false, disabledReason: 'surveys are not part of this analytics' } }
  ph.canRenderSurveyAsync = async function () { return ph.canRenderSurvey() }
  ph.startSessionRecording = noop
  ph.stopSessionRecording = noop
  ph.sessionRecordingStarted = function () { return false }
  ph.get_session_replay_url = function () { return null }
  ph.startExceptionAutocapture = noop
  ph.stopExceptionAutocapture = noop
  ph.surveys = { getSurveys: ph.getSurveys, getActiveMatchingSurveys: ph.getActiveMatchingSurveys, renderSurvey: noop, canRenderSurvey: ph.canRenderSurvey }
  ph.featureFlags = { getFlags: () => [], getFlagVariants: () => ({}), getFeatureFlag: () => undefined, isFeatureEnabled: () => false, onFeatureFlags: ph.onFeatureFlags, reloadFeatureFlags: noop, override: noop, overrideFeatureFlags: noop }
  ph.sessionRecording = null
  Object.defineProperty(ph, 'config', { get: () => config, enumerable: true })
  Object.defineProperty(ph, '__loaded', { get: () => ready(), enumerable: true })
  ph.LIB_VERSION = 'platformkit'
  ph.version = 'platformkit'
  return ph
}

/* the object, and — where PostHog's own snippet was there first, an array of queued calls with its init calls in _i — the replay */
export function install(win) {
  const ph = makePosthog()
  const stub = win && win.posthog
  if (win) win.posthog = ph
  if (stub && stub !== ph) {
    for (const init of (stub._i || [])) { try { ph.init(init[0], init[1], init[2]) } catch (e) { /* theirs */ } }
    if (Array.isArray(stub)) for (const call of stub) { if (Array.isArray(call) && typeof ph[call[0]] === 'function') { try { ph[call[0]](...call.slice(1)) } catch (e) { /* theirs */ } } }
    if (stub.people && Array.isArray(stub.people)) for (const call of stub.people) { if (Array.isArray(call) && ph.people[call[0]]) ph.people[call[0]](...call.slice(1)) }
  }
  return ph
}

export { makePosthog }
