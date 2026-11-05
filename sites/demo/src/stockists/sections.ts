/*
 * The press's own admin section (platformkit.config.js admin.sections, reached as #site/admin).
 * `module: 'stockists'` is the whole of the gating: AdminPage's MODULE_OF merges every site
 * section carrying one, so this leaves the rail with its module exactly as one of the kit's does.
 *
 * NO COMPONENT, ON PURPOSE. A section says where a thing sits in the rail — its group, its label,
 * its glyph — and nothing more. The SCREEN comes from the model (build/admin-models.mjs): the
 * admin draws the grid and the drawer from its zod fields, as it does for every collection the kit
 * ships. This section carried a hand-written read-only panel for a while, which was three things
 * wrong at once: it could not edit, it had to be maintained beside the schema, and it hid the
 * editor the kit gives away. A site writes a component here only when a form from its fields is
 * genuinely not enough.
 */
export const sections = [
  { sec: 'Content', key: 'stockists', label: 'Stockists', module: 'stockists', icon: '<path d="M3.5 7.5h13v9h-13z"/><path d="M3.5 7.5 5 3.5h10l1.5 4"/><path d="M8 16.5v-4h4v4"/>',
    title: 'Stockists', lead: 'The shops that carry the books.' },
]
