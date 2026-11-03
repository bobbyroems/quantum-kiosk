/*
 * Nanoscale camera and scene-registration model.
 *
 * This module is deliberately independent of the DOM, gesture model, copy, and
 * layout chrome. It works only in the 2160 x 3840 design coordinate system and
 * returns similarity transforms of the form
 *
 *   screenPoint = (scenePoint * scale) + [translateX, translateY]
 *
 * Integration must set `transform-origin: 0 0`. The helper at the bottom emits
 * the equivalent CSS `translate3d(...) scale(...)` transform.
 *
 * Registration terminology
 * ------------------------
 * A handoff registration H maps a point in the incoming scene into the
 * corresponding point in the outgoing scene:
 *
 *   outgoingPoint = H(incomingPoint)
 *
 * During a cross-scene handoff, both layers share one camera C:
 *
 *   outgoingMatrix = C
 *   incomingMatrix = C · H
 *
 * Therefore corresponding landmarks remain coincident for every intermediate
 * progress value, rather than only at the ends of a dissolve. C starts at the
 * outgoing settled transform and ends at `incomingSettled · inverse(H)`, so
 * the incoming layer finishes at its exact settled transform.
 *
 * Crucially, C is interpolated around the registered landmark, not by lerping
 * its raw translations. At each sample we log-interpolate scale, interpolate
 * the landmark's desired screen position between its two settled endpoints,
 * then derive translation from
 *
 *   translation = desiredScreenPoint - (canonicalLandmark * scale)
 *
 * This keeps the subject on a straight, in-viewport path even during very deep
 * zooms. The easing is monotonic, so there is no overshoot and sampling the same
 * progress in reverse produces the same frame.
 */

const EPSILON = 1e-9
/* User-directed balance correction: stops 02 and 03 share the Cryostat's x=770 visual lane. */
const STOP_02_03_ALIGNMENT_X = -100

export const NANOSCALE_CAMERA_STAGE = Object.freeze({ width: 2160, height: 3840 })
export const NANOSCALE_CAMERA_STOPS = Object.freeze([0, 1, 2, 3, 4, 5])

/* Fit the complete splash to the stage width and begin it directly below the
   120px navbar. The source is never cropped. */
const SPLASH_SETTLED = Object.freeze({
  scale: 1,
  translateX: 0,
  translateY: 120
})

const IDENTITY = Object.freeze({
  scale: 1,
  translateX: 0,
  translateY: 0
})

function isFiniteNumber(value) {
  return typeof value === 'number' && Number.isFinite(value)
}

function clamp(value, minimum = 0, maximum = 1) {
  if (!isFiniteNumber(value)) return minimum
  return Math.min(maximum, Math.max(minimum, value))
}

function assertPoint(point, label = 'point') {
  if (!point || !isFiniteNumber(point.x) || !isFiniteNumber(point.y)) {
    throw new TypeError(`${label} must have finite x and y values`)
  }
}

function assertRect(rect, label = 'rectangle') {
  if (
    !rect ||
    !isFiniteNumber(rect.x) ||
    !isFiniteNumber(rect.y) ||
    !isFiniteNumber(rect.width) ||
    !isFiniteNumber(rect.height) ||
    rect.width <= 0 ||
    rect.height <= 0
  ) {
    throw new TypeError(`${label} must have finite x/y and positive width/height`)
  }
}

function assertSimilarity(transform, label = 'similarity transform') {
  if (
    !transform ||
    !isFiniteNumber(transform.scale) ||
    transform.scale <= 0 ||
    !isFiniteNumber(transform.translateX) ||
    !isFiniteNumber(transform.translateY)
  ) {
    throw new TypeError(`${label} must have a positive scale and finite translations`)
  }
}

function frozenRect(x, y, width, height) {
  const rect = { x, y, width, height }
  assertRect(rect)
  return Object.freeze(rect)
}

function frozenPoint(x, y) {
  const point = { x, y }
  assertPoint(point)
  return Object.freeze(point)
}

function freezeSimilarity(transform) {
  assertSimilarity(transform)
  return Object.freeze({
    scale: transform.scale,
    translateX: transform.translateX,
    translateY: transform.translateY
  })
}

/** Monotonic C2 easing: zero velocity and acceleration at both stop boundaries. */
export function nanoscaleCameraEase(progress) {
  const t = clamp(progress)
  return t * t * t * ((t * ((t * 6) - 15)) + 10)
}

/** Applies a translate + uniform-scale transform to a design-space point. */
export function transformNanoscalePoint(transform, point) {
  assertSimilarity(transform)
  assertPoint(point)
  return Object.freeze({
    x: (point.x * transform.scale) + transform.translateX,
    y: (point.y * transform.scale) + transform.translateY
  })
}

/** Applies a similarity to an axis-aligned rectangle. */
export function transformNanoscaleRect(transform, rect) {
  assertSimilarity(transform)
  assertRect(rect)
  const origin = transformNanoscalePoint(transform, rect)
  return frozenRect(
    origin.x,
    origin.y,
    rect.width * transform.scale,
    rect.height * transform.scale
  )
}

/** Returns outer(inner(point)). */
export function composeNanoscaleSimilarities(outer, inner) {
  assertSimilarity(outer, 'outer transform')
  assertSimilarity(inner, 'inner transform')
  return freezeSimilarity({
    scale: outer.scale * inner.scale,
    translateX: (outer.scale * inner.translateX) + outer.translateX,
    translateY: (outer.scale * inner.translateY) + outer.translateY
  })
}

export function invertNanoscaleSimilarity(transform) {
  assertSimilarity(transform)
  const inverseScale = 1 / transform.scale
  return freezeSimilarity({
    scale: inverseScale,
    translateX: -transform.translateX * inverseScale,
    translateY: -transform.translateY * inverseScale
  })
}

/**
 * Builds a uniform-scale registration from two corresponding rectangles.
 *
 * `outgoingRect` and `incomingRect` describe the same source feature in the
 * two settled Figma frames. Their centers are matched exactly. Geometric-mean
 * scale minimizes multiplicative width/height error when production crops
 * differ by a fraction of a pixel or when a semantic handoff changes aspect.
 */
export function nanoscaleSimilarityFromRects(
  outgoingRect,
  incomingRect,
  { scaleMode = 'geometric-mean' } = {}
) {
  assertRect(outgoingRect, 'outgoing rectangle')
  assertRect(incomingRect, 'incoming rectangle')

  const widthScale = outgoingRect.width / incomingRect.width
  const heightScale = outgoingRect.height / incomingRect.height
  let scale

  if (scaleMode === 'width') scale = widthScale
  else if (scaleMode === 'height') scale = heightScale
  else if (scaleMode === 'geometric-mean') scale = Math.sqrt(widthScale * heightScale)
  else throw new RangeError(`Unsupported rectangle scale mode: ${scaleMode}`)

  const outgoingCenter = {
    x: outgoingRect.x + (outgoingRect.width / 2),
    y: outgoingRect.y + (outgoingRect.height / 2)
  }
  const incomingCenter = {
    x: incomingRect.x + (incomingRect.width / 2),
    y: incomingRect.y + (incomingRect.height / 2)
  }

  return freezeSimilarity({
    scale,
    translateX: outgoingCenter.x - (incomingCenter.x * scale),
    translateY: outgoingCenter.y - (incomingCenter.y * scale)
  })
}

/** Builds a similarity with an explicit scale and one independently measured anchor pair. */
export function nanoscaleSimilarityFromAnchors(outgoingPoint, incomingPoint, scale) {
  assertPoint(outgoingPoint, 'outgoing anchor')
  assertPoint(incomingPoint, 'incoming anchor')
  if (!isFiniteNumber(scale) || scale <= 0) {
    throw new RangeError('anchor registration scale must be a positive finite number')
  }
  return freezeSimilarity({
    scale,
    translateX: outgoingPoint.x - (incomingPoint.x * scale),
    translateY: outgoingPoint.y - (incomingPoint.y * scale)
  })
}

function centerOfRect(rect) {
  assertRect(rect)
  return frozenPoint(
    rect.x + (rect.width / 2),
    rect.y + (rect.height / 2)
  )
}

/* Maps a measured intrinsic pixel rectangle through an object-fit: fill box. */
function rectThroughFill(assetRect, assetSize, artBox) {
  assertRect(assetRect, 'intrinsic feature rectangle')
  assertRect(
    { x: 0, y: 0, width: assetSize?.width, height: assetSize?.height },
    'intrinsic asset size'
  )
  assertRect(artBox, 'fill art box')
  const scaleX = artBox.width / assetSize.width
  const scaleY = artBox.height / assetSize.height
  return frozenRect(
    artBox.x + (assetRect.x * scaleX),
    artBox.y + (assetRect.y * scaleY),
    assetRect.width * scaleX,
    assetRect.height * scaleY
  )
}

/** Interpolates translation linearly and scale logarithmically. */
export function interpolateNanoscaleSimilarity(
  fromTransform,
  toTransform,
  progress,
  easing = nanoscaleCameraEase
) {
  assertSimilarity(fromTransform, 'from transform')
  assertSimilarity(toTransform, 'to transform')
  if (typeof easing !== 'function') throw new TypeError('easing must be a function')

  const eased = clamp(easing(clamp(progress)))
  const logScale = Math.log(fromTransform.scale) + (
    (Math.log(toTransform.scale) - Math.log(fromTransform.scale)) * eased
  )

  return freezeSimilarity({
    scale: Math.exp(logScale),
    translateX: fromTransform.translateX + (
      (toTransform.translateX - fromTransform.translateX) * eased
    ),
    translateY: fromTransform.translateY + (
      (toTransform.translateY - fromTransform.translateY) * eased
    )
  })
}

