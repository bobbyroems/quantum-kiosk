import { assetUrl } from '../../core/asset-url.js'

const COMPARISON_ROOT = 'assets/modules/nanoscale/comparison'

export const NANOSCALE_COMPARISON_ASSETS = Object.freeze({
  guitarCutout: `${COMPARISON_ROOT}/guitar-cutout.png`,
  hockeyPuckBackground: `${COMPARISON_ROOT}/hockey-puck-background.jpg`,
  hockeyPuckCutout: `${COMPARISON_ROOT}/hockey-puck-cutout.png`,
  pencilCutout: `${COMPARISON_ROOT}/pencil-cutout.png`,
  saltBackground: `${COMPARISON_ROOT}/salt-background.png`,
  saltCutout: `${COMPARISON_ROOT}/salt-cutout.png`,
  redBloodCellBackground: `${COMPARISON_ROOT}/red-blood-cell-background.png`,
  redBloodCellCutout: `${COMPARISON_ROOT}/red-blood-cell-cutout.png`
})

export const NANOSCALE_COMPARISON_IMAGE_PATHS = Object.freeze(
  Object.values(NANOSCALE_COMPARISON_ASSETS)
)

const FEEDBACK_FRAME_FILL = Object.freeze({ color: '#F2F4F5', opacity: 0.6 })

const identityPaintTransform = () => Object.freeze({
  scaleX: 1,
  scaleY: 1,
  translateX: 0,
  translateY: 0
})

const frame = ({
  fillVisible = true,
  strokeColor,
  strokeOpacity = 1
}) => Object.freeze({
  width: 613,
  height: 662,
  cornerRadius: 12,
  /* Rounded where the card is rounded, square where it meets the caption, so
     the surface behind never shows past a corner of the picture. */
  cornerRadii: Object.freeze([12, 12, 0, 0]),
  clipsContent: true,
  fill: Object.freeze({ ...FEEDBACK_FRAME_FILL, visible: fillVisible }),
  stroke: Object.freeze({
    color: strokeColor,
    opacity: strokeOpacity,
    width: 4
  })
})

const box = (x, y, width, height) => Object.freeze({ x, y, width, height })

const source = (width, height, hash) => Object.freeze({ width, height, hash })

const paint = (mode, transform = identityPaintTransform(), filter = null) => Object.freeze({
  mode,
  transform,
  ...(filter ? { filter } : {})
})

const stretch = (scaleX, scaleY, translateX, translateY) => Object.freeze({
  scaleX,
  scaleY,
  translateX,
  translateY
})

const affine = (m00, m01, m02, m10, m11, m12) => Object.freeze({
  m00,
  m01,
  m02,
  m10,
  m11,
  m12
})

/*
 * Exact visible media layers from Feedback > Copy Updates for Makeshift >
 * Nanoscale in the current Figma file. The source feedback frames are scaled
 * to 1130.22607421875 x 2009.290771484375; every bound below is normalized to
 * the 2160 x 3840 kiosk coordinate system. Bounds are local to the 613 x 662
 * media frame. Oversized and rotated layers deliberately extend beyond it and
 * are clipped by the frame.
 */
