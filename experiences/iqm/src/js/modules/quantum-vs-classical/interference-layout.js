/*
 * Current Design V3 separates the five wave sources from the field of possible
 * outcomes. Five of these sixteen rigs are interactive; the other eleven are
 * deliberately passive, so they can visualise cancellation without inventing waves.
 *
 * The passive count is roughly half the twenty first authored here. The whole
 * field surfaces at once when the third lesson ends, and at the original pitch
 * that arrival read as a crowd rather than as a field of possible answers — the
 * solution had to compete with its own neighbours to be seen. Rows are thinned by
 * dropping alternate columns rather than by narrowing them, so every row still
 * reaches the flanks at its own depth and the on-screen scatter stays even; the
 * five source positions are untouched, since the wave field's cancellation
 * margins are tuned to exactly where they stand.
 */

const NORMALIZED_ROWS = Object.freeze([
  Object.freeze({ z: -0.82, xs: Object.freeze([-0.82, 0, 0.83]) }),
  Object.freeze({ z: -0.55, xs: Object.freeze([-0.63, 0.28]) }),
  Object.freeze({ z: -0.23, xs: Object.freeze([-0.82, -0.48, 0, 0.83]) }),
  /* -0.94 was dropped rather than -0.53: this row is close enough to the camera
     that the portrait frustum cuts its outermost column off screen entirely, so
     keeping it would have spent a rig on nothing and left the left third of the
     row visibly empty. */
  Object.freeze({ z: 0.16, xs: Object.freeze([-0.53, 0.48]) }),
  Object.freeze({ z: 0.54, xs: Object.freeze([-0.65, 0.08, 0.68]) }),
  Object.freeze({ z: 0.92, xs: Object.freeze([0.02]) }),
  /* Three fills for the near water, which read as empty patches once the field
     surfaced: the z 0.54 row jumps straight from its centre column to its
     flanks, and z 0.92 carried a single buoy for the whole foreground.

     Appended as their own rows, sharing the depths above rather than joining
     those rows, so that every existing candidate keeps its index. The source
     positions are indices 8, 7, 11, 13 and 3 and the winner is 8; growing an
     earlier row would renumber them, and stableHeading() is index-derived, so
     it would also re-yaw buoys nobody asked to move. */
  Object.freeze({ z: 0.54, xs: Object.freeze([-0.3]) }),
  Object.freeze({ z: 0.92, xs: Object.freeze([0.4]) })
])

const WORLD_SCALE = Object.freeze({ x: 5.2, z: 9 })

/*
 * Every row is wide enough to reach the camera's left and right edges at its own
 * depth: the frustum keeps opening as the field recedes, so rows that stopped at
 * the authored width left two empty wedges of water flanking the outcome field.
 * Column spacing stays proportional to camera distance (~2.8 m at z -11.2, the
 * authored cadence), which keeps the on-screen gaps even from the near flanks to
 * the horizon. The two nearest rows only carry flank columns — the middle of that
 * band belongs to the interaction field. Interiors are thinned to alternate
 * columns for the same reason the near field is, and the z -9 row keeps only its
 * inner pair: at that depth the outer one sat past the portrait frustum's edge,
 * so it cost two rigs and showed nothing. Alternate rows carry three columns
 * rather than four so the thinned rows land between their neighbours' columns:
 * at this distance four rows sharing the same three screen columns read as a
 * picket fence, where a quincunx still reads as an open lattice.
 */
const BACKGROUND_ROWS = Object.freeze([
  Object.freeze({ z: -6.6, xs: Object.freeze([-6.9, 6.9]) }),
  Object.freeze({ z: -11.2, xs: Object.freeze([-8.4, -2.8, 2.8, 8.4]) }),
  Object.freeze({ z: -15.8, xs: Object.freeze([-8.4, 0, 8.4]) }),
  Object.freeze({ z: -22.5, xs: Object.freeze([-12, -4, 4, 12]) }),
  Object.freeze({ z: -32.5, xs: Object.freeze([-14.4, 0, 14.4]) }),
  /* Two fills for the far band, left and right. The z -22.5 row above carries
     -12, -4, 4 and 12, but at that depth the portrait frustum cuts the outer
     pair off screen, so the row reads as its inner pair alone with a hole on
     either side. These sit in those holes.

     Its own row, sharing that depth rather than joining the row, so the
     background buoys keep their indices: stableHeading() derives yaw from the
     index, and growing an earlier row would re-yaw every rig after it. */
  Object.freeze({ z: -22.5, xs: Object.freeze([-8, 8]) })
])

function stableHeading(index) {
  return (((index * 37) % 17) - 8) * 0.012
}

export const INTERFERENCE_CANDIDATE_LAYOUT = Object.freeze(
  NORMALIZED_ROWS.flatMap((row, rowIndex) => {
    const rowOffset = NORMALIZED_ROWS
      .slice(0, rowIndex)
      .reduce((total, item) => total + item.xs.length, 0)
    return row.xs.map((x, columnIndex) => {
      const index = rowOffset + columnIndex
      return Object.freeze({
        id: `candidate-${String(index + 1).padStart(2, '0')}`,
        x: x * WORLD_SCALE.x,
        z: row.z * WORLD_SCALE.z,
        heading: stableHeading(index)
      })
    })
  })
)

/* The outcome lattice continues past the authored interaction field. Row and buoy
   spacing both open toward the horizon so the reveal stays patterned without turning
   the distance into a dense wall. */
export const INTERFERENCE_BACKGROUND_BUOY_LAYOUT = Object.freeze(
  BACKGROUND_ROWS.flatMap((row, rowIndex) => row.xs.map((x, columnIndex) => {
    const index = BACKGROUND_ROWS
      .slice(0, rowIndex)
      .reduce((total, item) => total + item.xs.length, 0) + columnIndex
    return Object.freeze({
      id: `background-${String(index + 1).padStart(2, '0')}`,
      x,
      z: row.z,
      heading: stableHeading(INTERFERENCE_CANDIDATE_LAYOUT.length + index)
    })
  }))
)

/* Central answer first, then the four guided sources used by the V3 storyboard. */
/* The four secondary positions retain the V3 left/right/foreground/far rhythm while
   giving their 1.68 m harmonics a strong cancellation margin everywhere except the
   central solution. */
export const INTERFERENCE_SOURCE_CANDIDATE_INDICES = Object.freeze([7, 6, 10, 12, 3])

export const INTERFERENCE_SOURCE_LAYOUT = Object.freeze(
  INTERFERENCE_SOURCE_CANDIDATE_INDICES.map((candidateIndex, sourceIndex) => {
    const candidate = INTERFERENCE_CANDIDATE_LAYOUT[candidateIndex]
    return Object.freeze({
      ...candidate,
      id: sourceIndex === 0 ? 'central' : `source-${sourceIndex + 1}`,
      candidateIndex,
      sourceIndex
    })
  })
)

export const INTERFERENCE_WINNER_CANDIDATE_INDEX = INTERFERENCE_SOURCE_CANDIDATE_INDICES[0]

export function sourceIndexForCandidate(candidateIndex) {
  const sourceIndex = INTERFERENCE_SOURCE_CANDIDATE_INDICES.indexOf(candidateIndex)
  return sourceIndex >= 0 ? sourceIndex : null
}