/**
 * Interpolates a camera around one canonical focal point.
 *
 * Raw translation interpolation is not geometrically stable when scale changes
 * by several orders of magnitude: the focal point can arc far outside the
 * viewport even though both endpoint transforms are correct. This form makes
 * the screen-space focal path explicit and derives translation last.
 */
export function interpolateNanoscaleSimilarityAroundAnchor(
  fromTransform,
  toTransform,
  canonicalAnchor,
  progress,
  easing = nanoscaleCameraEase
) {
  assertSimilarity(fromTransform, 'from transform')
  assertSimilarity(toTransform, 'to transform')
  assertPoint(canonicalAnchor, 'canonical anchor')
  if (typeof easing !== 'function') throw new TypeError('easing must be a function')

  const eased = clamp(easing(clamp(progress)))
  const logScale = Math.log(fromTransform.scale) + (
    (Math.log(toTransform.scale) - Math.log(fromTransform.scale)) * eased
  )
  const scale = Math.exp(logScale)
  const fromScreenAnchor = transformNanoscalePoint(fromTransform, canonicalAnchor)
  const toScreenAnchor = transformNanoscalePoint(toTransform, canonicalAnchor)
  const desiredScreenAnchor = {
    x: fromScreenAnchor.x + ((toScreenAnchor.x - fromScreenAnchor.x) * eased),
    y: fromScreenAnchor.y + ((toScreenAnchor.y - fromScreenAnchor.y) * eased)
  }

  return freezeSimilarity({
    scale,
    translateX: desiredScreenAnchor.x - (canonicalAnchor.x * scale),
    translateY: desiredScreenAnchor.y - (canonicalAnchor.y * scale)
  })
}

function pointInRect(rect, u, v) {
  return Object.freeze({
    x: rect.x + (rect.width * u),
    y: rect.y + (rect.height * v)
  })
}

/* Audited Figma Design v3 geometry, relative to a 2160 x 3840 frame. */
const SPLASH_ROOM_SOURCE = frozenRect(-2006, 120, 6172, 3472)
const CRYOSTAT_ROOM_SOURCE = frozenRect(-1943, 118, 5624, 3164)

/*
 * Where the stop-01 plate sits inside the splash bitmap, found by matching the
 * two renders' gold masks across scale and offset (best overlap at 0.37 splash
 * pixels per plate pixel). This is the whole 1800 x 3114 plate canvas rather
 * than the object framed inside it, so it registers directly against
 * `CRYOSTAT_ASSET_RECT` below and the pair no longer carries the extent
 * mismatch an object-framed rectangle gave the first handoff.
 */
const SPLASH_CRYOSTAT_ASSET_RECT = frozenRect(819.2, 1122.3, 666, 1152.18)
const CRYOSTAT_ASSET_RECT = frozenRect(0, 0, 1800, 3114)

/*
 * Accounts for the STRETCH paint transform on raw node 414:652, rather than
 * using only its clipping rectangle. This is source-registration evidence; it
 * is not the canonical rectangle of the production Majorana scene.
 */
const MAJORANA_ROOM_SOURCE = frozenRect(
  -17654.06908090348 + STOP_02_03_ALIGNMENT_X,
  -14904,
  37046.136988417704,
  20838.477653392383
)

/* Visible focal targets in the settled, full-stage scene coordinate system. */
const MAJORANA_REGISTERED_TARGET = frozenRect(
  -265.8125 + STOP_02_03_ALIGNMENT_X,
  1104.982421875,
  2268.317138671875,
  1276.011962890625
)
const QPU_BACKGROUND_SOURCE = frozenRect(
  -7183 + STOP_02_03_ALIGNMENT_X,
  -3428,
  18346,
  10320
)
const QPU_REGISTERED_TARGET = frozenRect(
  -196 + STOP_02_03_ALIGNMENT_X,
  553,
  2133,
  2326
)
/*
 * The focal cutout is re-cut from the delivered close-up at 1:1 with the stage
 * rectangle it fills, rather than being the 476 x 519 Figma export drawn at
 * 4.5x. It frames the same window, so the dark board is the same fraction of it
 * that (14, 52, 411, 411) was of the export — and because both the rectangle
 * and the plate it is measured against scale together, `QPU_DARK_BOARD_TARGET`
 * does not move, which is what holds the 02 -> 03 registration still.
 */
const QPU_FOCAL_NATIVE_SIZE = Object.freeze({ width: 2283, height: 2490 })
const QPU_DARK_BOARD_ASSET_RECT = frozenRect(
  (14 / 476) * QPU_FOCAL_NATIVE_SIZE.width,
  (52 / 519) * QPU_FOCAL_NATIVE_SIZE.height,
  (411 / 476) * QPU_FOCAL_NATIVE_SIZE.width,
  (411 / 519) * QPU_FOCAL_NATIVE_SIZE.height
)
const QPU_DARK_BOARD_TARGET = rectThroughFill(
  QPU_DARK_BOARD_ASSET_RECT,
  QPU_FOCAL_NATIVE_SIZE,
  QPU_REGISTERED_TARGET
)
const QPU_DIE_TARGET = frozenRect(610 + STOP_02_03_ALIGNMENT_X, 1553, 333, 333)
const QUBIT_BACKGROUND_SOURCE = frozenRect(-5467, -2390, 12376, 8814)
const QUBIT_ARRAY_TARGET = frozenRect(35, 1374, 1294, 702)
const NANOWIRE_BACKGROUND_SOURCE = frozenRect(
  -3015,
  -613.510672,
  6710,
  4526.022949
)
const NANOWIRE_TARGET = frozenRect(
  -890.352783203125,
  722.7542114257812,
  3497.015380859375,
  1967.0712890625
)

/*
 * The room-source mapping supplies the intended 01->02 zoom magnitude. Its
 * vertical axis is exact; the Figma STRETCH crop leaves a sub-pixel horizontal
 * residual that a uniform-scale camera cannot represent.
 */
const ROOM_TO_MAJORANA_SCREEN_REGISTRATION = nanoscaleSimilarityFromRects(
  CRYOSTAT_ROOM_SOURCE,
  MAJORANA_ROOM_SOURCE,
  { scaleMode: 'height' }
)

/* The Majorana focal object is where that source zoom lands inside Cryostat 01. */
const CRYOSTAT_MAJORANA_TARGET_DERIVED = transformNanoscaleRect(
  ROOM_TO_MAJORANA_SCREEN_REGISTRATION,
  MAJORANA_REGISTERED_TARGET
)

/*
 * The shared-source mapping preserves Figma's zoom magnitude, but its derived
 * X landmark sits to the right of the Cryostat's visible gold centerline.
 * Apply the left-lane correction explicitly here: shifting both source rects
 * above cancels algebraically, so it cannot fix the visible overlay by itself.
 */
const CRYOSTAT_MAJORANA_TARGET = frozenRect(
  CRYOSTAT_MAJORANA_TARGET_DERIVED.x + STOP_02_03_ALIGNMENT_X,
  CRYOSTAT_MAJORANA_TARGET_DERIVED.y,
  CRYOSTAT_MAJORANA_TARGET_DERIVED.width,
  CRYOSTAT_MAJORANA_TARGET_DERIVED.height
)

function alignmentForKeyword(keyword, axis) {
  if (axis === 'x') {
    if (keyword === 'left') return 0
    if (keyword === 'right') return 1
    return 0.5
  }
  if (keyword === 'top') return 0
  if (keyword === 'bottom') return 1
  return 0.5
}

/**
 * Resolves CSS-like object-fit placement into an intrinsic-art -> scene transform.
 * This lets focal points be measured in the same 2160 x 3840 coordinates that
 * the camera consumes, even when a transparent source is placed in a smaller box.
 */
export function nanoscaleArtPlacement({
  assetSize,
  artBox,
  fit = 'cover',
  objectPosition = 'center center'
}) {
  assertRect({ x: 0, y: 0, width: assetSize?.width, height: assetSize?.height }, 'asset size')
  assertRect(artBox, 'art box')
  if (!['cover', 'contain'].includes(fit)) {
    throw new RangeError('art fit must be cover or contain')
  }

  const scaleX = artBox.width / assetSize.width
  const scaleY = artBox.height / assetSize.height
  const scale = fit === 'cover' ? Math.max(scaleX, scaleY) : Math.min(scaleX, scaleY)
  const renderedWidth = assetSize.width * scale
  const renderedHeight = assetSize.height * scale
  const [xKeyword = 'center', yKeyword = 'center'] = objectPosition.split(/\s+/)
  const xAlignment = alignmentForKeyword(xKeyword, 'x')
  const yAlignment = alignmentForKeyword(yKeyword, 'y')

  return freezeSimilarity({
    scale,
    translateX: artBox.x + ((artBox.width - renderedWidth) * xAlignment),
    translateY: artBox.y + ((artBox.height - renderedHeight) * yAlignment)
  })
}

const FULL_STAGE_ART = Object.freeze({
  assetSize: Object.freeze({ width: 2160, height: 3840 }),
  artBox: frozenRect(0, 0, 2160, 3840),
  fit: 'cover',
  objectPosition: 'center center',
  assetToScene: IDENTITY
})

/* The delivered splash is an exact 9:16 recomposition for this panel, so
   `contain` fills the stage with nothing left over. */
const SPLASH_ASSET_SIZE = Object.freeze({ width: 2304, height: 4096 })

const SPLASH_ART = Object.freeze({
  assetSize: SPLASH_ASSET_SIZE,
  artBox: frozenRect(0, 0, 2160, 3840),
  fit: 'contain',
  objectPosition: 'center top',
  assetToScene: nanoscaleArtPlacement({
    assetSize: SPLASH_ASSET_SIZE,
    artBox: { x: 0, y: 0, width: 2160, height: 3840 },
    fit: 'contain',
    objectPosition: 'center top'
  })
})

