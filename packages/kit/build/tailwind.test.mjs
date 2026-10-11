/*
 * Tailwind is wired in, and it did not flatten the app on the way.
 *
 * Adding a utility framework to an app that already has sixteen hundred lines of
 * CSS has exactly one dangerous part: Preflight, Tailwind's reset. It strips the
 * margins off every heading and paragraph, unstyles every button and list, and
 * changes the box model globally. Dropping it in unmodified would have flattened
 * the landing page and the whole instrument at once.
 *
 * So it is disabled, and this checks that it stays disabled — and that utilities
 * are actually being generated, because a config that emits nothing looks exactly
 * like a working one until you try to use it.
 */
import fs from 'node:fs';
import path from 'node:path';

let pass = 0, fail = 0;
function ok(msg, cond) { if (cond) pass++; else { fail++; console.log('  FAIL  ' + msg); } }

console.log('\nTAILWIND\n');

/* ---- the wiring ---- */
const cfg = fs.readFileSync(new URL('../vite/tailwind.config.js', import.meta.url), 'utf8');   /* the kit's, applied by the plugin */
ok('preflight is off', /preflight:\s*false/.test(cfg));
ok('the content globs cover the theme\'s components and the site\'s', /theme\.src \+ '\/\*\*\/\*\.\{vue/.test(cfg) && /site\.root \+ '\/src\/\*\*\/\*\.\{vue/.test(cfg));

/* the theme's files, wherever the theme is installed (its manifest says) */
const { loadSite } = await import('./site.mjs'); const { loadTheme } = await import('./theme.mjs')
const THEME = await loadTheme(await loadSite())
/* the entry, and the app module it imports once the content is in place (main.js → app.js) */
const appJs = path.join(path.dirname(THEME.main), 'app.js')
const entry = fs.readFileSync(THEME.main, 'utf8') + (fs.existsSync(appJs) ? fs.readFileSync(appJs, 'utf8') : '');
ok('the directives are imported', /tailwind\.css/.test(entry));
ok('...before the app stylesheet, so nothing existing loses a tie',
   entry.indexOf('tailwind.css') < entry.indexOf('atlas.css'));

const css = fs.readFileSync(THEME.src + '/tailwind.css', 'utf8');
ok('utilities are asked for', /@tailwind utilities/.test(css));

/* ---- the built output ---- */
const dir = 'dist/assets';
if (!fs.existsSync(dir)) {
  console.log('  (no dist — run the build first)\n');
  process.exit(0);
}
const bundles = fs.readdirSync(dir).filter((f) => f.endsWith('.css'))
  .map((f) => fs.readFileSync(path.join(dir, f), 'utf8'));
const all = bundles.join('\n');

/* every one of these is a Preflight rule, and every one would break something */
const resets = [
  ['a global box-sizing reset', /\*,\s*::before,\s*::after\s*\{[^}]*box-sizing/],
  ['headings stripped to inherit', /h1,\s*h2,\s*h3,\s*h4,\s*h5,\s*h6\s*\{[^}]*font-size:\s*inherit/],
  ['margins zeroed off everything', /blockquote,[^{]*h1,[^{]*\{[^}]*margin:\s*0/],
  ['buttons unstyled', /button,\s*\[type=['"]?button/],
  ['lists unstyled', /ol,\s*ul,\s*menu\s*\{[^}]*list-style:\s*none/],
];
for (const [what, re] of resets) ok('preflight did not bring ' + what, !re.test(all));

/* utilities are actually produced */
ok('utilities are generated', /\.text-white\s*\{/.test(all));

/* and the theme's own styles are all still there — classes every site's build carries whatever its
   modules (the header, the landing's hero and button, the docs shell, the sign-in card), never a
   site's own or a module's, which a site with that module off does not bundle */
const survivors = ['lphero', 'lpbtn', 'sitecta', 'wk-panel', 'pagein', 'contentground', 'au-card'];
const missing = survivors.filter((c) => !all.includes('.' + c));
ok('every existing style survived' + (missing.length ? ' — lost ' + missing.join(', ') : ''),
   missing.length === 0);

console.log('\n' + (fail ? fail + ' failed, ' + pass + ' passed' : 'all ' + pass + ' checks passed') + '\n');
process.exit(fail ? 1 : 0);
