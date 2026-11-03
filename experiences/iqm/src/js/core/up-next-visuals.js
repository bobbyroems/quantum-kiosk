/**
 * The artwork each "Up next" popup shows, keyed by the module being offered.
 *
 * The cutouts are the ones the 27 Aug board draws (Figma "Module Specific",
 * pop-ups 255:1843 / 255:2084 / 255:2309 / 255:2550 / 255:2784).
 *
 * The board sizes each cutout to its own subject, and that does not survive
 * contact with a fixed panel: every cutout therefore shares one contained box
 * in `.kiosk-up-next-popup__art`. A `layout` value stays available for a design
 * that supplies its own box; the tall Majorana plate uses a larger one.
 *
 * Because the box contains, what decides how large an offer reads is how much
 * of its own canvas the subject fills. The delivered cutouts carried the
 * board's padding — subjects at 18-32% of the canvas, rendering ~220px tall —
 * while plates trimmed to their subject render ~413. Trimming the file is what
 * makes an offer bigger here; the box is shared and moves all of them.
 */

/* The 07 → 08 popup is a different design (344:2402), and its blue
   architecture cutout used to need dedicated 818 × 755 geometry because the
   delivered file carried the board's own padding around the sphere.

   The re-cut plate is trimmed to the sphere itself, so that geometry would now
   scale the subject alone to 818 wide — roughly twice every other offer — and
   crop it, because trimming also changed the file's aspect. It takes the shared
   contained box instead, which is what makes it read at the same size as the
   rest. */
const NANOSCALE_VISUAL = Object.freeze({
  src: 'assets/ui/up-next/nanoscale.png',
  alt: 'A blue spherical topological-qubit architecture'
})

export const UP_NEXT_VISUALS = Object.freeze({
  'states-of-matter': {
    src: 'assets/ui/up-next/states-of-matter.png',
    alt: 'A block of ice suspended in mid air'
  },
  'qubit-explorer': {
    src: 'assets/ui/up-next/qubit-explorer.png',
    alt: 'A topoconductor layer inside a pale sphere'
  },
  'protecting-information': {
    src: 'assets/ui/up-next/protecting-information.png',
    alt: 'A quantum device seen from above'
  },
  'build-nanowire': {
    src: 'assets/ui/up-next/build-nanowire.webp',
    alt: 'A blue flow through the nanowire atomic lattice'
  },
  /* Both build offers are transparent plates baked from the current Three.js
     scenes by scripts/export-up-next-visuals.cjs, trimmed to the subject. */
  'build-majorana-2': {
    src: 'assets/ui/up-next/build-majorana-2.webp',
    alt: 'The Majorana 2 chip held in its mount',
    layout: 'majorana'
  },
  /* Board 255:3042 draws this offer with no image, which left the panel's
     visual well blank on the only popup that reaches it. It carries the same
     plate the module's menu card uses, cut to the shared contained box. */
  'measurement-based': {
    src: 'assets/ui/up-next/measurement-based.webp',
    alt: 'A gold topological-qubit processor with a dark central measurement array'
  },
  nanoscale: NANOSCALE_VISUAL,
  /* The 08 → 09 offer. Its subject is a tall column rather than a wide object,
     so the shared landscape box would render it as a sliver a fifth of the
     panel's width; it takes a portrait box of its own for the same reason the
     Majorana plate takes a larger one. */
  'quantum-platform': {
    src: 'assets/ui/up-next/quantum-platform.webp',
    alt: 'The quantum stack drawn as a tall column of coloured spheres',
    layout: 'stack'
  }
})

/** The artwork for a module's offer, or null when none is drawn for it. */
export function upNextVisualFor(moduleId) {
  return UP_NEXT_VISUALS[moduleId] || null
}

/*
 * The end of the run has no next module, so board 255:3527 leaves its picture
 * area empty. That reads as a missing image rather than a deliberate blank, so
 * the offer home carries the attract screen's own chip — the device the whole
 * floor has just been about, and the picture the visitor first arrived on.
 */
export const UP_NEXT_COMPLETE_VISUAL = Object.freeze({
  src: 'assets/ui/up-next/all-modules-complete.webp',
  alt: 'The Majorana 2 chip in its gold mount'
})
