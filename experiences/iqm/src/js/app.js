import { waitForTask, taskTimeout } from './core/abortable-task.js'
import { IdleController } from './core/idle-controller.js'
import {
  armIdleController,
  rearmIdleController,
  routeIdle
} from './core/idle-navigation.js'
import { assetUrl } from './core/asset-url.js'
import { mountAuroraBackgrounds } from './core/aurora-background.js'
import { imperfectionParams, setImperfection } from './core/surface-imperfection.js'
import { getLightRigs, lightRigsVersion } from './core/light-rig-registry.js'
import { playMajoranaPortalTransition } from './core/experience-portal.js'
import { ModuleCarousel } from './core/module-carousel.js'
import { buildShapeScene } from './core/module-shape-scenes.js'
import { createShapeScenePool, hasShapeScene } from './core/shape-scene-3d.js'
import { initAudio, sound, startAmbient, stopAmbient } from './core/kiosk-audio.js'
import { installPressBloom } from './core/press-bloom.js'
import { installButtonTapSound } from './core/button-tap-sound.js'
import { createKioskSettings } from './core/kiosk-settings.js'
import { configureIdleTimeouts } from './core/idle-timeouts.js'
import { splitTextForReveal } from './core/text-reveal.js'
import { ModuleHost } from './core/module-host.js'
import { ScreenRouter } from './core/screen-router.js'
import { StageScaler } from './core/stage-scaler.js'
import { createMajoranaScene } from './modules/build-majorana-2/majorana-scene.js'
import { getModule, isPlayable, MODULE_CATEGORIES, MODULES } from './modules/module-registry.js'

/* Whether the dev dock was left collapsed, so a reload doesn't drop it back over
   whatever card was being reviewed. */
const DEVELOPMENT_HUD_COLLAPSED_KEY = 'iqm-kiosk:development-hud-collapsed'
const SCREEN_UNMOUNT_DELAY_MS = 400

/* Half of the menu's layout crossfade: the menu is dark for this long before
   the new layout is applied, then takes the same time to come back. Matches the
   .menu-body opacity transition in app.css. */
const MENU_LAYOUT_FADE_MS = 200

/* Kept in step with config/kiosk.config.json — this only applies if that file
   cannot be read, and a visitor-facing timeout should not change because of it. */
const fallbackConfig = {
  design: { width: 2160, height: 3840 },
  development: {
    idleReturnToMenuMs: 600000,
    idleReturnToHomeMs: 600000,
    showHud: false
  },
  kiosk: { idleReturnToMenuMs: 120000, idleReturnToHomeMs: 120000 }
}

/*
 * The CSS shapes are the no-WebGL fallback, not a loading state. They used to
 * paint as soon as the card was built and only leave once the 3D pool resolved,
 * which flashed a purple sphere across cards whose real preview is a cryostat or
 * an ice block. They stay hidden now until the pool is known not to be coming.
 */
function revealCssShapeFallback(hosts) {
  for (const host of hosts) host.element.dataset.shapeFallback = 'shown'
}

function createModuleCard(module, moduleCountLabel) {
  const category = MODULE_CATEGORIES[module.category]
  const button = document.createElement('button')
  button.className = 'module-card'
  button.type = 'button'
  button.dataset.moduleId = module.id
  button.dataset.moduleNumber = module.number
  button.dataset.moduleStatus = isPlayable(module) ? 'interactive' : 'concept'
  button.dataset.moduleTitle = module.title
  button.setAttribute('aria-label', module.placeholder
    ? `Module ${module.number}: ${module.title}, coming soon`
    : `Open module ${module.number}: ${module.title}`)
  if (module.placeholder) button.setAttribute('aria-disabled', 'true')

  /* A slot whose module is still in production carries its FPO mark rather than
     a generated shape: the shape pool would give it an abstract sphere, which is
     the reason the previous placeholder was pulled from the carousel. */
  const previewImage = module.preview?.kind !== 'video' && module.preview
    ? `<img class="module-card__preview-image" src="${assetUrl(module.preview.src)}" alt="${module.preview.alt || ''}">`
    : ''
  const preview = module.placeholder
    ? `<span class="module-card__preview-fpo" aria-hidden="true">FPO</span>`
    : module.preview?.kind === 'video'
      ? `<span class="module-card__preview-portal" data-carousel-preview-motion aria-hidden="true">
          <video class="module-card__preview-video" src="${assetUrl(module.preview.src)}" loop muted playsinline preload="metadata" disablepictureinpicture></video>
        </span>`
    : module.preview?.swing
      ? `<span class="module-card__preview-swing" data-carousel-preview-motion>
          ${previewImage}
        </span>`
    : module.preview
      ? previewImage
    : `
      <span class="module-card__preview-placeholder" aria-hidden="true">
        <span class="module-card__preview-label">Module preview</span>
        <span class="module-card__preview-number">${module.number}</span>
      </span>
    `
  const navigationGrid = module.preview?.grid
    ? '<span class="module-card__shape-scene" data-navigation-grid-only aria-hidden="true"></span>'
    : ''
  const livePreview = module.preview3d?.kind === 'majorana'
    ? '<span class="module-card__3d-host" data-majorana-menu-preview aria-hidden="true"></span>'
    : ''

  button.innerHTML = `
    <span class="module-card__visual" data-has-preview="${Boolean(module.preview)}" data-preview-layout="${module.preview?.layout || 'full'}">
      ${navigationGrid}
      ${preview}
      ${livePreview}
    </span>
    <span class="module-card__content">
      <span class="module-card__copy">
        <h3>${module.titleHtml || module.title}</h3>
        <span class="module-card__summary">${module.summary}</span>
      </span>
      <span class="module-card__footer">
        <span class="module-card__footer-label">${module.placeholder ? 'Coming soon' : 'Open experience'}</span>
        <span class="action-arrow" aria-hidden="true">
          <img src="${assetUrl('/assets/ui/principle-chevron.svg')}" alt="">
        </span>
      </span>
    </span>
  `

  if (!module.preview && !module.placeholder) {
    const visual = button.querySelector('.module-card__visual')
    if (buildShapeScene(visual, module.id, category.color)) {
      visual.querySelector('.module-card__preview-placeholder')?.remove()
    }
  }

  return button
}

