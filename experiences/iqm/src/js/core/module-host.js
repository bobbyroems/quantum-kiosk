import { waitForTask, taskTimeout } from './abortable-task.js'

function noop() {}

function escapeHtml(value = '') {
  return String(value)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;')
}

function getMountFunction(moduleExports) {
  if (typeof moduleExports?.mount === 'function') return moduleExports.mount
  if (typeof moduleExports?.default?.mount === 'function') return moduleExports.default.mount
  if (typeof moduleExports?.default === 'function') return moduleExports.default

  throw new TypeError('Interactive modules must export a mount(container, context) function.')
}

function getDisposer(mountResult) {
  if (typeof mountResult === 'function') return mountResult
  if (typeof mountResult?.dispose === 'function') return () => mountResult.dispose()
  return noop
}

function getPresentationReady(mountResult) {
  return typeof mountResult?.presentationReady === 'function'
    ? mountResult.presentationReady
    : null
}

function runDisposer(disposer) {
  try {
    Promise.resolve(disposer?.()).catch(error => {
      console.error('Module disposal failed.', error)
    })
  } catch (error) {
    console.error('Module disposal failed.', error)
  }
}

function isAbortError(error) {
  return error?.name === 'AbortError'
}

/* A module whose code and media are already cached resolves in a few frames.
   Painting the "Preparing…" view for those reads as a flash between the wipe
   and the experience, so the view only appears once a load is slow enough to
   need explaining. */
const LOADING_VIEW_DELAY_MS = 260

export class DomModuleHostView {
  #conceptDisposer = null
  #conceptToken = 0

  constructor(root) {
    if (!root) throw new TypeError('Module host root is required.')
    this.root = root
  }

