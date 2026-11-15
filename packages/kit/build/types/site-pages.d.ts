/* the page table the kit's Vite plugin composes for a site (vite/index.mts pageTable; openspec: modules-as-packages) */
declare module '#site/page-tests' {
  import type { PageRow } from 'platformkit/lib/pages.js'
  export const PAGE_TESTS: PageRow[]
}
declare module '#site/pages' {
  import type { PageRow } from 'platformkit/lib/pages.js'
  import type { Component } from 'vue'
  export const PAGES: Array<PageRow & { component: Component | null }>
}
declare module '#site/admin-screens' {
  import type { Component } from 'vue'
  export const SCREENS: Record<string, Component>
  /* a rail section; one with tabOf joins that item's tabs instead of the rail */
  export const SECTIONS: Array<{ key: string, sec?: string, module: string, after?: string, icon?: string, needs?: string, live?: boolean, afterItem?: string, beforeItem?: string, tabOf?: string }>
  /* the screens handed the rest of the admin path as `name`, and the ones drawn without the dashboards' frame */
  export const PATHED: string[]
  export const BARE: string[]
}