export class KioskApp {
  constructor(root = document) {
    this.root = root
    this.runtime = window.kiosk || {}
    this.config = {
      ...fallbackConfig,
      ...this.runtime.config,
      design: { ...fallbackConfig.design, ...this.runtime.config?.design },
      development: { ...fallbackConfig.development, ...this.runtime.config?.development },
      kiosk: { ...fallbackConfig.kiosk, ...this.runtime.config?.kiosk }
    }
    const idleConfig = this.runtime.isKiosk ? this.config.kiosk : this.config.development
    configureIdleTimeouts({
      returnToMenuMs: idleConfig.idleReturnToMenuMs,
      returnToHomeMs: idleConfig.idleReturnToHomeMs
    })

    this.router = new ScreenRouter(root)
    this.stage = root.getElementById('kiosk-stage')
    this.menuScreen = root.querySelector('[data-screen="menu"]')
    this.moduleGrid = root.getElementById('module-grid')
    this.activeModuleId = null
    this.isOpeningExperience = false
    this.majoranaPreviewAbortController = null
    this.majoranaPreviewController = null
    this.majoranaPreviewPromise = null
    this.majoranaModulePreload = null
    this.quantumPrinciplesPreload = null
    this.nanoscaleModulePreload = null
    this.moduleUnmountTimer = null
    this.settings = null
    this.menuLayoutFadeTimer = null

    this.onActivity = this.onActivity.bind(this)

    this.moduleCarousel = new ModuleCarousel({
      currentLabel: root.getElementById('module-carousel-current'),
      nextButton: root.getElementById('module-carousel-next'),
      onActivity: this.onActivity,
      onOpen: moduleId => this.openModule(moduleId),
      pagination: root.getElementById('module-carousel-pagination'),
      previousButton: root.getElementById('module-carousel-previous'),
      root: root.getElementById('module-carousel'),
      track: this.moduleGrid,
      viewport: root.getElementById('module-carousel-viewport')
    })

    this.idleController = new IdleController({
      onIdle: () => this.onIdle()
    })

    this.moduleHost = new ModuleHost({
      root: root.getElementById('module-host'),
      onActivity: this.onActivity,
      navigate: {
        home: () => this.goHome(),
        menu: () => this.openMenu(),
        module: moduleId => this.openModule(moduleId)
      }
    })

    /* Dev convenience: console access to the app (hidden in kiosk mode). */
    if (!this.runtime.isKiosk) window.__kioskApp = this

    /* Full-stage vertical wipe used when entering a module. */
    this.screenWipe = document.createElement('div')
    this.screenWipe.className = 'screen-wipe'
    this.screenWipe.setAttribute('aria-hidden', 'true')
    this.stage.append(this.screenWipe)

    this.stageScaler = new StageScaler({
      stage: root.getElementById('kiosk-stage'),
      designWidth: this.config.design.width,
      designHeight: this.config.design.height,
      onScale: scale => this.updateDevelopmentHud(scale)
    })
  }

  start() {
    document.body.classList.toggle('is-kiosk', Boolean(this.runtime.isKiosk))
    this.auroraBackgrounds?.dispose()
    this.auroraBackgrounds = mountAuroraBackgrounds(this.root)
    this.renderModuleMenu()
    this.bindEvents()
    installPressBloom(this.root)
    installButtonTapSound(this.root)
    this.settings = createKioskSettings({
      root: this.root,
      onIdleTimeoutChange: () => this.onIdleTimeoutChange(),
      onLayoutChange: layout => this.applyMenuLayout(layout)
    })
    this.applyMenuLayout(this.settings?.layout ?? 'top', { animate: false })
    this.setupTextReveals()
    this.setupDevelopmentHud()
    this.stageScaler.start()
    this.router.show('attract')
    this.restoreDevelopmentView()
    void this.preloadMajoranaModule()
    void this.preloadQuantumPrinciplesModule()
    void this.preloadNanoscaleModule()
    void this.ensureShapeScenes()
    if (this.router.currentScreen !== 'module') {
      void this.ensureMajoranaMenuPreview()
    }
  }

  /* Dev-only: survive Vite full reloads without losing the current screen. */
  rememberDevelopmentView(screen, moduleId = null) {
    if (this.runtime.isKiosk) return
    try {
      window.sessionStorage.setItem('kiosk-dev-view', JSON.stringify({ screen, moduleId }))
    } catch {
      /* storage unavailable — ignore */
    }
  }

  restoreDevelopmentView() {
    if (this.runtime.isKiosk) return
    try {
      const saved = JSON.parse(window.sessionStorage.getItem('kiosk-dev-view') || 'null')
      if (saved?.screen === 'menu') {
        this.openMenu()
      } else if (saved?.screen === 'module' && getModule(saved.moduleId)) {
        this.majoranaPreviewController?.setSuspended(true)
        this.activateModule(getModule(saved.moduleId))
      }
    } catch {
      /* corrupt state — ignore */
    }
  }

  ensureShapeScenes() {
    if (this.shapeScenePoolPromise) return this.shapeScenePoolPromise

    const hosts = [...this.moduleGrid.querySelectorAll('.module-card__shape-scene')]
      .map(element => ({
        element,
        moduleId: element.closest('.module-card')?.dataset.moduleId,
        gridOnly: element.hasAttribute('data-navigation-grid-only')
      }))
      .filter(host => host.gridOnly || hasShapeScene(host.moduleId))
    if (!hosts.length) return Promise.resolve(null)

    this.shapeScenePoolPromise = createShapeScenePool({
      hosts,
      onActivity: this.onActivity,
      isVisible: () =>
        this.router.currentScreen === 'menu' ||
        this.menuScreen.classList.contains('is-leaving')
    }).then(pool => {
      if (pool) {
        for (const host of hosts) {
          host.element.querySelectorAll('.ss').forEach(shape => shape.remove())
        }
        /* The pool does not draw until the menu is on screen, so without this
           the first menu frame pays for every shader link and texture upload at
           once — which is the stutter leaving the attract screen. Warming here
           spends it while the attract screen is still up. Not awaited: the menu
           must not wait on an optimisation. */
        void pool.warmUp?.()
      } else {
        revealCssShapeFallback(hosts)
      }
      return pool
    }).catch(error => {
      console.warn('3D shape scenes unavailable, keeping CSS fallback.', error)
      revealCssShapeFallback(hosts)
      return null
    })

    return this.shapeScenePoolPromise
  }

  setupTextReveals() {
    let wordIndex = 0
    for (const segment of this.root.querySelectorAll('.screen--attract .attract-copy h1 > span')) {
      wordIndex = splitTextForReveal(segment, { startIndex: wordIndex })
    }
  }

  renderModuleMenu() {
    const moduleCountLabel = String(MODULES.length).padStart(2, '0')
    const fragment = document.createDocumentFragment()
    MODULES.forEach(module => fragment.append(createModuleCard(module, moduleCountLabel)))
    this.moduleGrid.replaceChildren(fragment)
    this.root.getElementById('module-carousel-total').textContent = moduleCountLabel
    this.moduleCarousel.mount(this.moduleGrid.children)
  }

