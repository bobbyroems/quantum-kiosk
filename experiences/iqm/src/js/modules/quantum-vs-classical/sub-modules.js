/**
 * The three principles module 01 runs, in the order the floor takes them.
 *
 * This is the route, and it is here rather than in index.js because the games
 * need it too: each one puts the 1-2-3 in the band while it runs, and a game
 * importing the module that imports it would close a cycle.
 *
 * Order matters twice over — it is the order of the sub-menu and the numbering
 * on the 1-2-3 — so the list is the single place either can change.
 */
export const SUB_MODULES = Object.freeze([
  { id: 'superposition', label: 'Superposition' },
  { id: 'entanglement', label: 'Entanglement' },
  { id: 'interference', label: 'Interference' }
])
