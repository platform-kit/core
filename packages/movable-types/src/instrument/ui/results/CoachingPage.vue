<script setup>
/* The last tab: a standing invitation to book a session, booked here in the app —
   the option cards, then SessionBooker (the month, the times, the confirm) —
   never on cal.com's page; upcoming sessions are moved and cancelled here too. */
import { ref, watch, onMounted, onBeforeUnmount, computed } from "vue";
import PageHero from "./PageHero.vue";
import SessionBooker from "./SessionBooker.vue";
import CoachHours from "./CoachHours.vue";
import CoachAway from "./CoachAway.vue";
import ProviderOfferings from "./ProviderOfferings.vue";
import ProviderTerms from "./ProviderTerms.vue";
import ProviderEarnings from "./ProviderEarnings.vue";
import { mayReader } from "@platform-kit/kit/supabase/functions/_shared/sessions/page.js";
import { us } from "../strings.js";
import { supabase, configured } from "@platform-kit/kit/lib/supabase.js";
import { isSignedIn, user, isProvider } from "@platform-kit/kit/lib/auth.js";
import { sessionOptions, loadOfferings, cancelSession, markNoShow, placeOf, eventOfType, schedulerOf, answerBooking, companyOf } from "@platform-kit/kit/lib/booking.js";
import { sessions as ALL_SESSIONS } from "#content";
import { recordingFor } from "@platform-kit/kit/lib/recordings.js";
import site from "#site";
/* framed: drawn inside another surface's own header (the community's coaching place), so the page's banner is left off */
const props = defineProps({ framed: { type: Boolean, default: false } });
const C = us("library").coaching.page;
/* the ways to book, for this reader — the site's own declared types (content/sessions) AND the live
   offerings of its providers, in one list, because a reader choosing a time is not thinking about
   which of the two kinds of record they are choosing from */
const offerings = ref([]);
/* WHERE THIS PERSON STANDS as a provider — one read, and the only thing the page does with it is
   offer the terms. Failing to sign stops nothing here; it stops a NEW thing going on sale, which the
   database holds and the offerings surface says. */
const standing = ref(null), termsOpen = ref(false), offeringsEl = ref(null);
async function loadStanding() { if (!isProvider.value || !configured) return; try { const { data } = await supabase.rpc("provider_standing"); standing.value = data || null; } catch (e) { standing.value = null; } }
function askTerms() { termsOpen.value = true; }
async function onSigned() { await loadStanding(); if (offeringsEl.value && offeringsEl.value.reload) await offeringsEl.value.reload(); }
const options = computed(() => sessionOptions(attending.value, offerings.value));
/* moving a booked session: the same picker on its option, with the uid */
const moving = ref(null);
const movingOption = computed(() => (moving.value ? options.value.find((o) => o.event === moving.value.event) || null : null));
function startMove(b) { moving.value = b; tab.value = 'book'; }
/* cancelling one: asked once, then through the app */
const asking = ref(null), cancelling = ref(false), cancelErr = ref('');
async function doCancel(run = false) {
  if (!asking.value) return;
  cancelling.value = true; cancelErr.value = '';
  try { await cancelSession(asking.value.uid, undefined, run === true); asking.value = null; await load(); }
  catch (e) { cancelErr.value = e.message || B['cal-error']; }
  finally { cancelling.value = false; }
}
const B = us("library").coaching.booker || {};
const mine = (b) => !!user.value && b.user_id === user.value.id;
/* a host may move and cancel a session the site scheduled at any time, and mark a no-show once its time has passed */
const hostOf = (b) => !!user.value && b.provider === "native" && (b.host_id === user.value.id || b.provider_id === user.value.id) && b.user_id !== user.value.id;
/* MAY THIS PERSON MOVE OR CANCEL THIS ONE — the type's own switches, through the same pure module
   cancel-session and book-session ask (_shared/sessions/page.js). A button that refuses when it is
   pressed is worse than no button; a host is not held to the reader's switches, because they cancel
   a session they are giving whenever they need to. */
function may(b, what) {
  if (!(mine(b) || hostOf(b))) return false
  if (hostOf(b)) return true
  const type = (options.value || []).find((o) => o.event === b.event) || null
  return mayReader(type, what, b.start_at, Date.now(), b.status).ok
}
/* THE HOST'S WORD. Saying yes is the booking being made — the invitation, the room and the week of
   chat all follow from it — so it goes through the same function a booking goes through. */