  bindEvents() {
    this.root.getElementById('start-button').addEventListener('click', () => this.openMenu())

    this.root.addEventListener('click', event => {
      const action = event.target.closest('[data-action]')?.dataset.action
      if (action === 'home') this.goHome()
      if (action === 'menu') this.openMenu()
    })

    document.addEventListener('pointerdown', () => {
      initAudio()
      startAmbient()
    }, true)

    document.addEventListener('contextmenu', event => event.preventDefault())
    document.addEventListener('dragstart', event => event.preventDefault())

    window.addEventListener('keydown', event => {
      if (event.key !== 'Escape') return
      if (this.settings?.isOpen()) {
        this.settings.close()
        return
      }
      if (!this.runtime.isKiosk) {
        this.router.currentScreen === 'module' ? this.openMenu() : this.goHome()
      }
    })
  }

  openMenu() {
    if (this.isOpeningExperience) return
    // Following the outro can advance through modules without touching the
    // carousel. Select the module being left before revealing the menu.
    const moduleIndex = MODULES.findIndex(module => module.id === this.activeModuleId)
    if (moduleIndex >= 0) this.moduleCarousel.setIndex(moduleIndex, { animate: false })
    this.activeModuleId = null
    this.majoranaPreviewController?.setSuspended(false)
    Promise.resolve(this.shapeScenePoolPromise).then(pool => pool?.resetDive?.())
    this.router.show('menu')
    this.deferModuleUnmount()
    this.moduleCarousel.setActive(true)
    this.rememberDevelopmentView('menu')
    this.armIdle()
    void this.preloadMajoranaModule()
    void this.ensureMajoranaMenuPreview()
  }

  openModule(moduleId) {
    const module = getModule(moduleId)
    if (!module || this.isOpeningExperience) return
    /* Placeholder slots sit in the carousel so the run of eight reads as
       complete, but there is nothing behind them to mount. */
    if (!isPlayable(module)) return
    this.cancelDeferredModuleUnmount()
    this.moduleCarousel.setActive(false)

    if (module.preview3d?.kind === 'majorana') {
      this.moduleCarousel.markVisited(moduleId)
      sound.dive()
      void this.openMajoranaWithPortal(module)
      return
    }

    this.isOpeningExperience = true
    this.majoranaPreviewController?.setSuspended(true)
    this.moduleCarousel.markVisited(moduleId)
    sound.dive()

    /* Vertical wipe: cover the stage, mount the module underneath, then
       reveal it. The stage animates itself in once its content lands. */
    const waitForPresentationReady = module.waitForPresentationReady === true
    void this.runModuleWipe(() => {
      const activation = this.activateModule(module, {
        deferStageReveal: waitForPresentationReady,
        entryTransition: 'wipe'
      })
      return waitForPresentationReady ? activation : undefined
    }, {
      commitFrames: waitForPresentationReady ? 2 : 0
    }).catch(error => {
      console.error('Module transition failed.', error)
    }).finally(() => {
      this.isOpeningExperience = false
    })
  }

  runModuleWipe(onCovered, { commitFrames = 0 } = {}) {
    const wipe = this.screenWipe
    return new Promise(resolve => {
      wipe.classList.add('is-active', 'is-covering')
      window.setTimeout(async () => {
        try {
          /* Mount may include a module-specific presentation-ready barrier.
             Keep the fully opaque wipe in place until that contract settles. */
          await onCovered?.()
        } catch (error) {
          console.error('Module activation during wipe failed.', error)
        }
        if (commitFrames > 0) {
          /* A deferred stage was measurable but visibility:hidden during its
             warmup. Give Chromium covered frames to promote and composite its
             now-visible canvases before moving the wipe away. */
          await new Promise(resolve => {
            let frame = null
            const finish = () => {
              clearTimeout(deadline)
              if (frame !== null) cancelAnimationFrame(frame)
              resolve()
            }
            const deadline = setTimeout(finish, 250)
            let remaining = commitFrames
            const commit = () => {
              remaining -= 1
              if (remaining <= 0) finish()
              else frame = requestAnimationFrame(commit)
            }
            frame = requestAnimationFrame(commit)
          })
        }
        wipe.classList.remove('is-covering')
        wipe.classList.add('is-revealing')
        window.setTimeout(() => {
          wipe.classList.remove('is-active', 'is-revealing')
          resolve()
        }, 560)
      }, 560)
    })
  }

  activateModule(module, mountContext = {}) {
    if (!module) return null
    this.cancelDeferredModuleUnmount()
    this.moduleCarousel.setActive(false)

    const category = MODULE_CATEGORIES[module.category]
    const resolvedMountContext = {
      deferStageReveal: module.waitForPresentationReady === true,
      ...mountContext,
      runtime: this.runtime
    }
    this.activeModuleId = module.id
    this.router.show('module')
    this.rememberDevelopmentView('module', module.id)
    this.armIdle()
    return this.moduleHost.mount({
      ...module,
      categoryLabel: category.label,
      accent: category.color
    }, resolvedMountContext)
  }

  cancelDeferredModuleUnmount() {
    if (this.moduleUnmountTimer === null) return
    window.clearTimeout(this.moduleUnmountTimer)
    this.moduleUnmountTimer = null
  }

  deferModuleUnmount() {
    this.cancelDeferredModuleUnmount()
    /* Screens fade for 360 ms. Keep the outgoing module alive through that
       interval so its WebGL surfaces fade as part of the screen, then free it. */
    this.moduleUnmountTimer = window.setTimeout(() => {
      this.moduleUnmountTimer = null
      if (this.router.currentScreen !== 'module') this.moduleHost.unmount()
    }, SCREEN_UNMOUNT_DELAY_MS)
  }

  preloadMajoranaModule() {
    if (this.majoranaModulePreload) return this.majoranaModulePreload
    const module = getModule('build-majorana-2')
    this.majoranaModulePreload = module?.load?.().catch(error => {
      this.majoranaModulePreload = null
      console.warn('Majorana module preload failed.', error)
      return null
    }) || Promise.resolve(null)
    return this.majoranaModulePreload
  }

  preloadQuantumPrinciplesModule() {
    if (this.quantumPrinciplesPreload) return this.quantumPrinciplesPreload
    const module = getModule('quantum-vs-classical')
    this.quantumPrinciplesPreload = module?.load?.()
      .then(moduleExports => moduleExports.preload?.())
      .catch(error => {
        this.quantumPrinciplesPreload = null
        console.warn('Quantum principle preview preload failed.', error)
        return null
      }) || Promise.resolve(null)
    return this.quantumPrinciplesPreload
  }

  preloadNanoscaleModule() {
    if (this.nanoscaleModulePreload) return this.nanoscaleModulePreload
    const module = getModule('nanoscale')
    this.nanoscaleModulePreload = module?.load?.()
      .then(moduleExports => moduleExports.preload?.())
      .catch(error => {
        this.nanoscaleModulePreload = null
        console.warn('Nanoscale image preload failed.', error)
        return null
      }) || Promise.resolve(null)
    return this.nanoscaleModulePreload
  }

