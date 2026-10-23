/*
 * THE KIT'S PANELS FOR THE PRIVATE HALF OF A MEMBER'S CARD, in the order they are drawn: where somebody is working (the
 * instrument), what they have read (the library), what they have bought (the store), the courses they are taking. Core keeps the ones whose module
 * the site has on (vite's #site/member), then applies the site's own `off`, `panels` and `order`.
 *
 * Each is handed a person's id, fetches its own data, and every read it makes asks may_see_member first. Its words are
 * the theme's content/ui/spaces.md (## member-panels), which a site rewords in its own strings.
 */
import { us } from 'platformkit/lib/content.js'
import MemberWorking from './MemberWorking.vue'
import MemberRead from './MemberRead.vue'
import MemberBought from './MemberBought.vue'
import MemberCourses from './MemberCourses.vue'

const W = () => us('spaces')['member-panels'].main

/* a title is a function because it is about somebody: on your own card these are about YOU, and one string cannot say
   both without reading as a form letter */
const say = (key) => ({ mine }) => W()[key + (mine ? '-title-own' : '-title')]

export const kitPanels = [
  { key: 'working', title: say('working'), component: MemberWorking },
  { key: 'read', title: say('read'), component: MemberRead },
  { key: 'bought', title: say('bought'), component: MemberBought },
  /* the courses somebody is taking (the courses module), worded from content/ui/courses.md */
  { key: 'courses', title: ({ mine }) => us('courses')['member-panel'].main[mine ? 'title-mine' : 'title-theirs'], component: MemberCourses },
]
