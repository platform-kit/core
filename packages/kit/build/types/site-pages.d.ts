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
  export const SECTIONS: Array<{ key: string, sec: string, module: string, after?: string, icon?: string, needs?: string, live?: boolean, afterItem?: string, beforeItem?: string }>
}