  ensureMajoranaPreviewHost(card) {
    let host = card?.querySelector('[data-majorana-menu-preview]')
    if (host) return host
    const visual = card?.querySelector('.module-card__visual')
    if (!visual) return null
    host = document.createElement('span')
    host.className = 'module-card__3d-host'
    host.dataset.majoranaMenuPreview = ''
    host.setAttribute('aria-hidden', 'true')
    visual.append(host)
    return host
  }

  ensureMajoranaMenuPreview() {
    if (this.majoranaPreviewPromise) return this.majoranaPreviewPromise
    const card = this.moduleGrid.querySelector('[data-module-id="build-majorana-2"]')
    const host = this.ensureMajoranaPreviewHost(card)
    if (!card || !host) return Promise.resolve(null)

    const abortController = new AbortController()
    card.classList.add('is-preview-warming')
    card.classList.remove('has-live-preview', 'is-preview-unavailable')
    this.majoranaPreviewAbortController = abortController
    const deadline = setTimeout(() => abortController.abort(taskTimeout('Majorana preview timed out.')), 30000)
    this.majoranaPreviewPromise = waitForTask(createMajoranaScene({
      host,
      signal: abortController.signal,
      navigationPreview: true,
      onActivity: this.onActivity,
      onReady: () => {
        if (abortController.signal.aborted) return
        card.classList.remove('is-preview-warming', 'is-preview-unavailable')
        card.classList.add('has-live-preview')
      }
    }), abortController.signal, controller => controller.dispose()).finally(() => clearTimeout(deadline)).then(controller => {
      if (abortController.signal.aborted) {
        controller.dispose()
        return null
      }
      this.majoranaPreviewController = controller
      window.requestAnimationFrame(() => {
        if (
          this.majoranaPreviewController === controller &&
          this.router.currentScreen !== 'menu'
        ) {
          controller.setSuspended(true)
        }
      })
      return controller
    }).catch(error => {
      if (error?.name !== 'AbortError') {
        console.warn('Majorana menu preview could not be loaded.', error)
      }
      if (this.majoranaPreviewAbortController === abortController) {
        this.majoranaPreviewAbortController = null
        this.majoranaPreviewPromise = null
        card.classList.remove('has-live-preview', 'is-preview-warming')
        card.classList.add('is-preview-unavailable')
      }
      return null
    })

    return this.majoranaPreviewPromise
  }

  disposeMajoranaMenuPreview() {
    this.majoranaPreviewAbortController?.abort()
    this.majoranaPreviewController?.dispose()
    this.majoranaPreviewAbortController = null
    this.majoranaPreviewController = null
    this.majoranaPreviewPromise = null
    this.moduleGrid
      .querySelector('[data-module-id="build-majorana-2"]')
      ?.classList.remove('has-live-preview', 'is-preview-warming', 'is-preview-unavailable')
  }

  releaseMajoranaMenuPreview() {
    this.majoranaPreviewAbortController = null
    this.majoranaPreviewController = null
    this.majoranaPreviewPromise = null
    this.moduleGrid
      .querySelector('[data-module-id="build-majorana-2"]')
      ?.classList.remove('has-live-preview', 'is-preview-warming', 'is-preview-unavailable')
  }

  async openMajoranaWithPortal(module) {
    const card = this.moduleGrid.querySelector('[data-module-id="build-majorana-2"]')
    const previewHost = this.ensureMajoranaPreviewHost(card)
    const sourceElement = previewHost
    if (!card || !sourceElement || !previewHost) {
      this.disposeMajoranaMenuPreview()
      this.activateModule(module)
      return
    }

    this.isOpeningExperience = true
    void this.preloadMajoranaModule()

    let startScene = null
    let removeReadyListener = () => {}
    let handoffScene = null
    let prepared = false
    let previewTransferred = false

    try {
      card.classList.add('is-preparing-entry')
      const previewController = await this.ensureMajoranaMenuPreview()
      card.classList.remove('is-preparing-entry')
      if (!previewController) {
        this.disposeMajoranaMenuPreview()
        await this.activateModule(module)
        return
      }

      await playMajoranaPortalTransition({
        stage: this.stage,
        menuScreen: this.menuScreen,
        sourceElement,
        sceneController: previewController,
        prepare: async () => {
          const sceneReady = new Promise((resolve, reject) => {
            const moduleHost = this.root.getElementById('module-host')
            const handleReady = () => resolve(performance.now())
            const handleError = event => reject(
              event.detail?.error || new Error('The shared Majorana scene could not be attached.')
            )
            moduleHost.addEventListener('majorana:scene-ready', handleReady, { once: true })
            moduleHost.addEventListener('majorana:scene-error', handleError, { once: true })
            removeReadyListener = () => {
              moduleHost.removeEventListener('majorana:scene-ready', handleReady)
              moduleHost.removeEventListener('majorana:scene-error', handleError)
            }
          })
          // Observe early scene errors while mount is still preparing the handoff.
          void sceneReady.catch(() => {})
          const sceneStartPromise = new Promise(resolve => {
            startScene = resolve
          })
          const category = MODULE_CATEGORIES[module.category]
          this.activeModuleId = module.id
          this.armIdle()
          const mountResult = await this.moduleHost.mount({
            ...module,
            categoryLabel: category.label,
            accent: category.color
          }, {
            entryTransition: 'portal',
            sceneStartPromise,
            majoranaSceneController: previewController,
            runtime: this.runtime
          })
          if (mountResult.status !== 'active') throw mountResult.error || new Error('Majorana preparation was interrupted.')
          prepared = true
          let handoffPromise = null
          handoffScene = () => {
            if (!handoffPromise) {
              startScene?.()
              handoffPromise = sceneReady.then(readyAt => {
                previewTransferred = true
                return readyAt
              })
            }
            return handoffPromise
          }
          return {
            destinationElement: this.root.querySelector('.majorana-model-slot--intro'),
            sceneReady,
            handoffScene
          }
        },
        reveal: () => this.router.show('module')
      })
    } catch (error) {
      console.error('Majorana portal transition failed.', error)
      if (!prepared) {
        this.disposeMajoranaMenuPreview()
        await this.activateModule(module)
      } else {
        startScene?.()
        // The preview belongs to this failed portal; retry builds a fresh scene.
        this.moduleHost.reportError(error, { runtime: this.runtime })
        this.router.show('module')
      }
    } finally {
      card.classList.remove('is-preparing-entry')
      removeReadyListener()
      if (previewTransferred) this.releaseMajoranaMenuPreview()
      else this.disposeMajoranaMenuPreview()
      if (prepared) {
        const majoranaRoot = this.root.querySelector('[data-majorana-root].is-portal-entry')
        window.requestAnimationFrame(() => {
          window.requestAnimationFrame(() => {
            if (majoranaRoot?.isConnected) {
              majoranaRoot.classList.add('is-portal-entry-complete')
            }
          })
        })
      }
      this.isOpeningExperience = false
      void this.ensureMajoranaMenuPreview()
    }
  }