const answering = ref('')
async function answer(b, yes) {
  answering.value = b.uid
  try { await answerBooking(b.uid, yes); await load() }
  catch (e) { cancelErr.value = e.message || String(e) }
  finally { answering.value = '' }
}
const canNoShow = (b) => hostOf(b) && !b.no_show && b.end_at && new Date(b.end_at).getTime() < Date.now() && (b.status === "accepted" || b.status === "ended");
const noShowing = ref("");
async function doNoShow(b) { noShowing.value = b.uid; try { await markNoShow(b.uid); await load(); } catch (e) { cancelErr.value = e.message; } finally { noShowing.value = ""; } }
const placeLine = (b) => placeOf(b.where, B);
/* a host books for people: every published type, offered whatever the host's own tier */
const HW = us("library").coaching.host || {};
const forOthers = ref(false);
const hostOptions = computed(() => (ALL_SESSIONS || []).filter((s) => s.published !== false).sort((a, b) => (a.order || 99) - (b.order || 99)).map((s) => ({ ...s, event: eventOfType(s), scheduler: schedulerOf(s), blocked: false, paid: false, credits: 0 })));
function onBookedFor() { load(); }
const madeBy = (b) => (b.made_by_name ? fill(HW["made-by"], { name: b.made_by_name }) : "");
/* a room on this site opens in this tab (the router takes the click); a link elsewhere opens a new one */
const ours = (u) => !!u && (u.startsWith('/') || (typeof location !== 'undefined' && u.startsWith(location.origin + '/')));
function onBooked() { moving.value = null; load(); }
/* the chat is a member's or a coach's (src/pages/ChatPage.vue decides the same way) */


/* the reader's sessions, mirrored from cal.com (supabase/functions/cal-webhook):
   the ones they attend and — for a coach — the ones they give; upcoming ones with
   the way in, past ones with the recording when it has landed. The rows follow
   the webhook live: any change to a booking the reader is on reloads them. */
const rows = ref([]);
async function load() {
  if (!configured) { rows.value = []; offerings.value = []; standing.value = null; return; }
  if (!isSignedIn.value) { rows.value = []; offerings.value = []; standing.value = null; return; }
  const { data } = await supabase.from("bookings").select("uid,title,name,event,start_at,end_at,status,no_show,user_id,provider_id,provider_email,host_id,provider,where,join_url,credit_id,made_by,made_by_name,recording_path,transcript_path,recording_state,recording_error,run_of").order("start_at", { ascending: false }).limit(50);
  rows.value = data || [];
  try { offerings.value = await loadOfferings(); } catch (e) { offerings.value = []; }
  await loadStanding();
}
/* a call's recording: ours, in the bucket, signed for the attendee and the coach when Watch is pressed (session-files);
   the state while it is on its way, or after the keep took it — never a cal.com link */
const watching = ref(null), media = ref({}), mediaBusy = ref("");
const fill = (t, m) => String(t || "").replace(/\{(\w+)\}/g, (_, k) => (m[k] == null ? "" : m[k]));
async function watch_(b) {
  if (watching.value === b.uid) { watching.value = null; return; }
  if (!media.value[b.uid]) { mediaBusy.value = b.uid; try { media.value = { ...media.value, [b.uid]: await recordingFor(b.uid) }; } catch (e) { media.value = { ...media.value, [b.uid]: { error: e.message } }; } finally { mediaBusy.value = ""; } }
  watching.value = b.uid;
}
async function transcript(b) { const m = media.value[b.uid] || (await recordingFor(b.uid)); media.value = { ...media.value, [b.uid]: m }; if (m && m.transcript) window.open(m.transcript, "_blank", "noopener"); }
let channel = null;
function listen() {
  if (channel || !configured || !isSignedIn.value) return;
  channel = supabase.channel("bookings:mine")
    .on("postgres_changes", { event: "*", schema: "public", table: "bookings" }, load)
    .subscribe((status) => { if (status === "SUBSCRIBED") load(); });
}
function unlisten() { if (channel) { try { supabase.removeChannel(channel); } catch (e) { /* gone */ } channel = null; } }
onMounted(() => { load(); listen(); });
onBeforeUnmount(unlisten);
watch(user, () => { unlisten(); load(); listen(); });
const now = () => Date.now();
/* a booking the reader gives rather than attends */
const asCoach = (b) => !!user.value && (b.provider_id === user.value.id || (!!b.provider_email && !!user.value.email && b.provider_email.toLowerCase() === user.value.email.toLowerCase()) ) && b.user_id !== user.value.id;
const attending = computed(() => rows.value.filter((b) => !asCoach(b)));
const live = (b) => (b.status === "accepted" || b.status === "pending") && b.end_at && new Date(b.end_at).getTime() > now();
const upcoming = computed(() => rows.value.filter(live).sort((a, b) => new Date(a.start_at) - new Date(b.start_at)));
/* HOW MANY SESSIONS THE RUN HOLDS, for the row that says "One of 6". Counted from the rows in hand
   rather than asked for: they are all the reader's own, so they are all here already. */