const CRYOSTAT_ART = Object.freeze({
  assetSize: Object.freeze({ width: 1800, height: 3114 }),
  artBox: frozenRect(255, 0, 1030, 2718),
  fit: 'cover',
  objectPosition: 'center bottom',
  assetToScene: nanoscaleArtPlacement({
    assetSize: { width: 1800, height: 3114 },
    artBox: { x: 255, y: 0, width: 1030, height: 2718 },
    fit: 'cover',
    objectPosition: 'center bottom'
  })
})

/*
 * This scene used to paint one flat render of the arm and the package together,
 * placed by a Figma box plus a user-directed nudge. The plate is now the package
 * alone, cut from the delivered close-up, and the arm it hangs from is the
 * chandelier underlay painted behind it.
 *
 * So the box is fitted to that arm, not to where the retired plate happened to
 * sit. The chandelier renders its own copy of the package on the end of the
 * arm, and this plate has to land on it exactly: the underlay is not trimmed,
 * so wherever the plate falls short the render underneath shows as a second
 * chip.
 *
 * Width and horizontal centre come from that render (910.1 stage px wide,
 * centre x 778.1, measured on the underlay at the same alpha threshold as the
 * frame). The two renders agree that the neck sits 14 px inside the frame on
 * either side, so the arm runs into the package as one object. The vertical
 * offset is then the one that buries the underlay's package most completely:
 * the close-up's frame is a little shallower than the chandelier's and their
 * corner radii differ, so the fit is a search rather than an edge match, and
 * at this offset the render underneath is never more than 1.3 px outside the
 * plate anywhere along its outline.
 *
 * 0.235980 stage px per plate px; the box carries the plate's own aspect.
 */
const MAJORANA_ASSET_SIZE = Object.freeze({ width: 3875, height: 4096 })
const MAJORANA_ART_BOX = frozenRect(321.07, 1232.85, 914.42, 966.57)

const MAJORANA_ART = Object.freeze({
  assetSize: MAJORANA_ASSET_SIZE,
  artBox: MAJORANA_ART_BOX,
  /* The box carries the plate's own aspect, so cover and fill agree here. */
  fit: 'cover',
  objectPosition: 'center center',
  assetToScene: nanoscaleArtPlacement({
    assetSize: MAJORANA_ASSET_SIZE,
    artBox: MAJORANA_ART_BOX,
    fit: 'cover',
    objectPosition: 'center center'
  })
})

/*
 * The 02 -> 03 zoom enters the dark QPU window inside Majorana 2, not the
 * center of the complete package. This is the window on the package plate, in
 * its own pixels: the inclusive cell (354, 1811, 257, 256) that was measured on
 * the retired flat plate, carried across through the two renders' shared
 * circuit-board registration and checked against the window it frames. Mapped
 * through the placement above it is the landmark the handoff is built on, and
 * it follows the plate wherever the plate is fitted.
 */
const MAJORANA_QPU_ASSET_RECT = frozenRect(792.359, 1564.671, 994.715, 990.845)
const MAJORANA_QPU_TARGET = transformNanoscaleRect(
  MAJORANA_ART.assetToScene,
  MAJORANA_QPU_ASSET_RECT
)

/*
 * Pairwise registration is expressed in canonical scene coordinates. The
 * production splash measurement begins in intrinsic bitmap coordinates, while
 * Cryostat's corresponding feature is its complete rendered intrinsic plate
 * (which extends behind the art-box crop). Converting both through their actual
 * cover placements is what makes the first overlay agree with the DOM pixels.
 */
const SPLASH_CRYOSTAT_TARGET = transformNanoscaleRect(
  SPLASH_ART.assetToScene,
  SPLASH_CRYOSTAT_ASSET_RECT
)
const CRYOSTAT_REGISTERED_TARGET = transformNanoscaleRect(
  CRYOSTAT_ART.assetToScene,
  CRYOSTAT_ASSET_RECT
)
const CRYOSTAT_MAJORANA_FEATURE_CANONICAL = centerOfRect(CRYOSTAT_MAJORANA_TARGET)

export const NANOSCALE_CAMERA_GEOMETRY = Object.freeze({
  splashRoomSource: SPLASH_ROOM_SOURCE,
  cryostatRoomSource: CRYOSTAT_ROOM_SOURCE,
  splashCryostatAssetRect: SPLASH_CRYOSTAT_ASSET_RECT,
  splashCryostatTarget: SPLASH_CRYOSTAT_TARGET,
  cryostatAssetRect: CRYOSTAT_ASSET_RECT,
  cryostatRegisteredTarget: CRYOSTAT_REGISTERED_TARGET,
  majoranaRoomSource: MAJORANA_ROOM_SOURCE,
  cryostatMajoranaTarget: CRYOSTAT_MAJORANA_TARGET,
  majoranaRegisteredTarget: MAJORANA_REGISTERED_TARGET,
  majoranaQpuAssetRect: MAJORANA_QPU_ASSET_RECT,
  majoranaQpuTarget: MAJORANA_QPU_TARGET,
  /* Backward-compatible name; this is the visible step-02 target, not an art box. */
  majoranaPuckSource: MAJORANA_REGISTERED_TARGET,
  qpuBackgroundSource: QPU_BACKGROUND_SOURCE,
  qpuRegisteredTarget: QPU_REGISTERED_TARGET,
  qpuDarkBoardAssetRect: QPU_DARK_BOARD_ASSET_RECT,
  qpuDarkBoardTarget: QPU_DARK_BOARD_TARGET,
  qpuDieTarget: QPU_DIE_TARGET,
  qubitBackgroundSource: QUBIT_BACKGROUND_SOURCE,
  qubitArrayTarget: QUBIT_ARRAY_TARGET,
  nanowireBackgroundSource: NANOWIRE_BACKGROUND_SOURCE,
  nanowireTarget: NANOWIRE_TARGET
})

function freezePaintTransform(transform) {
  if (!transform) return null
  return Object.freeze(transform.map(row => Object.freeze([...row])))
}

/*
 * Alpha ramps for a layer, authored as the CSS gradient stops they become:
 * `[position, alpha]` pairs in fractions of the layer box, `down` running top to
 * bottom and `across` running left to right. They exist so a plate can dissolve
 * into the scene retained beneath it instead of ending on a hard rectangle.
 */
function freezeLayerMask(mask) {
  if (!mask) return null
  const axes = {}
  for (const axis of ['down', 'across']) {
    if (!mask[axis]) continue
    axes[axis] = Object.freeze(mask[axis].map(stop => Object.freeze([...stop])))
  }
  return Object.freeze(axes)
}

function freezeCameraGroupLayer(layer) {
  assertRect(layer.artBox, `${layer.id} art box`)
  assertRect(
    { x: 0, y: 0, width: layer.nativeSize?.width, height: layer.nativeSize?.height },
    `${layer.id} native size`
  )
  return Object.freeze({
    ...layer,
    mask: freezeLayerMask(layer.mask),
    nativeSize: Object.freeze({ ...layer.nativeSize }),
    artBox: frozenRect(
      layer.artBox.x,
      layer.artBox.y,
      layer.artBox.width,
      layer.artBox.height
    ),
    paintTransform: freezePaintTransform(layer.paintTransform),
    exportAdjustment: layer.exportAdjustment
      ? Object.freeze({ ...layer.exportAdjustment })
      : null
  })
}

function freezeCameraGroup(group) {
  const layers = Object.freeze(group.layers.map(freezeCameraGroupLayer))
  const coverageLayer = layers.find(layer => layer.id === group.coverageLayerId)
  if (!coverageLayer) {
    throw new Error(`Camera group ${group.id} needs its coverage layer`)
  }
  /* A group may state its coverage box independently of the layer that paints
     it, for the case where the box the handoff timing was built on is not the
     box the current plate happens to occupy. */
  const coverageArtBox = group.coverageArtBox
    ? frozenRect(
      group.coverageArtBox.x,
      group.coverageArtBox.y,
      group.coverageArtBox.width,
      group.coverageArtBox.height
    )
    : coverageLayer.artBox
  return Object.freeze({
    id: group.id,
    coordinateSpace: 'canonical-stage',
    transformOrigin: '0 0',
    coverageLayerId: group.coverageLayerId,
    coverageArtBox,
    minimumDimensionScale: Math.max(
      NANOSCALE_CAMERA_STAGE.width / coverageArtBox.width,
      NANOSCALE_CAMERA_STAGE.height / coverageArtBox.height
    ),
    layers
  })
}

/*
 * Native layered exports preserve the oversized Figma plates. The shared root
 * backdrop sits outside this group; every child is positioned in canonical
 * stage coordinates and the single group receives the camera transform.
 */
/*
 * Where the stop-02 package lands once the 02 -> 03 zoom has run. The handoff
 * is built from the same two landmark rectangles, so this is the incoming
 * scene's own view of the plate the visitor was just looking at.
 */
const QPU_RETAINED_PACKAGE_BOX = transformNanoscaleRect(
  invertNanoscaleSimilarity(
    nanoscaleSimilarityFromRects(MAJORANA_QPU_TARGET, QPU_DARK_BOARD_TARGET)
  ),
  MAJORANA_ART_BOX
)