  goHome() {
    if (this.isOpeningExperience) return
    this.moduleCarousel.setActive(false)
    this.majoranaPreviewController?.setSuspended(true)
    this.activeModuleId = null
    this.settings?.close()
    this.idleController.stop()
    stopAmbient()
    this.router.show('attract')
    this.deferModuleUnmount()
    this.rememberDevelopmentView('attract')
  }

  onActivity() {
    this.idleController.reset()
  }

  armIdle() {
    armIdleController(this.idleController, this.activeModuleId)
  }

  onIdle() {
    routeIdle({
      activeModuleId: this.activeModuleId,
      goHome: () => this.goHome(),
      idleController: this.idleController,
      isOpeningExperience: this.isOpeningExperience,
      openMenu: () => this.openMenu()
    })
  }

  onIdleTimeoutChange() {
    rearmIdleController(this.idleController, this.activeModuleId)
  }

  /* Top and Center move the artwork, the copy, the CTA and the dots all at
     once, so the menu crossfades rather than animating a dozen positions past
     each other. Off the menu screen there is nothing to see, so the swap lands
     immediately. */
  applyMenuLayout(layout, { animate = true } = {}) {
    if (this.stage.dataset.layout === layout) return

    const menuBody = this.root.querySelector('.screen--menu .menu-body')
    const canFade = animate &&
      menuBody &&
      this.router.currentScreen === 'menu' &&
      !window.matchMedia?.('(prefers-reduced-motion: reduce)').matches

    if (!canFade) {
      this.stage.dataset.layout = layout
      return
    }

    window.clearTimeout(this.menuLayoutFadeTimer)
    menuBody.classList.add('is-relayouting')
    this.menuLayoutFadeTimer = window.setTimeout(() => {
      this.stage.dataset.layout = layout
      menuBody.classList.remove('is-relayouting')
      this.menuLayoutFadeTimer = null
    }, MENU_LAYOUT_FADE_MS)
  }

  setupDevelopmentHud() {
    const hud = this.root.getElementById('development-hud')
    /* Off unless development.showHud is switched on in kiosk.config.json, and
       even then only in Electron dev mode or when served straight into a
       browser. */
    hud.hidden = !this.config.development.showHud ||
      (!this.runtime.isDevelopment && 'platform' in this.runtime)
    this.stage.classList.toggle('has-development-hud', !hud.hidden)
    this.root.getElementById('development-resolution').textContent =
      `${this.config.design.width} × ${this.config.design.height}`
    if (!hud.hidden) {
      this.startFpsMeter()
      this.setupMaterialPanel()
      this.setupDevelopmentHudToggle(hud)
    }
  }

  /* The dock sits over the bottom of the kiosk, which is exactly where a
     screenshot of a card wants to be clean. Collapsing it to a small chip keeps
     it one click away instead of gone until reload, and the choice is
     remembered so a reload doesn't put it back over the design. */
  setupDevelopmentHudToggle(hud) {
    const toggle = document.createElement('button')
    toggle.id = 'development-hud-toggle'
    toggle.className = 'development-hud__toggle'
    toggle.type = 'button'
    hud.append(toggle)

    const apply = collapsed => {
      hud.dataset.collapsed = String(collapsed)
      /* The panel is a separate fixed element, so hiding the dock has to take it
         along or a headless slider stack is left floating over the kiosk. */
      if (collapsed) this.closeMaterialPanel?.()
      toggle.textContent = collapsed ? 'DEV' : '×'
      toggle.title = collapsed ? 'Show the dev dock' : 'Hide the dev dock'
      toggle.setAttribute('aria-label', toggle.title)
      toggle.setAttribute('aria-pressed', String(collapsed))
      /* The settings cog clears the dock by its measured height; re-run that
         with the new one. Layout has to settle first, hence the next frame. */
      window.requestAnimationFrame(() => this.updateDevelopmentHud(this.lastStageScale ?? 1))
    }

    let collapsed = false
    try {
      collapsed = window.localStorage.getItem(DEVELOPMENT_HUD_COLLAPSED_KEY) === 'true'
    } catch { /* Private-mode storage refusals must not cost us the dock. */ }
    apply(collapsed)

    toggle.addEventListener('click', () => {
      collapsed = hud.dataset.collapsed !== 'true'
      apply(collapsed)
      try {
        window.localStorage.setItem(DEVELOPMENT_HUD_COLLAPSED_KEY, String(collapsed))
      } catch { /* Same: the toggle still works for this session. */ }
    })
  }

