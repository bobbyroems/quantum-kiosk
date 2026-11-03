/*
 * Quantum vs. Classical — three key principles, each a coin sub-game.
 * The sub-menu follows the current Figma "Sub Menu Selection Screen"
 * (node 506:2224);
 * the Superposition and Entanglement games port the client prototypes in
 * ref/3js with the kiosk's quarter model, materials and studio lighting.
 * Interference uses the supplied buoy model; its full experience owns the
 * shader-driven analytic water field while the menu keeps the buoy isolated.
 */

import { assetUrl } from '../../core/asset-url.js'
import { loadCoinAssets } from './coin-assets.js'
import { loadBuoyAssets } from './interference-assets.js'
import { createInterferenceGame } from './interference-game.js'
import { mountModuleOutro } from '../module-outro.js'
import { createMenuScene } from './menu-scene.js'
import { createSuperpositionGame } from './superposition-game.js'
import { createEntanglementGame } from './entanglement-game.js'
import { SUB_MODULES } from './sub-modules.js'
import { createSubModuleNav } from '../../core/sub-module-nav.js'

const GAME_CREATORS = Object.freeze({
  superposition: createSuperpositionGame,
  entanglement: createEntanglementGame,
  interference: createInterferenceGame
})

/* Built from the route rather than restating it: the labels are also the ones
   the 1-2-3 prints in the band, and two lists of the same three names is how
   the sub-menu and the pagination end up disagreeing. */
const GAMES = Object.freeze(Object.fromEntries(
  SUB_MODULES.map(step => [step.id, { label: step.label, create: GAME_CREATORS[step.id] }])
))

let preloadPromise = null

/* Start the large menu asset reads while the visitor is still outside this
   module. GPU programs and uploads are warmed later, once the real card
   dimensions exist under the opaque module wipe. */
export function preload() {
  preloadPromise ??= Promise.all([
    loadCoinAssets(),
    loadBuoyAssets(),
    import('three/addons/environments/RoomEnvironment.js')
  ])
    .then(([assets, buoyAssets, { RoomEnvironment }]) => ({
      assets,
      buoyAssets,
      RoomEnvironment
    }))
    .catch(error => {
      preloadPromise = null
      throw error
    })
  return preloadPromise
}

