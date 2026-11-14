/* the address the API reference answers (openspec: modules-as-packages) */
import { ROUTES } from 'platformkit/lib/router.js'
import type { PageTest } from 'platformkit/lib/page-routes.js'

export const apiReference: PageTest = (r) => r === ROUTES.api