const runOf = computed(() => {
  const n = {}
  for (const b of rows.value) if (b.run_of) n[b.run_of] = (n[b.run_of] || 0) + 1
  const out = {}
  for (const b of rows.value) if (b.run_of && n[b.run_of] > 1) out[b.uid] = n[b.run_of]
  return out
})
/* WHO ELSE IS COMING to each group booking the reader holds a seat of, where its type says to show
   it. One ask per such row as the list changes: the whole value of knowing is knowing before you
   turn up, so it is not put behind a tap. */
const company = ref({})
watch([upcoming, options], async ([rows, opts]) => {
  const out = {}
  for (const b of rows || []) {
    const type = (opts || []).find((o) => o.event === b.event)
    if (!type || (type.page || {}).attendees !== true || !(type.seats > 0)) continue
    const names = await companyOf(b.uid).catch(() => [])
    if (names.length) out[b.uid] = names
  }
  company.value = out
}, { immediate: true })
const past = computed(() => rows.value.filter((b) => !live(b) && b.status !== "rescheduled"));
/* what a row says after its title: who it is with (for the coach), and its state */
const note = (b) => [asCoach(b) && b.name ? C.with + " " + b.name : "", placeLine(b), madeBy(b), b.status === "pending" ? C.pending : b.status === "cancelled" ? C.cancelled : b.status === "rejected" ? C.rejected : "", b.no_show ? C["no-show"] : ""].filter(Boolean);
const tab = ref('book')
const tabs = computed(() => [
  ...(props.framed ? [{ k: 'book', label: C.book, n: 0 }] : []),
  ...(isSignedIn.value ? [
    { k: 'upcoming', label: C.upcoming, n: upcoming.value.length },
    { k: 'past', label: C.past, n: past.value.length },
  ] : []),
  ...(!props.framed ? [{ k: 'book', label: C.book, n: 0 }] : []),
  /* a host's own side — their hours, their time away, what they have earned, booking for someone —
     a tab after the booking rather than four bands above everything a member also reads */
  ...(isProvider.value ? [{ k: 'host', label: C.host, n: 0 }] : []),
])
let picked = false
watch(upcoming, (u) => { if (!picked && !props.framed) tab.value = u.length ? 'upcoming' : 'book' }, { immediate: true })
watch(tab, () => { picked = true })
const when = (iso) => { try { return new Intl.DateTimeFormat(undefined, { weekday: "short", day: "numeric", month: "short", hour: "numeric", minute: "2-digit" }).format(new Date(iso)); } catch (e) { return iso || ""; } };
</script>