const QPU_CAMERA_GROUP = freezeCameraGroup({
  id: 'qpu-chip-group',
  coverageLayerId: 'qpu-chip-background',
  /*
   * The retired background was a Figma export on a canvas far larger than
   * anything it painted -- 28% of it carried the package and the rest was
   * transparent. That empty canvas is what decided when this scene was allowed
   * to start fading in, so it is kept here as a timing constant rather than
   * silently becoming the smaller box of the plate that replaced it. It is not
   * a claim about painted pixels; what fills the viewport during the handoff is
   * the retained stack beneath, as it always was.
   */
  coverageArtBox: QPU_BACKGROUND_SOURCE,
  layers: [
    {
      /*
       * The stop-02 package plate, painted a second time as this scene's own
       * background. It used to be a separate export of the same object, which
       * sat about 1% off the plate retained underneath; being literally the
       * same bitmap, the two are now coincident by construction and the pair
       * costs one decoded image instead of two.
       */
      id: 'qpu-chip-background',
      asset: 'majorana-2.webp',
      role: 'background',
      nativeSize: MAJORANA_ASSET_SIZE,
      artBox: QPU_RETAINED_PACKAGE_BOX,
      fit: 'fill',
      opacity: 0.60000002384,
      opaque: false
    },
    {
      id: 'qpu-chip-focal',
      asset: 'qpu-chip-focal.webp',
      role: 'focal',
      nativeSize: QPU_FOCAL_NATIVE_SIZE,
      artBox: QPU_REGISTERED_TARGET,
      opacity: 1,
      opaque: false,
      fit: 'fill'
    }
  ]
})

const QUBIT_CAMERA_GROUP = freezeCameraGroup({
  id: 'qubit-array-group',
  coverageLayerId: 'qubit-array-background',
  layers: [
    {
      /*
       * Mask-and-blur plate: the SEM databar is cut and every edge is feathered
       * so the photograph dissolves into the retained QPU scene instead of
       * ending on a hard rectangle. It is scaled and padded back onto the
       * retired plate's 4096 x 2917 canvas, so the art box still registers it.
       */
      id: 'qubit-array-background',
      asset: 'qubit-array-background.webp',
      role: 'background',
      nativeSize: { width: 4096, height: 2917 },
      artBox: QUBIT_BACKGROUND_SOURCE,
      fit: 'fill',
      opacity: 1,
      opaque: false
    }
    /*
     * A qubit-array-focal plate used to sit over QUBIT_ARRAY_TARGET here. It was
     * a 1:1 crop of these very pixels (428 x 232 either way) taken from the
     * pre-mask grade, so against the masked plate it only ever contributed a
     * contrast step and a hard edge. QUBIT_ARRAY_TARGET survives below as the
     * registration rect for the 03 -> 04 and 04 -> 05 handoffs.
     */
  ]
})

const NANOWIRE_CAMERA_GROUP = freezeCameraGroup({
  id: 'nanowire-group',
  coverageLayerId: 'nanowire-background',
  layers: [
    {
      /*
       * The SEM databar occupies the bottom 158 of this plate's 2917 rows. It is
       * masked away rather than cropped, so the art box keeps its registration
       * and the cut dissolves into the retained qubit-array scene beneath.
       *
       * The top ramp mirrors that fade across the viewport, not across the
       * plate: at the settled stop the plate runs from y -613.51 to 3912.51 over
       * a 0..3840 stage, so a plate-symmetric ramp would sit above the frame
       * entirely. These stops put the top edge fully clear 172.80px below the
       * frame top and solid by 357.46px, the same distances the bottom fade
       * keeps from the frame bottom.
       */
      id: 'nanowire-background',
      asset: 'nanowire-background.webp',
      role: 'background',
      nativeSize: { width: 4096, height: 2917 },
      artBox: NANOWIRE_BACKGROUND_SOURCE,
      fit: 'fill',
      paintTransformBaked: true,
      opacity: 1,
      opaque: false,
      mask: {
        down: [[0, 0], [0.17373, 0], [0.214531, 1], [0.905, 1], [0.9458, 0], [1, 0]]
      }
    },
    {
      /* This export carries transparent padding, so the feather is measured from
         the painted hardware inside it (x 484-1415, y 210-841 of 1920 x 1080)
         rather than from the plate edge. */
      id: 'nanowire-focal',
      asset: 'nanowire-focal.webp',
      role: 'focal',
      nativeSize: { width: 1920, height: 1080 },
      artBox: NANOWIRE_TARGET,
      fit: 'fill',
      opacity: 0.899999976,
      opaque: false,
      mask: {
        across: [[0, 0], [0.2521, 0], [0.305, 1], [0.685, 1], [0.737, 0], [1, 0]],
        down: [[0, 0], [0.1944, 0], [0.247, 1], [0.7261, 1], [0.7787, 0], [1, 0]]
      },
      revealWithStop: true,
      revealDelayMs: 220
    }
  ]
})

function freezeFeature(feature) {
  if (!feature) return null
  assertPoint(feature)
  return Object.freeze({ ...feature })
}

/*
 * Plates painted behind a scene's registered art, positioned by their own art
 * box in that scene's coordinates. They ride inside the same camera, so they
 * zoom and register with the art in front of them. This is what lets a detail
 * baked into a flat plate be lifted onto its own layer without the plate behind
 * it turning into a hole.
 */
function freezeScenePlates(plates) {
  if (!plates?.length) return null
  return Object.freeze(plates.map(plate => {
    assertRect(plate.artBox, `${plate.id} plate art box`)
    return Object.freeze({
      ...plate,
      artBox: frozenRect(plate.artBox.x, plate.artBox.y, plate.artBox.width, plate.artBox.height)
    })
  }))
}

function freezeScene(scene) {
  const art = scene.art
  return Object.freeze({
    ...scene,
    settled: freezeSimilarity(scene.settled),
    art,
    underlays: freezeScenePlates(scene.underlays),
    /* Top-level aliases keep the view integration simple and backward-compatible. */
    artBox: art.artBox,
    fit: art.fit,
    anchor: art.objectPosition,
    assetSize: art.assetSize,
    assetToScene: art.assetToScene,
    cameraGroup: scene.cameraGroup ?? null,
    entryFeature: freezeFeature(scene.entryFeature),
    exitFeature: freezeFeature(scene.exitFeature)
  })
}

export const NANOSCALE_CAMERA_SCENES = Object.freeze([
  freezeScene({
    stop: 0,
    id: 'splash',
    number: null,
    layerId: 'splash-room',
    settled: SPLASH_SETTLED,
    art: SPLASH_ART,
    exitFeature: {
      ...centerOfRect(SPLASH_CRYOSTAT_TARGET),
      label: 'Cryostat in supplied room splash',
      figmaNode: 'production splash measurement',
      coordinates: 'canonical 2160 x 3840 scene after cover placement'
    }
  }),
  freezeScene({
    stop: 1,
    id: 'cryostat',
    number: '01',
    layerId: 'cryostat',
    settled: IDENTITY,
    art: CRYOSTAT_ART,
    entryFeature: {
      ...centerOfRect(CRYOSTAT_REGISTERED_TARGET),
      label: 'Complete rendered Cryostat plate',
      figmaNode: 'production cryostat.webp in 31:954 layout',
      coordinates: 'canonical 2160 x 3840 scene after cover placement'
    },
    exitFeature: {
      ...CRYOSTAT_MAJORANA_FEATURE_CANONICAL,
      label: 'Majorana package inside the cryostat',
      figmaNode: 'derived from 414:652 and 414:653',
      coordinates: 'canonical Cryostat scene'
    }
  }),
  freezeScene({
    stop: 2,
    id: 'majorana-2',
    /*
     * The arm and the package used to be one flat render, so the package could
     * not be moved on its own; the underlay below was painted behind it against
     * the day the plate in front could be trimmed to the package. That is this
     * scene now: the plate is the package alone and the arm behind it is real.
     */
    underlays: [
      {
        /*
         * The same region of the chandelier master the stop-01 plate is cut
         * from, so the arm continues into stop 01 exactly as the 01 -> 02
         * registration places it. Cutting the region rather than placing the
         * whole plate scaled up is what keeps this layer paintable: the full
         * asset made this scene's composited layer 10347 x 17901 CSS px, past
         * the point where Chromium will raster at full scale, which softened
         * everything the scene painted.
         */
        id: 'majorana-arm',
        asset: 'majorana-arm.webp',
        artBox: { x: -374.1, y: -1309.8, width: 2299.4, height: 3529.6 },
        fit: 'fill',
        opacity: 1
      }
    ],
    number: '02',
    layerId: 'majorana-2',
    settled: IDENTITY,
    art: MAJORANA_ART,
    entryFeature: {
      ...centerOfRect(MAJORANA_REGISTERED_TARGET),
      label: 'Majorana 2 focal package',
      figmaNode: '31:1394 / 414:653'
    },
    exitFeature: {
      ...centerOfRect(MAJORANA_QPU_TARGET),
      label: 'QPU window inside Majorana 2',
      figmaNode: 'window measured on the retired flat plate, carried in stage coordinates'
    }
  }),
  freezeScene({
    stop: 3,
    id: 'qpu-chip',
    number: '03',
    layerId: 'qpu-chip',
    settled: IDENTITY,
    art: FULL_STAGE_ART,
    cameraGroup: QPU_CAMERA_GROUP,
    entryFeature: {
      ...centerOfRect(QPU_DARK_BOARD_TARGET),
      label: 'Dark QPU board inside the registered object',
      figmaNode: 'dark board as a fraction of the re-cut focal plate'
    },
    exitFeature: {
      ...centerOfRect(QPU_DIE_TARGET),
      label: 'QPU die measured by the ~0.5 cm dimension',
      figmaNode: '414:1012-414:1016'
    }
  }),
  freezeScene({
    stop: 4,
    id: 'qubit-array',
    number: '04',
    layerId: 'qubit-array',
    settled: IDENTITY,
    art: FULL_STAGE_ART,
    cameraGroup: QUBIT_CAMERA_GROUP,
    entryFeature: {
      ...centerOfRect(QUBIT_ARRAY_TARGET),
      label: 'Qubit array object',
      figmaNode: '426:7513'
    },
    exitFeature: {
      ...centerOfRect(QUBIT_ARRAY_TARGET),
      label: 'Qubit array object',
      figmaNode: '426:7513'
    }
  }),
  freezeScene({
    stop: 5,
    id: 'nanowire',
    number: '05',
    layerId: 'nanowire',
    settled: IDENTITY,
    art: FULL_STAGE_ART,
    cameraGroup: NANOWIRE_CAMERA_GROUP,
    entryFeature: {
      ...centerOfRect(NANOWIRE_TARGET),
      label: 'Nanowire render',
      figmaNode: '414:1294'
    }
  })
])

