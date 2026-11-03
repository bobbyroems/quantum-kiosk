import { assetUrl } from '../../core/asset-url.js'
import { createBuildGuidanceController } from './build-guidance.js'
import {
  blendBuildDragTilt,
  buildDragOffset,
  buildDragTiltFromVelocity,
  centeredBuildSnap,
  pointInsideRect
} from './build-drag-motion.js'
import { componentRotationFromDrag } from './component-inspection.js'
import { createMajoranaFinale } from './majorana-finale.js'
import { createMajoranaScene } from './majorana-scene.js'
import { createPathwaysGuidanceController } from './pathways-guidance.js'
import { getPathwayPulsePoint } from './pathway-pulse-motion.js'
import {
  getPathwaysContinuationElapsed,
  getPathwaysFrame,
  getSelectedPathwayFrame,
  PATHWAYS_TIMINGS
} from './pathways-timeline.js'
import { createPathwaysVisitController } from './pathways-visit.js'
import {
  getSectionTransitionKind,
  rectInStage,
  SECTION_TRANSITION_KINDS,
  SECTION_TRANSITION_TIMINGS,
  transformBetweenRects
} from './section-transition-motion.js'
import { mountModuleOutro } from '../module-outro.js'
import {
  createKioskExplainer,
  disposeKioskExplainer,
  updateKioskExplainer
} from '../../core/kiosk-explainer.js'
import {
  createKioskTooltip,
  updateKioskTooltip
} from '../../core/kiosk-tooltip.js'
import {
  createMajoranaState,
  getMajoranaBuildProgress,
  hasVisitedMajoranaTab,
  isValidMajoranaDrop,
  isMajoranaBuildComplete,
  MAJORANA_PARTS,
  reduceMajoranaState
} from './majorana-state.js'

const TAB_LABELS = Object.freeze({
  components: 'The Components',
  pathways: 'The Pathways',
  build: 'Build the Majorana'
})

const TAB_ORDER = Object.freeze(Object.keys(TAB_LABELS))
const PATHWAY_IDS = Object.freeze(['external', 'control', 'readout'])
const PATHWAY_DETAILS = Object.freeze({
  external: Object.freeze({
    title: 'Connection to external instrumentation',
    body: 'This pathway connects room-temperature electronics to a cryogenic environment over 100x colder than outer space.'
  }),
  control: Object.freeze({
    title: 'Control signals to QPU',
    body: 'More qubits usually means more wiring. Placing the Cryo-CMOS next to the qubits helps reduce the wiring needed to scale.'
  }),
  readout: Object.freeze({
    title: 'Qubit readout',
    body: "Measuring a qubit changes its state. That's why the signal in this pathway comes from nearby sensors, not the qubit itself."
  })
})
/* Wording from the 25 Aug board. The two mid-build lines no longer carry the
   bolded "Add the X to complete the module" instruction they used to: the board
   moves that job to the opening line, and each state now says what is missing
   by describing what the placed part cannot do on its own. */
const BUILD_PANEL_COPY = Object.freeze({
  'qpu-first': 'The QPU stack generates quantum signals. It still needs instructions from the cryo-CMOS.',
  'cryo-first': 'The cryo-CMOS sends instructions to the quantum processor. But without a QPU stack, there is nothing to control.',
  complete: 'Together, the cryo-CMOS and QPU stack form a complete quantum processing module.'
})
const BUILD_TOOLTIP_COPY = Object.freeze({
  initial: 'Drag and drop the missing components on M2',
  'qpu-first': 'Awaiting instructions. Add missing component.',
  'cryo-first': 'Awaiting quantum hardware. Add missing component.',
  complete: 'Tap anywhere to finish'
})
const COMPONENTS_RELOCATION_MS = 1_800
const COMPONENTS_RELOCATION_FALLBACK_MS = COMPONENTS_RELOCATION_MS + 180
const COMPONENTS_SCHEMATIC_REVEAL_MS = 760
// Reveal QPU first, hold for comprehension, then reveal Cryo-CMOS. Each text
// card waits until its component has physically settled into the focus layout.
const COMPONENTS_FOCUS_TRANSITION_MS = 3_450
const PATHWAY_DETAIL_TRANSITION_MS = 760
const BUILD_SNAP_TRANSITION_MS = 560
const BUILD_SNAP_FALLBACK_MS = BUILD_SNAP_TRANSITION_MS + 120
const BUILD_SEAT_EFFECT_MS = 300
const BUILD_TILT_REST_DELAY_MS = 84
const PATHWAYS_COMPONENT_FILTER = 'grayscale(1) saturate(0.25) brightness(1.04)'

