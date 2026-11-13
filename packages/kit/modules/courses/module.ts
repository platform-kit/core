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
    { name: 'CoursesPage', order: 230, page: 'theme:pages/CoursesPage.vue', test: 'platformkit/lib/page-routes.js#courses' },
  ],
  owns: {
    routes: ['/courses', '/certificates'],
    steps: ['courses-push'],
    cron: [{ name: 'course-notices', schedule: '*/15 * * * *', command: 'select public.run_course_notices()' }],
  },
} satisfies ModuleDeclaration