function sceneAt(stop) {
  return NANOSCALE_CAMERA_SCENES[stop]
}

const CENTER_UV = Object.freeze([Object.freeze([0.5, 0.5])])

function freezeLandmarks({
  outgoingRect,
  incomingRect,
  outgoingSettled,
  incomingSettled,
  uvs
}) {
  const outgoingInverse = invertNanoscaleSimilarity(outgoingSettled)
  const incomingInverse = invertNanoscaleSimilarity(incomingSettled)

  return Object.freeze(uvs.map(([u, v]) => Object.freeze({
    outgoing: transformNanoscalePoint(
      outgoingInverse,
      pointInRect(outgoingRect, u, v)
    ),
    incoming: transformNanoscalePoint(
      incomingInverse,
      pointInRect(incomingRect, u, v)
    ),
    normalizedSourcePoint: Object.freeze({ u, v })
  })))
}

function registeredHandoff({
  from,
  to,
  kind,
  source,
  outgoingRect,
  incomingRect,
  landmarkUvs,
  scaleMode = 'geometric-mean',
  scaleOverride = null,
  fadeStart = 0.3,
  fadeEnd = 0.7,
  compositeMode = 'overlay',
  extentTolerance = null
}) {
  if (!['crossfade', 'overlay'].includes(compositeMode)) {
    throw new RangeError(`Unsupported nanoscale composite mode: ${compositeMode}`)
  }
  if (
    extentTolerance !== null &&
    (!isFiniteNumber(extentTolerance) || extentTolerance < 0)
  ) {
    throw new RangeError('handoff extent tolerance must be null or a non-negative number')
  }
  const outgoingScene = sceneAt(from)
  const incomingScene = sceneAt(to)
  const screenRegistration = scaleOverride === null
    ? nanoscaleSimilarityFromRects(outgoingRect, incomingRect, { scaleMode })
    : nanoscaleSimilarityFromAnchors(
        centerOfRect(outgoingRect),
        centerOfRect(incomingRect),
        scaleOverride
      )

  /* Convert the Figma-stage registration into each layer's canonical coordinates. */
  const registration = composeNanoscaleSimilarities(
    invertNanoscaleSimilarity(outgoingScene.settled),
    composeNanoscaleSimilarities(screenRegistration, incomingScene.settled)
  )
  const landmarks = freezeLandmarks({
    outgoingRect,
    incomingRect,
    outgoingSettled: outgoingScene.settled,
    incomingSettled: incomingScene.settled,
    uvs: landmarkUvs
  })
  const cameraAnchor = landmarks[0]?.outgoing
  if (!cameraAnchor) throw new Error(`Handoff ${from}->${to} needs a focal landmark`)
  const outgoingEnd = composeNanoscaleSimilarities(
    incomingScene.settled,
    invertNanoscaleSimilarity(registration)
  )
  const screenPath = Object.freeze({
    from: transformNanoscalePoint(outgoingScene.settled, cameraAnchor),
    to: transformNanoscalePoint(outgoingEnd, cameraAnchor)
  })
  const draft = {
    from,
    to,
    kind,
    source,
    compositeMode,
    extentTolerance,
    persistent: false,
    outgoingLayerId: outgoingScene.layerId,
    incomingLayerId: incomingScene.layerId,
    outgoingRect,
    incomingRect,
    outgoingFeature: outgoingScene.exitFeature,
    incomingFeature: incomingScene.entryFeature,
    screenRegistration,
    registration,
    cameraAnchor,
    screenPath,
    landmarks
  }
  const coverageArtBox = incomingScene.cameraGroup?.coverageArtBox ?? null
  const firstCoverageProgress = coverageArtBox
    ? findIncomingCoverageProgress(draft, coverageArtBox)
    : 0
  if (coverageArtBox && firstCoverageProgress >= (1 - EPSILON)) {
    throw new Error(
      `Incoming camera group ${incomingScene.cameraGroup.id} cannot cover the viewport before stop ${to}`
    )
  }
  const coverageGuard = coverageArtBox ? 0.0001 : 0
  const effectiveFadeStart = Math.min(
    0.999,
    Math.max(fadeStart, firstCoverageProgress + coverageGuard)
  )
  const effectiveFadeEnd = Math.min(
    1,
    Math.max(fadeEnd, effectiveFadeStart + 0.18)
  )

  return Object.freeze({
    ...draft,
    fade: Object.freeze({
      start: effectiveFadeStart,
      end: effectiveFadeEnd,
      requestedStart: fadeStart,
      requestedEnd: fadeEnd
    }),
    coverage: Object.freeze({
      incomingRequired: Boolean(coverageArtBox),
      incomingArtBox: coverageArtBox,
      firstCoverageProgress
    })
  })
}

function transformedArtBoxCoverageGap(transform, artBox) {
  const bounds = transformNanoscaleRect(transform, artBox)
  return Math.max(
    0,
    bounds.x,
    bounds.y,
    NANOSCALE_CAMERA_STAGE.width - (bounds.x + bounds.width),
    NANOSCALE_CAMERA_STAGE.height - (bounds.y + bounds.height)
  )
}

/* Finds the first camera sample whose incoming oversized plate covers the stage. */
function findIncomingCoverageProgress(handoff, artBox) {
  const coverageGapAt = progress => transformedArtBoxCoverageGap(
    handoffTransforms(handoff, progress).incoming,
    artBox
  )

  if (coverageGapAt(0) <= EPSILON) return 0

  const searchSteps = 512
  let lower = 0
  let upper = null
  for (let index = 1; index <= searchSteps; index += 1) {
    const progress = index / searchSteps
    if (coverageGapAt(progress) <= EPSILON) {
      upper = progress
      lower = (index - 1) / searchSteps
      break
    }
  }
  if (upper === null) return 1

  for (let iteration = 0; iteration < 48; iteration += 1) {
    const midpoint = (lower + upper) / 2
    if (coverageGapAt(midpoint) <= EPSILON) upper = midpoint
    else lower = midpoint
  }
  return upper
}

export const NANOSCALE_CAMERA_HANDOFFS = Object.freeze([
  registeredHandoff({
    from: 0,
    to: 1,
    kind: 'production-bitmap-registration',
    source: 'splash-room.webp cryostat bbox -> cryostat.webp rendered intrinsic plate',
    outgoingRect: transformNanoscaleRect(
      SPLASH_SETTLED,
      NANOSCALE_CAMERA_GEOMETRY.splashCryostatTarget
    ),
    incomingRect: NANOSCALE_CAMERA_GEOMETRY.cryostatRegisteredTarget,
    landmarkUvs: CENTER_UV,
    fadeStart: 0.32,
    fadeEnd: 0.68,
    compositeMode: 'crossfade'
  }),
  registeredHandoff({
    from: 1,
    to: 2,
    kind: 'shared-source-guided-feature',
    source: 'room-source scale; visible Majorana package centers',
    outgoingRect: NANOSCALE_CAMERA_GEOMETRY.cryostatMajoranaTarget,
    incomingRect: NANOSCALE_CAMERA_GEOMETRY.majoranaRegisteredTarget,
    landmarkUvs: CENTER_UV,
    scaleOverride: ROOM_TO_MAJORANA_SCREEN_REGISTRATION.scale
  }),
  registeredHandoff({
    from: 2,
    to: 3,
    kind: 'registered-feature-center',
    source: 'measured dark-board pixels inside Majorana 2 -> QPU focal cutout',
    outgoingRect: NANOSCALE_CAMERA_GEOMETRY.majoranaQpuTarget,
    incomingRect: NANOSCALE_CAMERA_GEOMETRY.qpuDarkBoardTarget,
    landmarkUvs: CENTER_UV,
    extentTolerance: 0.005
  }),
  registeredHandoff({
    from: 3,
    to: 4,
    kind: 'semantic-center',
    source: 'QPU die -> qubit array',
    outgoingRect: NANOSCALE_CAMERA_GEOMETRY.qpuDieTarget,
    incomingRect: NANOSCALE_CAMERA_GEOMETRY.qubitArrayTarget,
    landmarkUvs: CENTER_UV,
    fadeStart: 0.32,
    fadeEnd: 0.68
  }),
  registeredHandoff({
    from: 4,
    to: 5,
    kind: 'semantic-center',
    source: 'qubit array -> nanowire',
    outgoingRect: NANOSCALE_CAMERA_GEOMETRY.qubitArrayTarget,
    incomingRect: NANOSCALE_CAMERA_GEOMETRY.nanowireTarget,
    landmarkUvs: CENTER_UV,
    fadeStart: 0.32,
    fadeEnd: 0.68
  })
])

/* Kept as a named export for integration diagnostics and design review. */
export { ROOM_TO_MAJORANA_SCREEN_REGISTRATION }

function incomingOpacityForHandoff(handoff, localProgress) {
  const { start, end } = handoff.fade
  if (localProgress <= start) return 0
  if (localProgress >= end) return 1
  return nanoscaleCameraEase((localProgress - start) / (end - start))
}

function opacitiesForHandoff(handoff, localProgress) {
  const incoming = incomingOpacityForHandoff(handoff, localProgress)
  return Object.freeze({
    incoming,
    outgoing: handoff.compositeMode === 'crossfade' ? 1 - incoming : 1
  })
}