function moduleMarkup() {
  const microsoftLogo = assetUrl('assets/ui/microsoft-logo.png')
  const restartIcon = assetUrl('assets/ui/restart.svg')
  const exitIcon = assetUrl('assets/ui/exit-x.svg')
  const chevronIcon = assetUrl('assets/ui/chevron-right.svg')
  const introShadow = assetUrl('assets/modules/build-majorana-2/majorana-shadow.svg')
  const schematicBackdrop = assetUrl('assets/modules/build-majorana-2/majorana-schematic-backdrop.png')
  const schematicComposite = assetUrl('assets/modules/build-majorana-2/majorana-schematic-composite.png')
  const qpuStackCrop = assetUrl('assets/modules/build-majorana-2/majorana-qpu-stack-crop.png')
  const pcbCover = assetUrl('assets/modules/build-majorana-2/majorana-pcb-cover.png')
  const pathwayControl = assetUrl(
    'assets/modules/build-majorana-2/majorana-pathway-control.png'
  )
  const pathwayControlActive = assetUrl(
    'assets/modules/build-majorana-2/majorana-pathway-control-active.png'
  )
  const pathwayInput = assetUrl(
    'assets/modules/build-majorana-2/majorana-pathway-input.png'
  )
  const pathwayInputActive = assetUrl(
    'assets/modules/build-majorana-2/majorana-pathway-input-active.png'
  )
  const pathwayReadout = assetUrl(
    'assets/modules/build-majorana-2/majorana-pathway-readout.png'
  )
  const pathwayReadoutActive = assetUrl(
    'assets/modules/build-majorana-2/majorana-pathway-readout-active.png'
  )
  const pathwayArrowControl = assetUrl(
    'assets/modules/build-majorana-2/majorana-pathway-arrow-control.svg'
  )
  const pathwayArrowInput = assetUrl(
    'assets/modules/build-majorana-2/majorana-pathway-arrow-input.svg'
  )
  const pathwayArrowReadout = assetUrl(
    'assets/modules/build-majorana-2/majorana-pathway-arrow-readout.svg'
  )
  const pathwayLabelLine = assetUrl(
    'assets/modules/build-majorana-2/majorana-pathway-label-line.svg'
  )
  const pathwayLabelLineControl = assetUrl(
    'assets/modules/build-majorana-2/majorana-pathway-label-line-control.svg'
  )
  const pathwayPulseGlow = assetUrl(
    'assets/modules/build-majorana-2/majorana-pathway-pulse-glow.svg'
  )
  const pathwayPulseCore = assetUrl(
    'assets/modules/build-majorana-2/majorana-pathway-pulse-core.svg'
  )
  return `
    <div class="majorana-module is-intro" data-majorana-root>
      <header class="majorana-module__header">
        <div class="majorana-brand" aria-label="Microsoft Quantum">
          <span class="majorana-brand__microsoft">
            <img src="${microsoftLogo}" alt="Microsoft">
          </span>
          <span class="majorana-brand__rule" aria-hidden="true"></span>
          <span class="majorana-brand__quantum">Quantum</span>
        </div>

        <div class="microsoft-header__actions">
          <button class="microsoft-header__action" type="button" data-majorana-action="restart">
            <span>Restart</span>
            <span class="microsoft-header__action-icon" aria-hidden="true"><img src="${restartIcon}" alt=""></span>
          </button>
          <button class="microsoft-header__action" type="button" data-majorana-action="exit">
            <span>Exit</span>
            <span class="microsoft-header__action-icon" aria-hidden="true"><img src="${exitIcon}" alt=""></span>
          </button>
        </div>
      </header>

      <div class="majorana-module__views">
        <section class="majorana-view majorana-intro" data-majorana-view="intro">
          <div class="majorana-intro__light-sweep" aria-hidden="true"></div>
          <img class="majorana-intro__shadow" src="${introShadow}" alt="" aria-hidden="true">
          <div class="majorana-model-slot majorana-model-slot--intro" data-model-slot="intro"></div>
          <button class="majorana-primary-action" type="button" data-majorana-action="start" disabled>
            <span>Get started</span>
            <span class="majorana-primary-action__icon" aria-hidden="true">
              <img src="${chevronIcon}" alt="">
            </span>
          </button>
        </section>

        <section class="majorana-view majorana-components" data-majorana-view="components" hidden>
          <div class="majorana-model-slot majorana-model-slot--components" data-model-slot="components"></div>

          <div class="majorana-components-focus" data-components-focus aria-hidden="true" inert>
            <div class="majorana-components-focus__intro" data-majorana-explainer="components-summary"></div>

            <button
              class="majorana-focus-component majorana-focus-component--qpu"
              type="button"
              data-majorana-component-inspect="qpu-stack"
              aria-label="Rotate the QPU stack to inspect it"
              aria-describedby="majorana-qpu-description"
            >
              <span class="majorana-focus-component__idle">
                <span class="majorana-focus-component__rotator">
                  <span class="majorana-focus-component__qpu-shell"></span>
                  <span class="majorana-focus-component__qpu-crop">
                    <img src="${qpuStackCrop}" alt="" loading="eager" decoding="async">
                  </span>
                  <span
                    class="majorana-focus-component__model"
                    data-majorana-component-model="qpu-stack"
                    aria-hidden="true"
                  ></span>
                </span>
              </span>
            </button>

            <button
              class="majorana-focus-component majorana-focus-component--cmos"
              type="button"
              data-majorana-component-inspect="cryo-cmos"
              aria-label="Rotate the Cryo-CMOS to inspect it"
              aria-describedby="majorana-cmos-description"
            >
              <span class="majorana-focus-component__idle">
                <span class="majorana-focus-component__rotator">
                  <span class="majorana-focus-component__pcb-cover">
                    <img src="${pcbCover}" alt="" loading="eager" decoding="async">
                  </span>
                  <span class="majorana-focus-component__green-mask"></span>
                  <span class="majorana-focus-component__cryo-chip">
                    <img src="${qpuStackCrop}" alt="" loading="eager" decoding="async">
                  </span>
                  <span
                    class="majorana-focus-component__model"
                    data-majorana-component-model="cryo-cmos"
                    aria-hidden="true"
                  ></span>
                </span>
              </span>
            </button>

            <div class="majorana-components-focus__card majorana-components-focus__card--qpu" id="majorana-qpu-description" data-majorana-explainer="qpu"></div>

            <div class="majorana-components-focus__card majorana-components-focus__card--cmos" id="majorana-cmos-description" data-majorana-explainer="cmos"></div>
          </div>

          <button class="majorana-tap-target" type="button" data-majorana-action="next-pathways" aria-label="Continue to quantum information channels" hidden></button>
          <div class="majorana-stage-tooltip majorana-stage-tooltip--components" data-majorana-tooltip="components" aria-hidden="true"></div>
        </section>

        <section class="majorana-view majorana-pathways" data-majorana-view="pathways" hidden>
          <div class="majorana-model-slot majorana-model-slot--pathways" data-model-slot="pathways"></div>

          <div class="majorana-pathways__diagram" aria-hidden="true">
            <div class="majorana-pathway majorana-pathway--external" data-pathway="external">
              <span class="majorana-pathway__track majorana-pathway__track--neutral">
                <img src="${pathwayInput}" alt="" loading="eager" decoding="async">
              </span>
              <span class="majorana-pathway__track majorana-pathway__track--active" data-pathway-active>
                <img src="${pathwayInputActive}" alt="" loading="eager" decoding="async">
              </span>
              <img class="majorana-pathway__arrow majorana-pathway__arrow--one" src="${pathwayArrowInput}" alt="">
              <img class="majorana-pathway__arrow majorana-pathway__arrow--two" src="${pathwayArrowInput}" alt="">
              <img class="majorana-pathway__arrow majorana-pathway__arrow--three" src="${pathwayArrowInput}" alt="">
              <span class="majorana-pathway__pulse" data-pathway-pulse>
                <img class="majorana-pathway__pulse-glow" src="${pathwayPulseGlow}" alt="">
                <img class="majorana-pathway__pulse-core" src="${pathwayPulseCore}" alt="">
              </span>
            </div>

            <div class="majorana-pathway majorana-pathway--control" data-pathway="control">
              <span class="majorana-pathway__track majorana-pathway__track--neutral">
                <img src="${pathwayControl}" alt="" loading="eager" decoding="async">
              </span>
              <span class="majorana-pathway__track majorana-pathway__track--active" data-pathway-active>
                <img src="${pathwayControlActive}" alt="" loading="eager" decoding="async">
              </span>
              <img class="majorana-pathway__arrow majorana-pathway__arrow--one" src="${pathwayArrowControl}" alt="">
              <span class="majorana-pathway__pulse" data-pathway-pulse>
                <img class="majorana-pathway__pulse-glow" src="${pathwayPulseGlow}" alt="">
                <img class="majorana-pathway__pulse-core" src="${pathwayPulseCore}" alt="">
              </span>
            </div>

            <div class="majorana-pathway majorana-pathway--readout" data-pathway="readout">
              <span class="majorana-pathway__track majorana-pathway__track--neutral">
                <img src="${pathwayReadout}" alt="" loading="eager" decoding="async">
              </span>
              <span class="majorana-pathway__track majorana-pathway__track--active" data-pathway-active>
                <img src="${pathwayReadoutActive}" alt="" loading="eager" decoding="async">
              </span>
              <img class="majorana-pathway__arrow majorana-pathway__arrow--one" src="${pathwayArrowReadout}" alt="">
              <img class="majorana-pathway__arrow majorana-pathway__arrow--two" src="${pathwayArrowReadout}" alt="">
              <span class="majorana-pathway__pulse" data-pathway-pulse>
                <img class="majorana-pathway__pulse-glow" src="${pathwayPulseGlow}" alt="">
                <img class="majorana-pathway__pulse-core" src="${pathwayPulseCore}" alt="">
              </span>
            </div>
          </div>

          <!-- These labels are attached to artwork geometry, so they are the
               documented local-label exception to the shared explainer surface. -->
          <img class="majorana-pathway-connector majorana-pathway-connector--external" src="${pathwayLabelLine}" alt="" aria-hidden="true">
          <div class="majorana-pathway-tooltip majorana-pathway-tooltip--external" data-pathway-label="external">
            <span class="majorana-pathway-tooltip__title">Instructions from external instrumentation</span>
          </div>

          <img class="majorana-pathway-connector majorana-pathway-connector--readout" src="${pathwayLabelLine}" alt="" aria-hidden="true">
          <div class="majorana-pathway-tooltip majorana-pathway-tooltip--readout" data-pathway-label="readout">
            <span class="majorana-pathway-tooltip__title">Quantum information readout</span>
          </div>

          <img class="majorana-pathway-connector majorana-pathway-connector--control" src="${pathwayLabelLineControl}" alt="" aria-hidden="true">
          <div class="majorana-pathway-tooltip majorana-pathway-tooltip--control" data-pathway-label="control">
            <span class="majorana-pathway-tooltip__title">Control signals to QPU</span>
          </div>

          <div class="majorana-pathways__copy" data-majorana-explainer="pathways" data-pathways-copy></div>

          <button class="majorana-tap-target" type="button" data-majorana-action="next-build" aria-label="Continue to build the Majorana 2" hidden></button>
          <div class="majorana-stage-tooltip majorana-stage-tooltip--pathways" data-majorana-tooltip="pathways" aria-hidden="true"></div>

          <div class="majorana-pathways__component-holder" aria-hidden="true">
            <!-- Figma's longer dash cadence cannot be expressed by a native
                 CSS dashed border, so this artwork frame is the documented
                 local geometry exception to the shared kiosk surfaces. -->
            <svg class="majorana-component-holder__border" viewBox="0 0 1310.068 830.757" preserveAspectRatio="none" focusable="false">
              <rect x="2.25" y="2.25" width="1305.568" height="826.257" rx="31.191" />
            </svg>
            <!-- No holder title here: these chips are a preview of what the
                 build screen will hand over, and nothing in this view can be
                 dragged yet. -->
            <figure class="majorana-pathways__component majorana-pathways__component--qpu">
              <span class="majorana-pathways__component-visual majorana-pathways__component-visual--qpu">
                <span class="majorana-pathways__qpu-shell"></span>
                <span class="majorana-pathways__qpu-crop">
                  <img src="${qpuStackCrop}" alt="" loading="eager" decoding="async">
                </span>
                <span
                  class="majorana-pathways__component-model"
                  data-majorana-pathways-model="qpu-stack"
                ></span>
              </span>
              <figcaption>QPU stack</figcaption>
            </figure>
            <figure class="majorana-pathways__component majorana-pathways__component--cmos">
              <span class="majorana-pathways__component-visual majorana-pathways__component-visual--cmos">
                <span class="majorana-pathways__pcb-cover">
                  <img src="${pcbCover}" alt="" loading="eager" decoding="async">
                </span>
                <span class="majorana-pathways__green-mask"></span>
                <span class="majorana-pathways__cryo-chip">
                  <img src="${qpuStackCrop}" alt="" loading="eager" decoding="async">
                </span>
                <span
                  class="majorana-pathways__component-model"
                  data-majorana-pathways-model="cryo-cmos"
                ></span>
              </span>
              <figcaption>Cryo-CMOS</figcaption>
            </figure>
          </div>
        </section>

        <section class="majorana-view majorana-build" data-majorana-view="build" hidden>
          <div class="majorana-model-slot majorana-model-slot--build" data-model-slot="build"></div>

          <div class="majorana-build__pathways" aria-hidden="true">
            <div class="majorana-pathway majorana-pathway--external majorana-build-path" data-build-path-index="1">
              <span class="majorana-pathway__track majorana-pathway__track--neutral">
                <img src="${pathwayInput}" alt="" loading="eager" decoding="async">
              </span>
              <span class="majorana-pathway__track majorana-pathway__track--active">
                <img src="${pathwayInput}" alt="" loading="eager" decoding="async">
              </span>
              <img class="majorana-pathway__arrow majorana-pathway__arrow--one" src="${pathwayArrowInput}" alt="">
              <img class="majorana-pathway__arrow majorana-pathway__arrow--two" src="${pathwayArrowInput}" alt="">
              <img class="majorana-pathway__arrow majorana-pathway__arrow--three" src="${pathwayArrowInput}" alt="">
            </div>

            <div class="majorana-pathway majorana-pathway--control majorana-build-path" data-build-path-index="2">
              <span class="majorana-pathway__track majorana-pathway__track--neutral">
                <img src="${pathwayControl}" alt="" loading="eager" decoding="async">
              </span>
              <span class="majorana-pathway__track majorana-pathway__track--active">
                <img src="${pathwayControl}" alt="" loading="eager" decoding="async">
              </span>
              <img class="majorana-pathway__arrow majorana-pathway__arrow--one" src="${pathwayArrowControl}" alt="">
            </div>

            <div class="majorana-pathway majorana-pathway--readout majorana-build-path" data-build-path-index="3">
              <span class="majorana-pathway__track majorana-pathway__track--neutral">
                <img src="${pathwayReadout}" alt="" loading="eager" decoding="async">
              </span>
              <span class="majorana-pathway__track majorana-pathway__track--active">
                <img src="${pathwayReadout}" alt="" loading="eager" decoding="async">
              </span>
              <img class="majorana-pathway__arrow majorana-pathway__arrow--one" src="${pathwayArrowReadout}" alt="">
              <img class="majorana-pathway__arrow majorana-pathway__arrow--two" src="${pathwayArrowReadout}" alt="">
            </div>
          </div>

          <div class="majorana-build__board" aria-label="Majorana component drop zones">
            ${MAJORANA_PARTS.map(part => `
              <div class="majorana-drop-slot majorana-drop-slot--${part.id}" data-build-slot="${part.id}">
              </div>
            `).join('')}
          </div>

          <div class="majorana-build__placed-labels" aria-hidden="true">
            <span class="majorana-build__placed-label majorana-build__placed-label--qpu-stack">QPU stack</span>
            <span class="majorana-build__placed-label majorana-build__placed-label--cryo-cmos">Cryo-CMOS</span>
          </div>

          <div class="majorana-build__explanation majorana-build__explanation--qpu" data-majorana-explainer="build-qpu" aria-live="polite"></div>
          <div class="majorana-build__explanation majorana-build__explanation--cryo" data-majorana-explainer="build-cryo" aria-live="polite"></div>
          <div class="majorana-build__summary" data-majorana-explainer="build-summary" aria-live="polite"></div>
          <div class="majorana-build__instruction" data-majorana-tooltip="build" aria-live="polite"></div>
          <button class="majorana-tap-target" type="button" data-majorana-action="finish" aria-label="Finish building Majorana 2" hidden></button>

          <div class="majorana-build__tray" aria-label="Components to place">
            <!-- Same Figma-authored frame as the read-only holder above. -->
            <svg class="majorana-component-holder__border" viewBox="0 0 1310.068 830.757" preserveAspectRatio="none" focusable="false" aria-hidden="true">
              <rect x="2.25" y="2.25" width="1305.568" height="826.257" rx="31.191" />
            </svg>
            <p class="majorana-component-holder__title">Drag and drop the components</p>
            <button
              class="majorana-build-part majorana-build-part--qpu-stack"
              type="button"
              data-build-part="qpu-stack"
            >
              <span class="majorana-build-part__visual majorana-build-part__visual--qpu" aria-hidden="true">
                <span class="majorana-pathways__qpu-shell"></span>
                <span class="majorana-pathways__qpu-crop">
                  <img src="${qpuStackCrop}" alt="" loading="eager" decoding="async">
                </span>
                <span
                  class="majorana-build-part__model"
                  data-majorana-build-model="qpu-stack"
                ></span>
              </span>
              <span class="majorana-build-part__label">QPU stack</span>
              <span class="majorana-build-part__guidance-label">QPU stack</span>
            </button>

            <button
              class="majorana-build-part majorana-build-part--cryo-cmos"
              type="button"
              data-build-part="cryo-cmos"
            >
              <span class="majorana-build-part__visual majorana-build-part__visual--cmos" aria-hidden="true">
                <span class="majorana-pathways__pcb-cover">
                  <img src="${pcbCover}" alt="" loading="eager" decoding="async">
                </span>
                <span class="majorana-pathways__green-mask"></span>
                <span class="majorana-pathways__cryo-chip">
                  <img src="${qpuStackCrop}" alt="" loading="eager" decoding="async">
                </span>
                <span
                  class="majorana-build-part__model"
                  data-majorana-build-model="cryo-cmos"
                ></span>
              </span>
              <span class="majorana-build-part__label">Cryo-CMOS</span>
              <span class="majorana-build-part__guidance-label">Cryo-CMOS</span>
            </button>
          </div>

          <p class="majorana-build__feedback" data-build-feedback aria-live="assertive"></p>
        </section>

        <div
          class="majorana-section-transition"
          data-majorana-section-transition
          aria-hidden="true"
        ></div>
      </div>

      <div class="majorana-model-stage" data-model-stage>
        <div class="majorana-model-stage__loading" data-model-loading>
          <span class="majorana-model-stage__spinner" aria-hidden="true"></span>
          <strong>Loading the Majorana 2</strong>
          <span data-model-progress>Preparing 3D model…</span>
        </div>
        <div
          class="majorana-schematic"
          role="img"
          aria-label="Majorana 2 schematic with the QPU stack and Cryo-CMOS highlighted"
          aria-hidden="true"
        >
          <div class="majorana-schematic__reveal">
            <div class="majorana-schematic__content">
              <div class="majorana-schematic__backdrop" aria-hidden="true">
                <img src="${schematicBackdrop}" alt="" loading="eager" decoding="async">
              </div>

              <div class="majorana-schematic__composite majorana-schematic__composite--qpu" aria-hidden="true">
                <img src="${schematicComposite}" alt="" loading="eager" decoding="async">
              </div>
              <div class="majorana-schematic__composite majorana-schematic__composite--cmos" aria-hidden="true">
                <img src="${schematicComposite}" alt="" loading="eager" decoding="async">
              </div>

              <div class="majorana-schematic__groove majorana-schematic__groove--qpu" aria-hidden="true">
                <span class="majorana-schematic__groove-outer"></span>
                <span class="majorana-schematic__groove-inner"></span>
              </div>
              <div class="majorana-schematic__groove majorana-schematic__groove--cmos" aria-hidden="true">
                <span class="majorana-schematic__groove-outer"></span>
                <span class="majorana-schematic__groove-inner"></span>
              </div>

              <div class="majorana-schematic__component majorana-schematic__component--qpu" aria-hidden="true">
                <span class="majorana-schematic__qpu-shell"></span>
                <span class="majorana-schematic__qpu-crop">
                  <img src="${qpuStackCrop}" alt="" loading="eager" decoding="async">
                </span>
                <span
                  class="majorana-schematic__component-model majorana-schematic__component-model--qpu"
                  data-majorana-schematic-model="qpu-stack"
                ></span>
              </div>

              <div class="majorana-schematic__component majorana-schematic__component--cmos" aria-hidden="true">
                <span class="majorana-schematic__pcb-cover">
                  <img src="${pcbCover}" alt="" loading="eager" decoding="async">
                </span>
                <span class="majorana-schematic__green-mask"></span>
                <span class="majorana-schematic__cryo-chip">
                  <img src="${qpuStackCrop}" alt="" loading="eager" decoding="async">
                </span>
                <span
                  class="majorana-schematic__component-model majorana-schematic__component-model--cmos"
                  data-majorana-schematic-model="cryo-cmos"
                ></span>
              </div>
            </div>
          </div>
        </div>
      </div>

      <div data-pathways-guidance hidden aria-hidden="true"></div>
      <div data-pathway-detail hidden aria-hidden="true" inert></div>
    </div>
  `
}

