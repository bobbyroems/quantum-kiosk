/*
 * Kiosk settings surface: a cog in the bottom-right corner of the stage that
 * springs open a frosted popover holding the sound, layout and timing controls.
 *
 * AGENTS.md sends floating panels to createKioskExplainer. This is the
 * documented interactive-dialog exception — the explainer models a passive
 * title/body surface, with no launcher, no open/closed state and no focusable
 * controls to keep out of the tab order while it is closed.
 *
 * The spring lives in CSS so the panel, the cog and the segment thumb all ride
 * the same curve; this module only owns state and the enter/exit sequencing.
 */
import { getVolume, isMusicEnabled, setMusicEnabled, setVolume } from './kiosk-audio.js'
import {
  formatIdleTimeout,
  getIdleTimeouts,
  IDLE_TIMEOUT_LIMITS,
  setIdleTimeout
} from './idle-timeouts.js'

/* Whether the "Up next" pop-up is allowed to interrupt, so a testing session
   can stop it without stripping the offer out of the build.

   On by default. It used to be off, because it arrived first and covered the
   result the visitor had just produced. It arrives last now — the band offers
   quietly and the pop-up only asks outright five seconds later, if that went
   unanswered — and IQM asked for that third beat explicitly: on the floor,
   people finished a module and stood looking at a finished screen. Off by
   default meant the beat they asked for never ran.

   Deliberately not persisted either way. A kiosk that came back from a restart
   in a state nobody chose would be a hard fault to diagnose on a floor. */
let upNextCardsEnabled = true
const upNextListeners = new Set()

export function areUpNextCardsEnabled() {
  return upNextCardsEnabled
}

export function setUpNextCardsEnabled(next) {
  const value = next !== false
  if (value === upNextCardsEnabled) return
  upNextCardsEnabled = value
  for (const listener of upNextListeners) listener(value)
}

/** Lets a card that is already on screen close itself when they are turned off. */
export function onUpNextCardsChange(listener) {
  upNextListeners.add(listener)
  return () => upNextListeners.delete(listener)
}

/* Matches the exit transform in .kiosk-settings__panel — the panel is only
   taken out of the layout once it has finished shrinking into the cog. */
const PANEL_EXIT_MS = 200

function prefersReducedMotion() {
  return window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false
}

export function createKioskSettings({
  root = document,
  onIdleTimeoutChange,
  onLayoutChange
} = {}) {
  const container = root.getElementById('kiosk-settings')
  const launcher = root.getElementById('kiosk-settings-launcher')
  const panel = root.getElementById('kiosk-settings-panel')
  if (!container || !launcher || !panel) return null

  let open = false
  let exitTimer = null

  panel.inert = true

  const setOpen = next => {
    if (next === open) return
    open = next
    launcher.setAttribute('aria-expanded', String(open))

    if (open) {
      window.clearTimeout(exitTimer)
      exitTimer = null
      panel.hidden = false
      panel.inert = false
      /* The panel has to sit in the layout in its collapsed state for a frame
         before data-open flips, or the spring has nothing to run from.
         Reading a metric forces that layout pass. */
      void panel.offsetWidth
      container.dataset.open = 'true'
      return
    }

    container.dataset.open = 'false'
    panel.inert = true
    if (prefersReducedMotion()) {
      panel.hidden = true
      return
    }
    exitTimer = window.setTimeout(() => {
      panel.hidden = true
      exitTimer = null
    }, PANEL_EXIT_MS)
  }

  launcher.addEventListener('click', () => setOpen(!open))

  /* A tap anywhere else dismisses the popover. Captured so it closes even when
     the tap lands on a control that stops the event on its way back up. */
  root.addEventListener('pointerdown', event => {
    if (!open || container.contains(event.target)) return
    setOpen(false)
  }, true)

  bindVolume(root)
  bindMusic(root, container)
  bindUpNext(root, container)
  bindIdleTimeouts(root, onIdleTimeoutChange)
  const layout = bindLayout(root, container, onLayoutChange)

  return {
    close: () => setOpen(false),
    isOpen: () => open,
    layout
  }
}