function handoffTransforms(handoff, localProgress) {
  const outgoingScene = sceneAt(handoff.from)
  const incomingScene = sceneAt(handoff.to)

  if (handoff.persistent) {
    const transform = interpolateNanoscaleSimilarity(
      handoff.fromTransform,
      handoff.toTransform,
      localProgress
    )
    return Object.freeze({ persistent: transform })
  }

  const outgoingEnd = composeNanoscaleSimilarities(
    incomingScene.settled,
    invertNanoscaleSimilarity(handoff.registration)
  )
  const camera = interpolateNanoscaleSimilarityAroundAnchor(
    outgoingScene.settled,
    outgoingEnd,
    handoff.cameraAnchor,
    localProgress
  )

  return Object.freeze({
    outgoing: camera,
    incoming: composeNanoscaleSimilarities(camera, handoff.registration)
  })
}

function presentationSegmentTransform(handoff, transforms) {
  if (handoff.persistent) {
    return composeNanoscaleSimilarities(
      transforms.persistent,
      invertNanoscaleSimilarity(handoff.fromTransform)
    )
  }
  return composeNanoscaleSimilarities(
    transforms.outgoing,
    invertNanoscaleSimilarity(sceneAt(handoff.from).settled)
  )
}

/** Returns the bounded outer-camera delta for one adjacent handoff. */
export function sampleNanoscalePresentationSegment(segment, localProgress) {
  if (!Number.isInteger(segment) || segment < 0 || segment >= NANOSCALE_CAMERA_HANDOFFS.length) {
    throw new RangeError('Nanoscale presentation segment is outside the camera journey')
  }
  const handoff = NANOSCALE_CAMERA_HANDOFFS[segment]
  return presentationSegmentTransform(
    handoff,
    handoffTransforms(handoff, clamp(localProgress))
  )
}

const FIXED_STAGE_BACKDROP = Object.freeze({
  fixed: true,
  x: 0,
  y: 0,
  width: NANOSCALE_CAMERA_STAGE.width,
  height: NANOSCALE_CAMERA_STAGE.height
})

function cameraToLocalArtTransform(scene, transform) {
  const { x, y } = scene.art.artBox
  return freezeSimilarity({
    scale: transform.scale,
    translateX: transform.translateX + ((transform.scale - 1) * x),
    translateY: transform.translateY + ((transform.scale - 1) * y)
  })
}

function sampledLayer(scene, role, transform, opacity = 1, extra = {}) {
  const artTransform = cameraToLocalArtTransform(scene, transform)
  return Object.freeze({
    stop: scene.stop,
    sceneId: scene.id,
    layerId: scene.layerId,
    role,
    translateX: transform.translateX,
    translateY: transform.translateY,
    scale: transform.scale,
    opacity,
    visible: opacity > 0,
    transformOrigin: '0 0',
    /* Integration transforms only the art/group. Scene wrappers stay
       transparent; the shared root stage owns the one opaque backing. */
    transformTarget: scene.cameraGroup ? 'camera-group' : 'art',
    cameraTransform: transform,
    cameraGroup: scene.cameraGroup,
    artTransform,
    ...extra
  })
}

const SETTLED_OVERLAY_STACKS = new Map()

/* Stop 00 is intentionally discarded by the first crossfade. From stop 01 on,
   every traversed scene remains registered beneath the newer artwork. */
function settledOverlayStackAt(stop) {
  const cached = SETTLED_OVERLAY_STACKS.get(stop)
  if (cached) return cached

  let stack
  if (stop === 0) {
    stack = [{ scene: sceneAt(0), transform: sceneAt(0).settled }]
  } else {
    stack = [{ scene: sceneAt(1), transform: sceneAt(1).settled }]
    for (let fromStop = 1; fromStop < stop; fromStop += 1) {
      const outgoingEnd = handoffTransforms(
        NANOSCALE_CAMERA_HANDOFFS[fromStop],
        1
      ).outgoing
      stack = stack.map(entry => ({
        scene: entry.scene,
        transform: composeNanoscaleSimilarities(outgoingEnd, entry.transform)
      }))
      const incomingScene = sceneAt(fromStop + 1)
      stack.push({ scene: incomingScene, transform: incomingScene.settled })
    }
  }

  const frozen = Object.freeze(stack.map(entry => Object.freeze(entry)))
  SETTLED_OVERLAY_STACKS.set(stop, frozen)
  return frozen
}

function settledSample(progress, scene) {
  const stack = settledOverlayStackAt(scene.stop)
  return Object.freeze({
    progress,
    fromStop: scene.stop,
    toStop: scene.stop,
    localProgress: 0,
    easedProgress: 0,
    backdrop: FIXED_STAGE_BACKDROP,
    presentationTransform: IDENTITY,
    layers: Object.freeze(stack.map((entry, index) => sampledLayer(
      entry.scene,
      index === (stack.length - 1) ? 'settled' : 'underlay',
      entry.transform,
      1,
      { stackStop: scene.stop }
    )))
  })
}

/**
 * Samples the six-stop visual timeline.
 *
 * Layers are returned bottom-to-top and never contain more than five entries.
 * 00->01 is a true reciprocal crossfade. Later handoffs are source-over
 * overlays: every traversed scene from 01 onward remains fully opaque and
 * registered beneath the newer artwork. The shared root backing prevents gaps.
 */
export function sampleNanoscaleCamera(progress) {
  const safeProgress = clamp(
    progress,
    NANOSCALE_CAMERA_STOPS[0],
    NANOSCALE_CAMERA_STOPS.at(-1)
  )

  if (Number.isInteger(safeProgress)) {
    return settledSample(safeProgress, sceneAt(safeProgress))
  }

  const fromStop = Math.floor(safeProgress)
  const toStop = fromStop + 1
  const localProgress = safeProgress - fromStop
  const easedProgress = nanoscaleCameraEase(localProgress)
  const handoff = NANOSCALE_CAMERA_HANDOFFS[fromStop]
  const transforms = handoffTransforms(handoff, localProgress)

  if (handoff.persistent) {
    return Object.freeze({
      progress: safeProgress,
      fromStop,
      toStop,
      localProgress,
      easedProgress,
      backdrop: FIXED_STAGE_BACKDROP,
      presentationTransform: presentationSegmentTransform(handoff, transforms),
      layers: Object.freeze([
        sampledLayer(sceneAt(fromStop), 'persistent', transforms.persistent, 1, {
          fromStop,
          toStop
        })
      ])
    })
  }

  const opacities = opacitiesForHandoff(handoff, localProgress)
  const layers = []
  const presentationTransform = presentationSegmentTransform(handoff, transforms)

  if (handoff.compositeMode === 'overlay') {
    const settledStack = settledOverlayStackAt(fromStop)
    settledStack.forEach((entry, index) => {
      layers.push(sampledLayer(
        entry.scene,
        index === (settledStack.length - 1) ? 'outgoing' : 'underlay',
        composeNanoscaleSimilarities(presentationTransform, entry.transform),
        1,
        { stackStop: fromStop }
      ))
    })
  } else if (opacities.outgoing > 0) {
    layers.push(sampledLayer(
      sceneAt(fromStop),
      'outgoing',
      transforms.outgoing,
      opacities.outgoing
    ))
  }
  if (opacities.incoming > 0) {
    layers.push(sampledLayer(
      sceneAt(toStop),
      'incoming',
      transforms.incoming,
      opacities.incoming
    ))
  }

  return Object.freeze({
    progress: safeProgress,
    fromStop,
    toStop,
    localProgress,
    easedProgress,
    backdrop: FIXED_STAGE_BACKDROP,
    presentationTransform,
    layers: Object.freeze(layers)
  })
}

function cssSimilarity(transform, label) {
  if (
    !transform ||
    !isFiniteNumber(transform.translateX) ||
    !isFiniteNumber(transform.translateY) ||
    !isFiniteNumber(transform.scale) ||
    transform.scale <= 0
  ) {
    throw new TypeError(`${label} must contain finite translateX/translateY and scale`)
  }
  return `translate3d(${transform.translateX}px, ${transform.translateY}px, 0) scale(${transform.scale})`
}

/** Formats the canonical stage camera; useful for diagnostics and wrappers at 0,0. */
export function nanoscaleCameraCssTransform(layer) {
  return cssSimilarity(layer, 'camera layer')
}

/** Formats the transform for a stage-origin group containing layered art. */
export function nanoscaleCameraCssGroupTransform(layer) {
  return cssSimilarity(layer?.cameraTransform, 'camera group transform')
}

/**
 * Formats the transform that must be applied to `.nz__scene-art` while its
 * `.nz__scene` parent stays fixed and transparent above the shared root stage.
 */
export function nanoscaleCameraCssArtTransform(layer) {
  return cssSimilarity(layer?.artTransform, 'camera art transform')
}

const VALIDATION_POINTS = Object.freeze([
  Object.freeze({ x: 0, y: 0 }),
  Object.freeze({ x: NANOSCALE_CAMERA_STAGE.width, y: 0 }),
  Object.freeze({ x: 0, y: NANOSCALE_CAMERA_STAGE.height }),
  Object.freeze({
    x: NANOSCALE_CAMERA_STAGE.width,
    y: NANOSCALE_CAMERA_STAGE.height
  }),
  Object.freeze({
    x: NANOSCALE_CAMERA_STAGE.width / 2,
    y: NANOSCALE_CAMERA_STAGE.height / 2
  })
])

function pointDistance(first, second) {
  return Math.hypot(first.x - second.x, first.y - second.y)
}

function transformErrorInPixels(first, second) {
  return VALIDATION_POINTS.reduce((maximum, point) => Math.max(
    maximum,
    pointDistance(
      transformNanoscalePoint(first, point),
      transformNanoscalePoint(second, point)
    )
  ), 0)
}

function screenPointViewportOverflow(point) {
  assertPoint(point)
  return Math.max(
    0,
    -point.x,
    point.x - NANOSCALE_CAMERA_STAGE.width,
    -point.y,
    point.y - NANOSCALE_CAMERA_STAGE.height
  )
}

