<script setup>
/*
 * THE PLATFORMKIT MARK — three cubes in isometric, one resting on two.
 *
 * A kit is parts that fit, and this is the smallest arrangement where that is visible: two units on
 * the ground and a third resting in the valley between them, sharing faces. It is the CORE's mark. The demo does
 * not wear it and must not — the demo is another publisher, and a mark of one's own is the point of
 * the whole thing.
 *
 * Drawn rather than a picture, because it is the header, the admin, the share cards and the favicon
 * the build photographs at every size, so it has to hold at 16 pixels and at 1200.
 *
 * THE GEOMETRY is one cube placed three times. A cube of side k projects to three rhombi off the
 * top face's four points — north (px, py), east (px+s, py+k/2), south (px, py+k), west (px-s,
 * py+k/2), where s = k·cos30 — the top being N·E·S·W, the left face W·S then both dropped by k, and
 * the right face S·E then both dropped by k. The SIDES HANG FROM THE TOP FACE'S EDGES, never from
 * its north point: taking the apex as a corner (the first try) draws a pinwheel, not a cube. Here
 * k = 6.8 in a 26 box, the two lower cubes one step along the ground either way (±s, +k/2) from the
 * upper one, which is one level up (0, −k). The upper cube is drawn FIRST: it is furthest back, and
 * the tops of the two in front cut across its lower half, which is what makes it read as resting.
 *
 * The colours are the brand's and are deliberately NOT tinted by `stroke`: this is a mark, not a
 * glyph, and a PlatformKit that came out green on a green site would not be one. It carries no
 * binding but the two the convention allows and no expression at all, so build/fonts.mjs markFrom
 * can lift this svg whole for the functions.
 */
defineProps({ size: { type: Number, default: 26 }, stroke: { type: String, default: 'var(--accent)' } })
</script>

<template>
  <svg :width="size" :height="size" viewBox="0 0 26 26" aria-hidden="true">
    <defs>
      <linearGradient id="pkTop" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0" stop-color="#fdfbe6" />
        <stop offset="1" stop-color="#b9abef" />
      </linearGradient>
      <linearGradient id="pkLeft" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0" stop-color="#d9d3f8" />
        <stop offset="1" stop-color="#8672ea" />
      </linearGradient>
      <linearGradient id="pkRight" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0" stop-color="#6242e6" />
        <stop offset="1" stop-color="#4a2dd0" />
      </linearGradient>
    </defs>

    <!-- the cube on top, drawn first: the two below cut across it -->
    <polygon points="13,1.1 18.889,4.5 13,7.9 7.111,4.5" fill="url(#pkTop)" />
    <polygon points="7.111,4.5 13,7.9 13,14.7 7.111,11.3" fill="url(#pkLeft)" />
    <polygon points="13,7.9 18.889,4.5 18.889,11.3 13,14.7" fill="url(#pkRight)" />

    <!-- the cube it rests on, to the left -->
    <polygon points="7.111,11.3 13,14.7 7.111,18.1 1.222,14.7" fill="url(#pkTop)" />
    <polygon points="1.222,14.7 7.111,18.1 7.111,24.9 1.222,21.5" fill="url(#pkLeft)" />
    <polygon points="7.111,18.1 13,14.7 13,21.5 7.111,24.9" fill="url(#pkRight)" />

    <!-- and the one to the right -->
    <polygon points="18.889,11.3 24.778,14.7 18.889,18.1 13,14.7" fill="url(#pkTop)" />
    <polygon points="13,14.7 18.889,18.1 18.889,24.9 13,21.5" fill="url(#pkLeft)" />
    <polygon points="18.889,18.1 24.778,14.7 24.778,21.5 18.889,24.9" fill="url(#pkRight)" />
  </svg>
</template>
