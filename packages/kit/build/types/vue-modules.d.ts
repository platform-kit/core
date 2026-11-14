/* a .vue file imported from TypeScript outside the theme's folder — a module's front door exporting one of its screens
   (openspec: modules-as-packages). Where vue-tsc resolves the file itself it uses the component's own types; this is what a
   .ts file gets where it cannot. */
declare module '*.vue' {
  import type { DefineComponent } from 'vue'
  const component: DefineComponent<Record<string, unknown>, Record<string, unknown>, unknown>
  export default component
}