  /* Dev-only: live material tuning for the 3D nav scenes plus per-light
     controls for any module scene currently on screen. The toggle lives in
     the compact dev dock; the full panel opens above it. */
  setupMaterialPanel() {
    const hud = this.root.getElementById('development-hud')
    const button = document.createElement('button')
    button.id = 'development-materials'
    button.className = 'development-hud__materials'
    button.type = 'button'
    button.textContent = 'Materials'
    button.setAttribute('aria-controls', 'development-material-panel')
    button.setAttribute('aria-expanded', 'false')
    button.setAttribute('aria-haspopup', 'dialog')
    hud.append(button)

    const panel = document.createElement('div')
    panel.id = 'development-material-panel'
    panel.className = 'development-material-panel'
    panel.hidden = true
    panel.setAttribute('aria-label', 'Material settings')
    panel.setAttribute('role', 'dialog')
    document.body.append(panel)

    const positionPanel = () => {
      if (panel.hidden) return
      const viewportPadding = 12
      const panelGap = 8
      /* Keep the tuning helper secondary to the rendered product. A compact,
         internally scrolling panel leaves the Majorana model visible while
         the user adjusts its finish on the Get Started screen. */
      const panelHeightCap = Math.min(320, window.innerHeight * 0.36)

      /* Prefer the empty gutter beside the kiosk strip so the panel never
         covers the kiosk itself; fall back over the stage when the window
         is too narrow to have one. */
      const stageRect = this.stage.getBoundingClientRect()
      const gutter = window.innerWidth - stageRect.right
      const panelWidth = panel.offsetWidth || 380
      if (gutter >= panelWidth + (viewportPadding * 2)) {
        panel.style.right = `${Math.max(
          viewportPadding,
          window.innerWidth - stageRect.right - viewportPadding - panelWidth
        )}px`
        panel.style.bottom = `${viewportPadding}px`
        panel.style.maxHeight = `${Math.max(
          80,
          Math.min(panelHeightCap, window.innerHeight - (viewportPadding * 2))
        )}px`
        return
      }

      const triggerRect = button.getBoundingClientRect()
      const hudRect = hud.getBoundingClientRect()
      panel.style.right =
        `${Math.max(viewportPadding, window.innerWidth - triggerRect.right)}px`
      panel.style.bottom =
        `${Math.max(viewportPadding, window.innerHeight - hudRect.top + panelGap)}px`
      panel.style.maxHeight = `${Math.max(
        80,
        Math.min(panelHeightCap, hudRect.top - panelGap - viewportPadding)
      )}px`
    }
    this.positionMaterialPanel = positionPanel
    this.closeMaterialPanel = () => {
      if (panel.hidden) return
      panel.hidden = true
      button.setAttribute('aria-expanded', 'false')
    }
    window.addEventListener('resize', positionPanel, { passive: true })
    window.addEventListener('keydown', event => {
      if (event.key !== 'Escape' || panel.hidden) return
      panel.hidden = true
      button.setAttribute('aria-expanded', 'false')
      button.focus()
    })

    let renderedModuleId = null
    let renderedRigsVersion = lightRigsVersion()
    button.addEventListener('click', async () => {
      /* No pool (CSS-fallback menu) still opens the panel: module scenes
         register light rigs independently of the carousel. */
      const pool = await Promise.resolve(this.shapeScenePoolPromise)
      const opening = panel.hidden
      panel.hidden = !opening
      button.setAttribute('aria-expanded', String(opening))
      if (opening) {
        positionPanel()
        renderedModuleId = pool?.getCenter().moduleId ?? null
        renderedRigsVersion = lightRigsVersion()
        this.buildMaterialPanel(panel, pool)
      }
    })

    /* Follow the app: re-render for whichever card is centred, and whenever
       a module scene registers or drops a light rig. */
    window.setInterval(async () => {
      if (panel.hidden) return
      const pool = await Promise.resolve(this.shapeScenePoolPromise)
      const centerId = pool?.getCenter().moduleId ?? null
      if (centerId !== renderedModuleId || lightRigsVersion() !== renderedRigsVersion) {
        renderedModuleId = centerId
        renderedRigsVersion = lightRigsVersion()
        this.buildMaterialPanel(panel, pool)
      }
    }, 600)
  }

  buildMaterialPanel(panel, pool) {
    panel.replaceChildren()
    const center = pool?.getCenter()

    const addSection = (title, host = panel) => {
      const heading = document.createElement('div')
      heading.textContent = title
      heading.style.cssText =
        'margin: 10px 0 4px; color: #7ef2a5; font-weight: 700; text-transform: uppercase'
      host.append(heading)
    }
    const addRow = (label, control, readout, host = panel) => {
      const row = document.createElement('label')
      row.className = 'development-material-panel__row'
      row.style.cssText = 'display: flex; align-items: center; gap: 8px; margin: 4px 0'
      const name = document.createElement('span')
      name.textContent = label
      name.title = label
      name.style.cssText = 'flex: 0 0 104px; overflow: hidden; text-overflow: ellipsis'
      row.append(name, control)
      if (readout) row.append(readout)
      host.append(row)
    }
    const addSlider = (label, value, min, max, step, apply, host = panel) => {
      const input = document.createElement('input')
      input.type = 'range'
      input.min = String(min)
      input.max = String(max)
      input.step = String(step)
      input.value = String(value)
      input.style.cssText = 'flex: 1; min-width: 0'
      const readout = document.createElement('input')
      readout.className = 'development-material-panel__value'
      readout.type = 'number'
      readout.min = String(min)
      readout.max = String(max)
      readout.step = String(step)
      readout.value = Number(value).toFixed(2)
      readout.setAttribute('aria-label', `${label} exact value`)
      const setValue = rawValue => {
        if (!Number.isFinite(rawValue)) return
        const nextValue = Math.min(max, Math.max(min, rawValue))
        input.value = String(nextValue)
        readout.value = nextValue.toFixed(2)
        apply(nextValue)
      }
      input.addEventListener('input', () => {
        setValue(input.valueAsNumber)
      })
      readout.addEventListener('input', () => {
        if (!Number.isFinite(readout.valueAsNumber)) return
        const nextValue = Math.min(max, Math.max(min, readout.valueAsNumber))
        input.value = String(nextValue)
        apply(nextValue)
      })
      readout.addEventListener('change', () => setValue(readout.valueAsNumber))
      readout.addEventListener('keydown', event => {
        if (event.key !== 'Enter') return
        setValue(readout.valueAsNumber)
        readout.blur()
      })
      addRow(label, input, readout, host)
    }
    const addColor = (label, value, apply, host = panel) => {
      const input = document.createElement('input')
      input.type = 'color'
      input.value = value
      input.style.cssText = 'flex: 1; height: 24px; border: 0; background: none; padding: 0'
      input.addEventListener('input', () => apply(input.value))
      addRow(label, input, null, host)
    }
    const addCheck = (label, checked, apply, host = panel) => {
      const input = document.createElement('input')
      input.type = 'checkbox'
      input.checked = checked
      input.style.cssText = 'flex: 0 0 auto; width: 16px; height: 16px; accent-color: #7ef2a5'
      input.addEventListener('change', () => apply(input.checked))
      addRow(label, input, null, host)
    }
    const addControlGroup = (label, open = false, host = panel) => {
      const group = document.createElement('details')
      group.className = 'development-material-panel__group'
      group.open = open
      const summary = document.createElement('summary')
      summary.textContent = label
      const body = document.createElement('div')
      body.className = 'development-material-panel__group-body'
      group.append(summary, body)
      host.append(group)
      return body
    }
    const addNote = (copy, host = panel) => {
      const note = document.createElement('p')
      note.className = 'development-material-panel__note'
      note.textContent = copy
      host.append(note)
    }
    const copyText = async copy => {
      if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(copy)
        return
      }
      const fallback = document.createElement('textarea')
      fallback.value = copy
      fallback.style.cssText = 'position: fixed; opacity: 0; pointer-events: none'
      document.body.append(fallback)
      fallback.select()
      const copied = document.execCommand('copy')
      fallback.remove()
      if (!copied) throw new Error('Clipboard copy was rejected.')
    }
    const addCopy = (label, getText, host = panel) => {
      const row = document.createElement('div')
      row.className = 'development-material-panel__action-row'
      const action = document.createElement('button')
      action.className = 'development-material-panel__action'
      action.type = 'button'
      action.textContent = label
      const status = document.createElement('span')
      status.className = 'development-material-panel__action-status'
      status.setAttribute('aria-live', 'polite')
      action.addEventListener('click', async () => {
        const copy = String(getText?.() ?? '')
        try {
          await copyText(copy)
          status.textContent = 'copied'
        } catch (error) {
          status.textContent = 'copy failed — see console'
          console.info('Tuning values:', copy, error)
        }
      })
      row.append(action, status)
      host.append(row)
    }