export const NANOSCALE_COMPARISON_RECIPES = Object.freeze([
  Object.freeze({
    id: 'cryostat',
    contentIndex: 0,
    timelineIndex: 1,
    figmaNodeId: '58:5183',
    frame: frame({ strokeColor: '#0078D4', strokeOpacity: 0.2 }),
    layers: Object.freeze([
      Object.freeze({
        id: 'guitar-cutout',
        figmaNodeId: '58:5184',
        asset: NANOSCALE_COMPARISON_ASSETS.guitarCutout,
        source: source(4096, 1632, 'e1d128b448cfcc62d63127f504df0820318c504f'),
        box: box(
          175.86652099643021,
          5.999768905962234,
          263.26593087752514,
          649.9999827191653
        ),
        opacity: 1,
        paint: paint('stretch', stretch(
          0.161376953125,
          1,
          0.36096683144569397,
          0
        ))
      })
    ])
  }),
  Object.freeze({
    id: 'majorana-2',
    contentIndex: 1,
    timelineIndex: 2,
    figmaNodeId: '58:5467',
    frame: frame({ strokeColor: '#0078D4', strokeOpacity: 0.2 }),
    layers: Object.freeze([
      Object.freeze({
        id: 'hockey-puck-background',
        figmaNodeId: '58:5469',
        asset: NANOSCALE_COMPARISON_ASSETS.hockeyPuckBackground,
        source: source(4096, 2389, '70a69f8a8e9fd891db7e3402e455e396adb154c5'),
        box: box(
          -327.00263210216377,
          -39.0005120847591,
          1268.7483837019263,
          739.9999632782262
        ),
        opacity: 0.3,
        paint: paint('fill')
      }),
      Object.freeze({
        id: 'hockey-puck-cutout',
        figmaNodeId: '58:5472',
        asset: NANOSCALE_COMPARISON_ASSETS.hockeyPuckCutout,
        source: source(924, 685, '2cbc9d6e1ed6f98e89947747938e50e61abce81a'),
        box: box(
          17.99587418568396,
          347.998646122579,
          286.9999930876661,
          213.99999103556698
        ),
        opacity: 1,
        paint: paint('stretch', stretch(
          1.0025551319122314,
          1.008373737335205,
          -0.0015479413559660316,
          -0.003837071591988206
        ))
      })
    ])
  }),
  Object.freeze({
    id: 'qpu-chip',
    contentIndex: 2,
    timelineIndex: 3,
    figmaNodeId: '58:5745',
    frame: frame({ strokeColor: '#B8D4E9' }),
    layers: Object.freeze([
      Object.freeze({
        id: 'pencil-cutout',
        figmaNodeId: '58:5746',
        asset: NANOSCALE_COMPARISON_ASSETS.pencilCutout,
        source: source(4096, 2234, 'ae88a9c1a706b930883d93850d2f6f8b10a1ab80'),
        box: box(0, 0, 2368.8596074744796, 1292.0000578907964),
        opacity: 1,
        transform: affine(
          0.7996061444282532,
          0.6005247235298157,
          -1729.998116389014,
          -0.6005247235298157,
          0.7996061444282532,
          1052.5588812041976
        ),
        paint: paint('fill')
      })
    ])
  }),
  Object.freeze({
    id: 'qubit-array',
    contentIndex: 3,
    timelineIndex: 4,
    figmaNodeId: '58:4656',
    frame: frame({ fillVisible: false, strokeColor: '#B8D4E9' }),
    layers: Object.freeze([
      Object.freeze({
        id: 'salt-background',
        figmaNodeId: '58:4658',
        asset: NANOSCALE_COMPARISON_ASSETS.saltBackground,
        source: source(4096, 2788, 'edbef4c3fee410a8b9fbc50753a0a247435eade4'),
        box: box(
          -369.9976853959966,
          -60.00056234647076,
          1063.9999516136627,
          723.9999732147062
        ),
        opacity: 0.7,
        paint: paint('fill')
      }),
      Object.freeze({
        id: 'salt-cutout',
        figmaNodeId: '58:4659',
        asset: NANOSCALE_COMPARISON_ASSETS.saltCutout,
        source: source(2152, 1882, '3d667baa1977fe24f3a22db96b0c4d430134bb86'),
        box: box(
          1.0023067754264803,
          89.99942649229729,
          560.0000021601044,
          488.99999157559307
        ),
        opacity: 1,
        paint: paint('stretch', stretch(
          1.0017609596252441,
          1.0002477169036865,
          -0.0003668348945211619,
          -0.0000639194913674146
        ))
      })
    ])
  }),
  Object.freeze({
    id: 'nanowire',
    contentIndex: 4,
    timelineIndex: 5,
    figmaNodeId: '58:6011',
    frame: frame({ fillVisible: false, strokeColor: '#B8D4E9' }),
    layers: Object.freeze([
      Object.freeze({
        id: 'red-blood-cell-background',
        figmaNodeId: '58:6013',
        asset: NANOSCALE_COMPARISON_ASSETS.redBloodCellBackground,
        source: source(4096, 2487, '6ac338e5a1cfb4a01c3f89c57ce627a0c32b8da9'),
        box: box(
          -370.0028093790037,
          -69.99889977914115,
          1281.3380636738277,
          777.9999615501428
        ),
        opacity: 0.7,
        paint: paint(
          'fill',
          identityPaintTransform(),
          Object.freeze({ vibrance: -0.15000000596046448 })
        )
      }),
      Object.freeze({
        id: 'red-blood-cell-cutout',
        figmaNodeId: '58:6014',
        asset: NANOSCALE_COMPARISON_ASSETS.redBloodCellCutout,
        source: source(1289, 1748, '65b0934a89e52ced435b6ae343629edef3322166'),
        box: box(
          107.9971771756463,
          138.00108804455692,
          404.33812350871796,
          547.9999658703514
        ),
        opacity: 1,
        paint: paint('stretch', stretch(
          1.0027391910552979,
          1.0021560192108154,
          -0.002325389301404357,
          -0.0011985721066594124
        ))
      })
    ])
  })
])

