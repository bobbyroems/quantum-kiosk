import { releaseVideoElement } from './media-lifecycle.js'

const VALID_CONTAINER_TAGS = new Set(['article', 'aside', 'div', 'section'])
const DEFAULT_EXIT_FALLBACK_MS = 170
const EXIT_FALLBACK_BUFFER_MS = 50
const explainerLifecycle = new WeakMap()

function hasOwn(value, key) {
  return Object.prototype.hasOwnProperty.call(value, key)
}

function normalizeHeadingLevel(value) {
  const level = Number(value)
  return Number.isInteger(level) && level >= 1 && level <= 6 ? level : 2
}

function normalizeContainerTag(value) {
  const tagName = String(value || 'article').toLowerCase()
  return VALID_CONTAINER_TAGS.has(tagName) ? tagName : 'article'
}

function isDomContent(value) {
  return Boolean(value) && typeof value === 'object' && Number.isInteger(value.nodeType)
}

function replaceElementContent(element, value) {
  if (value === null || value === undefined) {
    element.replaceChildren()
    return
  }
  if (!isDomContent(value)) {
    throw new TypeError('KioskExplainer rich content must be a DOM Node or DocumentFragment')
  }
  element.replaceChildren(value)
}

function lifecycleFor(element) {
  let lifecycle = explainerLifecycle.get(element)
  if (!lifecycle) {
    lifecycle = {
      ariaHidden: true,
      exitTimer: null,
      onExitEnd: null,
      visible: false
    }
    explainerLifecycle.set(element, lifecycle)
  }
  return lifecycle
}

function cancelPendingExit(element, lifecycle) {
  if (lifecycle.exitTimer !== null) {
    window.clearTimeout(lifecycle.exitTimer)
    lifecycle.exitTimer = null
  }
  if (lifecycle.onExitEnd) {
    element.removeEventListener('transitionend', lifecycle.onExitEnd)
    element.removeEventListener('transitioncancel', lifecycle.onExitEnd)
    lifecycle.onExitEnd = null
  }
}

function setAccessibilityHidden(element, hidden) {
  element.setAttribute('aria-hidden', String(hidden))
  element.toggleAttribute('inert', hidden)
  element.inert = hidden
}

function prefersReducedMotion() {
  return window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false
}

function cssTimeToMs(value) {
  const time = String(value || '').trim()
  const numeric = Number.parseFloat(time)
  if (!Number.isFinite(numeric)) return 0
  return time.endsWith('ms') ? numeric : numeric * 1000
}

/* Feature panels can lengthen the shared exit with CSS custom properties. The
   fallback must follow that authored opacity transition instead of cutting it
   off at the component default. `transitionend` remains the primary path; this
   is only the guard for interrupted or unreported transitions. */
function exitFallbackMs(element) {
  const style = window.getComputedStyle?.(element)
  if (!style) return DEFAULT_EXIT_FALLBACK_MS
  const properties = style.transitionProperty.split(',').map(value => value.trim())
  const durations = style.transitionDuration.split(',').map(cssTimeToMs)
  const delays = style.transitionDelay.split(',').map(cssTimeToMs)
  let opacityMs = 0

  for (const [index, property] of properties.entries()) {
    if (property !== 'opacity' && property !== 'all') continue
    const duration = durations[index % Math.max(durations.length, 1)] || 0
    const delay = delays[index % Math.max(delays.length, 1)] || 0
    opacityMs = Math.max(opacityMs, duration + delay)
  }

  return Math.max(
    DEFAULT_EXIT_FALLBACK_MS,
    Math.ceil(opacityMs + EXIT_FALLBACK_BUFFER_MS)
  )
}

function finishExit(element, lifecycle) {
  cancelPendingExit(element, lifecycle)
  if (!lifecycle.visible) element.hidden = true
}

function beginExit(element, lifecycle) {
  const wasShowing = element.classList.contains('is-showing')
  element.classList.remove('is-showing')
  if (lifecycle.exitTimer !== null || lifecycle.onExitEnd) return
  if (!wasShowing || !element.isConnected || prefersReducedMotion()) {
    element.hidden = true
    return
  }

  lifecycle.onExitEnd = event => {
    if (event.target !== element || event.propertyName !== 'opacity') return
    finishExit(element, lifecycle)
  }
  element.addEventListener('transitionend', lifecycle.onExitEnd)
  element.addEventListener('transitioncancel', lifecycle.onExitEnd)
  lifecycle.exitTimer = window.setTimeout(
    () => finishExit(element, lifecycle),
    exitFallbackMs(element)
  )
}

/* Callers name a video with `type: 'video'`; the extension test is the fallback
   so an existing caller that simply swaps an SVG for an MP4 keeps working. */