function moduleMarkup() {
  const microsoftLogo = assetUrl('assets/ui/microsoft-logo.png')
  const backIcon = assetUrl('assets/ui/chevron-right.svg')
  const restartIcon = assetUrl('assets/ui/restart.svg')
  const exitIcon = assetUrl('assets/ui/exit-x.svg')
  const principleIcon = assetUrl('assets/ui/principle-chevron.svg')
  return `
    <section class="qvc" data-qvc-root data-view="menu" aria-labelledby="qvc-title">
      <header class="microsoft-header qvc__header">
        <div class="microsoft-brand qvc__brand" aria-label="Microsoft Quantum">
          <span class="microsoft-brand__logo qvc__microsoft">
            <img src="${microsoftLogo}" alt="Microsoft" draggable="false">
          </span>
          <span class="microsoft-brand__divider qvc__brand-rule" aria-hidden="true"></span>
          <span class="microsoft-brand__quantum qvc__brand-quantum">Quantum</span>
        </div>
        <div class="microsoft-header__actions qvc__actions">
          <button class="microsoft-header__action qvc__utility-action qvc__utility-action--back" type="button" data-qvc-action="back">
            <span class="microsoft-header__action-icon microsoft-header__action-icon--back" aria-hidden="true">
              <img src="${backIcon}" alt="" draggable="false">
            </span>
            <span>Back</span>
          </button>
          <button class="microsoft-header__action qvc__utility-action" type="button" data-qvc-action="restart">
            <span>Restart</span>
            <span class="microsoft-header__action-icon" aria-hidden="true">
              <img src="${restartIcon}" alt="" draggable="false">
            </span>
          </button>
          <button class="microsoft-header__action qvc__utility-action" type="button" data-qvc-action="exit">
            <span>Exit</span>
            <span class="microsoft-header__action-icon" aria-hidden="true">
              <img src="${exitIcon}" alt="" draggable="false">
            </span>
          </button>
        </div>
      </header>

      <div class="qvc__experience">
        <h1 class="qvc__sr" id="qvc-title">What makes quantum different?</h1>

        <div class="qvc__menu" data-qvc-menu>
          <div class="qvc-copy qvc__menu-copy">
            <h2>Three quantum principles</h2>
            <!-- Broken where the board breaks it: the block is wide enough to
                 wrap differently on its own. -->
            <p>Classical computers have limits.<br>Key quantum phenomena allow us to solve<br>complex problems in entirely new ways.</p>
          </div>
          <div class="qvc__menu-cards" data-qvc-menu-strip>
            <button class="qvc__menu-card qvc__menu-card--superposition" type="button" data-qvc-game="superposition" aria-label="Step 1 of 3: Superposition">
              <span class="qvc__menu-card-scene" aria-hidden="true">
                <span class="qvc__menu-shadow"></span>
                <span class="qvc__menu-render" data-qvc-card-scene="superposition"></span>
              </span>
              <span class="qvc__principle"><span class="qvc__principle-label">Superposition</span><span class="qvc__principle-icon" aria-hidden="true"><img src="${principleIcon}" alt="" draggable="false"></span></span>
            </button>
            <button class="qvc__menu-card qvc__menu-card--entanglement" type="button" data-qvc-game="entanglement" aria-label="Step 2 of 3: Entanglement">
              <span class="qvc__menu-card-scene" aria-hidden="true">
                <span class="qvc__menu-shadow"></span>
                <span class="qvc__menu-render" data-qvc-card-scene="entanglement"></span>
              </span>
              <span class="qvc__principle"><span class="qvc__principle-label">Entanglement</span><span class="qvc__principle-icon" aria-hidden="true"><img src="${principleIcon}" alt="" draggable="false"></span></span>
            </button>
            <button class="qvc__menu-card qvc__menu-card--interference" type="button" data-qvc-game="interference" aria-label="Step 3 of 3: Interference">
              <span class="qvc__menu-card-scene" aria-hidden="true">
                <span class="qvc__menu-shadow"></span>
                <span class="qvc__menu-render" data-qvc-card-scene="interference"></span>
              </span>
              <span class="qvc__principle"><span class="qvc__principle-label">Interference</span><span class="qvc__principle-icon" aria-hidden="true"><img src="${principleIcon}" alt="" draggable="false"></span></span>
            </button>
          </div>
          <!-- A sibling of the principles, not a child: it is placed against the
               menu like the copy above it, and nesting it in the strip made its
               offset relative to the strip instead of the screen. -->
          <div class="qvc__sequence" data-qvc-sequence aria-hidden="true"></div>
        </div>

        <div class="qvc__game-host" data-qvc-game-host hidden></div>
        <div class="qvc__transition" data-qvc-transition aria-hidden="true">
          <div class="qvc__transition-content">
            <p class="qvc__transition-title">
              <span data-qvc-transition-title>Superposition</span>
              <span class="qvc__transition-spinner" aria-hidden="true">
                <svg viewBox="0 0 120 120" focusable="false">
                  <path d="M60 21C38.4609 21 21 38.4609 21 60C21 62.4853 18.9853 64.5 16.5 64.5C14.0147 64.5 12 62.4853 12 60C12 33.4903 33.4903 12 60 12C86.5097 12 108 33.4903 108 60C108 86.5097 86.5097 108 60 108C57.5147 108 55.5 105.985 55.5 103.5C55.5 101.015 57.5147 99 60 99C81.5391 99 99 81.5391 99 60C99 38.4609 81.5391 21 60 21Z" fill="currentColor"/>
                </svg>
              </span>
            </p>
            <div class="qvc__transition-path" data-qvc-transition-path></div>
          </div>
        </div>
      </div>
    </section>
  `
}

function createAbortError() {
  return new DOMException('Quantum vs. Classical mount was aborted', 'AbortError')
}

