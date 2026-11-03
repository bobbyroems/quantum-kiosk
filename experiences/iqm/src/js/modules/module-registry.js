export const MODULE_CATEGORIES = Object.freeze({
  nanoscale: {
    label: 'Nanoscale & qubits',
    color: '#1f9bff'
  },
  topological: {
    label: 'Topological quantum',
    color: '#9567ff'
  }
  /* "Readout & measurement" went with Module 08, its only member. */
})

/* Order is the visitor's route through the floor, set by IQM on 25 Aug: the
   principle first, then matter, then the device built up from it, measurement-
   driven computation, and the scale comparison last. `number` is the printed
   label rather than the array index. */
/* Where a card title is broken across two lines on the 25 Aug board, the break
   is carried here rather than left to wrapping — the box is wide enough to fit
   "Protection of quantum information" on one line, so it would never break
   where the design breaks it. `title` stays the plain string: it is what the
   host's loading and error screens escape into their headings, and what the
   card announces to a screen reader. */
export const MODULES = Object.freeze([
  {
    id: 'quantum-vs-classical',
    scheme: 'teal',
    displayWord: 'QUANTUM',
    number: '01',
    title: 'What makes quantum different?',
    titleHtml: 'What makes<br>quantum different?',
    summary: "Not a faster computer, a different one.",
    interaction: 'Principle activator and classical-versus-quantum comparison',
    category: 'topological',
    waitForPresentationReady: true,
    load: () => import('./quantum-vs-classical/index.js')
  },
  {
    id: 'states-of-matter',
    scheme: 'blue',
    displayWord: 'MATTER',
    number: '02',
    title: 'A new state of matter',
    summary: 'Solid, liquid, gas... topoconductor.',
    interaction: 'Animation scrubber with state transitions',
    category: 'topological',
    load: () => import('./states-of-matter/index.js')
  },
  {
    id: 'qubit-explorer',
    scheme: 'purple',
    displayWord: 'QUBIT',
    number: '03',
    title: 'Build a topoconductor',
    summary: 'Two materials. One superpower.',
    interaction: 'Drag, combine and explore interactive material layers',
    category: 'nanoscale',
    load: () => import('./qubit-explorer/index.js')
  },
  {
    id: 'protecting-information',
    scheme: 'blue',
    displayWord: 'PROTECT',
    number: '04',
    title: 'Protection of quantum information',
    titleHtml: 'Protection of<br>quantum information',
    summary: 'Topoconductor, activate!',
    interaction: '3D device explorer, hotspots and adjustable parameters',
    category: 'nanoscale',
    preview: {
      kind: 'video',
      layout: 'portal',
      grid: true,
      src: '/assets/modules/protecting-information/module-selection-screen.mp4'
    },
    load: () => import('./protecting-information/index.js')
  },
  {
    id: 'build-nanowire',
    scheme: 'blue',
    displayWord: 'NANOWIRE',
    number: '05',
    title: 'Build a qubit',
    summary: 'Built one atom at a time.',
    interaction: 'Swipe-built atomic layers, heat-map scan and magnified defect repair',
    category: 'nanoscale',
    waitForPresentationReady: true,
    load: () => import('./build-nanowire/index.js')
  },
  {
    id: 'build-majorana-2',
    scheme: 'blue',
    displayWord: 'MAJORANA',
    number: '06',
    title: 'Build a Majorana 2',
    /* Non-breaking space, not a <br>: one of the two places a summary is drawn
       escapes its HTML and the other does not, so a tag would render as text in
       half of them. Binding the last two words keeps the wrap before "quantum"
       and stops "chip." being left on a line of its own. */
    summary: "Inside Microsoft's breakthrough quantum chip.",
    interaction: 'Drag-and-drop 3D assembly, snapping and callouts',
    category: 'topological',
    preview: {
      src: '/assets/modules/build-majorana-2/majorana-intro-hero.png',
      alt: 'Majorana 2 quantum chip'
    },
    preview3d: { kind: 'majorana' },
    load: () => import('./build-majorana-2/index.js')
  },
  {
    id: 'measurement-based',
    scheme: 'purple',
    displayWord: 'COMPUTE',
    number: '07',
    title: 'Computing with topological qubits',
    titleHtml: 'Computing with<br>topological qubits',
    summary: 'Spread information, steer with measurement.',
    interaction: 'Guided measurement sequence with animated qubit outcomes',
    category: 'topological',
    preview: {
      grid: true,
      swing: true,
      src: '/assets/modules/measurement-based/menu-preview.png',
      alt: 'A gold topological-qubit processor with a dark central measurement array'
    },
    waitForPresentationReady: true,
    load: () => import('./measurement-based/index.js')
  },
  {
    id: 'nanoscale',
    scheme: 'teal',
    displayWord: 'NANO',
    number: '08',
    title: 'The scale of topological qubits',
    summary: 'A million qubits — in the palm of your hand.',
    interaction: 'Multi-level zoom, hotspots and scale comparison',
    category: 'nanoscale',
    waitForPresentationReady: true,
    load: () => import('./nanoscale/index.js')
  },
  {
    id: 'quantum-platform',
    /* Blue, and not because the board says so — it draws no band at all. The
       module is the platform seen whole, which is the brand's own blue, and it
       is the one scheme neither of its neighbours (07 purple, 08 teal) is
       using. */
    scheme: 'blue',
    displayWord: 'PLATFORM',
    number: '09',
    title: 'Microsoft Quantum Platform',
    summary: 'One platform from qubit to cloud.',
    interaction: 'Layer-by-layer walk down the full quantum stack',
    category: 'nanoscale',
    /* No `preview`: the card runs the shared live diorama instead, like every
       module but 07. A still here would opt it out of that — the shape-scene
       host is only built for cards without one — and leave it the one object
       on the floor a visitor cannot pick up and turn. */
    load: () => import('./quantum-platform/index.js')
  }
])

/** Whether a module can be entered, as opposed to being a placeholder slot. */
export function isPlayable(module) {
  return typeof module?.load === 'function'
}

/**
 * The module a visitor should be offered at the end of this one, or null at the
 * end of the run.
 *
 * Concept entries without a loader are skipped rather than special-cased, so
 * the route remains valid if a future module is temporarily unavailable.
 */
export function nextPlayableModule(moduleId) {
  const index = MODULES.findIndex(module => module.id === moduleId)
  if (index < 0) return null
  return MODULES.slice(index + 1).find(isPlayable) || null
}

export function getModule(moduleId) {
  return MODULES.find(module => module.id === moduleId) || null
}