export function mount(container, options = {}) {
  if (!(container instanceof HTMLElement)) {
    throw new TypeError('Build a Majorana 2 requires an HTMLElement container.')
  }

  const { signal: parentSignal, onActivity, navigate, module } = options
  const lifecycle = new AbortController()
  const { signal } = lifecycle
  const reducedMotion = window.matchMedia?.('(prefers-reduced-motion: reduce)') ?? {
    matches: false
  }
  const motionDuration = durationMs => reducedMotion.matches ? 1 : durationMs
  const motionDelay = durationMs => reducedMotion.matches ? 0 : durationMs
  let disposed = false
  let state = createMajoranaState()
  let sceneController = null
  let drag = null
  let pendingBuildSnap = null
  let buildSnapRun = 0
  let buildDragFrame = 0
  let buildTiltTimer = 0
  const returnTimers = new Map()
  let renderedView = null
  let renderedSceneSignature = null
  let stageAnimation = null
  let componentsPhase = 'schematic'
  let componentsRelocationTimer = 0
  let componentsFocusTimer = 0
  let componentsPrimeFrame = 0
  let componentsSpotlightTimer = 0
  let componentsActivateTimer = 0
  let componentsSpotlight = 'none'
  let componentsSequenceRun = 0
  let componentInspection = null
  let componentInspectionFrame = 0
  let pathwaysGuidance = null
  let buildGuidance = null
  let pathwaysAnimationFrame = 0
  let pathwaysElapsedMs = 0
  let pathwaysLastTimestamp = 0
  let pathwaysOverviewResumeMs = 0
  let pathwaysSelectionEnabled = false
  let pathwayDimensionsDirty = true
  let renderedPathwayId = null
  let displayedPathwayDetailId = null
  let pathwayDetailCloseTimer = 0
  let pathwayDetailCloseCleanup = null
  let pathwayDetailPortal = null
  let pathwayReturnFocus = null
  let pathwayDetailClosing = false
  let finalePlaying = false
  let sectionTransition = null
  let sectionTransitionRun = 0
  const pathwaysVisits = createPathwaysVisitController()

  container.innerHTML = moduleMarkup()
  const root = container.querySelector('[data-majorana-root]')
  const attachExplainer = (name, options) => {
    const host = root.querySelector(`[data-majorana-explainer="${name}"]`)
    const explainer = createKioskExplainer(options)
    host.append(explainer.element)
    return explainer
  }
  const attachTooltip = (name, text) => {
    const host = root.querySelector(`[data-majorana-tooltip="${name}"]`)
    const tooltip = createKioskTooltip({
      className: `kiosk-tooltip--blue majorana-shared-tooltip majorana-shared-tooltip--${name}`,
      hidden: true,
      text
    })
    host.append(tooltip.element)
    return tooltip
  }
  const componentSummaryExplainer = attachExplainer('components-summary', {
    body: 'Together, the QPU stack and Cryo-CMOS make up two key components of Majorana 2.',
    className: 'majorana-shared-explainer majorana-shared-explainer--components-summary',
    title: 'Quantum processing module'
  })
  const qpuExplainer = attachExplainer('qpu', {
    body: 'The topological qubits reside here',
    className: 'majorana-shared-explainer majorana-shared-explainer--component',
    headingLevel: 3,
    title: 'QPU stack'
  })
  const cmosExplainer = attachExplainer('cmos', {
    body: 'Provides digital control for the qubits',
    className: 'majorana-shared-explainer majorana-shared-explainer--component',
    headingLevel: 3,
    title: 'Cryo-CMOS'
  })
  const pathwaysExplainer = attachExplainer('pathways', {
    body: 'Each of these channels carries unique information, from control instructions to readout.',
    className: 'majorana-shared-explainer majorana-shared-explainer--pathways',
    title: 'Quantum information channels'
  })
  /* One panel per chip rather than one shared by both: each is sized to sit
     above the component it describes, so once both are seated the board carries
     both statements at once instead of the second overwriting the first. */
  const buildQpuExplainer = attachExplainer('build-qpu', {
    className: 'majorana-shared-explainer majorana-shared-explainer--build',
    hidden: true
  })
  const buildCryoExplainer = attachExplainer('build-cryo', {
    className: 'majorana-shared-explainer majorana-shared-explainer--build',
    hidden: true
  })
  /* And the closing line above the pair, in the space the tray leaves behind. */
  const buildSummaryExplainer = attachExplainer('build-summary', {
    className: 'majorana-shared-explainer majorana-shared-explainer--build-summary',
    hidden: true
  })
  const componentsContinueTooltip = attachTooltip('components', 'Tap anywhere to continue')
  const pathwaysContinueTooltip = attachTooltip('pathways', 'Tap anywhere to continue')
  const buildActionTooltip = attachTooltip('build', '')
  const sharedExplainers = [
    componentSummaryExplainer,
    qpuExplainer,
    cmosExplainer,
    pathwaysExplainer,
    buildQpuExplainer,
    buildCryoExplainer,
    buildSummaryExplainer
  ]
  if (options.majoranaSceneController) {
    root.classList.add('is-portal-entry')
  }
  const modelStage = root.querySelector('[data-model-stage]')
  const viewsElement = root.querySelector('.majorana-module__views')
  const viewSections = [...root.querySelectorAll('[data-majorana-view]')]
  const progressTabButtons = [...root.querySelectorAll('[data-majorana-tab]')]
  const modelSlots = Object.fromEntries(
    [...root.querySelectorAll('[data-model-slot]')].map(slot => [
      slot.dataset.modelSlot,
      slot
    ])
  )
  const sectionTransitionPortal = root.querySelector('[data-majorana-section-transition]')
  const startButton = root.querySelector('[data-majorana-action="start"]')
  const schematic = root.querySelector('.majorana-schematic')
  const schematicImagesReady = Promise.all(
    [...schematic.querySelectorAll('img')].map(image => (
      typeof image.decode === 'function'
        ? image.decode().catch(() => undefined)
        : Promise.resolve()
    ))
  )
  const componentsFocus = root.querySelector('[data-components-focus]')
  const componentFocusPairs = Object.freeze([
    Object.freeze({
      focus: root.querySelector('.majorana-focus-component--qpu'),
      source: root.querySelector('.majorana-schematic__component-model--qpu')
    }),
    Object.freeze({
      focus: root.querySelector('.majorana-focus-component--cmos'),
      source: root.querySelector('.majorana-schematic__component-model--cmos')
    })
  ])
  const pathwaysGuidanceElement = root.querySelector('[data-pathways-guidance]')
  const pathwayDetailElement = root.querySelector('[data-pathway-detail]')
  const moduleHeader = root.querySelector('.majorana-module__header')
  const progressNavigation = root.querySelector('.majorana-progress')
  const previousSectionButton = root.querySelector(
    '[data-majorana-action="previous-section"]'
  )
  const nextSectionButton = root.querySelector(
    '[data-majorana-action="next-section"]'
  )
  const loadingPanel = root.querySelector('[data-model-loading]')
  const progressLabel = root.querySelector('[data-model-progress]')
  const buildSection = root.querySelector('[data-majorana-view="build"]')
  const finale = createMajoranaFinale({
    reducedMotion: reducedMotion.matches,
    stage: buildSection
  })
  buildSection.prepend(finale.element, finale.chipElement)
  const componentsContinueAction = root.querySelector('[data-majorana-action="next-pathways"]')
  const pathwaysContinueAction = root.querySelector('[data-majorana-action="next-build"]')
  const buildTrayTitle = root.querySelector(
    '.majorana-build__tray > .majorana-component-holder__title'
  )
  const finishAction = root.querySelector('[data-majorana-action="finish"]')
  const buildFeedback = root.querySelector('[data-build-feedback]')

  /* Offered once the chip is built. Build is the last of the three tabs, so
     finishing it is finishing the module. The registry supplies module 07 as
     the next stop and keeps that route decision out of this feature. */
  const upNextBanner = mountModuleOutro({
    module,
    root,
    navigate,
    onActivity,
    onRestart: () => root.querySelector('[data-majorana-action="restart"]')?.click(),
    delayMs: 0,
    popupDelayMs: 2000
  })
  const buildPartCards = [...root.querySelectorAll('[data-build-part]')]
  const buildSlots = [...root.querySelectorAll('[data-build-slot]')]
  const buildPaths = [...root.querySelectorAll('[data-build-path-index]')]
  const pathwaysSection = root.querySelector('[data-majorana-view="pathways"]')
  const componentsSection = root.querySelector('[data-majorana-view="components"]')
  const pathwaysCopy = root.querySelector('[data-pathways-copy]')
  const pathwaySelectButtons = [...root.querySelectorAll('[data-pathway-select]')]
  const pathwayElements = Object.fromEntries(
    [...root.querySelectorAll('[data-pathway]')].map(element => [
      element.dataset.pathway,
      element
    ])
  )
  const pathwayLabels = Object.fromEntries(
    [...root.querySelectorAll('[data-pathway-label]')].map(element => [
      element.dataset.pathwayLabel,
      element
    ])
  )
  const pathwayConnectors = {
    external: root.querySelector('.majorana-pathway-connector--external'),
    control: root.querySelector('.majorana-pathway-connector--control'),
    readout: root.querySelector('.majorana-pathway-connector--readout')
  }
  const pathwayVisuals = Object.fromEntries(PATHWAY_IDS.map(pathwayId => {
    const pathway = pathwayElements[pathwayId]
    return [pathwayId, {
      activeTrack: pathway.querySelector('[data-pathway-active]'),
      arrows: [...pathway.querySelectorAll('.majorana-pathway__arrow')],
      arrowThresholds: pathwayId === 'external'
        ? [0.468, 0.72, 0.966]
        : pathwayId === 'control'
          ? [0.382]
          : [0.377, 0.12],
      connector: pathwayConnectors[pathwayId],
      dimensions: { width: 0, height: 0 },
      element: pathway,
      label: pathwayLabels[pathwayId],
      neutralTrack: pathway.querySelector('.majorana-pathway__track--neutral'),
      pulse: pathway.querySelector('[data-pathway-pulse]')
    }]
  }))
  const inlineStyleCache = new WeakMap()

  function activity() {
    if (currentView() === 'build') buildGuidance?.noteActivity()
    onActivity?.()
  }

  function currentView() {
    return state.isStarted ? state.activeTab : 'intro'
  }

  function setInlineStyle(element, property, value) {
    if (!element) return
    let propertyCache = inlineStyleCache.get(element)
    if (!propertyCache) {
      propertyCache = new Map()
      inlineStyleCache.set(element, propertyCache)
    }

    const serializedValue = element.style.getPropertyValue(property)
    const cachedValue = propertyCache.get(property)
    if (
      cachedValue?.requested === value &&
      cachedValue.serialized === serializedValue
    ) return
    if (serializedValue === value) {
      propertyCache.set(property, { requested: value, serialized: serializedValue })
      return
    }

    element.style.setProperty(property, value)
    propertyCache.set(property, {
      requested: value,
      serialized: element.style.getPropertyValue(property)
    })
  }

  /* The component cards were moved lower in the revised Figma frame. Their
     former hard-coded entrance transform still pointed at the old layout,
     which made both live canvases jump before travelling. Measure the actual
     schematic slots immediately before the handoff and derive a FLIP transform
     in the module's design coordinate space, keeping one Three.js canvas per
     component throughout the move. */
  function registerComponentFocusOrigins() {
    const stageScale = currentStageScale()
    if (!Number.isFinite(stageScale) || stageScale <= 0) return

    for (const { focus, source } of componentFocusPairs) {
      if (!(focus instanceof HTMLElement) || !(source instanceof HTMLElement)) continue
      const sourceRect = source.getBoundingClientRect()
      if (sourceRect.width <= 0 || sourceRect.height <= 0) continue

      const focusStyle = captureInlineStyle(focus)
      focus.style.setProperty('transition', 'none', 'important')
      focus.style.setProperty('transform', 'none', 'important')
      const targetRect = focus.getBoundingClientRect()
      restoreInlineStyle(focus, focusStyle)
      if (targetRect.width <= 0 || targetRect.height <= 0) continue

      setInlineStyle(
        focus,
        '--component-enter-x',
        `${(sourceRect.left - targetRect.left) / stageScale}px`
      )
      setInlineStyle(
        focus,
        '--component-enter-y',
        `${(sourceRect.top - targetRect.top) / stageScale}px`
      )
      setInlineStyle(
        focus,
        '--component-enter-scale-x',
        String(sourceRect.width / targetRect.width)
      )
      setInlineStyle(
        focus,
        '--component-enter-scale-y',
        String(sourceRect.height / targetRect.height)
      )
    }
  }

  function sceneSignature(view) {
    return [
      view,
      Number(Boolean(state.placements['qpu-stack'])),
      Number(Boolean(state.placements['cryo-cmos']))
    ].join(':')
  }

  function syncSceneView(view, { force = false } = {}) {
    if (!sceneController) return undefined
    const signature = sceneSignature(view)
    if (!force && signature === renderedSceneSignature) return Promise.resolve()
    renderedSceneSignature = signature
    return sceneController.setView(view, state)
  }

  function syncSceneComponentPresentation(view) {
    if (!sceneController) return
    const holdsSourcePresentation = Boolean(
      sectionTransition?.switched && sectionTransition.toView === view
    )
    if (holdsSourcePresentation) {
      sceneController.setComponentViewsActive(true)
      return
    }

    if (view === 'pathways' || view === 'build') {
      sceneController.setComponentViewsActive(true, view)
      return
    }

    if (view === 'components') {
      if (['priming', 'focusing', 'focus'].includes(componentsPhase)) {
        sceneController.setComponentViewsActive(true, 'components', {
          idleDelayMs: ['priming', 'focusing'].includes(componentsPhase)
            ? COMPONENTS_FOCUS_TRANSITION_MS
            : 0,
          immediate: !['priming', 'focusing'].includes(componentsPhase)
        })
      } else {
        sceneController.setComponentViewsActive(true, 'schematic')
      }
      return
    }

    sceneController.setComponentViewsActive(false, 'components')
  }

  function handoffSectionTransitionModels(activeTransition) {
    if (
      !activeTransition.switched ||
      currentView() !== activeTransition.toView ||
      !root.classList.contains('has-component-models')
    ) return

    if (activeTransition.kind === SECTION_TRANSITION_KINDS.COMPONENTS_PATHWAYS) {
      root.classList.add('has-shared-pathways-entry')
      root.classList.add('is-pathways-model-handoff')
    }
    sceneController?.setComponentViewsActive(true, activeTransition.toView)
  }

  function currentStageScale() {
    const rootBounds = root.getBoundingClientRect()
    return root.offsetWidth > 0 ? rootBounds.width / root.offsetWidth : 1
  }

  function captureInlineStyle(element) {
    return [...element.style].map(property => ({
      priority: element.style.getPropertyPriority(property),
      property,
      value: element.style.getPropertyValue(property)
    }))
  }

  function restoreInlineStyle(element, snapshot) {
    for (const property of [...element.style]) element.style.removeProperty(property)
    for (const { priority, property, value } of snapshot) {
      element.style.setProperty(property, value, priority)
    }
    if (snapshot.length === 0) element.removeAttribute('style')
  }

  function scheduleSectionTransition(activeTransition, callback, delayMs) {
    const timerId = window.setTimeout(() => {
      activeTransition.timers.delete(timerId)
      callback()
    }, delayMs)
    activeTransition.timers.add(timerId)
    return timerId
  }

  function trackSectionAnimation(activeTransition, animation) {
    if (!animation) return null
    activeTransition.animations.add(animation)
    animation.finished.catch(() => undefined)
    return animation
  }

  function measureHiddenSectionTargets(section, selectors) {
    if (!(section instanceof HTMLElement)) return null
    const wasHidden = section.hidden
    const originalStyle = captureInlineStyle(section)
    section.hidden = false
    section.style.setProperty('visibility', 'hidden', 'important')
    section.style.setProperty('pointer-events', 'none', 'important')
    section.style.setProperty('animation', 'none', 'important')

    const targets = Object.fromEntries(
      Object.entries(selectors).map(([key, selector]) => [
        key,
        section.querySelector(selector)?.getBoundingClientRect() ?? null
      ])
    )

    restoreInlineStyle(section, originalStyle)
    section.hidden = wasHidden
    return targets
  }

  function portalTransitionElement(
    activeTransition,
    element,
    targetRect,
    { startOpacity = 1, startFilter = 'none' } = {}
  ) {
    if (!(element instanceof HTMLElement) || !targetRect) return null
    const sourceRect = element.getBoundingClientRect()
    const portalRect = viewsElement.getBoundingClientRect()
    const stageScale = currentStageScale()
    const sourceBox = rectInStage(sourceRect, portalRect, stageScale)
    const motion = transformBetweenRects(sourceRect, targetRect, stageScale)
    if (!sourceBox || !motion) return null

    const record = {
      element,
      nextSibling: element.nextSibling,
      parent: element.parentNode,
      styleSnapshot: captureInlineStyle(element)
    }
    activeTransition.portalRecords.push(record)

    element.dataset.sectionTransitionItem = activeTransition.kind
    element.style.position = 'absolute'
    element.style.inset = 'auto'
    element.style.top = `${sourceBox.top}px`
    element.style.left = `${sourceBox.left}px`
    element.style.width = `${sourceBox.width}px`
    element.style.height = `${sourceBox.height}px`
    element.style.margin = '0'
    element.style.opacity = String(startOpacity)
    element.style.filter = startFilter
    element.style.pointerEvents = 'none'
    element.style.transform = 'translate3d(0, 0, 0) scale(1, 1)'
    element.style.transformOrigin = 'top left'
    element.style.transition = 'none'
    element.style.willChange = 'transform, opacity, filter'
    sectionTransitionPortal.append(element)

    return { element, motion, startFilter, startOpacity }
  }

  function restoreTransitionPortals(activeTransition) {
    for (const record of activeTransition.portalRecords) {
      const { element, parent, nextSibling, styleSnapshot } = record
      if (nextSibling?.parentNode === parent) parent.insertBefore(element, nextSibling)
      else parent?.append(element)
      delete element.dataset.sectionTransitionItem
      restoreInlineStyle(element, styleSnapshot)
    }
    activeTransition.portalRecords.length = 0
  }

  function animatePortalElement(activeTransition, movingElement, partId) {
    if (!movingElement) return null
    const { durationMs } = activeTransition.timings
    const delay = partId === 'cryo-cmos'
      ? (activeTransition.kind === SECTION_TRANSITION_KINDS.COMPONENTS_PATHWAYS ? 55 : 30)
      : 0
    const duration = Math.max(1, durationMs - delay)
    const { element, motion, startFilter, startOpacity } = movingElement
    const targetTransform = `translate3d(${motion.translateX}px, ${motion.translateY}px, 0) scale(${motion.scaleX}, ${motion.scaleY})`
    const keyframes = activeTransition.kind === SECTION_TRANSITION_KINDS.COMPONENTS_PATHWAYS
      ? [
          {
            offset: 0,
            filter: PATHWAYS_COMPONENT_FILTER,
            opacity: 0.3,
            transform: 'translate3d(0, 0, 0) scale(1, 1)'
          },
          {
            offset: 1,
            filter: PATHWAYS_COMPONENT_FILTER,
            opacity: 0.3,
            transform: targetTransform
          }
        ]
      : [
          {
            offset: 0,
            filter: startFilter,
            opacity: startOpacity,
            transform: 'translate3d(0, 0, 0) scale(1, 1)'
          },
          {
            offset: 0.7,
            filter: 'grayscale(0) saturate(1) brightness(1)',
            opacity: 1,
            transform: targetTransform
          },
          {
            offset: 0.82,
            filter: 'grayscale(0) saturate(1) brightness(1)',
            opacity: 1,
            transform: targetTransform
          },
          {
            offset: 1,
            filter: 'grayscale(0) saturate(1) brightness(1)',
            opacity: 1,
            transform: targetTransform
          }
        ]

    return trackSectionAnimation(activeTransition, element.animate(keyframes, {
      delay,
      duration,
      easing: 'cubic-bezier(0.4, 0, 0.2, 1)',
      fill: 'both'
    }))
  }

  function fadeTransitionElements(activeTransition, elements, durationMs = 260) {
    for (const element of elements) {
      if (!(element instanceof HTMLElement) || element.hidden) continue
      const opacity = Number.parseFloat(window.getComputedStyle(element).opacity)
      if (!Number.isFinite(opacity) || opacity <= 0) continue
      trackSectionAnimation(activeTransition, element.animate([
        { opacity },
        { opacity: 0 }
      ], {
        duration: durationMs,
        easing: 'ease-out',
        fill: 'both'
      }))
    }
  }

  function prepareComponentsPathwaysTransition(activeTransition) {
    resetComponentInspection()
    sceneController?.setComponentPose('flat', { immediate: true })

    const usesPersistentModels = root.classList.contains('has-component-models')

    const targets = measureHiddenSectionTargets(pathwaysSection, {
      qpu: usesPersistentModels
        ? '[data-majorana-pathways-model="qpu-stack"]'
        : '.majorana-pathways__component-visual--qpu',
      cmos: usesPersistentModels
        ? '[data-majorana-pathways-model="cryo-cmos"]'
        : '.majorana-pathways__component-visual--cmos'
    })
    if (!targets?.qpu || !targets?.cmos) return false

    const qpu = portalTransitionElement(
      activeTransition,
      componentsSection.querySelector(usesPersistentModels
        ? '[data-majorana-component-model="qpu-stack"]'
        : '.majorana-focus-component--qpu'),
      targets.qpu
    )
    const cmos = portalTransitionElement(
      activeTransition,
      componentsSection.querySelector(usesPersistentModels
        ? '[data-majorana-component-model="cryo-cmos"]'
        : '.majorana-focus-component--cmos'),
      targets.cmos
    )
    if (!qpu || !cmos) return false

    // The renderer used to switch from the brighter Components lighting to
    // the Pathways lighting only at the final DOM handoff. Apply the target
    // appearance while the shared canvases are already in the portal so the
    // models keep one continuous colour through the whole flight and landing.
    sceneController?.setComponentAppearance('pathways')
    animatePortalElement(activeTransition, qpu, 'qpu-stack')
    animatePortalElement(activeTransition, cmos, 'cryo-cmos')
    fadeTransitionElements(activeTransition, [
      componentsSection.querySelector('.majorana-components-focus__intro'),
      ...componentsSection.querySelectorAll('.majorana-components-focus__card')
    ], 260)
    return true
  }

  function preparePathwaysBuildTransition(activeTransition) {
    pathwaysGuidance.stop()
    stopPathwaysTimeline()

    const usesPersistentModels = root.classList.contains('has-component-models')

    const targets = measureHiddenSectionTargets(buildSection, {
      qpu: usesPersistentModels
        ? '[data-majorana-build-model="qpu-stack"]'
        : '.majorana-build-part__visual--qpu',
      cmos: usesPersistentModels
        ? '[data-majorana-build-model="cryo-cmos"]'
        : '.majorana-build-part__visual--cmos'
    })
    if (!targets?.qpu || !targets?.cmos) return false

    const qpu = portalTransitionElement(
      activeTransition,
      pathwaysSection.querySelector(usesPersistentModels
        ? '[data-majorana-pathways-model="qpu-stack"]'
        : '.majorana-pathways__component-visual--qpu'),
      targets.qpu,
      {
        startOpacity: 0.3,
        startFilter: PATHWAYS_COMPONENT_FILTER
      }
    )
    const cmos = portalTransitionElement(
      activeTransition,
      pathwaysSection.querySelector(usesPersistentModels
        ? '[data-majorana-pathways-model="cryo-cmos"]'
        : '.majorana-pathways__component-visual--cmos'),
      targets.cmos,
      {
        startOpacity: 0.3,
        startFilter: PATHWAYS_COMPONENT_FILTER
      }
    )
    if (!qpu || !cmos) return false

    animatePortalElement(activeTransition, qpu, 'qpu-stack')
    animatePortalElement(activeTransition, cmos, 'cryo-cmos')
    fadeTransitionElements(activeTransition, [
      pathwaysSection.querySelector('.majorana-pathways__component-holder'),
      pathwaysCopy,
      ...Object.values(pathwayLabels),
      ...Object.values(pathwayConnectors),
      ...pathwaysSection.querySelectorAll('[data-pathway-pulse]'),
      ...pathwaysSection.querySelectorAll('.majorana-pathway__track--active')
    ], 300)
    return true
  }

  function animateSectionTransitionLanding(activeTransition) {
    if (activeTransition.kind === SECTION_TRANSITION_KINDS.COMPONENTS_PATHWAYS) {
      // The destination holder is established synchronously when Pathways
      // becomes visible. Avoid a second, late opacity animation that would
      // tint the shared canvases as they decelerate into place.
      return
    }

    const landingDuration = activeTransition.timings.durationMs -
      activeTransition.timings.switchDelayMs
    const tray = buildSection.querySelector('.majorana-build__tray')
    trackSectionAnimation(activeTransition, tray?.animate([
      { opacity: 0 },
      { opacity: 1 }
    ], {
      duration: Math.min(460, landingDuration),
      easing: 'cubic-bezier(0.4, 0, 0.2, 1)',
      fill: 'both'
    }))
    buildPartCards.forEach((card, index) => {
      trackSectionAnimation(activeTransition, card.animate([
        { opacity: 0 },
        { opacity: 1 }
      ], {
        delay: 330 + (index * 30),
        duration: 400,
        easing: 'ease-out',
        fill: 'both'
      }))
    })
  }

  function switchSectionTransition(activeTransition) {
    if (
      disposed ||
      sectionTransition !== activeTransition ||
      activeTransition.switched
    ) return
    activeTransition.switched = true
    if (activeTransition.kind === SECTION_TRANSITION_KINDS.COMPONENTS_PATHWAYS) {
      // Establish the final Pathways surface as soon as that view becomes
      // visible, while the shared models are still in motion. This keeps the
      // backdrop under the translucent models stable through deceleration.
      root.classList.add('is-pathways-model-handoff')
    }
    dispatch({
      type: activeTransition.advance ? 'ADVANCE' : 'NAVIGATE',
      tab: activeTransition.toView
    })
    animateSectionTransitionLanding(activeTransition)
  }

  function finishSectionTransition(activeTransition, { activateDestination = true } = {}) {
    if (sectionTransition !== activeTransition) return
    activeTransition.timers.forEach(timerId => window.clearTimeout(timerId))
    activeTransition.timers.clear()
    handoffSectionTransitionModels(activeTransition)
    activeTransition.animations.forEach(animation => animation.cancel())
    activeTransition.animations.clear()
    restoreTransitionPortals(activeTransition)
    sectionTransitionPortal.replaceChildren()
    root.classList.remove('is-section-transitioning')
    delete root.dataset.sectionTransition
    sectionTransition = null
    if (activeTransition.kind === SECTION_TRANSITION_KINDS.COMPONENTS_PATHWAYS) {
      window.requestAnimationFrame(() => {
        root.classList.remove('is-pathways-model-handoff')
      })
    }
    syncModalInteractionState()

    if (!activateDestination || disposed) {
      if (!disposed) sceneController?.setComponentAppearance(currentView())
      return
    }
    if (currentView() === 'pathways') {
      startPathwaysVisit()
    } else if (currentView() === 'build') {
      buildGuidance.setActive(true)
      buildGuidance.syncPlacements(state.placements)
      void finale.prepare()
    }
  }

  function cancelSectionTransition({ activateDestination = false } = {}) {
    if (!sectionTransition) return
    const activeTransition = sectionTransition
    sectionTransitionRun += 1
    finishSectionTransition(activeTransition, { activateDestination })
  }

  function settleSectionTransition() {
    const activeTransition = sectionTransition
    if (!activeTransition) return
    switchSectionTransition(activeTransition)
    finishSectionTransition(activeTransition)
  }

  function startSectionTransition(toView, { advance = false } = {}) {
    const fromView = currentView()
    const kind = getSectionTransitionKind(fromView, toView)
    if (!kind || sectionTransition || disposed) return false
    if (drag || pendingBuildSnap || state.selectedPathwayId) return false

    const timings = SECTION_TRANSITION_TIMINGS[kind]
    const activeTransition = {
      animations: new Set(),
      advance,
      kind,
      portalRecords: [],
      switched: false,
      timers: new Set(),
      timings,
      toView,
      token: ++sectionTransitionRun
    }
    sectionTransition = activeTransition
    root.classList.add('is-section-transitioning')
    root.dataset.sectionTransition = kind
    syncModalInteractionState()

    const prepared = kind === SECTION_TRANSITION_KINDS.COMPONENTS_PATHWAYS
      ? prepareComponentsPathwaysTransition(activeTransition)
      : preparePathwaysBuildTransition(activeTransition)
    if (!prepared) {
      finishSectionTransition(activeTransition, { activateDestination: false })
      return false
    }

    scheduleSectionTransition(
      activeTransition,
      () => switchSectionTransition(activeTransition),
      timings.switchDelayMs
    )
    scheduleSectionTransition(
      activeTransition,
      () => finishSectionTransition(activeTransition),
      timings.durationMs + 80
    )
    return true
  }

  function canAdvanceFromView(view = currentView()) {
    if (view === 'components') return componentsPhase === 'focus'
    if (view === 'pathways') return pathwaysSelectionEnabled
    return false
  }

  function navigateSection(toView, { advance = false } = {}) {
    const fromView = currentView()
    if (
      sectionTransition ||
      drag ||
      pendingBuildSnap ||
      state.selectedPathwayId ||
      toView === fromView
    ) return false

    if (advance) {
      const activeTabIndex = TAB_ORDER.indexOf(fromView)
      if (
        !canAdvanceFromView(fromView) ||
        TAB_ORDER[activeTabIndex + 1] !== toView
      ) return false
    } else if (!hasVisitedMajoranaTab(state, toView)) {
      return false
    }

    const kind = getSectionTransitionKind(currentView(), toView)
    if (kind) {
      if (!startSectionTransition(toView, { advance })) {
        dispatch({ type: advance ? 'ADVANCE' : 'NAVIGATE', tab: toView })
      }
      return true
    }
    dispatch({ type: advance ? 'ADVANCE' : 'NAVIGATE', tab: toView })
    return true
  }

  function pathwayRevealClip(pathwayId, progress) {
    const hiddenPercentage = (1 - Math.max(0, Math.min(1, progress))) * 100
    if (pathwayId === 'external') return `inset(0 0 ${hiddenPercentage}% 0)`
    if (pathwayId === 'control') return `inset(0 0 0 ${hiddenPercentage}%)`
    return `inset(${hiddenPercentage}% 0 0 0)`
  }

  function cachePathwayDimensions() {
    if (!pathwayDimensionsDirty) return
    const stageScale = currentStageScale()
    let allDimensionsReady = true

    for (const pathwayId of PATHWAY_IDS) {
      const visual = pathwayVisuals[pathwayId]
      const bounds = visual.element.getBoundingClientRect()
      const computedStyle = bounds.width > 0 && bounds.height > 0
        ? null
        : window.getComputedStyle(visual.element)
      visual.dimensions.width = bounds.width > 0
        ? bounds.width / stageScale
        : Number.parseFloat(computedStyle?.width) || 0
      visual.dimensions.height = bounds.height > 0
        ? bounds.height / stageScale
        : Number.parseFloat(computedStyle?.height) || 0
      allDimensionsReady = allDimensionsReady &&
        visual.dimensions.width > 0 &&
        visual.dimensions.height > 0
    }

    pathwayDimensionsDirty = !allDimensionsReady
  }

  function renderPathwaysFrame(frame) {
    cachePathwayDimensions()
    if (pathwaysSection.dataset.pathwaysPhase !== frame.phase) {
      pathwaysSection.dataset.pathwaysPhase = frame.phase
    }
    setInlineStyle(
      pathwaysSection,
      '--pathways-qpu-glow',
      String(frame.componentGlow.qpu)
    )
    setInlineStyle(
      pathwaysSection,
      '--pathways-cmos-glow',
      String(frame.componentGlow.cmos)
    )

    for (const pathwayId of PATHWAY_IDS) {
      const visual = pathwayVisuals[pathwayId]
      const isActive = frame.activePathwayId === pathwayId
      const isHighlighted = frame.highlightedPathwayId === pathwayId
      const pulseProgress = isActive ? frame.pulse.progress : 0
      const entryProgress = frame.introProgress[pathwayId]
      const labelOpacity = frame.labelOpacity[pathwayId]
      const pathwayHasBeenDrawn = frame.phase !== 'detail' && entryProgress >= 1

      setInlineStyle(
        visual.neutralTrack,
        'clip-path',
        pathwayRevealClip(pathwayId, entryProgress)
      )
      setInlineStyle(
        visual.activeTrack,
        'clip-path',
        isHighlighted || pathwayHasBeenDrawn
        ? 'inset(0)'
          : pathwayRevealClip(pathwayId, pulseProgress)
      )
      setInlineStyle(
        visual.activeTrack,
        'opacity',
        isActive || isHighlighted || pathwayHasBeenDrawn ? '1' : '0'
      )
      visual.element.classList.toggle('is-active', isActive)
      visual.element.classList.toggle('is-selected', isHighlighted)
      visual.label.classList.toggle('is-active', isActive)

      visual.arrows.forEach((arrow, index) => {
        setInlineStyle(
          arrow,
          'opacity',
          entryProgress >= visual.arrowThresholds[index]
            ? String(isActive || isHighlighted ? 0.86 : 0.56)
            : '0'
        )
      })

      const pulseHidden = !(isActive && frame.pulse.visible)
      if (visual.pulse.hidden !== pulseHidden) visual.pulse.hidden = pulseHidden
      if (!pulseHidden) {
        const point = getPathwayPulsePoint(
          pathwayId,
          pulseProgress,
          visual.dimensions,
          frame.pulse.absorptionProgress,
          frame.pulse.emissionProgress
        )
        setInlineStyle(
          visual.pulse,
          'opacity',
          String(frame.pulse.opacity ?? 1)
        )
        setInlineStyle(
          visual.pulse,
          'transform',
          `translate3d(${point.x}px, ${point.y}px, 0) scale(${frame.pulse.scale ?? 1})`
        )
      }

      setInlineStyle(visual.label, 'opacity', String(labelOpacity))
      const labelOffset = 18 * (1 - labelOpacity)
      setInlineStyle(
        visual.label,
        'transform',
        pathwayId === 'external'
          ? `translate3d(0, ${-labelOffset}px, 0)`
          : pathwayId === 'control'
            ? `translate3d(${labelOffset}px, 0, 0)`
            : `translate3d(0, ${labelOffset}px, 0)`
      )
      setInlineStyle(visual.connector, 'opacity', String(labelOpacity))
    }

    setInlineStyle(pathwaysCopy, 'opacity', String(frame.copyOpacity))
    setInlineStyle(
      pathwaysCopy,
      'transform',
      `translate3d(0, ${24 * (1 - frame.copyOpacity)}px, 0)`
    )
  }

  function syncPathwaySelectionControls() {
    const detailsAreOpen = Boolean(state.selectedPathwayId)
    for (const button of pathwaySelectButtons) {
      const isSelected = button.dataset.pathwaySelect === state.selectedPathwayId
      button.disabled = !pathwaysSelectionEnabled || detailsAreOpen
      button.setAttribute('aria-pressed', String(isSelected))
    }
  }

  function setPathwaySelectionEnabled(enabled) {
    pathwaysSelectionEnabled = Boolean(enabled)
    if (
      pathwaysSelectionEnabled &&
      currentView() === 'pathways' &&
      !state.selectedPathwayId
    ) {
      pathwaysVisits.markIntroCompleted()
    }
    const continueVisible = pathwaysSelectionEnabled && currentView() === 'pathways'
    pathwaysContinueAction.hidden = !continueVisible
    updateKioskTooltip(pathwaysContinueTooltip, {
      replay: continueVisible,
      text: 'Tap anywhere to continue',
      visible: continueVisible
    })
    syncPathwaySelectionControls()
    syncProgressNavigationControls()
  }

  function stopPathwaysTimeline({ reset = false } = {}) {
    if (pathwaysAnimationFrame) {
      window.cancelAnimationFrame(pathwaysAnimationFrame)
      pathwaysAnimationFrame = 0
    }
    pathwaysElapsedMs = 0
    pathwaysLastTimestamp = 0
    pathwaysGuidance?.stop()
    setPathwaySelectionEnabled(false)
    if (reset) renderPathwaysFrame(getPathwaysFrame(0))
  }

  function startPathwaysTimeline({
    initialElapsedMs = 0,
    showGuidance = false
  } = {}) {
    stopPathwaysTimeline()
    const selectedPathwayId = state.selectedPathwayId
    pathwaysElapsedMs = Math.max(0, initialElapsedMs)
    if (!selectedPathwayId && showGuidance) {
      pathwaysGuidance.start()
    }
    setPathwaySelectionEnabled(
      Boolean(selectedPathwayId) ||
      pathwaysElapsedMs >= PATHWAYS_TIMINGS.copy.endMs
    )
    const frameAt = elapsedMs => selectedPathwayId
      ? getSelectedPathwayFrame(elapsedMs, selectedPathwayId)
      : getPathwaysFrame(elapsedMs)
    renderPathwaysFrame(frameAt(pathwaysElapsedMs))

    const tick = timestamp => {
      if (disposed || currentView() !== 'pathways') {
        pathwaysAnimationFrame = 0
        return
      }

      if (document.hidden) {
        pathwaysLastTimestamp = 0
        pathwaysAnimationFrame = window.requestAnimationFrame(tick)
        return
      }

      if (pathwaysLastTimestamp) {
        const delta = Math.max(0, timestamp - pathwaysLastTimestamp)
        pathwaysElapsedMs += delta
      }
      pathwaysLastTimestamp = timestamp
      renderPathwaysFrame(frameAt(pathwaysElapsedMs))
      if (
        !selectedPathwayId &&
        !pathwaysSelectionEnabled &&
        pathwaysElapsedMs >= PATHWAYS_TIMINGS.copy.endMs
      ) {
        setPathwaySelectionEnabled(true)
      }
      if (!selectedPathwayId && showGuidance) {
        pathwaysGuidance.update(pathwaysElapsedMs)
      }

      pathwaysAnimationFrame = window.requestAnimationFrame(tick)
    }

    pathwaysAnimationFrame = window.requestAnimationFrame(tick)
  }

  function startPathwaysVisit() {
    startPathwaysTimeline({
      ...pathwaysVisits.enter(),
      showGuidance: false
    })
  }

  document.addEventListener('visibilitychange', () => {
    // Do not count time spent in a hidden tab, but keep the sequence tied to
    // wall-clock time while the kiosk is actually visible.
    pathwaysLastTimestamp = 0
    if (document.hidden) settleSectionTransition()
  }, { signal })

  window.addEventListener('resize', () => {
    pathwayDimensionsDirty = true
    settleSectionTransition()
  }, { signal })

  function syncProgressNavigationControls() {
    const view = currentView()
    const activeTabIndex = TAB_ORDER.indexOf(view)
    const interactionLocked = Boolean(drag || pendingBuildSnap)

    progressTabButtons.forEach(button => {
      button.disabled =
        interactionLocked ||
        !hasVisitedMajoranaTab(state, button.dataset.majoranaTab)
    })

    if (previousSectionButton) {
      previousSectionButton.disabled =
        interactionLocked ||
        (view === 'components' && componentsPhase !== 'focus')
    }
    if (nextSectionButton) {
      nextSectionButton.disabled =
        interactionLocked ||
        activeTabIndex === TAB_ORDER.length - 1 ||
        !canAdvanceFromView(view)
    }
  }

  function syncModalInteractionState() {
    const pathwaysGuidanceVisible = Boolean(
      pathwaysGuidance?.getSnapshot().visible
    )
    const pathwayDetailVisible = Boolean(state.selectedPathwayId)
    const navigationIsBlocked =
      Boolean(sectionTransition) ||
      pathwaysGuidanceVisible ||
      pathwayDetailVisible

    // Restart and Exit remain available throughout every authored transition.
    moduleHeader.inert = false
    if (progressNavigation) {
      progressNavigation.inert =
        navigationIsBlocked || Boolean(drag || pendingBuildSnap)
    }
    pathwaysSection.inert =
      Boolean(sectionTransition) ||
      pathwaysGuidanceVisible ||
      pathwayDetailVisible
    buildSection.inert = Boolean(sectionTransition) || finalePlaying
  }

  function setPathwaysGuidanceVisible(visible) {
    root.classList.toggle('is-pathways-guidance-visible', visible)
    root.dataset.pathwaysGuidanceState = visible ? 'visible' : 'hidden'
    pathwaysGuidanceElement.classList.toggle('is-visible', visible)
    pathwaysGuidanceElement.setAttribute('aria-hidden', String(!visible))
    pathwaysGuidanceElement.inert = !visible
    syncModalInteractionState()
  }

  pathwaysGuidance = createPathwaysGuidanceController({
    onVisibilityChange: setPathwaysGuidanceVisible
  })
  setPathwaysGuidanceVisible(false)

  function setBuildGuidanceState(snapshot) {
    const partial = snapshot.phase === 'qpu-first' || snapshot.phase === 'cryo-first'
    const completionReady = snapshot.phase === 'complete' && snapshot.completionTooltipVisible
    /* Each chip's line belongs to that chip, so it appears when the chip is
       seated and stays there. The phase is enough to say which are down. */
    const complete = snapshot.phase === 'complete'
    const qpuPlaced = complete || snapshot.phase === 'qpu-first'
    const cryoPlaced = complete || snapshot.phase === 'cryo-first'
    const qpuCopy = qpuPlaced ? BUILD_PANEL_COPY['qpu-first'] : ''
    const cryoCopy = cryoPlaced ? BUILD_PANEL_COPY['cryo-first'] : ''
    const summaryCopy = completionReady ? BUILD_PANEL_COPY.complete : ''
    const promptKey = completionReady
      ? 'complete'
      : partial
        ? snapshot.phase
        : snapshot.bottomTooltip === 'initial'
          ? 'initial'
          : null
    const instructionCopy = promptKey ? BUILD_TOOLTIP_COPY[promptKey] : ''

    root.dataset.buildPhase = snapshot.phase
    root.dataset.buildPathCount = String(snapshot.activePathwayCount)
    root.classList.toggle('is-build-missing', Boolean(promptKey && promptKey !== 'complete'))
    root.classList.toggle('is-build-guidance-visible', snapshot.guidanceVisible)
    buildSection.dataset.buildGuidanceState = snapshot.guidanceVisible
      ? 'visible'
      : 'hidden'

    /* Replayed only while one slot is still open, which is when a line first
       arrives. Replaying as the second chip lands would restage copy the
       visitor is already part way through reading. */
    updateKioskExplainer(buildQpuExplainer, {
      ariaHidden: !qpuCopy,
      body: qpuCopy,
      replay: Boolean(qpuCopy) && partial,
      visible: Boolean(qpuCopy)
    })
    updateKioskExplainer(buildCryoExplainer, {
      ariaHidden: !cryoCopy,
      body: cryoCopy,
      replay: Boolean(cryoCopy) && partial,
      visible: Boolean(cryoCopy)
    })
    updateKioskExplainer(buildSummaryExplainer, {
      ariaHidden: !summaryCopy,
      body: summaryCopy,
      replay: Boolean(summaryCopy),
      visible: Boolean(summaryCopy)
    })
    updateKioskTooltip(buildActionTooltip, {
      replay: Boolean(promptKey),
      text: instructionCopy,
      visible: Boolean(promptKey)
    })
    buildActionTooltip.element.dataset.buildPrompt = promptKey ?? 'hidden'
    finishAction.hidden = !completionReady

    const guidanceTargets = new Set(snapshot.guidanceTargets)
    buildPartCards.forEach(card => {
      card.classList.toggle(
        'is-guidance-target',
        snapshot.guidanceVisible && guidanceTargets.has(card.dataset.buildPart)
      )
    })
    buildSlots.forEach(slot => {
      const slotId = slot.dataset.buildSlot
      slot.classList.toggle(
        'is-guidance-target',
        snapshot.guidanceVisible && guidanceTargets.has(slotId)
      )
      const missingInEmptyState =
        promptKey === 'initial' && !state.placements[slotId]
      slot.classList.toggle(
        'is-missing',
        snapshot.missingSlotId === slotId || missingInEmptyState
      )
    })
    buildPaths.forEach(path => {
      path.classList.toggle(
        'is-active',
        Number(path.dataset.buildPathIndex) <= snapshot.activePathwayCount
      )
    })
  }

  buildGuidance = createBuildGuidanceController({
    onChange: setBuildGuidanceState
  })
  setBuildGuidanceState(buildGuidance.getSnapshot())

  function clearPathwayDetailCloseWait() {
    window.clearTimeout(pathwayDetailCloseTimer)
    pathwayDetailCloseTimer = 0
    pathwayDetailCloseCleanup?.()
    pathwayDetailCloseCleanup = null
  }

  function restorePathwayTooltip() {
    if (!pathwayDetailPortal) return
    const { label, parent, nextSibling } = pathwayDetailPortal
    if (nextSibling?.parentNode === parent) {
      parent.insertBefore(label, nextSibling)
    } else {
      parent.append(label)
    }
    label.classList.remove('is-pathway-detail-portal')
    for (const property of [
      '--pathway-source-top',
      '--pathway-source-left',
      '--pathway-source-width',
      '--pathway-source-height',
      '--control-title-fragment-two-x',
      '--control-title-fragment-three-x'
    ]) {
      label.style.removeProperty(property)
    }
    pathwayDetailPortal = null
  }

  function portalPathwayTooltip(pathwayId) {
    const label = pathwayLabels[pathwayId]
    if (!label) return null
    if (pathwayDetailPortal?.label === label) return label
    restorePathwayTooltip()

    const rootBounds = root.getBoundingClientRect()
    const labelBounds = label.getBoundingClientRect()
    const stageScale = root.offsetWidth > 0
      ? rootBounds.width / root.offsetWidth
      : 1
    if (stageScale <= 0 || labelBounds.width <= 0 || labelBounds.height <= 0) {
      return label
    }

    const controlFragments = pathwayId === 'control'
      ? [...label.querySelectorAll('.majorana-pathway-tooltip__title-fragment')]
      : []
    if (controlFragments.length === 3) {
      const fragmentWidths = controlFragments.map(fragment => (
        fragment.getBoundingClientRect().width / stageScale
      ))
      const titleSpace = 11
      label.style.setProperty(
        '--control-title-fragment-two-x',
        `${fragmentWidths[0] + titleSpace}px`
      )
      label.style.setProperty(
        '--control-title-fragment-three-x',
        `${fragmentWidths[0] + fragmentWidths[1] + (titleSpace * 2)}px`
      )
    }

    label.style.setProperty(
      '--pathway-source-top',
      `${(labelBounds.top - rootBounds.top) / stageScale}px`
    )
    label.style.setProperty(
      '--pathway-source-left',
      `${(labelBounds.left - rootBounds.left) / stageScale}px`
    )
    label.style.setProperty(
      '--pathway-source-width',
      `${labelBounds.width / stageScale}px`
    )
    label.style.setProperty(
      '--pathway-source-height',
      `${labelBounds.height / stageScale}px`
    )

    pathwayDetailPortal = {
      label,
      parent: label.parentNode,
      nextSibling: label.nextSibling
    }
    label.classList.add('is-pathway-detail-portal')
    root.append(label)
    label.getBoundingClientRect()
    return label
  }

  function renderPathwayDetail(pathwayId) {
    clearPathwayDetailCloseWait()
    const isVisible = Boolean(pathwayId)
    const wasVisible = pathwayDetailElement.classList.contains('is-visible')

    if (isVisible) {
      portalPathwayTooltip(pathwayId)
      pathwayDetailClosing = false
      root.classList.remove('is-pathway-detail-closing')
      displayedPathwayDetailId = pathwayId
      pathwayDetailElement.dataset.selectedPathway = pathwayId
      pathwayDetailElement.setAttribute(
        'aria-label',
        `${PATHWAY_DETAILS[pathwayId].title}. Tap anywhere to exit overlay.`
      )
    }

    for (const [labelPathwayId, label] of Object.entries(pathwayLabels)) {
      label.classList.remove('is-detail-card', 'is-detail-returning')
      label.setAttribute('aria-expanded', String(
        isVisible && labelPathwayId === pathwayId
      ))
      if (isVisible && labelPathwayId === pathwayId) {
        label.classList.add('is-detail-card')
      }
    }

    pathwayDetailElement.classList.toggle('is-visible', isVisible)
    pathwayDetailElement.setAttribute('aria-hidden', String(!isVisible))
    pathwayDetailElement.inert = !isVisible
    root.classList.toggle('is-pathway-detail-visible', isVisible)
    root.dataset.pathwaysMode = isVisible ? 'detail' : 'overview'

    for (const panel of pathwayDetailElement.querySelectorAll(
      '[data-pathway-detail-panel]'
    )) {
      panel.setAttribute(
        'aria-hidden',
        String(panel.dataset.pathwayDetailPanel !== pathwayId)
      )
    }

    if (isVisible && !wasVisible) {
      window.requestAnimationFrame(() => pathwayDetailElement.focus({
        preventScroll: true
      }))
    }

    if (!isVisible && displayedPathwayDetailId) {
      pathwayDetailClosing = false
      root.classList.remove('is-pathway-detail-closing')
      pathwayDetailCloseTimer = window.setTimeout(() => {
        if (state.selectedPathwayId) return
        displayedPathwayDetailId = null
        delete pathwayDetailElement.dataset.selectedPathway
      }, 420)
    }

    if (!isVisible) restorePathwayTooltip()

    syncPathwaySelectionControls()
    syncModalInteractionState()
  }

  function animateStageRelocation(before, after, options = {}) {
    if (!before || !after || before.width <= 0 || after.width <= 0) return null

    const rootBounds = root.getBoundingClientRect()
    const stageScale = root.offsetWidth > 0 ? rootBounds.width / root.offsetWidth : 1
    const inverseScale = stageScale > 0 ? 1 / stageScale : 1
    const translateX = (before.left - after.left) * inverseScale
    const translateY = (before.top - after.top) * inverseScale
    const scaleX = before.width / after.width
    const scaleY = before.height / after.height

    const fromFrame = {
      transformOrigin: 'top left',
      transform: `translate(${translateX}px, ${translateY}px) scale(${scaleX}, ${scaleY})`
    }
    const toFrame = {
      transformOrigin: 'top left',
      transform: 'translate(0, 0) scale(1, 1)'
    }
    if (options.fromFilter) {
      fromFrame.filter = options.fromFilter
      toFrame.filter = options.toFilter ?? 'none'
    }
    if (Number.isFinite(options.fromOpacity)) {
      fromFrame.opacity = options.fromOpacity
      toFrame.opacity = Number.isFinite(options.toOpacity) ? options.toOpacity : 1
    }

    const animation = modelStage.animate([fromFrame, toFrame], {
      duration: motionDuration(options.durationMs ?? COMPONENTS_RELOCATION_MS),
      easing: options.easing ?? 'cubic-bezier(0.42, 0, 0.58, 1)',
      fill: 'none'
    })
    stageAnimation = animation
    const clearAnimation = () => {
      if (stageAnimation === animation) stageAnimation = null
    }
    animation.onfinish = clearAnimation
    animation.oncancel = clearAnimation
    return animation
  }

  function clearComponentsSequence() {
    componentsSequenceRun += 1
    window.clearTimeout(componentsRelocationTimer)
    window.clearTimeout(componentsFocusTimer)
    if (componentsPrimeFrame) window.cancelAnimationFrame(componentsPrimeFrame)
    window.clearTimeout(componentsSpotlightTimer)
    window.clearTimeout(componentsActivateTimer)
    componentsRelocationTimer = 0
    componentsFocusTimer = 0
    componentsPrimeFrame = 0
    componentsSpotlightTimer = 0
    componentsActivateTimer = 0
  }

  function beginComponentsSequence(relocationAnimation, cameraTransitionFinished) {
    clearComponentsSequence()
    componentsPhase = 'relocating'
    const run = componentsSequenceRun

    const phaseIsValid = expectedPhase => (
      !disposed &&
      run === componentsSequenceRun &&
      currentView() === 'components' &&
      componentsPhase === expectedPhase
    )

    const startFocusTransition = () => {
      if (!phaseIsValid('schematic')) return

      window.clearTimeout(componentsFocusTimer)
      componentsFocusTimer = 0
      registerComponentFocusOrigins()
      componentsPhase = 'priming'
      componentsSpotlight = 'qpu'
      render()

      /* Reparent the existing Three.js canvases into their measured FLIP
         origins, let that frame paint, then release both objects toward the
         Figma focus layout. Without this painted prime frame, Chromium can
         coalesce the reparent and destination styles into one visible jump. */
      const beginPaintedFocus = () => {
        if (!phaseIsValid('priming')) return
        componentsPrimeFrame = 0
        componentsPhase = 'focusing'
        render()

        componentsSpotlightTimer = window.setTimeout(() => {
          if (!phaseIsValid('focusing')) return
          componentsSpotlightTimer = 0
          componentsSpotlight = 'cmos'
          render()
        }, motionDelay(2_050))

        componentsActivateTimer = window.setTimeout(() => {
          if (!phaseIsValid('focusing')) return

          componentsActivateTimer = 0
          componentsPhase = 'focus'
          componentsSpotlight = 'both'
          render()
        }, motionDelay(COMPONENTS_FOCUS_TRANSITION_MS))
      }

      if (reducedMotion.matches) {
        beginPaintedFocus()
      } else {
        componentsPrimeFrame = window.requestAnimationFrame(() => {
          componentsPrimeFrame = window.requestAnimationFrame(beginPaintedFocus)
        })
      }
    }

    const finishRelocation = () => {
      if (!phaseIsValid('relocating')) return

      window.clearTimeout(componentsRelocationTimer)
      componentsRelocationTimer = 0
      schematicImagesReady.then(() => {
        if (!phaseIsValid('relocating')) return

      componentsPhase = 'schematic'
      componentsSpotlight = 'none'
      render()
        componentsFocusTimer = window.setTimeout(
          startFocusTransition,
          motionDelay(COMPONENTS_SCHEMATIC_REVEAL_MS)
        )
      })
    }

    componentsRelocationTimer = window.setTimeout(
      finishRelocation,
      motionDuration(COMPONENTS_RELOCATION_FALLBACK_MS)
    )
    const relocationFinished = relocationAnimation?.finished ?? Promise.resolve()
    Promise.allSettled([relocationFinished, cameraTransitionFinished]).then(finishRelocation)
  }

  function render() {
    const view = currentView()
    const previousView = renderedView
    const viewChanged = Boolean(previousView && previousView !== view)
    const previousStageBounds = viewChanged && modelStage.isConnected
      ? modelStage.getBoundingClientRect()
      : null
    const readsPreviousStageStyle =
      previousView === 'components' &&
      view === 'pathways' &&
      sectionTransition?.kind === SECTION_TRANSITION_KINDS.COMPONENTS_PATHWAYS
    const previousStageComputedStyle = readsPreviousStageStyle && modelStage.isConnected
      ? window.getComputedStyle(modelStage)
      : null
    const previousStageStyle = previousStageComputedStyle
      ? {
          filter: previousStageComputedStyle.filter,
          opacity: previousStageComputedStyle.opacity
        }
      : null
    if (previousView && previousView !== view) {
      stageAnimation?.cancel()
      stageAnimation = null
    }
    if (previousView === 'build' && view !== 'build') {
      cancelPendingBuildSnap()
      clearBuildDragFrame()
      if (drag) {
        drag.pendingSamples.length = 0
        setBuildPartTilt(drag.card, drag.partId, { rotateX: 0, rotateY: 0 }, false)
        resetDraggedCard(drag.card, false)
        drag = null
        delete root.dataset.draggingPart
      }
    }
    if (previousView === 'components' && view !== 'components') {
      resetComponentInspection()
      sceneController?.resetComponentRotations({ immediate: true })
      clearComponentsSequence()
      componentsPhase = 'schematic'
      componentsSpotlight = 'none'
    }
    if (view === 'components' && previousView && previousView !== 'intro' && previousView !== 'components') {
      clearComponentsSequence()
      componentsPhase = 'focus'
      componentsSpotlight = 'both'
    }
    if (previousView === 'intro' && view === 'components') {
      componentsPhase = 'relocating'
      componentsSpotlight = 'none'
    }
    root.classList.toggle('is-intro', view === 'intro')
    if (view === 'intro') {
      root.classList.remove(
        'has-shared-pathways-entry',
        'is-pathways-model-handoff'
      )
    }
    root.classList.toggle('is-entering-components', previousView === 'intro' && view === 'components')
    root.dataset.currentView = view
    modelStage.classList.toggle(
      'is-schematic',
      view === 'pathways' || view === 'build' || (
        view === 'components' &&
        ['schematic', 'priming', 'focusing', 'focus'].includes(componentsPhase)
      )
    )
    const isSchematicVisible =
      view === 'pathways' || view === 'build' || (
        view === 'components' &&
        ['schematic', 'priming', 'focusing', 'focus'].includes(componentsPhase)
      )
    schematic.setAttribute('aria-hidden', String(!isSchematicVisible))

    viewSections.forEach(section => {
      const isActive = section.dataset.majoranaView === view
      section.hidden = !isActive
      section.setAttribute('aria-hidden', String(!isActive))
    })

    progressTabButtons.forEach(button => {
      const isActive = button.dataset.majoranaTab === view
      const isVisited = hasVisitedMajoranaTab(state, button.dataset.majoranaTab)
      button.classList.toggle('is-active', isActive)
      button.classList.toggle('is-visited', isVisited)
      button.classList.toggle('is-complete', isVisited && !isActive)
      button.setAttribute('aria-current', isActive ? 'step' : 'false')
    })

    const modelSlot = modelSlots[view]
    let relocationAnimation = null
    if (modelSlot && modelStage.parentElement !== modelSlot) {
      modelSlot.append(modelStage)
      const isIntroComponentsTransition =
        (previousView === 'intro' && view === 'components') ||
        (previousView === 'components' && view === 'intro')
      if (isIntroComponentsTransition) {
        relocationAnimation = animateStageRelocation(
          previousStageBounds,
          modelStage.getBoundingClientRect()
        )
      } else if (
        sectionTransition?.kind === SECTION_TRANSITION_KINDS.COMPONENTS_PATHWAYS &&
        previousView === 'components' &&
        view === 'pathways'
      ) {
        relocationAnimation = animateStageRelocation(
          previousStageBounds,
          modelStage.getBoundingClientRect(),
          {
            durationMs:
              sectionTransition.timings.durationMs -
              sectionTransition.timings.switchDelayMs,
            easing: 'cubic-bezier(0.4, 0, 0.2, 1)',
            fromFilter: previousStageStyle?.filter ?? 'blur(18px)',
            fromOpacity: Number.parseFloat(previousStageStyle?.opacity) || 0.2,
            toFilter: 'none',
            toOpacity: 1
          }
        )
        trackSectionAnimation(sectionTransition, relocationAnimation)
      }
    }

    const cameraTransitionFinished = syncSceneView(view)

    if (previousView === 'intro' && view === 'components') {
      beginComponentsSequence(relocationAnimation, cameraTransitionFinished)
    }

    const isComponentsFocusVisible =
      view === 'components' && ['priming', 'focusing', 'focus'].includes(componentsPhase)
    const isComponentsReady =
      view === 'components' && componentsPhase === 'focus'
    syncSceneComponentPresentation(view)
    root.classList.toggle('is-components-focus', isComponentsFocusVisible)
    root.dataset.componentsPhase = view === 'components' ? componentsPhase : 'inactive'
    root.dataset.componentSpotlight = view === 'components'
      ? componentsSpotlight
      : 'none'
    componentsFocus.setAttribute('aria-hidden', String(!isComponentsFocusVisible))
    componentsFocus.inert = !isComponentsFocusVisible
    componentsSection.setAttribute(
      'aria-busy',
      String(view === 'components' && !isComponentsReady)
    )
    componentsContinueAction.hidden = !isComponentsReady
    updateKioskTooltip(componentsContinueTooltip, {
      replay: isComponentsReady,
      text: 'Tap anywhere to continue',
      visible: isComponentsReady
    })

    const progress = getMajoranaBuildProgress(state)
    const complete = isMajoranaBuildComplete(state)
    buildFeedback.textContent = state.lastDrop?.valid === false
      ? 'That component belongs in the other highlighted position. Try again.'
      : ''
    root.classList.toggle('is-build-complete', complete)
    buildTrayTitle?.setAttribute('aria-hidden', String(complete))
    root.classList.toggle('is-build-qpu-placed', Boolean(state.placements['qpu-stack']))
    root.classList.toggle('is-build-cmos-placed', Boolean(state.placements['cryo-cmos']))
    root.style.setProperty('--majorana-build-progress', String(progress / MAJORANA_PARTS.length))

    buildPartCards.forEach(card => {
      const isPlaced = Boolean(state.placements[card.dataset.buildPart])
      card.disabled = isPlaced
      card.classList.toggle('is-placed', isPlaced)
      card.setAttribute('aria-label', isPlaced
        ? `${card.dataset.buildPart === 'qpu-stack' ? 'QPU stack' : 'Cryo-CMOS'} placed`
        : `Drag ${card.dataset.buildPart === 'qpu-stack' ? 'QPU stack' : 'Cryo-CMOS'} onto the board`)
    })

    buildSlots.forEach(slot => {
      const isFilled = Boolean(state.placements[slot.dataset.buildSlot])
      slot.classList.toggle('is-filled', isFilled)
      slot.setAttribute('aria-label', `${slot.dataset.buildSlot === 'qpu-stack' ? 'QPU stack' : 'Cryo-CMOS'} position${isFilled ? ', filled' : ''}`)
    })

    buildGuidance.setActive(view === 'build' && !sectionTransition)
    buildGuidance.syncPlacements(state.placements)

    if (view === 'build' && previousView !== 'build' && !sectionTransition) void finale.prepare()

    syncProgressNavigationControls()

    const selectedPathwayId = view === 'pathways'
      ? state.selectedPathwayId
      : null
    if (view === 'pathways' && previousView !== 'pathways') {
      pathwaysOverviewResumeMs = 0
      if (sectionTransition) stopPathwaysTimeline({ reset: true })
      else startPathwaysVisit()
    } else if (
      view === 'pathways' &&
      previousView === 'pathways' &&
      selectedPathwayId !== renderedPathwayId
    ) {
      if (selectedPathwayId) {
        pathwaysOverviewResumeMs = Math.max(
          pathwaysElapsedMs,
          PATHWAYS_TIMINGS.loopStartMs
        )
        startPathwaysTimeline()
      } else {
        const continuationElapsedMs = getPathwaysContinuationElapsed(
          pathwaysElapsedMs,
          renderedPathwayId,
          pathwaysOverviewResumeMs + pathwaysElapsedMs
        )
        startPathwaysTimeline({
          initialElapsedMs: continuationElapsedMs,
          showGuidance: false
        })
      }
    } else if (view !== 'pathways' && previousView === 'pathways') {
      stopPathwaysTimeline({ reset: true })
      pathwaysOverviewResumeMs = 0
    }

    if (
      selectedPathwayId !== renderedPathwayId ||
      (previousView === 'pathways' && view !== 'pathways')
    ) renderPathwayDetail(selectedPathwayId)

    renderedPathwayId = selectedPathwayId
    renderedView = view
  }

  function dispatch(event) {
    if (event.type === 'RESTART') {
      finalePlaying = false
      finale.reset()
      upNextBanner?.withdraw()
      root.classList.remove('is-finale', 'is-finale-complete')
      sceneController?.setSuspended(false)
      resetBuildPartCards()
      pathwaysVisits.resetSession()
      buildGuidance?.reset()
    }
    state = reduceMajoranaState(state, event)
    activity()
    render()
  }

  function exitModule() {
    activity()
    if (typeof navigate?.menu === 'function') {
      navigate.menu()
      return
    }

    if (typeof navigate?.home === 'function') {
      navigate.home()
      return
    }

    if (typeof navigate === 'function') {
      navigate('menu')
      return
    }

    root.dispatchEvent(new CustomEvent('kiosk:navigate', {
      bubbles: true,
      detail: { screen: 'menu' }
    }))
  }

  async function startFinale() {
    if (finalePlaying || !isMajoranaBuildComplete(state)) return
    finalePlaying = true
    activity()
    finishAction.hidden = true
    updateKioskTooltip(buildActionTooltip, { visible: false })
    root.classList.add('is-finale')
    syncModalInteractionState()

    const completed = await finale.play()
    if (!completed || disposed || !finalePlaying) return
    sceneController?.setSuspended(true)
    root.classList.add('is-finale-complete')
    upNextBanner?.offer()
  }

  function handleClick(event) {
    const action = event.target.closest('[data-majorana-action]')?.dataset.majoranaAction
    const tab = event.target.closest('[data-majorana-tab]')?.dataset.majoranaTab
    const buildPart = event.target.closest('[data-build-part]')?.dataset.buildPart
    const pathwaySelect = event.target.closest('[data-pathway-select]')
      ?.dataset.pathwaySelect

    if (sectionTransition) {
      if (action === 'restart' || action === 'exit') {
        cancelSectionTransition({ activateDestination: false })
      } else {
        return
      }
    }

    if (
      pathwaySelect &&
      currentView() === 'pathways' &&
      pathwaysSelectionEnabled &&
      !state.selectedPathwayId
    ) {
      const visibleLabel = pathwayLabels[pathwaySelect]
      pathwayReturnFocus = visibleLabel
      portalPathwayTooltip(pathwaySelect)
      pathwaysGuidance.stop()
      dispatch({ type: 'SELECT_PATHWAY', pathwayId: pathwaySelect })
      return
    }

    if (tab) {
      navigateSection(tab)
      return
    }
    if (action === 'start') dispatch({ type: 'START' })
    if (action === 'previous-section') {
      const activeTabIndex = TAB_ORDER.indexOf(currentView())
      if (activeTabIndex <= 0) dispatch({ type: 'RESTART' })
      else navigateSection(TAB_ORDER[activeTabIndex - 1])
    }
    if (action === 'next-section') {
      const activeTabIndex = TAB_ORDER.indexOf(currentView())
      if (activeTabIndex >= 0 && activeTabIndex < TAB_ORDER.length - 1) {
        navigateSection(TAB_ORDER[activeTabIndex + 1], { advance: true })
      }
    }
    if (action === 'next-pathways') navigateSection('pathways', { advance: true })
    if (action === 'next-build') navigateSection('build', { advance: true })
    if (action === 'finish') void startFinale()
    if (action === 'restart') {
      dispatch({ type: 'RESTART' })
    }
    if (action === 'exit') exitModule()

    if (buildPart && event.detail === 0 && !state.placements[buildPart]) {
      const card = buildPartCards.find(candidate => candidate.dataset.buildPart === buildPart)
      const slot = buildSlots.find(candidate => candidate.dataset.buildSlot === buildPart)
      if (card && slot) startBuildSnap(card, buildPart, slot)
    }
  }

  function clearReturnTimer(card) {
    const timerId = returnTimers.get(card)
    if (timerId == null) return
    window.clearTimeout(timerId)
    returnTimers.delete(card)
  }

  function clearBuildTiltTimer() {
    window.clearTimeout(buildTiltTimer)
    buildTiltTimer = 0
  }

  function setBuildPartTilt(card, partId, tilt, active) {
    const rotateX = Number.isFinite(tilt?.rotateX) ? tilt.rotateX : 0
    const rotateY = Number.isFinite(tilt?.rotateY) ? tilt.rotateY : 0
    setInlineStyle(card, '--build-tilt-x', `${rotateX}deg`)
    setInlineStyle(card, '--build-tilt-y', `${rotateY}deg`)
    sceneController?.setBuildPartMotion(partId, rotateX, rotateY, active)
  }

  function clearBuildDragFrame() {
    if (!buildDragFrame) return
    window.cancelAnimationFrame(buildDragFrame)
    buildDragFrame = 0
  }

  function applyBuildDragSamples(activeDrag) {
    if (!activeDrag?.pendingSamples.length) return

    let lastSample = null
    for (const sample of activeDrag.pendingSamples.splice(0)) {
      const velocityTilt = buildDragTiltFromVelocity(
        (sample.clientX - activeDrag.lastX) / activeDrag.scale,
        (sample.clientY - activeDrag.lastY) / activeDrag.scale,
        sample.timeStamp - activeDrag.lastTime
      )
      activeDrag.tilt = blendBuildDragTilt(activeDrag.tilt, velocityTilt)
      activeDrag.lastX = sample.clientX
      activeDrag.lastY = sample.clientY
      activeDrag.lastTime = sample.timeStamp
      lastSample = sample
    }

    const offset = buildDragOffset(
      activeDrag.startX,
      activeDrag.startY,
      lastSample.clientX,
      lastSample.clientY,
      activeDrag.scale
    )
    setInlineStyle(activeDrag.card, '--drag-x', `${offset.x}px`)
    setInlineStyle(activeDrag.card, '--drag-y', `${offset.y}px`)
    setBuildPartTilt(activeDrag.card, activeDrag.partId, activeDrag.tilt, true)

    clearBuildTiltTimer()
    const restDelay = Math.max(
      0,
      BUILD_TILT_REST_DELAY_MS - (performance.now() - lastSample.receivedAt)
    )
    buildTiltTimer = window.setTimeout(() => {
      if (drag !== activeDrag) return
      activeDrag.tilt = { rotateX: 0, rotateY: 0 }
      setBuildPartTilt(activeDrag.card, activeDrag.partId, activeDrag.tilt, true)
      buildTiltTimer = 0
    }, restDelay)
  }

  function flushBuildDragFrame(activeDrag = drag) {
    clearBuildDragFrame()
    applyBuildDragSamples(activeDrag)
  }

  function scheduleBuildDragFrame() {
    if (buildDragFrame) return
    buildDragFrame = window.requestAnimationFrame(() => {
      buildDragFrame = 0
      applyBuildDragSamples(drag)
    })
  }

  function cleanupPendingBuildSnap(snap, resetPosition = false) {
    if (!snap) return
    window.clearTimeout(snap.fallbackTimer)
    snap.card.removeEventListener('transitionend', snap.handleTransitionEnd)
    snap.card.classList.remove('is-snapping')
    snap.slot.classList.remove('is-receiving')
    if (resetPosition) {
      snap.card.style.setProperty('--drag-x', '0px')
      snap.card.style.setProperty('--drag-y', '0px')
      snap.card.style.setProperty('--drop-x', '0px')
      snap.card.style.setProperty('--drop-y', '0px')
      snap.card.style.setProperty('--drop-scale', '1')
    }
  }

  function cancelPendingBuildSnap({ resetPosition = true } = {}) {
    buildSnapRun += 1
    if (!pendingBuildSnap) return
    const snap = pendingBuildSnap
    pendingBuildSnap = null
    cleanupPendingBuildSnap(snap, resetPosition)
    setBuildPartTilt(snap.card, snap.partId, { rotateX: 0, rotateY: 0 }, false)
    buildGuidance.setInteractionActive(false)
    syncProgressNavigationControls()
    syncModalInteractionState()
  }

  function finishBuildSnap(token) {
    const snap = pendingBuildSnap
    if (!snap || snap.token !== token) return
    pendingBuildSnap = null
    syncProgressNavigationControls()
    syncModalInteractionState()
    cleanupPendingBuildSnap(snap)

    state = reduceMajoranaState(state, {
      type: 'DROP_PART',
      partId: snap.partId,
      slotId: snap.slot.dataset.buildSlot
    })
    snap.card.classList.add('is-seating')
    snap.slot.classList.add('is-receiving')
    snap.card.style.setProperty('--drag-x', '0px')
    snap.card.style.setProperty('--drag-y', '0px')
    setBuildPartTilt(snap.card, snap.partId, { rotateX: 0, rotateY: 0 }, false)
    buildGuidance.setInteractionActive(false)
    activity()
    render()

    clearReturnTimer(snap.card)
    const seatTimer = window.setTimeout(() => {
      snap.card.classList.remove('is-seating')
      snap.slot.classList.remove('is-receiving')
      returnTimers.delete(snap.card)
    }, BUILD_SEAT_EFFECT_MS)
    returnTimers.set(snap.card, seatTimer)
  }

  function startBuildSnap(card, partId, slot, baseVisualRect = null) {
    if (
      pendingBuildSnap ||
      state.placements[partId] ||
      !isValidMajoranaDrop(partId, slot.dataset.buildSlot)
    ) return

    const visual = card.querySelector('.majorana-build-part__visual')
    if (!visual) return
    const rootBounds = root.getBoundingClientRect()
    const stageScale = root.offsetWidth > 0 ? rootBounds.width / root.offsetWidth : 1
    const visualBounds = baseVisualRect || visual.getBoundingClientRect()
    const target = centeredBuildSnap({
      baseVisualRect: visualBounds,
      slotRect: slot.getBoundingClientRect(),
      stageScale: stageScale || 1,
      visualWidth: visual.offsetWidth,
      visualHeight: visual.offsetHeight
    })
    const token = ++buildSnapRun

    clearBuildTiltTimer()
    clearReturnTimer(card)
    card.classList.remove('is-dragging', 'is-returning', 'is-seating')
    card.style.setProperty('--drop-x', `${target.x}px`)
    card.style.setProperty('--drop-y', `${target.y}px`)
    card.style.setProperty('--drop-scale', String(target.scale))
    setBuildPartTilt(card, partId, { rotateX: 0, rotateY: 0 }, false)
    card.classList.add('is-snapping')
    slot.classList.add('is-receiving')
    buildGuidance.setInteractionActive(true)

    const handleTransitionEnd = transitionEvent => {
      if (transitionEvent.target !== card || transitionEvent.propertyName !== 'transform') return
      finishBuildSnap(token)
    }
    const fallbackTimer = window.setTimeout(
      () => finishBuildSnap(token),
      BUILD_SNAP_FALLBACK_MS
    )
    pendingBuildSnap = {
      token,
      card,
      partId,
      slot,
      fallbackTimer,
      handleTransitionEnd
    }
    card.addEventListener('transitionend', handleTransitionEnd)
    syncProgressNavigationControls()
    syncModalInteractionState()
  }

  function resetBuildPartCards() {
    cancelPendingBuildSnap()
    clearBuildDragFrame()
    clearBuildTiltTimer()
    if (drag) drag.pendingSamples.length = 0
    buildPartCards.forEach(card => {
      clearReturnTimer(card)
      card.classList.remove('is-dragging', 'is-returning', 'is-snapping', 'is-seating')
      card.style.setProperty('--drag-x', '0px')
      card.style.setProperty('--drag-y', '0px')
      card.style.setProperty('--drop-x', '0px')
      card.style.setProperty('--drop-y', '0px')
      card.style.setProperty('--drop-scale', '1')
      setBuildPartTilt(
        card,
        card.dataset.buildPart,
        { rotateX: 0, rotateY: 0 },
        false
      )
    })
    buildSlots.forEach(slot => slot.classList.remove('is-receiving'))
  }

  function resetDraggedCard(card, animated) {
    card.classList.remove('is-dragging')
    card.classList.toggle('is-returning', animated)
    clearReturnTimer(card)
    card.style.setProperty('--drag-x', '0px')
    card.style.setProperty('--drag-y', '0px')
    card.style.setProperty('--build-tilt-x', '0deg')
    card.style.setProperty('--build-tilt-y', '0deg')
    if (animated) {
      const timerId = window.setTimeout(() => {
        card.classList.remove('is-returning')
        returnTimers.delete(card)
      }, 430)
      returnTimers.set(card, timerId)
    }
  }

  function handlePointerDown(event) {
    const inspectableComponent = event.target.closest('[data-majorana-component-inspect]')
    if (
      inspectableComponent &&
      currentView() === 'components' &&
      componentsPhase === 'focus'
    ) {
      event.preventDefault()
      activity()
      if (componentInspection) return
      const rootBounds = root.getBoundingClientRect()
      const scale = root.offsetWidth > 0 ? rootBounds.width / root.offsetWidth : 1
      componentInspection = {
        element: inspectableComponent,
        partId: inspectableComponent.dataset.majoranaComponentInspect,
        pointerId: event.pointerId,
        startX: event.clientX,
        startY: event.clientY,
        scale: scale || 1,
        width: inspectableComponent.offsetWidth,
        rotateX: 0,
        rotateY: 0
      }
      inspectableComponent.setPointerCapture(event.pointerId)
      inspectableComponent.classList.add('is-interacting')
      sceneController?.setComponentRotation(
        componentInspection.partId,
        0,
        0,
        true
      )
      return
    }

    const card = event.target.closest('[data-build-part]')
    if (!card || card.disabled || state.activeTab !== 'build' || pendingBuildSnap) return

    event.preventDefault()
    activity()
    const rootBounds = root.getBoundingClientRect()
    const scale = root.offsetWidth > 0 ? rootBounds.width / root.offsetWidth : 1
    const visual = card.querySelector('.majorana-build-part__visual')
    const pointerTime = Number.isFinite(event.timeStamp) ? event.timeStamp : performance.now()
    clearBuildDragFrame()
    drag = {
      card,
      partId: card.dataset.buildPart,
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      lastX: event.clientX,
      lastY: event.clientY,
      lastTime: pointerTime,
      tilt: { rotateX: 0, rotateY: 0 },
      pendingSamples: [],
      baseVisualRect: visual?.getBoundingClientRect() ?? null,
      scale: scale || 1
    }
    card.setPointerCapture(event.pointerId)
    clearReturnTimer(card)
    card.classList.remove('is-returning')
    card.classList.add('is-dragging')
    root.dataset.draggingPart = drag.partId
    setBuildPartTilt(card, drag.partId, drag.tilt, true)
    buildGuidance.setInteractionActive(true)
    syncProgressNavigationControls()
    syncModalInteractionState()
  }

  function handlePointerMove(event) {
    if (componentInspection?.pointerId === event.pointerId) {
      event.preventDefault()
      const x = (event.clientX - componentInspection.startX) / componentInspection.scale
      const y = (event.clientY - componentInspection.startY) / componentInspection.scale
      const rotation = componentRotationFromDrag(x, y, componentInspection.width)
      componentInspection.rotateX = rotation.rotateX
      componentInspection.rotateY = rotation.rotateY

      if (!componentInspectionFrame) {
        componentInspectionFrame = window.requestAnimationFrame(() => {
          componentInspectionFrame = 0
          if (!componentInspection) return
          componentInspection.element.style.setProperty(
            '--inspect-rotate-x',
            `${componentInspection.rotateX}deg`
          )
          componentInspection.element.style.setProperty(
            '--inspect-rotate-y',
            `${componentInspection.rotateY}deg`
          )
          sceneController?.setComponentRotation(
            componentInspection.partId,
            componentInspection.rotateX,
            componentInspection.rotateY,
            true
          )
        })
      }
      return
    }

    if (!drag || drag.pointerId !== event.pointerId) return
    event.preventDefault()
    drag.pendingSamples.push({
      clientX: event.clientX,
      clientY: event.clientY,
      receivedAt: performance.now(),
      timeStamp: Number.isFinite(event.timeStamp) ? event.timeStamp : performance.now()
    })
    scheduleBuildDragFrame()
  }

  function finishDrag(event, cancelled = false) {
    if (!drag || drag.pointerId !== event.pointerId) return
    flushBuildDragFrame(drag)
    const activeDrag = drag
    drag = null
    syncProgressNavigationControls()
    syncModalInteractionState()
    clearBuildTiltTimer()
    delete root.dataset.draggingPart

    if (activeDrag.card.hasPointerCapture(event.pointerId)) {
      activeDrag.card.releasePointerCapture(event.pointerId)
    }

    const targetSlot = cancelled
      ? null
      : buildSlots.find(slot => {
          const bounds = slot.getBoundingClientRect()
          return pointInsideRect(event.clientX, event.clientY, bounds)
        })

    const slotId = targetSlot?.dataset.buildSlot ?? null
    if (targetSlot && isValidMajoranaDrop(activeDrag.partId, slotId)) {
      startBuildSnap(
        activeDrag.card,
        activeDrag.partId,
        targetSlot,
        activeDrag.baseVisualRect
      )
      return
    }

    setBuildPartTilt(
      activeDrag.card,
      activeDrag.partId,
      { rotateX: 0, rotateY: 0 },
      false
    )
    state = reduceMajoranaState(state, {
      type: 'DROP_PART',
      partId: activeDrag.partId,
      slotId
    })
    resetDraggedCard(activeDrag.card, true)
    buildGuidance.setInteractionActive(false)
    activity()
    render()
  }

  function resetComponentInspection() {
    if (!componentInspection) return
    const activeInspection = componentInspection
    componentInspection = null

    if (componentInspectionFrame) {
      window.cancelAnimationFrame(componentInspectionFrame)
      componentInspectionFrame = 0
    }

    if (activeInspection.element.hasPointerCapture(activeInspection.pointerId)) {
      activeInspection.element.releasePointerCapture(activeInspection.pointerId)
    }

    activeInspection.element.style.setProperty('--inspect-rotate-x', '0deg')
    activeInspection.element.style.setProperty('--inspect-rotate-y', '0deg')
    activeInspection.element.classList.remove('is-interacting')
    sceneController?.setComponentRotation(activeInspection.partId, 0, 0, false)
  }

  function finishComponentInspection(event) {
    if (!componentInspection || componentInspection.pointerId !== event.pointerId) return
    resetComponentInspection()
  }

  function handlePathwaysGuidancePointerEvent(event) {
    event.stopPropagation()
  }

  function handlePathwaysGuidanceClick(event) {
    event.preventDefault()
    event.stopPropagation()
    pathwaysGuidance.dismiss()
  }

  function closePathwayDetail() {
    if (!state.selectedPathwayId || pathwayDetailClosing) return
    const closingPathwayId = state.selectedPathwayId
    const closingLabel = pathwayLabels[closingPathwayId]
    let labelReturned = !closingLabel
    let overlayHidden = false
    let closeFinished = false

    const finishClose = () => {
      if (closeFinished || (!labelReturned || !overlayHidden)) return
      closeFinished = true
      clearPathwayDetailCloseWait()
      if (disposed || state.selectedPathwayId !== closingPathwayId) return
      pathwayDetailClosing = false
      root.classList.remove('is-pathway-detail-closing')
      closingLabel?.classList.remove('is-detail-returning')
      dispatch({ type: 'SELECT_PATHWAY', pathwayId: null })
      window.requestAnimationFrame(() => {
        if (!pathwayReturnFocus?.isConnected) return
        pathwayReturnFocus.focus({ preventScroll: true })
        pathwayReturnFocus = null
      })
    }
    const finishCloseFallback = () => {
      labelReturned = true
      overlayHidden = true
      finishClose()
    }
    const handleLabelTransitionEnd = event => {
      if (event.target !== closingLabel || event.propertyName !== 'top') return
      labelReturned = true
      finishClose()
    }
    const handleOverlayTransitionEnd = event => {
      if (
        event.target !== pathwayDetailElement ||
        event.propertyName !== 'opacity'
      ) return
      overlayHidden = true
      finishClose()
    }

    clearPathwayDetailCloseWait()
    closingLabel?.addEventListener('transitionend', handleLabelTransitionEnd)
    pathwayDetailElement.addEventListener(
      'transitionend',
      handleOverlayTransitionEnd
    )
    pathwayDetailCloseCleanup = () => {
      closingLabel?.removeEventListener(
        'transitionend',
        handleLabelTransitionEnd
      )
      pathwayDetailElement.removeEventListener(
        'transitionend',
        handleOverlayTransitionEnd
      )
    }
    pathwayDetailClosing = true
    root.classList.add('is-pathway-detail-closing')
    closingLabel?.classList.remove('is-detail-card')
    closingLabel?.classList.add('is-detail-returning')
    pathwayDetailCloseTimer = window.setTimeout(
      finishCloseFallback,
      PATHWAY_DETAIL_TRANSITION_MS + 160
    )
  }

  function handlePathwayDetailPointerEvent(event) {
    event.stopPropagation()
  }

  function handlePathwayDetailClick(event) {
    event.preventDefault()
    event.stopPropagation()
    closePathwayDetail()
  }

  function handlePathwayDetailKeyDown(event) {
    if (event.key !== 'Escape') return
    event.preventDefault()
    event.stopPropagation()
    closePathwayDetail()
  }

  root.addEventListener('click', handleClick, { signal })
  root.addEventListener('pointerdown', handlePointerDown, { signal })
  root.addEventListener('pointermove', handlePointerMove, { signal })
  root.addEventListener('pointerup', event => {
    finishComponentInspection(event)
    finishDrag(event)
  }, { signal })
  root.addEventListener('pointercancel', event => {
    finishComponentInspection(event)
    finishDrag(event, true)
  }, { signal })
  root.addEventListener('lostpointercapture', event => {
    finishComponentInspection(event)
    finishDrag(event, true)
  }, { signal })
  pathwaysGuidanceElement.addEventListener(
    'pointerdown',
    handlePathwaysGuidancePointerEvent,
    { signal }
  )
  pathwaysGuidanceElement.addEventListener(
    'click',
    handlePathwaysGuidanceClick,
    { signal }
  )
  pathwayDetailElement.addEventListener(
    'pointerdown',
    handlePathwayDetailPointerEvent,
    { signal }
  )
  pathwayDetailElement.addEventListener('click', handlePathwayDetailClick, { signal })
  pathwayDetailElement.addEventListener('keydown', handlePathwayDetailKeyDown, { signal })

  const sceneHosts = {
    host: modelStage,
    componentHosts: Object.fromEntries(
      [...root.querySelectorAll('[data-majorana-component-model]')].map(componentHost => [
        componentHost.dataset.majoranaComponentModel,
        componentHost
      ])
    ),
    schematicComponentHosts: Object.fromEntries(
      [...root.querySelectorAll('[data-majorana-schematic-model]')].map(componentHost => [
        componentHost.dataset.majoranaSchematicModel,
        componentHost
      ])
    ),
    pathwaysComponentHosts: Object.fromEntries(
      [...root.querySelectorAll('[data-majorana-pathways-model]')].map(componentHost => [
        componentHost.dataset.majoranaPathwaysModel,
        componentHost
      ])
    ),
    buildComponentHosts: Object.fromEntries(
      [...root.querySelectorAll('[data-majorana-build-model]')].map(componentHost => [
        componentHost.dataset.majoranaBuildModel,
        componentHost
      ])
    )
  }

  function markComponentsReady() {
    if (!disposed) root.classList.add('has-component-models')
  }

  function markSceneReady(partsFound = {}) {
    if (disposed) return
    loadingPanel.classList.add('is-complete')
    modelStage.classList.add('is-ready')
    startButton.disabled = false
    root.dispatchEvent(new CustomEvent('majorana:scene-ready', { bubbles: true }))
    if (!partsFound['qpu-stack']?.length || !partsFound['cryo-cmos']?.length) {
      console.warn('Majorana model loaded without all expected named assemblies.', partsFound)
    }
  }

  Promise.resolve(options.sceneStartPromise).then(async () => {
    if (disposed) return null

    if (options.majoranaSceneController) {
      const controller = options.majoranaSceneController
      const attachment = controller.attachToModule({
        ...sceneHosts,
        onComponentsReady: markComponentsReady
      })
      // Do not enable Start while the two component renderers are still warming.
      await attachment.componentsReady
      markSceneReady(attachment.partsFound)
      return controller
    }

    return createMajoranaScene({
      ...sceneHosts,
      signal,
      onActivity: activity,
      onProgress: (ratio, loadedBytes) => {
        if (disposed) return
        progressLabel.textContent = ratio == null
          ? `${Math.max(1, Math.round(loadedBytes / 1_000_000))} MB loaded…`
          : `${Math.min(100, Math.round(ratio * 100))}%`
      },
      onReady: ({ partsFound }) => markSceneReady(partsFound),
      onComponentsReady: markComponentsReady
    })
  }).then(controller => {
    if (!controller) return
    if (disposed) {
      controller.dispose()
      return
    }
    sceneController = controller
    const view = currentView()
    syncSceneView(view, { force: true })
    syncSceneComponentPresentation(view)
  }).catch(error => {
    if (disposed || error?.name === 'AbortError') return
    options.majoranaSceneController?.dispose()
    root.dispatchEvent(new CustomEvent('majorana:scene-error', {
      bubbles: true,
      detail: { error }
    }))
    console.error('Majorana 2 model failed to load.', error)
    loadingPanel.classList.add('has-error')
    loadingPanel.querySelector('strong').textContent = '3D model unavailable'
    progressLabel.textContent = 'Restart the module to try loading it again.'
  })

  function dispose() {
    if (disposed) return
    disposed = true
    cancelSectionTransition({ activateDestination: false })
    cancelPendingBuildSnap()
    clearBuildDragFrame()
    clearBuildTiltTimer()
    if (drag) drag.pendingSamples.length = 0
    pathwaysGuidance.dispose()
    buildGuidance.dispose()
    lifecycle.abort()
    returnTimers.forEach(timerId => window.clearTimeout(timerId))
    returnTimers.clear()
    clearPathwayDetailCloseWait()
    restorePathwayTooltip()
    clearComponentsSequence()
    stopPathwaysTimeline()
    resetComponentInspection()
    stageAnimation?.cancel()
    upNextBanner?.dispose()
    sharedExplainers.forEach(disposeKioskExplainer)
    finale.dispose()
    sceneController?.dispose()
    if (root.parentElement === container) root.remove()
  }

  if (parentSignal?.aborted) dispose()
  else parentSignal?.addEventListener('abort', dispose, { once: true })

  render()
  return dispose
}

export default mount
