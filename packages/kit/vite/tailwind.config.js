/** @type {import('tailwindcss').Config} — the kit's Tailwind config, applied by the Vite plugin to every site: the theme's
    sources and the site's are the content globs (a site keeps no tailwind.config.js or postcss.config.js of its own) */
import animate from 'tailwindcss-animate'

export const tailwindConfig = (site, theme) => ({
  content: [site.root + '/index.html', site.root + '/src/**/*.{vue,js,ts,jsx,tsx}', theme.src + '/**/*.{vue,js,ts,jsx,tsx}'],
  /* the site flips theme with data-theme="dark" on <html>; shadcn's dark: variants follow it */
  darkMode: ['selector', '[data-theme="dark"]'],
  theme: {
    extend: {
      /* the shadcn-vue palette, as CSS variables set in src/tailwind.css from the site's tokens */
      colors: {
        border: 'hsl(var(--border))',
        input: 'hsl(var(--input))',
        ring: 'hsl(var(--ring))',
        background: 'hsl(var(--background))',
        foreground: 'hsl(var(--foreground))',
        primary: { DEFAULT: 'hsl(var(--primary))', foreground: 'hsl(var(--primary-foreground))' },
        secondary: { DEFAULT: 'hsl(var(--secondary))', foreground: 'hsl(var(--secondary-foreground))' },
        destructive: { DEFAULT: 'hsl(var(--destructive))', foreground: 'hsl(var(--destructive-foreground))' },
        muted: { DEFAULT: 'hsl(var(--muted))', foreground: 'hsl(var(--muted-foreground))' },
        accent: { DEFAULT: 'hsl(var(--accent))', foreground: 'hsl(var(--accent-foreground))' },
        popover: { DEFAULT: 'hsl(var(--popover))', foreground: 'hsl(var(--popover-foreground))' },
        card: { DEFAULT: 'hsl(var(--card))', foreground: 'hsl(var(--card-foreground))' },
      },
      borderRadius: { xl: 'calc(var(--radius) + 4px)', lg: 'var(--radius)', md: 'calc(var(--radius) - 2px)', sm: 'calc(var(--radius) - 4px)' },
      keyframes: {
        'accordion-down': { from: { height: 0 }, to: { height: 'var(--radix-accordion-content-height)' } },
        'accordion-up': { from: { height: 'var(--radix-accordion-content-height)' }, to: { height: 0 } },
        'collapsible-down': { from: { height: 0 }, to: { height: 'var(--radix-collapsible-content-height)' } },
        'collapsible-up': { from: { height: 'var(--radix-collapsible-content-height)' }, to: { height: 0 } },
      },
      animation: {
        'accordion-down': 'accordion-down 0.2s ease-out',
        'accordion-up': 'accordion-up 0.2s ease-out',
        'collapsible-down': 'collapsible-down 0.2s ease-in-out',
        'collapsible-up': 'collapsible-up 0.2s ease-in-out',
      },
    },
  },
  plugins: [animate],
  /* Preflight is Tailwind's reset. This app has ~1600 lines of CSS that predate
     it, and the reset would strip the margins off every heading, unstyle every
     button and list, and change the box model under all of it. Utilities only.
     The page builder carries its own scoped mini-reset for the shadcn markup. */
  corePlugins: { preflight: false },
})
export default tailwindConfig
