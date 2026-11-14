/* everything push is lives in this folder (openspec: modules-as-packages) */
import type { ModuleDeclaration } from '../../build/modules/manifest.mjs'

export default {
  key: 'push', what: 'web push to the staff', needs: 'there is nothing to send a notification from',
  static: false, git: true, cloud: true,
  fills: {
    /* who on the staff is told what, in the admin's settings after the strings */
    'core:admin-screen': [{ key: 'notifications', component: './ui/PushSettings.vue' }],
    'core:admin-rail': [{ key: 'notifications', sec: 'settings', afterItem: 'strings', live: true, needs: 'staff', icon: '<path d="M5 13.5V9a5 5 0 0 1 10 0v4.5l1.5 1.5h-13z"/><path d="M8.5 17a1.5 1.5 0 0 0 3 0"/>' }],
  },
  owns: { env: ['VAPID_PRIVATE_KEY', 'VAPID_SUBJECT', 'VITE_VAPID_PUBLIC_KEY'] },
} satisfies ModuleDeclaration
