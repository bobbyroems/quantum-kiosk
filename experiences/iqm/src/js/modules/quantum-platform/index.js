/**
 * Module 09 — The Microsoft Quantum Platform (Figma "Module 09: Microsoft
 * Quantum Platform", 30:1045).
 *
 * One screen, walked rather than navigated. The stack stands as a column of
 * dots with its five layer names hung off it; each tap names the next layer
 * down and opens that layer's reading in place, so the column grows downward
 * the way the visitor is reading it. The last layer, Qubits, opens onto the
 * hardware the stack sits on instead of a further reading, and finishing it
 * finishes the module.
 *
 * There is nothing to load, so there is no loading state: the module is a
 * drawing and its own copy.
 */

import { assetUrl } from '../../core/asset-url.js'
import {
  createKioskExplainer,
  disposeKioskExplainer,
  updateKioskExplainer
} from '../../core/kiosk-explainer.js'
import { createKioskTooltip, updateKioskTooltip } from '../../core/kiosk-tooltip.js'
import { mountModuleOutro } from '../module-outro.js'
import {
  DOT_ROWS,
  QUBIT_PARTNERS,
  ROW_COUNT,
  STACK_LAYERS,
  STEP_IDS,
  layerById
} from './stack.js'

/* What a slot leaves under an open card before the stack resumes. The gap
   above the card is the slot's own margin, which is the row gap the field
   already runs on, so an opening layer pushes the rest of the stack down by
   exactly the card plus one more row's worth of air. */
const CARD_TAIL_PX = 36

/* The board draws the closing reading on a different surface — partner logos
   rather than the standing copy — so the two cross over rather than one
   turning into the other. Long enough to read as a change of subject, short
   enough that a tap still feels answered. */
const SURFACE_CROSSFADE_MS = 420

function escapeHtml(value = '') {
  return String(value).replace(/[&<>"']/g, character => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;'
  })[character])
}

function createAbortError() {
  return new DOMException('The Microsoft Quantum Platform mount was aborted', 'AbortError')
}

/* One lattice row. The dots are placed on the row rather than flowed through
   it because the field is sparse — most rows are missing one or two columns,
   and a flowed row would close those gaps up. */
function rowMarkup(row, index) {
  const dots = row
    .map(dot => `
      <span class="qp__dot" data-qp-column="${dot.column}" data-qp-ink="${dot.ink}" aria-hidden="true"></span>
    `)
    .join('')

  /* The three middle names hang off the single dot their row carries, so they
     travel with the field when a card above them opens it apart. */
  const layer = STACK_LAYERS.find(candidate => candidate.row === index)
  const name = layer
    ? `
      <p class="qp__layer qp__layer--${layer.side}" data-qp-layer="${layer.id}">
        ${escapeHtml(layer.name)}
      </p>
    `
    : ''

  return `<div class="qp__row">${dots}${name}</div>`
}

/* Where an open reading goes. Always present, always collapsed to nothing
   until its layer is the one being read — the panel inside is built once and
   measured on the way open, so a slot never has to guess its own height. */
function slotMarkup(layerId) {
  return `<div class="qp__slot" data-qp-slot="${layerId}"><div data-qp-slot-inner></div></div>`
}

function partnerMarkup(partner) {
  const logo = partner.logo
    ? `
      <span class="qp__partner-logo">
        <img
          src="${assetUrl(partner.logo)}"
          alt="${escapeHtml(partner.logoAlt)}"
          width="${partner.logoWidth}"
          height="${partner.logoHeight}"
          draggable="false"
        >
      </span>
    `
    : ''
  return `
    <li class="qp__partner" data-qp-partner="${partner.id}">
      ${logo}
      <span class="qp__partner-label">${escapeHtml(partner.label)}</span>
    </li>
  `
}