function backdropCoversViewport(backdrop) {
  return Boolean(
    backdrop?.fixed &&
    backdrop.x <= 0 &&
    backdrop.y <= 0 &&
    (backdrop.x + backdrop.width) >= NANOSCALE_CAMERA_STAGE.width &&
    (backdrop.y + backdrop.height) >= NANOSCALE_CAMERA_STAGE.height
  )
}

/* The root-stage backdrop is independent of scene opacity/compositing. */
function sampledBackdropCoverage(sample) {
  return backdropCoversViewport(sample.backdrop) ? 1 : 0
}

/**
 * Numerically validates endpoint continuity, landmark registration, focal-path
 * containment, and full-stage backdrop coverage.
 *
 * `maxVisualFeatureError` is deliberately separate from the algebraic anchor
 * check. It compares every handoff's canonical landmark to the scene's audited
 * entry/exit feature metadata (for example QPU node 31:1676 rather than its much
 * larger background node), then checks the registered settled screen centers.
 * This prevents a mathematically self-consistent transform from locking onto
 * the wrong visual feature. `maxScreenPathDeviation` compares the sampled focal
 * point to its desired straight screen-space segment; `maxViewportOverflow`
 * asserts that point never leaves 2160 x 3840. Handoffs with an
 * `extentTolerance` additionally constrain registered width/height drift, so a
 * stale zoom magnitude cannot pass merely because its center still coincides.
 * Artwork is transformed inside a retained scene stack over a shared opaque
 * root stage, so
 * `minViewportBackdropCoverage` remains exactly 1 even during the reciprocal
 * 00->01 crossfade. Default geometry acceptance is <= 1 design px.
 */
