/* the addresses courses' page answers: the library, a course, a lesson and a certificate (openspec: courses) */
import { coursesRoute } from 'platformkit/lib/router.js'
import type { PageTest } from 'platformkit/lib/page-routes.js'

export const coursesPage: PageTest = (r) => coursesRoute(r)
