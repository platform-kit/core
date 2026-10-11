<script setup>
/*
 * THE HEAD OF AN ADMIN PAGE — one of them, for every page.
 *
 * Every page in the admin already drew the same thing: a title, a line under it, and the page's
 * own controls to the right. What they did not share was a single class, so each invented its
 * own `an-head`, `po-head`, `su-head`, `cma-head`, `sa-head`, `ak-head`, `pp-phead` — and with
 * the class went every value. Measured across the admin on one morning, the same element was:
 *
 *   26 · 54 · 62 · 96 · 152 px from the top        (People was a hundred and fifty-two)
 *   274 or 302 px from the left                    (two different gutters)
 *   22 · 26 · 27 · 28 · 30 · 32 · 34 px            (seven sizes for one thing)
 *   600 · 700 · 800                                (three weights)
 *   Plus Jakarta Sans, or Inter                    (two typefaces)
 *
 * None of that was a decision anybody made; it is what a shared pattern with no shared
 * implementation decays into. So this is the implementation, and a page that wants a heading
 * uses it rather than agreeing to use the same numbers.
 *
 *   <AdminHead :title="H.title" :sub="H.subtitle">
 *     <template #actions> …the page's own controls… </template>
 *   </AdminHead>
 *
 * A TABBED PAGE KEEPS ITS TITLE and puts the tabs under it. They were tried in place of the
 * title and that was wrong: a tabbed page was then the only page in the admin with no heading,
 * which is exactly the inconsistency this component exists to end. The title names the subject
 * — Comments, Emails — and the tabs name its parts.
 *
 * AND THE HEAD IS THE PAGE'S, NOT THE TAB'S. On a page in a set, the title and the line under it
 * are the SET's and do not change when you move between tabs; what belongs to the open tab — its
 * count, its controls, its New button — goes in the row with the tabs. Letting each tab put its
 * own lead and its own controls in the head meant the top of the page rearranged itself every
 * time you touched a tab, which is one page behaving like two.
 *
 * AND THE PAGE DOES NOT HAVE TO KNOW. Whether a view belongs to a set is the shell's business —
 * it owns the rail and the addresses — so the shell provides it and this asks. A page put into a
 * set tomorrow grows its tabs with no edit of its own, which is the only way a set stays a set:
 * the alternative is every member of it remembering to draw the same row.
 */
import { inject, computed } from 'vue'
import AdminTabs from './AdminTabs.vue'

defineProps({
  title: { type: String, default: '' },
  /* the line under the title: what the page is for, in one sentence */
  sub: { type: String, default: '' },
})

/* { tabs, on, label, count, pick, title } while this view is part of a set, else null */
const set = inject('adminTabs', null)
const tabs = computed(() => (set && set.value) || null)
/* a page in a set is named for the SET, not for the tab that happens to be open: the title says
   Comments whichever of its two tabs you are on */
const setTitle = computed(() => (tabs.value && tabs.value.title) || '')
</script>

<template>
  <!--
    ONE SHAPE FOR EVERY PAGE IN THE ADMIN.

      the head   the page's name and one line saying what it is for — and NOTHING else, so it
                 reads the same whichever tab of the page you are on
      the bar    the tabs, where there are any, and everything the page can be DONE TO: its
                 filters, its ranges, its New button
      the page   underneath

    The controls used to sit in the head on some pages and under it on others, so the top of
    every page was arranged differently from the one before it. There is one place now.
  -->
  <header class="ui-pagehead">
    <div class="ui-pagename">
      <h1 class="ui-pagetitle">{{ setTitle || title }}<slot v-if="!tabs" name="afterTitle" /></h1>
      <!-- in a set the line is the SET's, and where there is none there is none: falling back to
           the open tab's own is what made the head rearrange itself as you moved between tabs -->
      <p v-if="tabs" v-show="tabs.lead" class="ui-pagesub">{{ tabs.lead }}</p>
      <p v-else-if="sub || $slots.sub" class="ui-pagesub"><slot name="sub">{{ sub }}</slot></p>
    </div>
  </header>
  <div v-if="tabs || $slots.barLeft || $slots.actions" class="ui-pagebar">
    <div class="ui-pagebarleft">
      <AdminTabs v-if="tabs" :tabs="tabs.tabs" :on="tabs.on" :label="tabs.label" :count="tabs.count" @pick="tabs.pick" />
      <slot name="barLeft" />
    </div>
    <div v-if="$slots.actions" class="ui-pageacts"><slot name="actions" /></div>
  </div>
</template>