function moduleMarkup() {
  const microsoftLogo = assetUrl('assets/ui/microsoft-logo.png')
  const restartIcon = assetUrl('assets/ui/restart.svg')
  const exitIcon = assetUrl('assets/ui/exit-x.svg')

  /* The field, with a slot opened between each layer's row group. Reading the
     stack top to bottom: Applications, then rows 0-2, then Developer tools'
     slot, and so on — the slot always sits directly under the name it belongs
     to, which is what makes an opening card read as coming out of that name. */
  const field = []
  for (let index = 0; index < ROW_COUNT; index += 1) {
    field.push(rowMarkup(DOT_ROWS[index], index))
    const layer = STACK_LAYERS.find(candidate => candidate.row === index)
    if (layer) field.push(slotMarkup(layer.id))
  }

  return `
    <section class="qp" data-qp-root data-qp-step="overview" aria-labelledby="qp-title">
      <header class="microsoft-header qp__header">
        <div class="microsoft-brand" aria-label="Microsoft Quantum">
          <span class="microsoft-brand__logo" aria-hidden="true">
            <img src="${microsoftLogo}" alt="" draggable="false">
          </span>
          <span class="microsoft-brand__divider" aria-hidden="true"></span>
          <span class="microsoft-brand__quantum">Quantum</span>
        </div>
        <div class="microsoft-header__actions">
          <button class="microsoft-header__action" type="button" data-qp-action="restart">
            <span>Restart</span>
            <span class="microsoft-header__action-icon" aria-hidden="true">
              <img src="${restartIcon}" alt="" draggable="false">
            </span>
          </button>
          <button class="microsoft-header__action" type="button" data-qp-action="exit">
            <span>Exit</span>
            <span class="microsoft-header__action-icon" aria-hidden="true">
              <img src="${exitIcon}" alt="" draggable="false">
            </span>
          </button>
        </div>
      </header>

      <h1 class="qp__sr-only" id="qp-title">The Microsoft Quantum Platform</h1>

      <!-- The stage is the control: the board's only instruction on these
           screens is "Tap anywhere to continue", so the target is everything
           under the band rather than a button drawn somewhere in particular.
           The shared guidance pill stays what it is — a noninteractive label
           for this target, not the target itself. -->
      <button
        class="qp__advance"
        type="button"
        data-qp-advance
        aria-label="Continue to the next layer of the stack"
      ></button>

      <div class="qp__stack" data-qp-stack>
        <p class="qp__layer qp__layer--above" data-qp-layer="applications">Applications</p>
        ${slotMarkup('applications')}
        ${field.join('')}
        <p class="qp__layer qp__layer--below" data-qp-layer="qubits">Qubits</p>
        <!-- The hardware the bottom of the stack rests on, between the name and
             the reading it opens: the logos are what "Qubits" points at, and
             the panel below then speaks about them. -->
        <section class="qp__partners" data-qp-partners aria-label="Supported qubit types" hidden>
          <ul class="qp__partner-list">${QUBIT_PARTNERS.map(partnerMarkup).join('')}</ul>
        </section>
        ${slotMarkup('qubits')}
      </div>

      <!-- The standing copy and the pill inviting the next tap move together
           and by the same amount, so they are one block that shifts rather
           than two that happen to agree. -->
      <div class="qp__below" data-qp-below>
        <div class="qp__continue" data-qp-continue></div>
        <div class="qp__copy" data-qp-copy>
          <!-- The break is the board's, carried rather than left to wrapping:
               the measure is wide enough to break a word later than the design
               does, and the heading reads as two clauses. -->
          <h2>Integrated full-stack solution<br>for quantum computing</h2>
          <p>Microsoft is building capabilities across the full quantum stack—so innovation at one layer can accelerate progress everywhere else.</p>
        </div>
      </div>

      <p class="qp__sr-only" data-qp-status aria-live="polite" aria-atomic="true"></p>
    </section>
  `
}