export function validateNanoscaleCamera({
  tolerance = 1,
  samples = 41,
  coverageTolerance = EPSILON
} = {}) {
  if (!isFiniteNumber(tolerance) || tolerance < 0) {
    throw new RangeError('validation tolerance must be a non-negative number')
  }
  if (!Number.isInteger(samples) || samples < 2) {
    throw new RangeError('validation samples must be an integer of at least 2')
  }
  if (!isFiniteNumber(coverageTolerance) || coverageTolerance < 0) {
    throw new RangeError('coverage tolerance must be a non-negative number')
  }

  const errors = []
  let maxEndpointError = 0
  let maxAnchorError = 0
  let maxVisualFeatureError = 0
  let maxRegisteredExtentMismatch = 0
  let maxScreenPathDeviation = 0
  let maxViewportOverflow = 0
  let maxViewportCoverageGap = 0
  let maxCameraGroupCoverageGap = 0
  let minViewportBackdropCoverage = 1
  let maxLayerCount = 0
  let maxRetainedScale = 1

  for (const scene of NANOSCALE_CAMERA_SCENES) {
    const sample = sampleNanoscaleCamera(scene.stop)
    const expectedStack = settledOverlayStackAt(scene.stop)
    maxLayerCount = Math.max(maxLayerCount, sample.layers.length)
    const backdropCoverage = sampledBackdropCoverage(sample)
    minViewportBackdropCoverage = Math.min(minViewportBackdropCoverage, backdropCoverage)
    maxViewportCoverageGap = Math.max(maxViewportCoverageGap, 1 - backdropCoverage)
    for (const layer of sample.layers) {
      maxRetainedScale = Math.max(maxRetainedScale, layer.scale)
      const coverageArtBox = layer.cameraGroup?.coverageArtBox
      if (!coverageArtBox || !layer.visible) continue
      const coverageGap = transformedArtBoxCoverageGap(
        layer.cameraTransform,
        coverageArtBox
      )
      maxCameraGroupCoverageGap = Math.max(maxCameraGroupCoverageGap, coverageGap)
      if (coverageGap > tolerance) {
        errors.push(
          `Stop ${scene.stop} camera-group background misses the viewport by ` +
          `${coverageGap.toFixed(3)}px`
        )
      }
    }
    const actualIds = sample.layers.map(layer => layer.layerId)
    const expectedIds = expectedStack.map(entry => entry.scene.layerId)
    const stackShapeValid = (
      actualIds.length === expectedIds.length &&
      actualIds.every((id, index) => id === expectedIds[index]) &&
      new Set(actualIds).size === actualIds.length
    )
    if (!stackShapeValid) {
      errors.push(`Stop ${scene.stop} does not resolve to its exact retained scene stack`)
    } else {
      sample.layers.forEach((layer, index) => {
        const endpointError = transformErrorInPixels(layer, expectedStack[index].transform)
        maxEndpointError = Math.max(maxEndpointError, endpointError)
        const expectedRole = index === (sample.layers.length - 1) ? 'settled' : 'underlay'
        if (
          endpointError > tolerance ||
          Math.abs(layer.opacity - 1) > EPSILON ||
          layer.role !== expectedRole
        ) {
          errors.push(`Stop ${scene.stop} retained scene ${layer.layerId} misses its endpoint`)
        }
      })
    }

    /* Every historical adjacent registration must remain coincident after all
       later outer-camera transforms have been composed over it. */
    if (scene.stop >= 2) {
      for (let fromStop = 1; fromStop < scene.stop; fromStop += 1) {
        const historicalHandoff = NANOSCALE_CAMERA_HANDOFFS[fromStop]
        const outgoingEntry = expectedStack[fromStop - 1]
        const incomingEntry = expectedStack[fromStop]
        for (const landmark of historicalHandoff.landmarks) {
          const outgoingPoint = transformNanoscalePoint(
            outgoingEntry.transform,
            landmark.outgoing
          )
          const incomingPoint = transformNanoscalePoint(
            incomingEntry.transform,
            landmark.incoming
          )
          const error = pointDistance(outgoingPoint, incomingPoint)
          maxAnchorError = Math.max(maxAnchorError, error)
          if (error > tolerance) {
            errors.push(
              `Stop ${scene.stop} breaks retained registration ` +
              `${fromStop}->${fromStop + 1} by ${error.toFixed(3)}px`
            )
          }
        }
      }
    }
    if ((1 - backdropCoverage) > coverageTolerance) {
      errors.push(`Stop ${scene.stop} does not cover the full viewport with an opaque backdrop`)
    }
  }

  for (const handoff of NANOSCALE_CAMERA_HANDOFFS) {
    const transformsAtStart = handoffTransforms(handoff, 0)
    const transformsAtEnd = handoffTransforms(handoff, 1)

    if (handoff.persistent) {
      const startError = transformErrorInPixels(
        transformsAtStart.persistent,
        handoff.fromTransform
      )
      const endError = transformErrorInPixels(
        transformsAtEnd.persistent,
        handoff.toTransform
      )
      maxEndpointError = Math.max(maxEndpointError, startError, endError)
      if (startError > tolerance || endError > tolerance) {
        errors.push(`Persistent handoff ${handoff.from}->${handoff.to} misses an endpoint`)
      }
    } else {
      const outgoingScene = sceneAt(handoff.from)
      const incomingScene = sceneAt(handoff.to)
      const outgoingFeature = outgoingScene.exitFeature
      const incomingFeature = incomingScene.entryFeature

      if (!outgoingFeature || !incomingFeature || handoff.landmarks.length === 0) {
        errors.push(`Handoff ${handoff.from}->${handoff.to} has no audited visual features`)
      } else {
        const firstLandmark = handoff.landmarks[0]
        const outgoingMetadataError = pointDistance(
          firstLandmark.outgoing,
          outgoingFeature
        )
        const incomingMetadataError = pointDistance(
          firstLandmark.incoming,
          incomingFeature
        )
        const outgoingSettledFeature = transformNanoscalePoint(
          outgoingScene.settled,
          outgoingFeature
        )
        const incomingSettledFeature = transformNanoscalePoint(
          incomingScene.settled,
          incomingFeature
        )
        const registeredIncomingFeature = transformNanoscalePoint(
          handoff.screenRegistration,
          incomingSettledFeature
        )
        const screenFeatureError = pointDistance(
          outgoingSettledFeature,
          registeredIncomingFeature
        )

        maxVisualFeatureError = Math.max(
          maxVisualFeatureError,
          outgoingMetadataError,
          incomingMetadataError,
          screenFeatureError
        )
        if (
          outgoingMetadataError > tolerance ||
          incomingMetadataError > tolerance ||
          screenFeatureError > tolerance
        ) {
          errors.push(
            `Handoff ${handoff.from}->${handoff.to} is registered to the wrong visual feature`
          )
        }
      }

      if (handoff.extentTolerance !== null) {
        const registeredIncomingRect = transformNanoscaleRect(
          handoff.screenRegistration,
          handoff.incomingRect
        )
        const widthMismatch = Math.abs(
          (registeredIncomingRect.width / handoff.outgoingRect.width) - 1
        )
        const heightMismatch = Math.abs(
          (registeredIncomingRect.height / handoff.outgoingRect.height) - 1
        )
        const extentMismatch = Math.max(widthMismatch, heightMismatch)
        maxRegisteredExtentMismatch = Math.max(
          maxRegisteredExtentMismatch,
          extentMismatch
        )
        if (extentMismatch > handoff.extentTolerance) {
          errors.push(
            `Handoff ${handoff.from}->${handoff.to} registered extent mismatch ` +
            `${(extentMismatch * 100).toFixed(2)}% exceeds ` +
            `${(handoff.extentTolerance * 100).toFixed(2)}%`
          )
        }
      }

      const startError = transformErrorInPixels(
        transformsAtStart.outgoing,
        outgoingScene.settled
      )
      const endError = transformErrorInPixels(
        transformsAtEnd.incoming,
        incomingScene.settled
      )
      maxEndpointError = Math.max(maxEndpointError, startError, endError)
      if (startError > tolerance || endError > tolerance) {
        errors.push(`Registered handoff ${handoff.from}->${handoff.to} misses an endpoint`)
      }

      const incomingCoverageArtBox = incomingScene.cameraGroup?.coverageArtBox
      if (incomingCoverageArtBox) {
        const coverageProbes = [
          Math.min(1, handoff.fade.start + 1e-7),
          (handoff.fade.start + handoff.fade.end) / 2,
          handoff.fade.end
        ]
        for (const probe of coverageProbes) {
          const incomingTransform = handoffTransforms(handoff, probe).incoming
          const coverageGap = transformedArtBoxCoverageGap(
            incomingTransform,
            incomingCoverageArtBox
          )
          maxCameraGroupCoverageGap = Math.max(maxCameraGroupCoverageGap, coverageGap)
          if (coverageGap > tolerance) {
            errors.push(
              `Handoff ${handoff.from}->${handoff.to} incoming background misses ` +
              `the viewport by ${coverageGap.toFixed(3)}px during its fade`
            )
            break
          }
        }
      }

      /* Crossing an integer changes roles, not pixels: the same retained IDs,
         order, opacity and transforms must exist on both sides of the boundary. */
      const endpointApproach = sampleNanoscaleCamera(handoff.to - 1e-7)
      const endpointSettled = sampleNanoscaleCamera(handoff.to)
      const endpointApproachIds = endpointApproach.layers.map(layer => layer.layerId)
      const endpointSettledIds = endpointSettled.layers.map(layer => layer.layerId)
      const endpointStackMatches = (
        endpointApproachIds.length === endpointSettledIds.length &&
        endpointApproachIds.every((id, index) => id === endpointSettledIds[index])
      )
      if (!endpointStackMatches) {
        errors.push(`Handoff ${handoff.from}->${handoff.to} changes its scene stack at arrival`)
      } else {
        endpointApproach.layers.forEach((layer, index) => {
          const settledLayer = endpointSettled.layers[index]
          const endpointError = transformErrorInPixels(layer, settledLayer)
          maxEndpointError = Math.max(maxEndpointError, endpointError)
          if (
            endpointError > tolerance ||
            Math.abs(layer.opacity - settledLayer.opacity) > EPSILON
          ) {
            errors.push(
              `Handoff ${handoff.from}->${handoff.to} has a retained-layer arrival discontinuity`
            )
          }
        })
      }

      let pathFailed = false
      let viewportFailed = false
      let coverageFailed = false
      let cameraGroupCoverageFailed = false
      let compositingFailed = false
      let layerCountFailed = false
      let retainedStackFailed = false

      for (let sampleIndex = 0; sampleIndex < samples; sampleIndex += 1) {
        const localProgress = sampleIndex / (samples - 1)
        const transforms = handoffTransforms(handoff, localProgress)
        const easedProgress = nanoscaleCameraEase(localProgress)
        const desiredScreenAnchor = {
          x: handoff.screenPath.from.x + (
            (handoff.screenPath.to.x - handoff.screenPath.from.x) * easedProgress
          ),
          y: handoff.screenPath.from.y + (
            (handoff.screenPath.to.y - handoff.screenPath.from.y) * easedProgress
          )
        }
        const actualScreenAnchor = transformNanoscalePoint(
          transforms.outgoing,
          handoff.cameraAnchor
        )
        const screenPathDeviation = pointDistance(
          actualScreenAnchor,
          desiredScreenAnchor
        )
        const viewportOverflow = screenPointViewportOverflow(actualScreenAnchor)
        maxScreenPathDeviation = Math.max(maxScreenPathDeviation, screenPathDeviation)
        maxViewportOverflow = Math.max(maxViewportOverflow, viewportOverflow)

        if (screenPathDeviation > tolerance && !pathFailed) {
          errors.push(
            `Handoff ${handoff.from}->${handoff.to} focal path deviates ` +
            `${screenPathDeviation.toFixed(3)}px from its desired screen path`
          )
          pathFailed = true
        }
        if (viewportOverflow > tolerance && !viewportFailed) {
          errors.push(
            `Handoff ${handoff.from}->${handoff.to} focal point leaves the viewport by ` +
            `${viewportOverflow.toFixed(3)}px`
          )
          viewportFailed = true
        }

        for (const landmark of handoff.landmarks) {
          const outgoingPoint = transformNanoscalePoint(
            transforms.outgoing,
            landmark.outgoing
          )
          const incomingPoint = transformNanoscalePoint(
            transforms.incoming,
            landmark.incoming
          )
          const error = pointDistance(outgoingPoint, incomingPoint)
          maxAnchorError = Math.max(maxAnchorError, error)
          if (error > tolerance) {
            errors.push(
              `Handoff ${handoff.from}->${handoff.to} landmark error ${error.toFixed(3)}px`
            )
            break
          }
        }

        const progress = handoff.from + localProgress
        const publicSample = sampleNanoscaleCamera(progress)
        maxLayerCount = Math.max(maxLayerCount, publicSample.layers.length)
        const backdropCoverage = sampledBackdropCoverage(publicSample)
        const coverageGap = 1 - backdropCoverage
        minViewportBackdropCoverage = Math.min(
          minViewportBackdropCoverage,
          backdropCoverage
        )
        maxViewportCoverageGap = Math.max(maxViewportCoverageGap, coverageGap)
        for (const layer of publicSample.layers) {
          maxRetainedScale = Math.max(maxRetainedScale, layer.scale)
          const coverageArtBox = layer.cameraGroup?.coverageArtBox
          if (!coverageArtBox || !layer.visible) continue
          const artCoverageGap = transformedArtBoxCoverageGap(
            layer.cameraTransform,
            coverageArtBox
          )
          maxCameraGroupCoverageGap = Math.max(
            maxCameraGroupCoverageGap,
            artCoverageGap
          )
          if (artCoverageGap > tolerance && !cameraGroupCoverageFailed) {
            errors.push(
              `Handoff ${handoff.from}->${handoff.to} exposes a camera-group edge by ` +
              `${artCoverageGap.toFixed(3)}px while that scene is visible`
            )
            cameraGroupCoverageFailed = true
          }
        }
        const maximumExpectedLayers = handoff.compositeMode === 'crossfade'
          ? 2
          : handoff.to
        if (
          publicSample.layers.length > maximumExpectedLayers &&
          !layerCountFailed
        ) {
          errors.push(
            `Handoff ${handoff.from}->${handoff.to} exceeds its retained-layer budget`
          )
          layerCountFailed = true
        }
        if (
          localProgress > EPSILON &&
          localProgress < (1 - EPSILON) &&
          !compositingFailed
        ) {
          const expected = opacitiesForHandoff(handoff, localProgress)
          const outgoing = publicSample.layers.find(layer => layer.role === 'outgoing')
          const incoming = publicSample.layers.find(layer => layer.role === 'incoming')
          const outgoingOpacity = outgoing?.opacity ?? 0
          const incomingOpacity = incoming?.opacity ?? 0
          if (
            Math.abs(outgoingOpacity - expected.outgoing) > EPSILON ||
            Math.abs(incomingOpacity - expected.incoming) > EPSILON
          ) {
            errors.push(
              `Handoff ${handoff.from}->${handoff.to} violates its ` +
              `${handoff.compositeMode} compositing rule`
            )
            compositingFailed = true
          }

          const layerIds = publicSample.layers.map(layer => layer.layerId)
          if (
            new Set(layerIds).size !== layerIds.length &&
            !retainedStackFailed
          ) {
            errors.push(`Handoff ${handoff.from}->${handoff.to} duplicates a scene layer`)
            retainedStackFailed = true
          }

          if (handoff.compositeMode === 'overlay' && !retainedStackFailed) {
            const expectedRetained = settledOverlayStackAt(handoff.from)
            const actualRetained = publicSample.layers.filter(layer => layer.role !== 'incoming')
            const cameraDelta = composeNanoscaleSimilarities(
              transforms.outgoing,
              invertNanoscaleSimilarity(outgoingScene.settled)
            )
            const retainedShapeMatches = (
              actualRetained.length === expectedRetained.length &&
              actualRetained.every((layer, index) => (
                layer.layerId === expectedRetained[index].scene.layerId
              ))
            )
            if (!retainedShapeMatches) {
              errors.push(
                `Handoff ${handoff.from}->${handoff.to} breaks retained scene order`
              )
              retainedStackFailed = true
            } else {
              actualRetained.forEach((layer, index) => {
                const expectedTransform = composeNanoscaleSimilarities(
                  cameraDelta,
                  expectedRetained[index].transform
                )
                const retainedError = transformErrorInPixels(layer, expectedTransform)
                maxEndpointError = Math.max(maxEndpointError, retainedError)
                if (
                  retainedError > tolerance ||
                  Math.abs(layer.opacity - 1) > EPSILON
                ) {
                  errors.push(
                    `Handoff ${handoff.from}->${handoff.to} moves or fades a retained scene`
                  )
                  retainedStackFailed = true
                }
              })
            }
          }
        }
        if (coverageGap > coverageTolerance && !coverageFailed) {
          errors.push(
            `Handoff ${handoff.from}->${handoff.to} leaves a viewport backdrop ` +
            `coverage gap of ${coverageGap.toExponential(3)}`
          )
          coverageFailed = true
        }
      }
    }
  }

  return Object.freeze({
    valid: errors.length === 0,
    tolerance,
    samples,
    coverageTolerance,
    maxEndpointError,
    maxAnchorError,
    maxVisualFeatureError,
    maxRegisteredExtentMismatch,
    maxScreenPathDeviation,
    maxViewportOverflow,
    minViewportBackdropCoverage,
    maxViewportCoverageGap,
    maxCameraGroupCoverageGap,
    maxLayerCount,
    maxRetainedScale,
    errors: Object.freeze(errors)
  })
}

export function assertValidNanoscaleCamera(options) {
  const report = validateNanoscaleCamera(options)
  if (!report.valid) {
    throw new Error(`Invalid nanoscale camera:\n${report.errors.join('\n')}`)
  }
  return report
}