<template>
  <div class="coaching">
    <PageHero v-if="!props.framed">
      <template #statement>{{ C.heading }}</template>
      <template #prose>{{ C.prose }}</template>
    </PageHero>
    <!-- The community leads with booking; the standalone sheet opens on an upcoming session when
         there is one. A host's settings stay after the reader's tabs. -->
    <div class="ctabs" role="tablist">
      <button v-for="t in tabs" :key="t.k" type="button" role="tab" class="ctab" :class="{ on: tab === t.k }" :aria-selected="tab === t.k" @click="tab = t.k">
        {{ t.label }}<span v-if="t.n" class="ctab-n">{{ t.n }}</span>
      </button>
    </div>

    <ProviderTerms :standing="standing" :open="termsOpen" @close="termsOpen = false" @signed="onSigned" />
    <!-- THE HOST'S TAB: their hours, their time away, their offerings, what they have earned, and
         booking for someone -->
    <section v-if="tab === 'host' && isProvider" class="sess-host">
      <!-- a host's own hours — an account that gives appointments (an administrator today) -->
      <CoachHours />
      <CoachAway />
      <!-- and what they offer of their own, where the site allows it: the component asks its own
           standing and shows nothing at all where it does not -->
      <ProviderOfferings ref="offeringsEl" @terms="askTerms" />
      <ProviderEarnings />
      <!-- a host books for people: a courtesy, or a sale made elsewhere — nothing charged, no allowance counted -->
      <section class="bf" :class="{ open: forOthers }">
        <button type="button" class="bf-head" :aria-expanded="forOthers" @click="forOthers = !forOthers"><span class="bf-title">{{ HW.title }}</span><span class="bf-sum">{{ HW.lead }}</span><span class="bf-btn">{{ forOthers ? HW.close : HW.open }}</span></button>
        <div v-if="forOthers" class="bf-body"><SessionBooker key="host" host :options="hostOptions" @booked="onBookedFor" /></div>
      </section>
    </section>

    <section v-if="tab === 'upcoming'" class="sess">
      <div v-if="upcoming.length" class="sess-group">
        <div v-for="b in upcoming" :key="b.uid" class="sess-row" :class="{ soft: b.status === 'pending' }">
          <span class="sess-when">{{ when(b.start_at) }}</span>
          <span class="sess-title">{{ b.title }}<i v-for="n in note(b)" :key="n"> · {{ n }}</i><i v-if="runOf[b.uid]"> · {{ fill(B['in-run'], { n: runOf[b.uid] }) }}</i></span>
          <span class="sess-acts">
            <a v-if="b.join_url" class="sess-join" :href="b.join_url" :target="ours(b.join_url) ? null : '_blank'" :rel="ours(b.join_url) ? null : 'noopener'">{{ C.join }}</a>
            <!-- A BOOKING WAITING FOR THE HOST'S WORD is one decision, so it is the only one offered
                 until it is answered: Move and Cancel are for a session that exists. -->
            <!-- THE TITLE ALREADY SAYS IT IS AWAITING CONFIRMATION, so the right-hand side carries the
                 decision and nothing else. For the reader there is nothing to decide, and a row with
                 nothing on the right is honest: the answer is not theirs to give. -->
            <template v-if="b.status === 'pending' && hostOf(b)">
              <button type="button" class="sess-yes" :disabled="answering === b.uid" @click="answer(b, true)">{{ answering === b.uid ? B.answering : B.accept }}</button>
              <button type="button" :disabled="answering === b.uid" @click="answer(b, false)">{{ B.decline }}</button>
            </template>
            <button v-if="b.status !== 'pending' && may(b, 'reschedule')" type="button" @click="startMove(b)">{{ B.move }}</button>
            <button v-if="b.status !== 'pending' && may(b, 'cancel')" type="button" @click="asking = b; cancelErr = ''">{{ C.cancel }}</button>
            <!-- A ROW WITH NOTHING ON THE RIGHT READS AS UNFINISHED. Where the type says neither may
                 be done, the row says so once rather than leaving a blank where the buttons were. -->
            <i v-if="b.status !== 'pending' && (mine(b) || hostOf(b)) && !may(b, 'cancel') && !may(b, 'reschedule')" class="sess-stands">{{ B.stands }}</i>
          </span>
          <!-- WHO ELSE IS COMING, where the type says so. Asked for when the rows are drawn rather
               than put behind a tap: the whole value of it is knowing before you turn up. -->
          <div v-if="company[b.uid] && company[b.uid].length" class="sess-company"><b>{{ B['who-coming'] }}</b><span>{{ company[b.uid].join(' · ') }}</span></div>
          <!-- cancelling: asked once, in the row -->
          <div v-if="asking && asking.uid === b.uid" class="sess-ask">
            <span>{{ B['cancel-ask'] }}<template v-if="b.credit_id"> {{ B['cancel-credit'] }}</template></span>
            <!-- ONE OF A RUN IS TWO QUESTIONS, not one. Cancelling one of six and being left with
                 five is sometimes exactly what somebody means and sometimes the opposite, so it is
                 asked rather than guessed from the fact that it belongs to a run. -->
            <template v-if="b.run_of">
              <button type="button" class="sess-yes" :disabled="cancelling" @click="doCancel(false)">{{ B['cancel-one'] }}</button>
              <button type="button" class="sess-yes" :disabled="cancelling" @click="doCancel(true)">{{ B['cancel-run'] }}</button>
            </template>
            <button v-else type="button" class="sess-yes" :disabled="cancelling" @click="doCancel()">{{ B['cancel-yes'] }}</button>
            <button type="button" :disabled="cancelling" @click="asking = null">{{ B['cancel-no'] }}</button>
            <em v-if="cancelErr">{{ cancelErr }}</em>
          </div>
        </div>
      </div>
      <p v-else class="sess-none">{{ isSignedIn ? C['none-upcoming'] : C.signin }} <button v-if="isSignedIn" type="button" class="sess-link" @click="tab = 'book'">{{ C.book }}</button></p>
    </section>

    <section v-else-if="tab === 'past'" class="sess">
      <div v-if="past.length" class="sess-group">
        <div v-for="b in past" :key="b.uid" class="sess-row" :class="{ off: b.status === 'cancelled' || b.status === 'rejected' }">
          <span class="sess-when">{{ when(b.start_at) }}</span>
          <span class="sess-title">{{ b.title }}<i v-for="n in note(b)" :key="n"> · {{ n }}</i></span>
          <span class="sess-acts">
            <button v-if="b.recording_path" type="button" class="sess-join" :disabled="mediaBusy === b.uid" @click="watch_(b)">{{ watching === b.uid ? C['recording-hide'] : C.recording }}</button>
            <button v-if="b.transcript_path" type="button" class="sess-link" @click="transcript(b)">{{ C.transcript }}</button>
            <button v-if="canNoShow(b)" type="button" :disabled="noShowing === b.uid" @click="doNoShow(b)">{{ B['no-show'] }}</button>
            <i v-else-if="b.recording_state === 'pending' || b.recording_state === 'failed'" class="sess-note">{{ C['recording-pending'] }}</i>
            <i v-else-if="b.recording_state === 'removed'" class="sess-note">{{ fill(C['recording-kept'], { n: b.recording_error }) }}</i>
          </span>
          <div v-if="watching === b.uid && media[b.uid]" class="sess-player">
            <video v-if="media[b.uid].recording" controls preload="metadata" :src="media[b.uid].recording" />
            <i v-else class="sess-note">{{ media[b.uid].error || C['recording-pending'] }}</i>
          </div>
        </div>
      </div>
      <p v-else class="sess-none">{{ isSignedIn ? C['none-past'] : C.signin }}</p>
    </section>

    <div v-else-if="tab === 'book'" class="book">
      <!-- moving a session: its option, named, and a way back -->
      <div v-if="moving" class="which-one moving"><b>{{ B.move }} · {{ moving.title }}</b><span>{{ when(moving.start_at) }}</span><button type="button" class="sess-link" @click="moving = null">{{ B.back }}</button></div>
    <SessionBooker v-if="moving && movingOption" :key="'move:' + moving.uid" :options="options" :moving="moving" :require-auth-to-book="site.coaching.requireAuthToBook !== false" @moved="onBooked" />
    <SessionBooker v-else-if="options.length" key="book" :options="options" :require-auth-to-book="site.coaching.requireAuthToBook !== false" @booked="onBooked" />
    <p v-else class="sess-none">{{ C['none-options'] }}</p>
    </div>
  </div>