function bindIdleTimeouts(root, onChange) {
  const timeouts = getIdleTimeouts()
  const bindings = [
    ['returnToMenuMs', 'idle-menu-slider', 'idle-menu-readout'],
    ['returnToHomeMs', 'idle-home-slider', 'idle-home-readout']
  ]

  for (const [key, sliderId, readoutId] of bindings) {
    const slider = root.getElementById(sliderId)
    const readout = root.getElementById(readoutId)
    if (!slider || !readout) continue

    slider.min = String(IDLE_TIMEOUT_LIMITS.minMs / 1000)
    slider.max = String(IDLE_TIMEOUT_LIMITS.maxMs / 1000)
    slider.step = String(IDLE_TIMEOUT_LIMITS.stepMs / 1000)
    slider.value = String(timeouts[key] / 1000)
    readout.textContent = formatIdleTimeout(timeouts[key])

    slider.addEventListener('input', () => {
      const timeoutMs = setIdleTimeout(key, slider.valueAsNumber * 1000)
      if (timeoutMs === null) return
      readout.textContent = formatIdleTimeout(timeoutMs)
      onChange?.()
    })
  }
}

function bindVolume(root) {
  const slider = root.getElementById('volume-slider')
  if (!slider) return
  slider.value = String(getVolume())
  slider.addEventListener('input', () => setVolume(slider.valueAsNumber))
}

/* Same segmented control again, through data-music. Unlike Up next, this one is
   persisted: it sits in the same audio group as the volume slider, which is
   already remembered, and an operator who silenced the floor for a talk should
   not have a restart undo it. */
function bindMusic(root, container) {
  const group = root.getElementById('kiosk-settings-music')
  if (!group) return
  const segments = [...group.querySelectorAll('.kiosk-settings__segment')]
  const current = isMusicEnabled() ? 'on' : 'off'
  container.dataset.music = current
  for (const option of segments) {
    option.setAttribute('aria-checked', String(option.dataset.music === current))
  }

  group.addEventListener('click', event => {
    const segment = event.target.closest('.kiosk-settings__segment')
    if (!segment || !group.contains(segment)) return
    const next = segment.dataset.music
    if (next === container.dataset.music) return
    container.dataset.music = next
    for (const option of segments) {
      option.setAttribute('aria-checked', String(option === segment))
    }
    setMusicEnabled(next === 'on')
  })
}

/* Same segmented control as the layout one, marking itself through data-upnext
   so the two thumbs move independently. */
function bindUpNext(root, container) {
  const group = root.getElementById('kiosk-settings-upnext')
  if (!group) return
  const segments = [...group.querySelectorAll('.kiosk-settings__segment')]
  const current = areUpNextCardsEnabled() ? 'on' : 'off'
  container.dataset.upnext = current
  /* Marked from the value, not from the markup, so the default lives in one
     place and the control cannot disagree with what the cards are doing. */
  for (const option of segments) {
    option.setAttribute('aria-checked', String(option.dataset.upnext === current))
  }

  group.addEventListener('click', event => {
    const segment = event.target.closest('.kiosk-settings__segment')
    if (!segment || !group.contains(segment)) return
    const next = segment.dataset.upnext
    if (next === container.dataset.upnext) return
    container.dataset.upnext = next
    for (const option of segments) {
      option.setAttribute('aria-checked', String(option === segment))
    }
    setUpNextCardsEnabled(next === 'on')
  })
}

/* The segmented control owns the selection: it marks its own thumb through
   data-layout on the settings element, and hands the value to the caller,
   which is what actually restyles the menu. */
function bindLayout(root, container, onLayoutChange) {
  const group = root.getElementById('kiosk-settings-layout')
  if (!group) return container.dataset.layout || 'top'
  const segments = [...group.querySelectorAll('.kiosk-settings__segment')]

  group.addEventListener('click', event => {
    const segment = event.target.closest('.kiosk-settings__segment')
    if (!segment || !group.contains(segment)) return
    const next = segment.dataset.layout
    if (next === container.dataset.layout) return
    container.dataset.layout = next
    for (const option of segments) {
      option.setAttribute('aria-checked', String(option === segment))
    }
    onLayoutChange?.(next)
  })

  return container.dataset.layout || 'top'
}