  #teardownConcept() {
    this.#conceptToken += 1
    const dispose = this.#conceptDisposer
    this.#conceptDisposer = null
    if (dispose) {
      try {
        dispose()
      } catch (error) {
        console.error('Concept scene disposal failed.', error)
      }
    }
  }

  clear() {
    this.#teardownConcept()
    this.root.removeAttribute('data-module-id')
    this.root.removeAttribute('data-module-state')
    this.root.removeAttribute('data-module-category')
    this.root.removeAttribute('data-module-scheme')
    this.root.replaceChildren()
  }

  showConcept(module) {
    this.#teardownConcept()
    this.root.dataset.moduleId = module.id
    this.root.dataset.moduleState = 'concept'
    this.root.dataset.moduleCategory = module.category || ''
    /* Which of the three band schemes this module runs; see module-host.css. */
    this.root.dataset.moduleScheme = module.scheme || 'purple'
    this.root.innerHTML = `
      <div class="module-host__scaffold">
        <article class="module-shell">
          <div class="module-heading">
            <p class="module-kicker">
              ${escapeHtml(module.number)} · ${escapeHtml(module.categoryLabel)}
            </p>
            <h2>${escapeHtml(module.title)}</h2>
            <p class="module-summary">${escapeHtml(module.summary)}</p>
          </div>

          <div class="interaction-placeholder">
            <div class="interaction-placeholder__scene" aria-hidden="true"></div>
            <div class="placeholder-label">
              <span>Concept module</span>
              <strong>${escapeHtml(module.interaction)}</strong>
            </div>
          </div>

          <div class="module-status">
            <span class="status-dot status-dot--concept"></span>
            <span>This interaction is awaiting final design and production assets.</span>
          </div>
        </article>
      </div>
    `

    const sceneHost = this.root.querySelector('.interaction-placeholder__scene')
    if (sceneHost) {
      const token = this.#conceptToken
      import('./concept-sphere.js')
        .then(({ mountConceptSphere }) => mountConceptSphere(sceneHost))
        .then(dispose => {
          if (token !== this.#conceptToken) {
            dispose?.()
            return
          }
          this.#conceptDisposer = dispose
        })
        .catch(error => console.warn('Concept sphere failed to start.', error))
    }
  }

  showLoading(module) {
    this.#teardownConcept()
    this.root.dataset.moduleId = module.id
    this.root.dataset.moduleState = 'loading'
    this.root.dataset.moduleCategory = module.category || ''
    /* Which of the three band schemes this module runs; see module-host.css. */
    this.root.dataset.moduleScheme = module.scheme || 'purple'
    this.root.innerHTML = `
      <div class="module-host__system-view" role="status" aria-live="polite">
        <div class="module-host__system-copy">
          <span class="module-host__spinner" aria-hidden="true"></span>
          <p class="module-kicker">
            ${escapeHtml(module.number)} · ${escapeHtml(module.categoryLabel)}
          </p>
          <h2>Preparing ${escapeHtml(module.title)}</h2>
          <p>Loading the interactive experience and its local media.</p>
        </div>
      </div>
    `
  }

  showStage(module, { animate = true, deferReveal = false } = {}) {
    this.#teardownConcept()
    this.root.dataset.moduleId = module.id
    this.root.dataset.moduleState = 'active'
    this.root.dataset.moduleCategory = module.category || ''
    /* Which of the three band schemes this module runs; see module-host.css. */
    this.root.dataset.moduleScheme = module.scheme || 'purple'
    /* Keep the stage measurable but unpainted while its async mount builds
       presentation-ready content. revealStage starts the entrance only once
       that module-owned readiness contract has settled. */
    this.root.innerHTML = `
      <div
        class="module-host__stage${deferReveal ? ' is-awaiting-content' : ''}"
        data-module-stage="${escapeHtml(module.id)}"
        aria-busy="true"
        aria-label="${escapeHtml(module.title)} interactive module"
      ></div>
    `
    return this.root.firstElementChild
  }

  revealStage(stage, { animate = true } = {}) {
    if (!stage) return
    stage.classList.remove('is-awaiting-content')
    if (!animate) return

    /* animationend bubbles, so ignore anything a module animates inside. */
    stage.addEventListener('animationend', event => {
      if (event.target !== stage || event.animationName !== 'module-arrive') return
      stage.classList.remove('is-arriving')
    })
    /* Commit removal of the hidden state before applying the from-keyframe. */
    void stage.offsetWidth
    stage.classList.add('is-arriving')
  }

  showError(module, error, onRetry) {
    this.#teardownConcept()
    this.root.dataset.moduleId = module.id
    this.root.dataset.moduleState = 'error'
    this.root.dataset.moduleCategory = module.category || ''
    /* Which of the three band schemes this module runs; see module-host.css. */
    this.root.dataset.moduleScheme = module.scheme || 'purple'
    this.root.innerHTML = `
      <div class="module-host__system-view module-host__system-view--error" role="alert">
        <div class="module-host__system-copy">
          <p class="module-kicker">Module unavailable</p>
          <h2>We couldn’t start ${escapeHtml(module.title)}.</h2>
          <p>The experience can be loaded again without restarting the kiosk.</p>
          <button class="primary-action module-host__retry" type="button">
            <span>Try again</span>
            <span class="action-arrow" aria-hidden="true">↻</span>
          </button>
          <details class="module-host__error-details">
            <summary>Technical details</summary>
            <code>${escapeHtml(error?.message || 'Unknown module error')}</code>
          </details>
        </div>
      </div>
    `
    this.root.querySelector('.module-host__retry')?.addEventListener('click', onRetry, { once: true })
  }

}

/**
 * Owns the lifecycle of a single interactive module.
 *
 * A module loader resolves to an object exporting `mount(container, context)`.
 * Mount may return a disposer function or `{ dispose() }`. It may also expose
 * `presentationReady()` for covered, post-reveal compositor warm-up. The host
 * aborts and disposes the active module whenever navigation starts another
 * experience.
 */
export class ModuleHost {
  constructor({ root, view, onActivity = noop, navigate = {}, mountTimeoutMs = 30000 }) {
    this.view = view || new DomModuleHostView(root)
    this.navigate = Object.freeze({
      home: navigate.home || noop,
      menu: navigate.menu || noop,
      /* Lets a finished module hand the visitor straight to the next one from
         its up-next band, rather than routing them back through the carousel. */
      module: navigate.module || noop
    })
    this.activityCallback = onActivity
    this.currentModule = null
    this.abortController = null
    this.disposer = null
    this.mountTimeoutMs = mountTimeoutMs
    this.requestToken = 0

    this.onActivity = this.onActivity.bind(this)
  }

  onActivity() {
    this.activityCallback?.()
  }