const comparisonRecipesById = new Map(
  NANOSCALE_COMPARISON_RECIPES.map(recipe => [recipe.id, recipe])
)

/** Resolve by content index (0-4), stop id, or a stop object carrying either. */
export function nanoscaleComparisonRecipeFor(reference) {
  if (typeof reference === 'object' && reference) {
    return nanoscaleComparisonRecipeFor(reference.id ?? reference.index)
  }

  const recipe = typeof reference === 'string'
    ? comparisonRecipesById.get(reference)
    : NANOSCALE_COMPARISON_RECIPES[reference]

  if (!recipe) throw new RangeError(`Unknown Nanoscale comparison recipe: ${reference}`)
  return recipe
}

function applyMediaAccessibility(media, alt) {
  if (alt) {
    media.setAttribute('role', 'img')
    media.setAttribute('aria-label', alt)
    media.removeAttribute('aria-hidden')
    return
  }

  media.removeAttribute('role')
  media.removeAttribute('aria-label')
  media.setAttribute('aria-hidden', 'true')
}

function applyLayerTransform(element, layer) {
  const { width, height, x, y } = layer.box
  element.style.width = `${width}px`
  element.style.height = `${height}px`

  if (!layer.transform) {
    element.style.left = `${x}px`
    element.style.top = `${y}px`
    return
  }

  const { m00, m01, m02, m10, m11, m12 } = layer.transform
  element.style.left = '0'
  element.style.top = '0'
  element.style.transformOrigin = '0 0'
  element.style.transform = `matrix(${m00}, ${m10}, ${m01}, ${m11}, ${m02}, ${m12})`
}

function applyPaint(image, layer) {
  const { mode, transform, filter } = layer.paint
  image.style.position = 'absolute'
  image.style.display = 'block'
  image.style.maxWidth = 'none'

  if (mode === 'fill') {
    image.style.inset = '0'
    image.style.width = '100%'
    image.style.height = '100%'
    image.style.objectFit = 'cover'
    image.style.objectPosition = 'center center'
  } else {
    const { width, height } = layer.box
    image.style.left = `${(-transform.translateX * width) / transform.scaleX}px`
    image.style.top = `${(-transform.translateY * height) / transform.scaleY}px`
    image.style.width = `${width / transform.scaleX}px`
    image.style.height = `${height / transform.scaleY}px`
  }

  /* Figma stores its saturation adjustment under the raw `vibrance` key. */
  if (filter?.vibrance) image.style.filter = `saturate(${1 + filter.vibrance})`
}

/**
 * Build the visible source layers only. The comparison card owns the audited
 * frame fill/stroke; this element stays transparent to avoid double painting.
 */
