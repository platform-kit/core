/*
 * COURSES: sections and lessons in order, released over time, tracked to completion (openspec: courses). A course
 * is a declaration (content/courses), projected into tables the database alone answers from — which lessons are
 * open, and a lesson's text only when it is — so there is no static shape: enrolment and progress need somewhere to live.
 *
 * Everything courses is lives in this folder (openspec: modules-as-packages): its schema, its function, and what it
 * adds when spaces, forms or sessions is on (integrations/). The manifest names none of those files; the folder does.
 */
import type { ModuleDeclaration } from '../../build/modules/manifest.mjs'

export default {
  key: 'courses', what: 'courses: lessons in order, released over time, tracked to completion, with certificates',
  needs: 'there is nowhere to keep who is enrolled, how far they are, or what is open to them',
  static: false, git: true, cloud: true,
  pages: [
    { name: 'CoursesPage', order: 230, page: './ui/CoursesPage.vue', test: './lib/routes.ts#coursesPage' },
  ],
  fills: {
    /* who is enrolled, with names and addresses: an administrator's screen */
    'core:admin-screen': [{ key: 'course-enrollments', component: './ui/admin/CourseEnrollments.vue' }],
    /* where the community is there to hold it, a Courses place in it, beside the pages of their own */
    'spaces:place': [{ key: 'courses', word: 'courses', icon: 'course', component: './ui/CoursesPlace.vue', wide: true, shows: 'everyone', claims: [], with: ['network'] }],
    /* the courses somebody is taking, on their card */
    'spaces:member-card': [{ key: 'courses', component: './integrations/spaces/MemberCourses.vue', words: { scope: 'courses', group: 'member-panel', mine: 'title-mine', theirs: 'title-theirs' } }],
  },
  owns: {
    routes: ['/courses', '/certificates'],
    steps: ['courses-push'],
    cron: [{ name: 'course-notices', schedule: '*/15 * * * *', command: 'select public.run_course_notices()' }],
  },
} satisfies ModuleDeclaration