</template>

<style scoped>
.ctabs { display: flex; gap: 4px; margin: 0 0 var(--s3); padding: 3px; border: 1px solid var(--qhair); border-radius: 999px; background: color-mix(in srgb, var(--qink) 4%, transparent); width: max-content; max-width: 100% }
.ctab { font: inherit; font-size: 13.5px; color: var(--qink3); background: transparent; border: 0; border-radius: 999px; padding: 8px 16px; cursor: pointer; display: inline-flex; align-items: center; gap: 7px; white-space: nowrap }
.ctab.on { color: var(--qflip, #fff); background: var(--qink) }
.ctab-n { font-family: var(--m); font-size: 10.5px; padding: 1px 6px; border-radius: 999px; background: color-mix(in srgb, currentColor 14%, transparent) }
.sess-link { font: inherit; font-size: 14px; color: var(--qink); background: none; border: 0; padding: 0; text-decoration: underline; cursor: pointer }
.sess { margin: 0 0 var(--s3); padding: 0; min-height: 80px }
.sess-group + .sess-group { margin-top: var(--s2) }
.sess h3 { font-size: 14.5px; font-weight: 700; color: var(--qink); margin: 0 0 8px }
.sess-row { display: grid; grid-template-columns: 170px minmax(0, 1fr) auto; gap: 12px; align-items: center; padding: 12px 16px; border: 1px solid var(--qhair); border-radius: 12px; background: var(--qcard); margin-bottom: 8px }
.sess-company { grid-column: 1 / -1; display: flex; gap: 10px; align-items: baseline; font-size: 13px; color: var(--qink2); padding-top: 4px }
.sess-company b { font-weight: 600; color: var(--qink3); font-size: 12px }
.sess-row.off { opacity: .6 }
.sess-row.soft { border-style: dashed }
.sess-when { font-family: var(--m); font-size: 12px; color: var(--qink3) }
.sess-title { font-size: 15px; color: var(--qink) }
.sess-title i { font-style: normal; color: var(--qink3) }
.sess-acts { display: flex; gap: 8px; flex-wrap: wrap; justify-content: flex-end; align-items: center }
.sess-stands { font-style: normal; font-size: 12.5px; color: var(--qink3) }
.sess-link { font: inherit; font-size: 13px; color: var(--qink2); background: none; border: 0; padding: 6px 4px; cursor: pointer; text-decoration: underline; text-underline-offset: 3px }
.sess-note { font-size: 12.5px; color: var(--qink3); font-style: normal }
.sess-player { grid-column: 1 / -1; margin-top: 4px } .sess-player video { display: block; width: 100%; max-height: 62vh; border-radius: 10px; background: #000 }
.sess-acts a { font-size: 13px; color: var(--qink2); text-decoration: none; padding: 6px 12px; border: 1px solid var(--qhair); border-radius: 999px }
.sess-acts a.sess-join { color: var(--qflip, #fff); background: var(--qink); border-color: var(--qink) }
.sess-acts button { font: inherit; font-size: 13px; color: var(--qink2); background: transparent; padding: 6px 12px; border: 1px solid var(--qhair); border-radius: 999px; cursor: pointer }
.sess-ask { grid-column: 1 / -1; display: flex; flex-wrap: wrap; align-items: center; gap: 10px; font-size: 13.5px; color: var(--qink2); padding-top: 8px; border-top: 1px dashed var(--qhair) }
.sess-ask button { font: inherit; font-size: 13px; padding: 6px 12px; border-radius: 999px; border: 1px solid var(--qhair); background: transparent; color: var(--qink2); cursor: pointer }
.sess-ask .sess-yes { color: var(--qflip, #fff); background: var(--qink); border-color: var(--qink) }
.sess-ask em { font-style: normal; color: var(--lvcatch, #dd3b3b) }
.which-one.moving { display: flex; align-items: center; gap: 12px; flex-wrap: wrap } .which-one.moving b, .which-one.moving span { display: inline; margin: 0 }
.sess-none { font-size: 14px; color: var(--qink3); margin: 0 0 var(--s3) }
.bf { border: 1px solid var(--qhair); border-radius: 14px; background: var(--qcard); margin: 0 0 var(--s3); padding: 0; overflow: hidden }   /* padding 0: the global stylesheet gives a section its own */
.bf-head { display: grid; grid-template-columns: auto minmax(0, 1fr) auto; align-items: center; gap: 12px; width: 100%; font: inherit; text-align: left; padding: 14px 16px; background: none; border: 0; color: var(--qink); cursor: pointer }
.bf-title { font-weight: 700; font-size: 15px } .bf-sum { font-size: 13px; color: var(--qink3); overflow: hidden; text-overflow: ellipsis; white-space: nowrap } .bf-btn { font-size: 13px; color: var(--qink2); padding: 6px 12px; border: 1px solid var(--qhair); border-radius: 999px; white-space: nowrap }
.bf-body { padding: 4px 16px 16px; border-top: 1px dashed var(--qhair) }
@media (max-width: 640px) { .bf-head { grid-template-columns: minmax(0, 1fr) auto } .bf-title { grid-row: 1 } .bf-btn { grid-row: 1; grid-column: 2; justify-self: end } .bf-sum { grid-column: 1 / -1; grid-row: 2; white-space: normal } }
@media (max-width: 640px) { .sess-row { grid-template-columns: 1fr; gap: 6px } .sess-acts { justify-content: flex-start } }
/* on a phone the three tabs share the width instead of the last one leaving the screen */
@media (max-width: 480px) {
  .ctabs { width: 100%; box-sizing: border-box }
  .ctab { flex: 1 1 0; justify-content: center; gap: 4px; padding: 7px 3px;
    font-size: 11px; line-height: 1.2; min-width: 0; white-space: nowrap; text-align: center }
  .ctabs { margin-bottom: 12px }
}
</style>