    const registeredRigs = getLightRigs()
    /* A rig with authored controls owns the panel for that live scene. This
       keeps dormant preview/detail rigs from burying the controls the author
       is actually using, while legacy light-only rigs still fall back to the
       automatic intensity/color/XYZ editor. */
    const authoredRigs = registeredRigs.filter(rig =>
      rig.showDefaultLightControls === false && rig.controls.length > 0)
    const liveRigs = authoredRigs.length > 0 ? authoredRigs : registeredRigs
    const title = document.createElement('div')
    title.textContent = liveRigs.length
      ? 'live module tuning'
      : center ? `scene: ${center.moduleId}` : 'module lights'
    title.style.cssText = 'margin: 2px 0 6px; color: #ffd479; font-weight: 700'
    panel.append(title)
    /* Live module rigs are the reason this panel is opened inside an
       experience, so keep them before the dormant carousel/material controls. */
    const liveRigHost = document.createElement('div')
    panel.append(liveRigHost)

    /* Framing controls for nav previews that expose them, so the circle and the
       slab inside it can be placed on the running kiosk rather than by editing
       constants and reloading. Absent for scenes without a navTuning object. */
    const navTuning = center ? pool?.getNavTuning(center.moduleId) : null
    const startAngle = center ? pool?.getStartAngleFor?.(center.moduleId) : null
    if (navTuning || Number.isFinite(startAngle)) {
      addSection('framing')
      /* The yaw the scene opens at. Separate from the tilts below: those pose the
         object inside its circle, this turns the whole diorama on its stage. */
      if (Number.isFinite(startAngle)) {
        addSlider('startAngle', startAngle, -Math.PI, Math.PI, 0.005, value =>
          pool.setStartAngleFor(center.moduleId, value))
      }
      for (const [key, [min, max]] of Object.entries(navTuning?.ranges ?? {})) {
        addSlider(key, navTuning.params[key], min, max, 0.005, value =>
          navTuning.apply({ [key]: value }))
      }
    }

    if (center) {
      addSection('material')
      for (const [key, min, max, step] of [
        ['alphaBase', 0, 1, 0.01],
        ['rim', 0, 3, 0.05],
        ['irid', 0, 1, 0.01],
        ['spec', 0, 3, 0.05],
        ['contrast', 0, 1.5, 0.01],
        ['diffuseMix', 0, 1, 0.01],
        ['shadowSide', 0, 1, 0.01],
        ['envWash', 0, 2, 0.01],
        ['grain', 0, 1, 0.01],
        ['gloss', 0, 1.5, 0.01]
      ]) {
        addSlider(key, center.materialParams[key], min, max, step, value =>
          pool.setMaterialFor(center.moduleId, { [key]: value }))
      }
      addColor('glossColor', center.materialParams.specColor, value =>
        pool.setMaterialFor(center.moduleId, { specColor: value }))
      addColor('rimColor', center.materialParams.rimColor, value =>
        pool.setMaterialFor(center.moduleId, { rimColor: value }))

      addSection('lights')
      for (const [key, min, max, step] of [
        ['dirX', -1, 1, 0.01],
        ['dirY', -1, 1, 0.01],
        ['dirZ', -1, 1, 0.01],
        ['keyIntensity', 0, 8, 0.05],
        ['hemiIntensity', 0, 2, 0.01]
      ]) {
        addSlider(key, center.lightParams[key], min, max, step, value =>
          pool.setLightsFor(center.moduleId, { [key]: value }))
      }
      addCheck('areaKey', center.lightParams.areaKey, value =>
        pool.setLightsFor(center.moduleId, { areaKey: value }))
      addSlider('areaSize', center.lightParams.areaSize, 0.5, 12, 0.1, value =>
        pool.setLightsFor(center.moduleId, { areaSize: value }))
      for (const key of ['keyX', 'keyY', 'keyZ']) {
        addSlider(key, center.lightParams[key], -10, 10, 0.1, value =>
          pool.setLightsFor(center.moduleId, { [key]: value }))
      }
      addColor('keyColor', center.lightParams.keyColor, value =>
        pool.setLightsFor(center.moduleId, { keyColor: value }))
      addColor('hemiSky', center.lightParams.hemiSky, value =>
        pool.setLightsFor(center.moduleId, { hemiSky: value }))
      addColor('hemiGround', center.lightParams.hemiGround, value =>
        pool.setLightsFor(center.moduleId, { hemiGround: value }))
      for (const [key, min, max, step] of [
        ['accent1Intensity', 0, 12, 0.05],
        ['accent1X', -6, 6, 0.05],
        ['accent1Y', -6, 6, 0.05],
        ['accent1Z', -6, 6, 0.05],
        ['accent2Intensity', 0, 12, 0.05],
        ['accent2X', -6, 6, 0.05],
        ['accent2Y', -6, 6, 0.05],
        ['accent2Z', -6, 6, 0.05],
        ['innerIntensity', 0, 4, 0.02]
      ]) {
        addSlider(key, center.lightParams[key], min, max, step, value =>
          pool.setLightsFor(center.moduleId, { [key]: value }))
      }
      for (const key of ['accent1Color', 'accent2Color', 'innerColor']) {
        addColor(key, center.lightParams[key], value =>
          pool.setLightsFor(center.moduleId, { [key]: value }))
      }

      if (center.hasBloch) {
        addSection('bloch sphere')
        for (const [key, min, max, step] of [
          ['glossStrength', 0, 1, 0.01],
          ['glossRoughness', 0, 1, 0.01],
          ['glossReflect', 0, 3, 0.05],
          ['shellRimAlpha', 0, 1, 0.01],
          ['shellFresnelPow', 1, 16, 0.1],
          ['ringOpacity', 0, 1, 0.01],
          ['ringBackOpacity', 0, 1, 0.01]
        ]) {
          addSlider(key, pool.blochParams[key], min, max, step, value =>
            pool.setBloch({ [key]: value }))
        }
        for (const key of ['coreColor', 'arrowColor']) {
          addColor(key, pool.blochParams[key], value => pool.setBloch({ [key]: value }))
        }
      }

      addSection('scene (global)')
      addSlider('exposure', pool.sceneParams.exposure, 0, 2.5, 0.01, value =>
        pool.setScene({ exposure: value }))
      addSlider('envIntensity', pool.sceneParams.envIntensity, 0, 1.5, 0.01, value =>
        pool.setScene({ envIntensity: value }))
      /* Black cards baked into the shared reflection map (never rendered
         directly): studio negative-fill for livelier gloss reflections. */
      for (const [key, min, max, step] of [
        ['flagCount', 0, 8, 1],
        ['flagSize', 1, 12, 0.1],
        ['flagDistance', 2, 12, 0.1],
        ['flagHeight', -4, 8, 0.1],
        ['flagAngle', 0, 360, 1],
        ['flagTilt', -90, 90, 1],
        ['envBlur', 0, 0.3, 0.005]
      ]) {
        addSlider(key, pool.sceneParams[key], min, max, step, value =>
          pool.setScene({ [key]: value }))
      }

      if (center.moduleId === 'states-of-matter') {
        /* One horizontal black flag, baked into this scene's env only. */
        addSection('ice flag')
        addCheck('enabled', pool.iceFlagParams.enabled, value =>
          pool.setIceFlag({ enabled: value }))
        for (const [key, min, max, step] of [
          ['width', 1, 20, 0.1],
          ['height', 0.2, 8, 0.1],
          ['distance', 2, 12, 0.1],
          ['elevation', -4, 8, 0.1],
          ['yaw', 0, 360, 1],
          ['pitch', -90, 90, 1]
        ]) {
          addSlider(key, pool.iceFlagParams[key], min, max, step, value =>
            pool.setIceFlag({ [key]: value }))
        }
      }

      addSection('ground (global)')
      for (const [key, min, max, step] of [
        ['sideRatio', 0.2, 1.2, 0.01],
        ['thicknessRatio', 0.002, 0.05, 0.001],
        ['heightRatio', 0, 0.3, 0.005]
      ]) {
        addSlider(key, pool.groundParams[key], min, max, step, value =>
          pool.setGround({ [key]: value }))
      }
    }

