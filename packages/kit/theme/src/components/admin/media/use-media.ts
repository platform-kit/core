/*
 * What the slot components share: VueFinder's own composables, reached from inside its slots (the slot content is
 * rendered under its provide tree), and the selection MediaPage provides. `menuAction(id)` finds one of VueFinder's
 * menu items by id — new-folder · upload · search · select-all · deselect · copy · paste · move · rename · delete ·
 * refresh · grid-view · list-view · tree-view — and runs its action, so every button of ours does exactly what
 * VueFinder's own menubar did, modals included; the menubar itself is gone from the page.
 */
import { inject, computed } from 'vue'
import { useMenuItems, useBreadcrumbActions } from 'vuefinder'
import { us } from 'platformkit/lib/strings.js'
import { toStore } from '../../../lib/admin/media-driver.js'

export const SELECTION = Symbol('media-selection')
export const USAGE = Symbol('media-usage')   /* { [store path]: [{ file, collection, title }] } for the selection: a file in use */
export const words = () => us('media').page

// @ts-expect-error TS2345, from the conversion: Argument of type 'any' is not assignable to parameter of type 'never'.
const flat = (items: any, out = []) => { for (const it of items || []) { out.push(it); if (it.items) flat(it.items, out) } return out }
export function useMedia() {
  const { menuItems } = useMenuItems()
  const crumbs = useBreadcrumbActions()
  const all = computed(() => flat(menuItems.value))
  const item = (id: any) => all.value.find((x: any) => x.id === id)
  const menuAction = (id: any) => { const it: any = item(id); if (it && it.action) it.action() }
  const enabled = (id: any) => { const it: any = item(id); return !it || !it.enabled || it.enabled() }
  const checked = (id: any) => { const it: any = item(id); return !!(it && it.checked && it.checked()) }
  const selection = inject(SELECTION, computed(() => []))
  const usage: any = inject(USAGE, computed(() => ({})))
  /* the records that name an entry, by its VueFinder path */
  const usedBy = (item: any) => (item && usage.value[toStore(item.path)]) || []
  return { menuAction, enabled, checked, crumbs, selection, usage, usedBy, W: words() }
}
