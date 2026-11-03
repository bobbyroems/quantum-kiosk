/**
 * The stack the module walks up, and the dot field it is drawn on.
 *
 * Both come straight off the board (Figma "Module 09: Microsoft Quantum
 * Platform", 30:1045). They live here rather than inline in index.js because
 * the field is a table of 27 coordinates and the layers are a table of five
 * readings: index.js is about the walk, not about either table.
 */

/* The field is a 4 x 11 lattice on a 92px pitch with 56px dots, which is what
   makes a row 56 tall and the gap between two rows 36. Rows 2, 5 and 8 carry a
   single dot apiece: those are not decoration but the bullets the three middle
   layer names sit against, which is why a layer knows its row. */
export const DOT_SIZE = 56
export const DOT_PITCH = 92
export const COLUMN_COUNT = 4
export const ROW_COUNT = 11
export const ROW_GAP = DOT_PITCH - DOT_SIZE

/* One entry per dot, by row: which of the four columns it stands in and which
   of the field's six inks it is drawn in. Both are names rather than values —
   the stylesheet turns them into a left offset and a fill. The renderer's
   Content Security Policy forbids style attributes written into markup, so a
   colour could not be carried here as a hex even if it wanted to be. */
export const DOT_ROWS = Object.freeze([
  Object.freeze([
    { column: 0, ink: 'blue' },
    { column: 1, ink: 'purple' },
    { column: 2, ink: 'grey' },
    { column: 3, ink: 'teal' }
  ]),
  Object.freeze([
    { column: 0, ink: 'slate' },
    { column: 1, ink: 'grey' },
    { column: 2, ink: 'blue' }
  ]),
  Object.freeze([{ column: 3, ink: 'blue' }]),
  Object.freeze([
    { column: 0, ink: 'slate' },
    { column: 1, ink: 'slate' },
    { column: 2, ink: 'teal' },
    { column: 3, ink: 'purple' }
  ]),
  Object.freeze([
    { column: 1, ink: 'slate' },
    { column: 2, ink: 'purple' },
    { column: 3, ink: 'slate' }
  ]),
  Object.freeze([{ column: 0, ink: 'purple' }]),
  Object.freeze([
    { column: 0, ink: 'teal' },
    { column: 1, ink: 'mist' },
    { column: 2, ink: 'mist' },
    { column: 3, ink: 'slate' }
  ]),
  Object.freeze([
    { column: 1, ink: 'teal' },
    { column: 2, ink: 'grey' },
    { column: 3, ink: 'slate' }
  ]),
  Object.freeze([{ column: 3, ink: 'teal' }]),
  Object.freeze([
    { column: 1, ink: 'grey' },
    { column: 2, ink: 'slate' }
  ]),
  Object.freeze([{ column: 2, ink: 'slate' }])
])

/**
 * The five layers, top of the stack first — which is also the order the walk
 * takes them in, so this array is the step sequence as well as the drawing.
 *
 * `anchor` says where the name hangs:
 *   above / below  — centred over or under the whole field (Applications, Qubits)
 *   row            — beside the single dot on that row, on the given side
 *
 * `card` is the reading the layer opens. Its `tone` selects one of the three
 * fills the board uses; the fills themselves are in the stylesheet, because
 * which colour a panel is drawn in is not something this module decides at
 * runtime.
 */
export const STACK_LAYERS = Object.freeze([
  Object.freeze({
    id: 'applications',
    name: 'Applications',
    anchor: 'above',
    card: Object.freeze({
      tone: 'teal',
      title: 'Understanding nature',
      body: 'Quantum computers are particularly well-suited for very specific problems where quantum behavior is intrinsic to the system being modeled. This is where partnerships will continue to drive the field forward.'
    })
  }),
  Object.freeze({
    id: 'developer-tools',
    name: 'Developer tools',
    anchor: 'row',
    row: 2,
    side: 'left',
    card: Object.freeze({
      tone: 'blue',
      title: 'The Quantum Development Kit (QDK)',
      body: 'Microsoft’s open-source developer toolkit for building quantum applications. It provides everything needed to build, simulate, and execute quantum code, both locally and on quantum hardware.'
    })
  }),
  Object.freeze({
    id: 'operating-system',
    name: 'Operating system',
    anchor: 'row',
    row: 5,
    side: 'right',
    card: Object.freeze({
      tone: 'purple',
      title: 'Quantum operating system',
      body: 'An operating system built for quantum. A platform that integrates wide support, customizable readout, and enterprise administrative tools.'
    })
  }),
  Object.freeze({
    id: 'quantum-engine',
    name: 'Quantum engine',
    anchor: 'row',
    row: 8,
    side: 'left',
    card: Object.freeze({
      tone: 'teal',
      title: 'Quantum engine',
      body: 'The Microsoft quantum engine orchestrates quantum hardware, integrating advanced error correction techniques to detect and correct physical qubit errors in real time for reliable, scalable quantum computation.'
    })
  }),
  Object.freeze({
    id: 'qubits',
    name: 'Qubits',
    anchor: 'below',
    card: Object.freeze({
      tone: 'purple',
      title: 'Quantum hardware',
      body: 'At the foundation we have qubits produced through different quantum approaches. While we are building qubits in-house, we have built an entire software stack that can sit on top of any quantum hardware.'
    })
  })
])

/* The hardware the bottom layer opens onto. Microsoft's own topological qubit
   stands beside the partners rather than apart from them, which is the point
   the board is making: one software stack over whatever the hardware is.
   The fourth entry carries no logo because there is no fourth partner — it is
   the open end of the list. */
export const QUBIT_PARTNERS = Object.freeze([
  Object.freeze({
    id: 'topological',
    label: 'Topological',
    logo: 'assets/modules/quantum-platform/partner-microsoft.png',
    logoAlt: 'Microsoft',
    logoWidth: 265,
    logoHeight: 88
  }),
  Object.freeze({
    id: 'neutral-atom',
    label: 'Neutral Atom',
    logo: 'assets/modules/quantum-platform/partner-atom-computing.svg',
    logoAlt: 'Atom Computing',
    logoWidth: 239,
    logoHeight: 61
  }),
  Object.freeze({
    id: 't-center',
    label: 'T-center',
    logo: 'assets/modules/quantum-platform/partner-photonic.svg',
    logoAlt: 'Photonic',
    logoWidth: 208,
    logoHeight: 32
  }),
  Object.freeze({ id: 'other', label: 'Targeted qubit modalities' })
])

/** The walk: the overview the module opens on, then the five layers. */
export const STEP_IDS = Object.freeze(['overview', ...STACK_LAYERS.map(layer => layer.id)])

export function layerById(layerId) {
  return STACK_LAYERS.find(layer => layer.id === layerId) || null
}