export async function mount(container, options = {}) {
  if (!container?.replaceChildren) {
    throw new TypeError('Quantum vs. Classical requires a DOM container')
  }
  const { signal, onActivity, onError, navigate = {}, module } = options
  if (signal?.aborted) throw createAbortError()

  const wrapper = document.createElement('div')
  wrapper.innerHTML = moduleMarkup().trim()
  const root = wrapper.firstElementChild
  container.replaceChildren(root)

  const menuView = root.querySelector('[data-qvc-menu]')
  const menuStrip = root.querySelector('[data-qvc-menu-strip]')
  const gameHost = root.querySelector('[data-qvc-game-host]')
  const transitionTitle = root.querySelector('[data-qvc-transition-title]')
  const listeners = new AbortController()

  let disposed = false
  let menuScene = null
  let gameController = null
  let activeGameId = null
  let transitionId = 0
  const deferredDisposals = new Map()
  // Ownership survives the awaits between removing a game and showing its successor.
  const ownedGames = new Set()

  /* IQM asked for the three principles to be taken in order, so a card opens
     only once the one before it has been played through. "Played through" is
     the moment a game offers its "Up next" card: that card is shown only after
     the visitor has taken the game all the way to its result, which makes it
     the completion signal already in the build rather than a second one to
     keep in step with it.

     Interference has no card of its own because nothing follows it, which is
     also why it needs no completion hook — it gates nothing. */
  const completedGames = new Set()
  const GAME_PREREQUISITE = Object.freeze({
    entanglement: 'superposition',
    interference: 'entanglement'
  })
  const menuCards = [...menuStrip.querySelectorAll('[data-qvc-game]')]

  /* The band offering the module after this one. It is deliberately separate
     from the "Up next" the games show each other: those move between the three
     principles inside this module, this one leaves it. They never share the
     screen — the games' band belongs to Superposition and Entanglement, and
     this one only appears once Interference, which has no band of its own,
     resolves. */
  /* The band states where the visitor is, then follows the registry route. */
  const upNextBanner = mountModuleOutro({
    module,
    root,
    navigate,
    onActivity,
    onRestart: () => root.querySelector('[data-qvc-action="restart"]')?.click()
  })

  function isGameUnlocked(gameId) {
    const required = GAME_PREREQUISITE[gameId]
    return !required || completedGames.has(required)
  }

  /* Both 1-2-3s are the shared control (core/sub-module-nav.js): the sub-menu
     draws it teal-on-white with the labels off, the transition cover draws it
     with them on. They used to be two hand-built copies in this file, on an
     older blue-on-light design. */
  const sequenceNav = createSubModuleNav({
    steps: SUB_MODULES,
    tone: 'on-light',
    showLabels: false,
    ariaLabel: 'The three principles'
  })
  root.querySelector('[data-qvc-sequence]').append(sequenceNav.element)

  const transitionNav = createSubModuleNav({
    steps: SUB_MODULES,
    tone: 'on-light',
    ariaLabel: 'Opening principle'
  })
  root.querySelector('[data-qvc-transition-path]').append(transitionNav.element)

  /* The one the band carries while a game runs. It lives here rather than in the
     games because a game's disposal is deferred by a frame: by the time the
     outgoing one ran, the incoming one had already put its own step up, and
     clearing the band then took the new game's 1-2-3 with it. */
  const bandNav = createSubModuleNav({
    steps: SUB_MODULES,
    ariaLabel: 'Progress through the three principles'
  })

  /* Which principles the visitor may open, for the 1-2-3s to fade the rest. */
  function unlockedGameIds() {
    return SUB_MODULES.map(step => step.id).filter(isGameUnlocked)
  }

  /* Where the visitor stands on the menu: the first principle open to them that
     they have not finished. Null once they have finished them all — none of
     them is "current" then, and every disc carries a tick instead. */
  function currentPrincipleId() {
    return SUB_MODULES.find(
      step => isGameUnlocked(step.id) && !completedGames.has(step.id)
    )?.id ?? null
  }

  function allPrinciplesDone() {
    return completedGames.size === SUB_MODULES.length
  }

  function navState() {
    return { unlocked: unlockedGameIds(), completed: completedGames }
  }

  function applyMenuLocks() {
    sequenceNav.setCurrent(activeGameId ?? currentPrincipleId(), navState())
    for (const card of menuCards) {
      const gameId = card.dataset.qvcGame
      const unlocked = isGameUnlocked(gameId)
      const requiredId = GAME_PREREQUISITE[gameId]
      card.dataset.locked = String(!unlocked)
      card.disabled = !unlocked
      card.setAttribute('aria-disabled', String(!unlocked))
      const step = card.dataset.qvcStep || card.getAttribute('aria-label') || ''
      if (!card.dataset.qvcStep) card.dataset.qvcStep = step
      card.setAttribute('aria-label', unlocked
        ? card.dataset.qvcStep
        : `${card.dataset.qvcStep}, locked until ${GAMES[requiredId]?.label ?? 'the previous principle'} is complete`)
    }
  }

  signal?.addEventListener('abort', dispose, { once: true })
  const { assets, buoyAssets, RoomEnvironment } = await preload()
  if (signal?.aborted) throw createAbortError()

  const sceneContext = {
    signal,
    assets,
    buoyAssets,
    RoomEnvironment,
    onActivity,
    /* The one band. A game does not build its own: it borrows this one, swaps
       the module title for the 1-2-3 while it runs, and hands it back on the
       way out. Two bands under one header is what happens otherwise, since the
       module's band is on screen the whole visit now. */
    band: upNextBanner.band,
    /* Where a game hangs its pop-up: beside the band rather than inside the
       game, so the scrim covers the bar as well. Anything mounted inside
       .qvc__experience is sealed under it and cannot dim the band above. */
    popupHost: root,
    /* Interference has no pop-up of its own — finishing it finishes the module,
       so what follows is the next module and the module's outro owns that
       offer. "Tap to finish" brings it forward: the visitor has said they are
       done, so there is nothing left to wait five seconds for. */
    showUpNext: () => {
      upNextBanner.band.cancelEscalation()
      upNextBanner.popup?.raise(0)
    },
    /* Lets a finished game hand the visitor straight to the next principle via
       its "Up next" banner, instead of routing them back through the menu. */
    openGame: gameId => void openGame(gameId),
    /* A game reports itself finished so the menu can open what follows it. */
    onGameComplete: gameId => {
      if (completedGames.has(gameId)) return
      completedGames.add(gameId)
      applyMenuLocks()
      /* The band offering the next module appears once all three principles are
         done, which is what the board draws on the menu behind it.

         Keyed on the count rather than on Interference finishing. The two mean
         the same thing only because Interference is locked behind the other
         two — say what is actually meant, and the band survives any change to
         that order. */
      if (allPrinciplesDone()) upNextBanner?.offer()
    }
  }

  applyMenuLocks()

  /* Dev shortcut: H jumps straight to Interference from anywhere in this
     module. It is the third principle and normally locked behind the other
     two, so reaching it while working on it otherwise means playing both of
     them through first.

     Not registered at all unless the runtime says development, rather than
     registered and then guarded: --dev is what sets that flag, so no packaged
     build carries the listener. A kiosk has no keyboard, but one gets plugged
     in for maintenance, and this should not be reachable when it is.

     Marks the prerequisites complete rather than bypassing isGameUnlocked, so
     the menu underneath ends up in the state it would have reached honestly —
     cards unlocked, and openGame taking its usual path. Interference itself is
     deliberately not marked complete: that is what fires the next-module band,
     and the shortcut should not fake having finished the module. */
  if (window.kiosk?.isDevelopment) {
    window.addEventListener('keydown', event => {
      if (event.key !== 'h' && event.key !== 'H') return
      /* Leave the modified combinations to the browser and the OS. */
      if (event.ctrlKey || event.metaKey || event.altKey) return
      if (activeGameId === 'interference') return
      event.preventDefault()
      for (const gameId of Object.keys(GAMES)) {
        if (gameId !== 'interference') completedGames.add(gameId)
      }
      applyMenuLocks()
      void openGame('interference')
    }, { signal: listeners.signal })
  }

  function setView(view) {
    root.dataset.view = view
    menuView.hidden = view !== 'menu'
    menuView.inert = view !== 'menu'
    gameHost.hidden = view !== 'game'
    gameHost.inert = view !== 'game'
  }

  function waitForPaintFrames(count = 2) {
    return new Promise(resolve => {
      let remaining = count
      const commit = () => {
        remaining -= 1
        if (remaining <= 0) resolve()
        else requestAnimationFrame(commit)
      }
      requestAnimationFrame(commit)
    })
  }

  function wait(milliseconds) {
    return new Promise(resolve => window.setTimeout(resolve, milliseconds))
  }

  function waitForBandMotion() {
    const bandElement = upNextBanner.band.element
    return new Promise(resolve => {
      let fallback = null
      const finish = () => {
        bandElement.removeEventListener('transitionend', onTransitionEnd)
        if (fallback !== null) window.clearTimeout(fallback)
        resolve()
      }
      const onTransitionEnd = event => {
        if (event.target === bandElement && event.propertyName === 'transform') {
          finish()
        }
      }
      bandElement.addEventListener('transitionend', onTransitionEnd)
      /* Resolves even if the stylesheet is unavailable or the browser elides
         the transition because the module is being torn down. */
      fallback = window.setTimeout(finish, 240)
    })
  }

  async function slideBandOut(requestedTransition) {
    upNextBanner.band.element.classList.add('qvc-module-band--withdrawn')
    await waitForBandMotion()
    return transitionIsCurrent(requestedTransition)
  }

  async function slideBandIn(requestedTransition) {
    upNextBanner.band.element.classList.remove('qvc-module-band--withdrawn')
    await waitForBandMotion()
    return transitionIsCurrent(requestedTransition)
  }

  /* How long the numbered cover stays up, at minimum.
   *
   * It reveals as soon as the incoming game has produced a frame, and the games
   * are preloaded, so on a warm machine it could come and go faster than the
   * step rail finishes travelling — the screen exists to say where the visitor
   * is in the sequence, and it cannot do that if it is gone before the number
   * lands. The rail alone is a 520ms transition on a 60ms delay, so this leaves
   * roughly a second to read it afterwards.
   *
   * This is a floor, not a delay: a slow build still takes as long as it takes,
   * and nothing waits twice. */
  const MIN_COVER_MS = 1600
  let coverShownAt = 0

  function transitionIsCurrent(requestedTransition) {
    return !disposed && requestedTransition === transitionId
  }

  async function coverStage(requestedTransition, {
    targetId = 'menu',
    title = 'Three principles'
  } = {}) {
    root.classList.add('is-transitioning')
    root.setAttribute('aria-busy', 'true')
    root.dataset.transitionTarget = targetId
    transitionNav.setCurrent(targetId === 'menu' ? null : targetId, navState())
    /* Move the complete band away before its pagination is cleared. Swapping
       the band contents while it is offscreen avoids both a second 1-2-3 and a
       flash of the module title between the two surfaces. */
    if (!await slideBandOut(requestedTransition)) return false
    upNextBanner.band.clearPagination()
    transitionTitle.textContent = title
    root.dataset.transition = 'covering'
    coverShownAt = performance.now()
    /* Let the cover fully composite before doing any renderer construction.
       Otherwise shader compilation can freeze the menu halfway through its
       fade, which is the hitch this transition is intended to hide. */
    await wait(240)
    return transitionIsCurrent(requestedTransition)
  }

  function finishTransition(requestedTransition) {
    if (!transitionIsCurrent(requestedTransition)) return
    root.classList.remove('is-transitioning')
    root.removeAttribute('aria-busy')
    delete root.dataset.transition
    delete root.dataset.transitionTarget
  }

  async function revealStage(requestedTransition) {
    await waitForPaintFrames()
    if (!transitionIsCurrent(requestedTransition)) return false
    const held = performance.now() - coverShownAt
    if (held < MIN_COVER_MS) {
      await wait(MIN_COVER_MS - held)
      if (!transitionIsCurrent(requestedTransition)) return false
    }
    root.dataset.transition = 'revealing'
    await wait(340)
    if (!transitionIsCurrent(requestedTransition)) return false
    /* The cover pagination is fully gone before the prepared band returns. */
    if (!await slideBandIn(requestedTransition)) return false
    finishTransition(requestedTransition)
    return true
  }

  async function waitForGameFrame(requestedTransition) {
    /* Every game marks its canvas after its first successful render. Waiting
       here means the cover never reveals an empty canvas or half-built UI. */
    for (let frame = 0; frame < 60; frame += 1) {
      if (!transitionIsCurrent(requestedTransition)) return false
      if (gameHost.querySelector('.qvc-game__canvas.is-ready')) return true
      await waitForPaintFrames(1)
    }
    return transitionIsCurrent(requestedTransition)
  }

  /* Context loss can briefly paint a detached WebGL canvas white if it occurs
     in the same compositor frame as a view swap. Let the hidden state reach
     the screen first, then release the outgoing renderer on the next frame. */
  function disposeAfterViewSwap(controller) {
    if (!controller || deferredDisposals.has(controller)) return
    if (disposed) {
      ownedGames.delete(controller)
      controller.dispose()
      return
    }
    const frame = requestAnimationFrame(() => {
      deferredDisposals.delete(controller)
      ownedGames.delete(controller)
      controller.dispose()
    })
    deferredDisposals.set(controller, frame)
  }

  function flushDeferredDisposals() {
    for (const [controller, frame] of deferredDisposals) {
      cancelAnimationFrame(frame)
      ownedGames.delete(controller)
      controller.dispose()
    }
    deferredDisposals.clear()
  }

  async function showMenu() {
    if (root.classList.contains('is-transitioning')) return
    const requestedTransition = ++transitionId
    activeGameId = null
    const outgoingGame = gameController
    gameController = null

    if (outgoingGame && !await coverStage(requestedTransition, {
      targetId: 'menu',
      title: 'Three principles'
    })) return
    setView('menu')
    /* Back on the menu the band states which module this is, as the board draws
       it (255:3892). The offer belongs to the moment a principle finishes; left
       standing here it followed the visitor back and sat on a screen that is
       about where they are, not where they could go. The way on is not lost —
       the pop-up carries it, and the carousel is a tap away. */
    upNextBanner.band.withdrawOffer()
    upNextBanner.band.clearPagination()
    menuScene?.setActive(true)

    if (!menuScene) {
      const nextMenuScene = createMenuScene(menuStrip, sceneContext)
      menuScene = nextMenuScene
      try {
        await nextMenuScene.ready
      } catch (error) {
        if (menuScene === nextMenuScene) menuScene = null
        nextMenuScene.dispose()
        throw error
      }
    } else {
      await menuScene.ready
    }

    if (disposed || requestedTransition !== transitionId || activeGameId !== null) {
      return
    }

    menuScene?.setActive(true)
    disposeAfterViewSwap(outgoingGame)
    if (outgoingGame) await revealStage(requestedTransition)
  }

  function reportInteractionError(error) {
    if (disposed) return
    if (onError) onError(error)
    else {
      console.error('Quantum principle could not start.', error)
      dispose()
      navigate.menu?.()
    }
  }

  async function openGame(gameId) {
    try {
      await openGameTransition(gameId)
    } catch (error) {
      reportInteractionError(error)
    }
  }

  async function openGameTransition(gameId) {
    const game = GAMES[gameId]
    if (!game || root.classList.contains('is-transitioning')) return
    /* Reachable from a game's "Up next" as well as the menu, so the order is
       enforced here rather than only on the cards. */
    if (!isGameUnlocked(gameId)) return
    onActivity?.()

    const requestedTransition = ++transitionId
    activeGameId = gameId
    const outgoingGame = gameController
    gameController = null

    if (!await coverStage(requestedTransition, {
      targetId: gameId,
      title: game.label
    })) return
    setView('game')
    /* Drops an offer left standing by the game before it — that offer was for
       the principle the visitor has just taken. */
    upNextBanner.band.withdrawOffer()
    /* Keep the three preview renderers, PMREMs, shader programs and texture
       uploads alive for Back. Only their animation loop is suspended. */
    menuScene?.setActive(false)
    const nextController = await game.create(gameHost, sceneContext)
    ownedGames.add(nextController)
    if (disposed || requestedTransition !== transitionId || activeGameId !== gameId) {
      disposeAfterViewSwap(nextController)
      return
    }
    gameController = nextController
    await waitForGameFrame(requestedTransition)
    if (!transitionIsCurrent(requestedTransition)) return
    disposeAfterViewSwap(outgoingGame)
    /* Prepare the band's next state while the complete bar is offscreen. It
       slides back only after the cover's 1-2-3 has fully left. */
    bandNav.setCurrent(gameId, navState())
    upNextBanner.band.mountPagination(bandNav.element)
    await revealStage(requestedTransition)
  }

  root.addEventListener('click', event => {
    const action = event.target.closest('[data-qvc-action]')?.dataset.qvcAction
    if (action) {
      onActivity?.()
      if (action === 'back') void showMenu().catch(reportInteractionError)
      else if (action === 'restart') {
        if (root.dataset.view === 'game') gameController?.restart()
        else void showMenu().catch(reportInteractionError)
      } else if (action === 'exit') navigate.menu?.()
      return
    }

    const gameId = event.target.closest('[data-qvc-game]')?.dataset.qvcGame
    if (gameId) void openGame(gameId)
  }, { signal: listeners.signal })

  function dispose() {
    if (disposed) return
    disposed = true
    signal?.removeEventListener('abort', dispose)
    transitionId += 1
    root.classList.remove('is-transitioning')
    root.removeAttribute('aria-busy')
    delete root.dataset.transition
    delete root.dataset.transitionTarget
    listeners.abort()
    flushDeferredDisposals()
    upNextBanner?.dispose()
    menuScene?.dispose()
    menuScene = null
    for (const controller of ownedGames) controller.dispose()
    ownedGames.clear()
    gameController = null
  }

  await showMenu()
  if (signal?.aborted || disposed) throw createAbortError()
  return dispose
}