export function createNanoscaleComparisonMedia(reference, {
  alt = '',
  ownerDocument = globalThis.document
} = {}) {
  if (!ownerDocument?.createElement) {
    throw new TypeError('Nanoscale comparison media requires a DOM document')
  }

  const recipe = nanoscaleComparisonRecipeFor(reference)
  const media = ownerDocument.createElement('div')
  media.className = 'nz__comparison-media'
  media.dataset.nzComparisonMedia = recipe.id
  media.style.position = 'relative'
  media.style.width = '100%'
  media.style.height = '100%'
  media.style.minWidth = '0'
  media.style.minHeight = '0'
  media.style.overflow = 'hidden'
  media.style.borderRadius = recipe.frame.cornerRadii
    .map(radius => `${radius}px`)
    .join(' ')
  media.style.setProperty('--nz-comparison-design-width', `${recipe.frame.width}px`)
  media.style.setProperty('--nz-comparison-design-height', `${recipe.frame.height}px`)
  applyMediaAccessibility(media, alt)

  for (const layer of recipe.layers) {
    const node = ownerDocument.createElement('span')
    node.className = 'nz__comparison-media-layer'
    node.dataset.nzComparisonLayer = layer.id
    node.style.position = 'absolute'
    node.style.display = 'block'
    node.style.overflow = 'hidden'
    node.style.opacity = String(layer.opacity)
    applyLayerTransform(node, layer)

    const image = ownerDocument.createElement('img')
    image.className = 'nz__comparison-media-image'
    image.src = assetUrl(layer.asset, ownerDocument.baseURI)
    image.alt = ''
    image.decoding = 'async'
    image.draggable = false
    image.setAttribute('aria-hidden', 'true')
    applyPaint(image, layer)

    node.append(image)
    media.append(node)
  }

  return media
}

function setStackMediaActive(media, active, alt = '') {
  media.hidden = !active
  media.classList.toggle('is-active', active)
  media.toggleAttribute('data-nz-comparison-active', active)
  applyMediaAccessibility(media, active ? alt : '')
}

/**
 * Build all five recipes once. Keeping every `img[src]` in this detached tree
 * lets the stage decoder await the actual DOM images before the module reveals.
 */
export function createNanoscaleComparisonMediaStack({
  activeReference = null,
  alt = '',
  ownerDocument = globalThis.document
} = {}) {
  if (!ownerDocument?.createElement) {
    throw new TypeError('Nanoscale comparison media requires a DOM document')
  }

  const stack = ownerDocument.createElement('div')
  stack.className = 'nz__comparison-media-stack'
  stack.setAttribute('data-nz-comparison-media-stack', '')
  stack.style.position = 'relative'
  stack.style.width = '100%'
  stack.style.height = '100%'
  stack.style.minWidth = '0'
  stack.style.minHeight = '0'
  stack.style.overflow = 'hidden'

  for (const recipe of NANOSCALE_COMPARISON_RECIPES) {
    const media = createNanoscaleComparisonMedia(recipe, { ownerDocument })
    media.style.position = 'absolute'
    media.style.inset = '0'
    setStackMediaActive(media, false)
    stack.append(media)
  }

  if (activeReference !== null && activeReference !== undefined) {
    setNanoscaleComparisonMediaStackStop(stack, activeReference, { alt })
  }

  return stack
}

/** Toggle an existing stack without replacing or allocating image nodes. */
export function setNanoscaleComparisonMediaStackStop(stack, reference, { alt = '' } = {}) {
  if (!stack?.querySelectorAll) {
    throw new TypeError('Nanoscale comparison media stack requires a DOM element')
  }

  const recipe = nanoscaleComparisonRecipeFor(reference)
  let activeMedia = null
  for (const media of stack.querySelectorAll('[data-nz-comparison-media]')) {
    const active = media.dataset.nzComparisonMedia === recipe.id
    setStackMediaActive(media, active, alt)
    if (active) activeMedia = media
  }

  if (!activeMedia) {
    throw new Error(`Comparison stack does not contain recipe: ${recipe.id}`)
  }

  stack.dataset.nzComparisonMediaActive = recipe.id
  return activeMedia
}

/** Hide every recipe while retaining all decoded image nodes in the DOM. */
export function hideNanoscaleComparisonMediaStack(stack) {
  if (!stack?.querySelectorAll) {
    throw new TypeError('Nanoscale comparison media stack requires a DOM element')
  }

  for (const media of stack.querySelectorAll('[data-nz-comparison-media]')) {
    setStackMediaActive(media, false)
  }
  delete stack.dataset.nzComparisonMediaActive
}

/** Replace a media host's contents and return the new recipe root. */
export function renderNanoscaleComparisonMedia(container, reference, options = {}) {
  if (!container?.replaceChildren) {
    throw new TypeError('Nanoscale comparison media requires a DOM container')
  }

  const media = createNanoscaleComparisonMedia(reference, {
    ...options,
    ownerDocument: options.ownerDocument ?? container.ownerDocument
  })
  container.replaceChildren(media)
  return media
}