function isVideoMedia(media) {
  return media.type === 'video' || /\.(mp4|webm|mov)(\?|#|$)/i.test(String(media.src))
}

/* Every explainer built by this module has a video slot, but this component is
   shared by every module in the kiosk: a panel handed in from elsewhere, or one
   built before the slot existed, must degrade to the still rather than throw and
   take the whole experience down with it. */
function releaseVideo(mediaVideo) {
  if (!mediaVideo) return
  mediaVideo.hidden = true
  releaseVideoElement(mediaVideo)
}

function clearMedia(explainer) {
  const { element, media: figure, mediaImage, mediaVideo } = explainer
  figure.hidden = true
  mediaImage.hidden = true
  mediaImage.removeAttribute('src')
  mediaImage.removeAttribute('width')
  mediaImage.removeAttribute('height')
  mediaImage.alt = ''
  releaseVideo(mediaVideo)
  figure.removeAttribute('role')
  figure.removeAttribute('aria-label')
  element.classList.remove('has-media')
}

function updateMedia(explainer, media) {
  const { element, media: figure, mediaImage, mediaVideo } = explainer
  if (!media) {
    clearMedia(explainer)
    return
  }

  if (!media.src) throw new TypeError('KioskExplainer media requires a src')
  const source = String(media.src)
  const label = String(media.alt ?? '')

  if (mediaVideo && isVideoMedia(media)) {
    mediaImage.hidden = true
    mediaImage.removeAttribute('src')
    if (mediaVideo.getAttribute('src') !== source) {
      mediaVideo.src = source
      mediaVideo.load()
    }
    mediaVideo.loop = media.loop !== false
    mediaVideo.hidden = false
    if (Number.isFinite(media.width)) mediaVideo.width = media.width
    else mediaVideo.removeAttribute('width')
    if (Number.isFinite(media.height)) mediaVideo.height = media.height
    else mediaVideo.removeAttribute('height')
    /* A <video> takes no alt, so the caption role moves onto the figure. */
    figure.setAttribute('role', 'img')
    figure.setAttribute('aria-label', label)
  } else {
    releaseVideo(mediaVideo)
    figure.removeAttribute('role')
    figure.removeAttribute('aria-label')
    mediaImage.src = source
    mediaImage.alt = label
    mediaImage.hidden = false
    if (Number.isFinite(media.width)) mediaImage.width = media.width
    else mediaImage.removeAttribute('width')
    if (Number.isFinite(media.height)) mediaImage.height = media.height
    else mediaImage.removeAttribute('height')
  }

  figure.hidden = false
  element.classList.add('has-media')
}

/* Nothing should be decoding behind a hidden panel. The kiosk keeps several
   explainers built at once, so leaving their clips running would spend decode
   budget on frames that are never composited. */
function setMediaPlayback(explainer, playing) {
  const { mediaVideo } = explainer
  if (!mediaVideo || mediaVideo.hidden || !mediaVideo.getAttribute('src')) return
  if (playing) mediaVideo.play().catch(() => {})
  else mediaVideo.pause()
}

/**
 * Shared floating educational panel. Modules own placement and exact dimensions;
 * this component owns structure, surface, typography and visibility semantics.
 */
export function createKioskExplainer({
  body = '',
  bodyAriaLabel = '',
  bodyContent,
  className = '',
  footer = '',
  footerContent,
  headingLevel = 2,
  hidden = false,
  subtitle = '',
  visible = !hidden,
  ariaHidden = !visible,
  layout = 'stacked',
  media = null,
  tagName = 'article',
  title = '',
  variant = 'glass'
} = {}) {
  const element = document.createElement(normalizeContainerTag(tagName))
  element.className = ['kiosk-explainer', className].filter(Boolean).join(' ')
  element.dataset.kioskExplainerLayout = String(layout)
  element.dataset.kioskExplainerVariant = String(variant)

  const mediaElement = document.createElement('figure')
  mediaElement.className = 'kiosk-explainer__media'
  const mediaImage = document.createElement('img')
  mediaImage.className = 'kiosk-explainer__media-image'
  mediaImage.draggable = false

  /* Built alongside the image rather than on demand so swapping between a still
     and a clip is an attribute change, not a DOM rebuild mid-transition. An
     empty <video> costs nothing until it is given a source. */
  const mediaVideo = document.createElement('video')
  mediaVideo.className = 'kiosk-explainer__media-video'
  mediaVideo.muted = true
  mediaVideo.playsInline = true
  mediaVideo.preload = 'auto'
  mediaVideo.hidden = true
  mediaVideo.disablePictureInPicture = true

  mediaElement.append(mediaImage, mediaVideo)

  const copy = document.createElement('div')
  copy.className = 'kiosk-explainer__copy'
  const titleElement = document.createElement(`h${normalizeHeadingLevel(headingLevel)}`)
  titleElement.className = 'kiosk-explainer__title'
  /* A second, quieter line under the heading, for the qualifier a board sets
     smaller than the name it qualifies. Its own element rather than part of the
     title so it can take its own size and be left out entirely: a panel that
     passes no subtitle renders exactly as it did before this existed. */
  const subtitleElement = document.createElement('p')
  subtitleElement.className = 'kiosk-explainer__subtitle'
  subtitleElement.hidden = true
  const bodyElement = document.createElement('p')
  bodyElement.className = 'kiosk-explainer__body'
  copy.append(titleElement, subtitleElement, bodyElement)

  const footerElement = document.createElement('footer')
  footerElement.className = 'kiosk-explainer__footer'
  element.append(mediaElement, copy, footerElement)

  const explainer = Object.freeze({
    body: bodyElement,
    copy,
    element,
    footer: footerElement,
    subtitle: subtitleElement,
    media: mediaElement,
    mediaImage,
    mediaVideo,
    title: titleElement
  })

  element.hidden = !visible
  updateKioskExplainer(explainer, {
    ariaHidden,
    body,
    bodyAriaLabel,
    bodyContent,
    footer,
    footerContent,
    layout,
    media,
    subtitle,
    title,
    variant,
    visible
  })
  return explainer
}

/** Patch an existing explainer; omitted fields retain their current value. */
export function updateKioskExplainer(explainer, options = {}) {
  if (!explainer?.element || !explainer.title || !explainer.body) return

  const { body, element, footer, title } = explainer
  const lifecycle = lifecycleFor(element)
  if (hasOwn(options, 'layout')) {
    element.dataset.kioskExplainerLayout = String(options.layout || 'stacked')
  }
  if (hasOwn(options, 'variant')) {
    element.dataset.kioskExplainerVariant = String(options.variant || 'glass')
  }
  if (hasOwn(options, 'title')) {
    title.textContent = String(options.title ?? '')
    title.hidden = !title.textContent
  }
  if (hasOwn(options, 'subtitle') && explainer.subtitle) {
    explainer.subtitle.textContent = String(options.subtitle ?? '')
    explainer.subtitle.hidden = !explainer.subtitle.textContent
  }
  if (hasOwn(options, 'bodyContent') && options.bodyContent !== undefined) {
    replaceElementContent(body, options.bodyContent)
    body.hidden = !body.hasChildNodes()
  } else if (hasOwn(options, 'body')) {
    body.textContent = String(options.body ?? '')
    body.hidden = !body.textContent
  }
  if (hasOwn(options, 'bodyAriaLabel')) {
    const label = String(options.bodyAriaLabel ?? '')
    if (label) body.setAttribute('aria-label', label)
    else body.removeAttribute('aria-label')
  }
  if (hasOwn(options, 'footerContent') && options.footerContent !== undefined) {
    replaceElementContent(footer, options.footerContent)
    footer.hidden = !footer.hasChildNodes()
  } else if (hasOwn(options, 'footer')) {
    footer.textContent = String(options.footer ?? '')
    footer.hidden = !footer.textContent
  }
  if (hasOwn(options, 'media')) updateMedia(explainer, options.media)

  if (hasOwn(options, 'visible')) {
    const visible = Boolean(options.visible)
    lifecycle.visible = visible
    if (!hasOwn(options, 'ariaHidden')) lifecycle.ariaHidden = !visible
    if (visible) {
      cancelPendingExit(element, lifecycle)
      const wasHidden = element.hidden
      element.hidden = false
      if (wasHidden || options.replay) {
        element.classList.remove('is-showing')
        void element.offsetWidth
      }
      element.classList.add('is-showing')
      /* Restart rather than resume: the panel is a lesson, and a viewer who
         comes back to it should see the animation from the top rather than
         wherever it happened to be paused. */
      if ((wasHidden || options.replay) && explainer.mediaVideo) explainer.mediaVideo.currentTime = 0
      setMediaPlayback(explainer, true)
    } else {
      beginExit(element, lifecycle)
      setMediaPlayback(explainer, false)
    }
  }
  if (hasOwn(options, 'ariaHidden')) {
    lifecycle.ariaHidden = Boolean(options.ariaHidden)
  }
  setAccessibilityHidden(element, !lifecycle.visible || lifecycle.ariaHidden)
}

/** Cancel any pending exit work before removing an explainer from the DOM. */
export function disposeKioskExplainer(explainer) {
  if (!explainer?.element) return
  /* Removing the panel is not sufficient to stop Chromium's media pipeline.
     Release the decoder even when this explainer never made it far enough to
     receive lifecycle state (for example, an aborted module mount). */
  releaseVideo(explainer.mediaVideo)
  const lifecycle = explainerLifecycle.get(explainer.element)
  if (!lifecycle) return
  cancelPendingExit(explainer.element, lifecycle)
  explainerLifecycle.delete(explainer.element)
}