  async mount(module, mountContext = {}) {
    if (!module) throw new TypeError('A module definition is required.')

    this.#invalidate({ clear: false })
    const token = this.requestToken
    this.currentModule = module
    this.mountContext = mountContext

    if (typeof module.load !== 'function') {
      this.view.showConcept(module)
      return { status: 'concept' }
    }

    const abortController = new AbortController()
    this.abortController = abortController
    const cancelLoadingView = this.#scheduleLoadingView(module, token, abortController)
    const deadline = setTimeout(() => {
      abortController.abort(taskTimeout('The experience took too long to prepare. Please try again.'))
    }, this.mountTimeoutMs)

    try {
      const moduleExports = await waitForTask(module.load({ signal: abortController.signal }), abortController.signal)
      cancelLoadingView()
      if (!this.#isCurrent(token, abortController)) return { status: 'stale' }

      const deferStageReveal = mountContext.deferStageReveal === true
      /* A deferred wipe owns the visible handoff. Other wipe-driven modules
         retain their existing eager stage arrival and internal loading UI. */
      const animateStage = mountContext.entryTransition !== 'portal' &&
        !(mountContext.entryTransition === 'wipe' && deferStageReveal)
      const container = this.view.showStage(module, {
        animate: animateStage,
        deferReveal: deferStageReveal
      })
      if (!deferStageReveal) {
        this.view.revealStage?.(container, { animate: animateStage })
      }
      const mount = getMountFunction(moduleExports)
      const mountResult = await waitForTask(mount(container, {
        ...mountContext,
        module,
        signal: abortController.signal,
        onActivity: this.onActivity,
        onError: error => {
          if (this.#isCurrent(token, abortController)) this.reportError(error)
        },
        navigate: this.navigate
      }), abortController.signal, result => runDisposer(getDisposer(result)))
      const disposer = getDisposer(mountResult)
      const presentationReady = getPresentationReady(mountResult)

      if (!this.#isCurrent(token, abortController)) {
        runDisposer(disposer)
        return { status: 'stale' }
      }

      this.disposer = disposer
      if (deferStageReveal) {
        this.view.revealStage?.(container, { animate: animateStage })
      }
      if (presentationReady) {
        try {
          await waitForTask(presentationReady(), abortController.signal)
        } catch (error) {
          if (abortController.signal.aborted) throw error
          /* Compositor warm-up is an enhancement; a failure must not block the module. */
          console.warn(`Module “${module.id}” presentation warm-up failed.`, error)
        }
      }
      if (!this.#isCurrent(token, abortController)) {
        runDisposer(disposer)
        return { status: 'stale' }
      }
      container.setAttribute?.('aria-busy', 'false')
      return { status: 'active' }
    } catch (error) {
      cancelLoadingView()
      if (token !== this.requestToken || this.abortController !== abortController ||
          (abortController.signal.aborted && isAbortError(error))) {
        return { status: 'stale' }
      }

      console.error(`Module “${module.id}” failed to mount.`, error)
      abortController.abort()
      this.abortController = null
      const disposer = this.disposer
      this.disposer = null
      runDisposer(disposer)
      const retry = () => {
        if (token !== this.requestToken || this.currentModule !== module) return
        this.onActivity()
        void this.mount(module, mountContext)
      }
      this.view.showError(module, error, retry)
      return { status: 'error', error }
    } finally {
      clearTimeout(deadline)
      cancelLoadingView()
    }
  }

  unmount() {
    this.#invalidate({ clear: true })
  }

  /** Post-mount interactions share the same teardown and retry as startup. */
  reportError(error, retryContext = this.mountContext) {
    const module = this.currentModule
    const context = retryContext
    if (!module) return
    console.error(`Module “${module.id}” interaction failed.`, error)
    this.#invalidate({ clear: false })
    this.currentModule = module
    const token = this.requestToken
    this.view.showError(module, error, () => {
      if (token !== this.requestToken) return
      this.onActivity()
      void this.mount(module, context)
    })
  }

  /* Returns a cancel function; call it as soon as the load settles so a fast
     module goes straight from the wipe to its stage. */
  #scheduleLoadingView(module, token, abortController) {
    const timer = setTimeout(() => {
      if (!this.#isCurrent(token, abortController)) return
      this.view.showLoading(module)
    }, LOADING_VIEW_DELAY_MS)

    return () => clearTimeout(timer)
  }

  #invalidate({ clear }) {
    this.requestToken += 1
    this.abortController?.abort()
    this.abortController = null

    const disposer = this.disposer
    this.disposer = null
    if (disposer) runDisposer(disposer)

    this.currentModule = null
    this.mountContext = null
    if (clear) this.view.clear()
  }

  #isCurrent(token, abortController) {
    return token === this.requestToken &&
      abortController === this.abortController &&
      !abortController.signal.aborted
  }
}