    /* Shared surface-imperfection field: one uniform set patched into every
       PBR material and the nav shaders, dialed live across the whole app. */
    addSection('imperfection (global)')
    for (const [key, min, max, step] of [
      ['master', 0, 4, 0.01],
      ['normalAmt', 0, 0.6, 0.005],
      ['normalScale', 2, 160, 1],
      ['roughAmt', 0, 2, 0.01],
      ['roughScale', 0.5, 160, 0.1],
      ['mottleAmt', 0, 0.8, 0.005],
      ['mottleScale', 0.5, 24, 0.1]
    ]) {
      addSlider(key, imperfectionParams[key], min, max, step, value =>
        setImperfection({ [key]: value }))
    }

    /* Module scenes (qubit explorer, majorana main + component details)
       register their light rigs; every light gets its own controls. */
    for (const rig of liveRigs) {
      addSection(rig.label || rig.id, liveRigHost)
      const changed = () => rig.onChange?.()
      let customControlHost = liveRigHost
      for (const control of rig.controls ?? []) {
        if (control.type === 'group') {
          customControlHost = addControlGroup(control.label, control.open, liveRigHost)
          continue
        }
        if (control.type === 'note') {
          addNote(control.text, customControlHost)
          continue
        }
        if (control.type === 'copy') {
          addCopy(control.label, control.getText, customControlHost)
          continue
        }
        if (control.type === 'color') {
          const value = control.getValue?.()
          if (typeof value !== 'string') continue
          addColor(control.label, value, value => {
            control.setValue?.(value)
            changed()
          }, customControlHost)
          continue
        }
        if (control.type === 'range') {
          const value = control.getValue?.()
          if (
            !Number.isFinite(value) ||
            !Number.isFinite(control.min) ||
            !Number.isFinite(control.max)
          ) continue
          addSlider(
            control.label,
            value,
            control.min,
            control.max,
            control.step ?? 0.01,
            value => {
              control.setValue?.(value)
              changed()
            },
            customControlHost
          )
        }
      }
      if (rig.showDefaultLightControls === false) continue
      for (const { name, light } of rig.lights) {
        const intensityMax = Math.max(8, Math.ceil(light.intensity * 1.5))
        addSlider(`${name} intensity`, light.intensity, 0, intensityMax, 0.05, value => {
          light.intensity = value
          changed()
        }, liveRigHost)
        if (light.isHemisphereLight) {
          addColor(`${name} sky`, `#${light.color.getHexString()}`, value => {
            light.color.set(value)
            changed()
          }, liveRigHost)
          addColor(`${name} ground`, `#${light.groundColor.getHexString()}`, value => {
            light.groundColor.set(value)
            changed()
          }, liveRigHost)
          continue
        }
        addColor(`${name} color`, `#${light.color.getHexString()}`, value => {
          light.color.set(value)
          changed()
        }, liveRigHost)
        for (const axis of ['x', 'y', 'z']) {
          addSlider(`${name} pos ${axis}`, light.position[axis], -15, 15, 0.1, value => {
            light.position[axis] = value
            changed()
          }, liveRigHost)
        }
      }
    }
  }

  startFpsMeter() {
    const label = document.createElement('span')
    label.id = 'development-fps'
    label.className = 'development-hud__fps'
    label.textContent = '-- fps'
    label.setAttribute('aria-hidden', 'true')
    this.root.getElementById('development-hud').append(label)

    let frames = 0
    let worstFrameMs = 0
    let windowStart = performance.now()
    let previousFrameAt = windowStart

    const tick = now => {
      frames += 1
      worstFrameMs = Math.max(worstFrameMs, now - previousFrameAt)
      previousFrameAt = now

      const elapsed = now - windowStart
      if (elapsed >= 500) {
        const fps = (frames * 1000) / elapsed
        const displayFps = Math.min(999, Math.round(fps))
        const worstMs = Math.min(9999, Math.round(worstFrameMs))
        label.textContent = `${displayFps} fps · worst ${worstMs}ms`
        label.style.color = fps >= 55 ? '#7ef2a5' : fps >= 30 ? '#ffd479' : '#ff8080'
        frames = 0
        worstFrameMs = 0
        windowStart = now
      }
      window.requestAnimationFrame(tick)
    }
    window.requestAnimationFrame(tick)
  }

  updateDevelopmentHud(scale) {
    /* Kept so collapsing the dock can re-measure without waiting for a resize. */
    this.lastStageScale = scale
    const scaleLabel = this.root.getElementById('development-scale')
    if (scaleLabel) scaleLabel.textContent = `${Math.round(scale * 100)}%`

    const hud = this.root.getElementById('development-hud')
    if (!hud || hud.hidden) return

    const stageRect = this.stage.getBoundingClientRect()
    const edgeGap = 12
    hud.style.right = `${Math.max(edgeGap, window.innerWidth - stageRect.right + edgeGap)}px`
    hud.style.bottom = `${Math.max(edgeGap, window.innerHeight - stageRect.bottom + edgeGap)}px`

    const safeScale = scale > 0 ? scale : 1
    const settingsBottom = Math.max(
      132,
      Math.ceil((edgeGap + hud.getBoundingClientRect().height + 12) / safeScale)
    )
    this.stage.style.setProperty('--development-settings-bottom', `${settingsBottom}px`)
    this.positionMaterialPanel?.()
  }
}
