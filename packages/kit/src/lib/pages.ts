/*
 * The page an address shows (openspec: modules-as-packages): the first page of the site's page table, in order,
 * whose test holds. The table is core's pages and every enabled module's, composed by the kit's Vite plugin as
 * #site/pages; App.vue shows what this returns, and build/route-census.mts asks it the same question.
 */
import type { PageContext, PageTest } from './page-routes.js'

export type PageRow = { name: string, order: number, module: string, test: PageTest, keyBy: 'route' | null, props: Record<string, string> }

export function pageAt<T extends PageRow>(pages: readonly T[], route: string, ctx: PageContext): T | null {
  for (const p of pages) if (p.test(route, ctx)) return p
  return null
}

/* the props a page is given: 'route' is the address itself, anything else as written */
export const propsOf = (p: PageRow, route: string): Record<string, string> =>
  Object.fromEntries(Object.entries(p.props).map(([k, v]) => [k, v === 'route' ? route : v]))
