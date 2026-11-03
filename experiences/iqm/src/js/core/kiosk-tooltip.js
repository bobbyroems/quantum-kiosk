const SVG_NS = 'http://www.w3.org/2000/svg'

/*
 * Drawn rather than typed. As the letter `i` the mark was unreadable, and not
 * because of its size: the pill paints its words by clipping a gradient to the
 * text, which means -webkit-text-fill-color is transparent and every glyph is
 * filled by that gradient instead of by its own colour. A ring survives being
 * painted through the gradient's translucent middle; a thin stem and a dot do
 * not, so the mark washed out to an empty circle exactly when the sheen passed
 * over it.
 *
 * Geometry is immune to that — fill and stroke are not text — so the mark keeps
 * its weight through the sweep. It also stops the shape depending on which of
 * the Segoe fallbacks actually loaded.
 *
 * currentColor throughout, so it still takes the module's type colour.
 */
function buildInfoMark() {
  const svg = document.createElementNS(SVG_NS, 'svg')
  svg.setAttribute('viewBox', '0 0 24 24')
  svg.setAttribute('fill', 'none')
  svg.setAttribute('focusable', 'false')
  svg.setAttribute('aria-hidden', 'true')

  const ring = document.createElementNS(SVG_NS, 'circle')
  ring.setAttribute('cx', '12')
  ring.setAttribute('cy', '12')
  ring.setAttribute('r', '10.7')
  ring.setAttribute('stroke', 'currentColor')
  ring.setAttribute('stroke-width', '1.5')

  const dot = document.createElementNS(SVG_NS, 'circle')
  dot.setAttribute('cx', '12')
  dot.setAttribute('cy', '7.4')
  dot.setAttribute('r', '1')
  dot.setAttribute('fill', 'currentColor')

  /* A seriffed body rather than a plain bar: an entry stroke at the top left
     and a foot across the bottom, which is the shape the classic info mark
     uses. A bare rectangle beside a round dot read as two unrelated blobs —
     the serifs are what make it resolve as a letter at this size.

     The stem stays narrow and the serifs carry the width, so the mark gains
     shape without gaining weight.

     Traced from the top-left of the entry stroke, clockwise: across the top,
     down the stem's right edge, out and around the foot, then back up the
     stem's left edge to close under the entry stroke. */
  const body = document.createElementNS(SVG_NS, 'path')
  body.setAttribute('d', [
    'M10.25 10.75',
    'H12.75',
    'V16.55',
    'H14.4',
    'V17.75',
    'H9.6',
    'V16.55',
    'H11.25',
    'V11.95',
    'H10.25',
    'Z'
  ].join(''))
  body.setAttribute('fill', 'currentColor')

  svg.append(ring, dot, body)
  return svg
}

export function createKioskTooltip({
  ariaHidden = false,
  className = '',
  hidden = false,
  text = ''
} = {}) {
  const element = document.createElement('div')
  element.className = ['kiosk-tooltip', className].filter(Boolean).join(' ')
  element.hidden = hidden
  element.setAttribute('aria-hidden', String(ariaHidden || hidden))

  const line = document.createElement('p')
  line.className = 'kiosk-tooltip__text'

  /* Decorative, and hidden from the reading order: the pill is already an
     instruction, so announcing a badge before it only adds noise.

     It lives inside .kiosk-tooltip__text rather than beside it because that is
     the element modules colour — several set the type colour there and leave
     the pill's own `color` alone — so sitting inside is what makes
     currentColor resolve to the words' colour rather than the pill's. */
  const icon = document.createElement('span')
  icon.className = 'kiosk-tooltip__icon'
  icon.setAttribute('aria-hidden', 'true')
  icon.append(buildInfoMark())

  /* `copy` is this span, not the paragraph. Callers assign to
     copy.textContent — updateKioskTooltip below, and superposition-game.js
     directly — and assigning to the paragraph would take the badge with it
     every time the words changed. */
  const copy = document.createElement('span')
  copy.className = 'kiosk-tooltip__label'
  copy.textContent = text

  line.append(icon, copy)
  element.append(line)

  return Object.freeze({ ariaHidden: Boolean(ariaHidden), copy, element })
}

export function updateKioskTooltip(tooltip, {
  replay = false,
  text = '',
  visible = false
} = {}) {
  if (!tooltip?.element || !tooltip.copy) return

  tooltip.copy.textContent = text
  tooltip.element.classList.remove('is-showing')
  tooltip.element.hidden = !visible
  tooltip.element.setAttribute('aria-hidden', String(tooltip.ariaHidden || !visible))
  if (!visible) return

  if (replay) void tooltip.element.offsetWidth
  tooltip.element.classList.add('is-showing')
}