export async function mount(container, options = {}) {
  if (!container?.replaceChildren) {
    throw new TypeError('The Microsoft Quantum Platform requires a DOM container')
  }

  const { signal, onActivity, navigate = {}, module } = options
  if (signal?.aborted) throw createAbortError()

  const shell = document.createElement('div')
  shell.innerHTML = moduleMarkup().trim()
  const root = shell.firstElementChild

  /* The band states where the visitor is, then follows the registry route. */
  const upNextBanner = mountModuleOutro({
    module,
    root,
    navigate,
    onActivity,
    onRestart: () => root.querySelector('[data-qp-action="restart"]')?.click()
  })

  container.replaceChildren(root)

  const listeners = new AbortController()
  let disposed = false
  let stepIndex = 0
  let crossfadeTimer = null

  const status = root.querySelector('[data-qp-status]')
  const partners = root.querySelector('[data-qp-partners]')
  const advance = root.querySelector('[data-qp-advance]')
  const labels = new Map(
    [...root.querySelectorAll('[data-qp-layer]')].map(node => [node.dataset.qpLayer, node])
  )

  const continueTooltip = createKioskTooltip({
    className: 'kiosk-tooltip--blue qp__continue-pill',
    text: 'Tap anywhere to continue'
  })
  root.querySelector('[data-qp-continue]').append(continueTooltip.element)

  /* One panel per layer, built now and kept. They are the shared explainer
     drawn on a solid fill rather than the default glass: the board puts these
     inside the drawing, on white, where the glass surface has nothing to sit
     over and the fill is what tells the visitor which layer is speaking. */
  const cards = new Map(
    STACK_LAYERS.map(layer => {
      const explainer = createKioskExplainer({
        className: 'qp__card',
        title: layer.card.title,
        body: layer.card.body,
        variant: 'plain',
        visible: false
      })
      explainer.element.dataset.qpTone = layer.card.tone
      root.querySelector(`[data-qp-slot="${layer.id}"] [data-qp-slot-inner]`).append(explainer.element)
      return [layer.id, explainer]
    })
  )

  const slots = new Map(
    STACK_LAYERS.map(layer => [layer.id, root.querySelector(`[data-qp-slot="${layer.id}"]`)])
  )

  /* A slot's open height cannot be written down: the panels wrap to whatever
     the loaded font does with them. It is measured on the way open, with the
     panel already unhidden, and then watched — the kiosk's Segoe Sans can
     arrive after the module does, and a panel that reflows under a height
     fixed at fallback metrics would have its last line clipped off. */
  const openHeights = new ResizeObserver(entries => {
    for (const entry of entries) {
      const slot = entry.target.parentElement
      if (slot?.dataset.open !== 'true') continue
      slot.style.height = `${entry.target.offsetHeight + CARD_TAIL_PX}px`
    }
  })

  function openSlot(layerId) {
    const slot = slots.get(layerId)
    const inner = slot?.firstElementChild
    if (!slot || !inner) return
    updateKioskExplainer(cards.get(layerId), { visible: true })
    slot.dataset.open = 'true'
    slot.style.height = `${inner.offsetHeight + CARD_TAIL_PX}px`
    openHeights.observe(inner)
  }

  function closeSlot(layerId) {
    const slot = slots.get(layerId)
    if (!slot) return
    updateKioskExplainer(cards.get(layerId), { visible: false })
    delete slot.dataset.open
    slot.style.height = '0px'
    if (slot.firstElementChild) openHeights.unobserve(slot.firstElementChild)
  }

  function render() {
    const stepId = STEP_IDS[stepIndex]
    const layer = layerById(stepId)
    root.dataset.qpStep = stepId

    for (const [layerId, node] of labels) {
      /* On the overview every name reads equally; once a layer is open it is
         the one being spoken about and the rest stand back. */
      node.dataset.state = !layer ? 'even' : layerId === stepId ? 'active' : 'quiet'
    }

    for (const candidate of STACK_LAYERS) {
      if (candidate.id === stepId) openSlot(candidate.id)
      else closeSlot(candidate.id)
    }

    /* The closing layer trades the standing copy for the hardware it sits on,
       and there is nothing after it to invite, so the pill goes too. */
    const atHardware = stepId === 'qubits'
    updateKioskTooltip(continueTooltip, {
      text: 'Tap anywhere to continue',
      visible: !atHardware
    })
    advance.disabled = atHardware

    window.clearTimeout(crossfadeTimer)
    if (atHardware) {
      partners.hidden = false
      /* Unhidden a frame before it is faded up, so the fade has a from-state
         to run out of rather than appearing at full strength. */
      crossfadeTimer = window.setTimeout(() => { partners.dataset.shown = 'true' }, 20)
    } else {
      delete partners.dataset.shown
      crossfadeTimer = window.setTimeout(() => { partners.hidden = true }, SURFACE_CROSSFADE_MS)
    }

    /* The names and the open panel are both in the reading order already, so
       this only has to say which layer the tap moved to. */
    status.textContent = layer
      ? `${layer.name}: ${layer.card.title}.`
      : 'The Microsoft quantum stack, from applications down to qubits. Tap to take each layer in turn.'
  }

  function step() {
    if (stepIndex >= STEP_IDS.length - 1) return
    stepIndex += 1
    render()
    /* Reaching the hardware is finishing the module: there is no further layer
       to offer, so the band turns over to what follows this module instead. */
    if (stepIndex === STEP_IDS.length - 1) upNextBanner?.offer()
  }

  function restart() {
    /* Back to the overview, so the band goes back to naming this module. Left
       standing, the offer outlives the run that earned it. */
    upNextBanner?.withdraw()
    stepIndex = 0
    render()
    status.textContent = 'Module restarted. The stack is back to its overview.'
  }

  root.addEventListener('click', event => {
    const action = event.target.closest('[data-qp-action]')?.dataset.qpAction
    if (action) {
      onActivity?.()
      if (action === 'restart') restart()
      else if (action === 'exit') navigate.menu?.()
      return
    }
    if (!event.target.closest('[data-qp-advance]')) return
    onActivity?.()
    step()
  }, { signal: listeners.signal })

  const dispose = () => {
    if (disposed) return
    disposed = true
    window.clearTimeout(crossfadeTimer)
    openHeights.disconnect()
    listeners.abort()
    upNextBanner?.dispose()
    for (const explainer of cards.values()) disposeKioskExplainer(explainer)
  }
  signal?.addEventListener('abort', dispose, { once: true, signal: listeners.signal })

  render()

  return dispose
}

export default { mount }
