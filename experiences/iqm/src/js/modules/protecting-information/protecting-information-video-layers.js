/**
 * The layered device treatment for Protecting quantum information, as set out
 * on the "Stacking the Layers" board (Figma o84Jpq…, node 4:40).
 *
 * The board describes the scene as a stack of numbered passes over one square
 * composition, plus a short sequence of one-shot transitions around it. Some
 * passes are delivered video; two are explicitly *not* — the board annotates
 * the particle passes "still want these to be three.js controlled by dials, use
 * this as reference", and the magnetic arcs likewise. Those are marked here so
 * the gap is visible in the stack rather than being mistaken for a missing file.
 *
 * Most of the video masters have not been delivered. This module names every
 * pass the board names anyway, so the stack is the design's shape and a master
 * dropping into the manifest joins it without anything else changing. What is
 * absent is reported once at mount rather than failing quietly.
 *
 * Layers register with each other automatically: each is positioned from its own
 * crop rectangle as a fraction of the 4096 composition every master was authored
 * inside, so nothing here measures offsets by hand.
 */

import { createAlphaVideo, loadAlphaVideoManifest } from '../../core/alpha-video.js'
import { throwIfAborted } from '../../core/media-lifecycle.js'

/*
 * The board's electron-movement reference, which is what the dials are actually
 * driving. Recorded here because the three.js particle passes have to hit these
 * four states and nothing else in the module writes them down:
 *
 *   00  electrons spread evenly across the chip, moving sporadically
 *   01  electrons slow to a barely noticeable crawl        <- temperature
 *   02  electrons move away from the centred glow, leaving
 *       two precise rows                                    <- voltage
 *   03  those rows align further still, into observable
 *       "pairs"                                             <- magnetic
 */
/* The Add-on FX clip waits eleven seconds, fades up over three, then holds.
   This is a point safely inside the hold. */
const ADD_ON_FX_HELD_SECONDS = 20

/* What the glow reaches at a fully turned dial. It is a bright pass — a hard
   blue line around the whole die — and at full strength it competes with the
   device rather than sitting on it.

   Raised a fifth from the 0.25 it was first held to: at that level the line was
   reading as faded rather than as restraint, and the voltage dial's own effect
   was easy to miss. Still well short of full, which is where it stops sitting
   on the device and starts fighting it. */
const ADD_ON_FX_PEAK_OPACITY = 0.3

/* The intro clip holds a covering state for its first two and a half seconds,
   then wipes away over the next two. Parking just before the wipe skips a dead
   hold the visitor would spend looking at a covered device, while still opening
   from covered. */
const INTRO_COVER_SECONDS = 2.2

/* What each voltage-driven pass reaches at a fully turned dial. The P3 pulse is
   the brightest thing in the stack and at full strength it flares over the die
   rather than running along it, so it is held to just over half. */
const VOLTAGE_PASS_PEAK_OPACITY = Object.freeze({
  'electricity-a': 0.55,
  'electricity-b': 1,
  'h-bar': 1
})

export const ELECTRON_STATES = Object.freeze(['spread', 'slowed', 'channelled', 'paired'])

/* Bottom to top, numbered as the board numbers them — 05 is absent there too.
 *
 * `clip` is the manifest key when the pass is video, and null when the board
 * asks for three.js. `blend` follows the board's "(Add/Screen Mode)" notes:
 * those passes add light rather than covering what is beneath them. */
const LAYER_STACK = Object.freeze([
  Object.freeze({
    order: '00',
    role: 'base',
    label: 'TPT Base Layer',
    /* A still plate, not a clip: the device itself does not move. Everything
       that does move is a pass above it. */
    clip: 'tpt-base-layer'
  }),
  Object.freeze({
    order: '01',
    role: 'particles-a',
    label: 'Particles A',
    clip: null,
    threeJs: true,
    blend: 'plus-lighter'
  }),
  Object.freeze({
    order: '02',
    role: 'over-particles-a',
    label: 'Layer Over Particles A',
    clip: 'tpt-layer-over-particle-a'
  }),
  /* The board breaks 03 into two looping additive passes — "looping Electricity
     pulses A" and "…B", both marked (Add/Screen Mode) — over a base still. The
     two delivered electricity clips are those passes; the base still
     (ELECTRICITY_Pulsing_P2_noH) and the H-reveal overlay have not arrived, so
     the pulses currently ride on the base layer instead. */
  Object.freeze({
    order: '03a',
    role: 'electricity-a',
    label: 'Electricity Pulses A',
    clip: 'electricity-pulsing-p3-add',
    loop: true,
    blend: 'plus-lighter'
  }),
  Object.freeze({
    order: '03b',
    role: 'electricity-b',
    label: 'Electricity Pulses B',
    clip: 'electricity-shapes-loop',
    loop: true,
    blend: 'plus-lighter'
  }),
  Object.freeze({
    order: '04',
    role: 'particles-b',
    label: 'Particles B',
    clip: null,
    threeJs: true,
    blend: 'plus-lighter'
  }),
  Object.freeze({
    /* "Appears over above image when 'H' needs to appear" — the electricity
       sub-board puts it with the pulses, so it sits directly above them and is
       revealed on the same drive rather than resting with the stack. */
    order: '03c',
    role: 'h-bar',
    label: 'H Bar',
    clip: 'tpt-h-bar'
  }),
  Object.freeze({
    order: '06',
    role: 'cover',
    label: 'Over Top of it All',
    /* The board's note: masks and covers the particles where they overrun the
       die at the sides, so it has to stay above both particle passes. */
    clip: 'tpt-layer-above-particles-and-electricity',
    loop: true
  }),
  Object.freeze({
    order: '07',
    role: 'glow-lines',
    label: 'Glow Line FX',
    clip: 'tpt-glow-line-fx',
    loop: true,
    blend: 'plus-lighter'
  }),
  Object.freeze({
    /* The delivered "Add-on FX": a blue glow tracing the die's edge and the
       gate structure, with the nanowires picked out in gold. The board names a
       Glow Line FX at 07 and this is the only delivered pass that looks like
       one, but the names do not match, so it is kept as its own layer rather
       than quietly filed as that one.

       It is authored as a reveal — transparent for its first eleven seconds,
       fading up over the following three, then holding — so it is driven by the
       voltage dial rather than played. See setAddOnFx. */
    order: '07b',
    role: 'add-on-fx',
    label: 'Add-on FX',
    clip: 'tpt-add-on-fx',
    blend: 'plus-lighter'
  }),
  Object.freeze({
    order: '08',
    role: 'magnetic-arcs',
    label: 'Magnetic Wave Pulses',
    /* "Purple Three.JS Magnetic Wave Arc Pulses added at this point." */
    clip: null,
    threeJs: true
  })
])

/* The one-shots around the stack, with the board's own direction for each. */
const SEQUENCE = Object.freeze([
  Object.freeze({
    role: 'intro',
    label: 'TPT Intro Device Fade',
    clip: 'tpt-intro-reveal-short'
  }),
  Object.freeze({
    role: 'device-fade-out',
    label: 'Device fade out',
    /* "Fade out should be over top of the stacked layers to reveal the part of
       the device we want to be at next." */
    clip: 'tpt-device-fade-top'
  }),
  Object.freeze({
    role: 'outro-fade-in',
    label: 'TPT Outro Device Fade In',
    /* "Fade up should be over top of the stacked layers and reveal in full." */
    clip: 'tpt-outro-de-reveal-short'
  }),
  Object.freeze({
    role: 'inset-window',
    label: 'Inset Window Popup',
    /* "Should popup slightly after the Magnetic Pulses begin." */
    clip: 'tpt-nanowire-inset-window'
  }),
  Object.freeze({
    role: 'full-fx-outro',
    label: 'Full FX Outro',
    /* "Fade to this video after the user completes the tuning the dials step." */
    clip: 'tpt-w-full-fx-outro'
  }),
  Object.freeze({
    role: 'electricity-fx-outro',
    label: 'Electricity FX Outro',
    /* "Same as above but without glow line overlays and magnetics." */
    clip: 'device-w-electrons-electricity-outro'
  })
])

function report(missing, awaitingThreeJs, standIns) {
  if (standIns.length) {
    console.warn(`[pqi] standing in for undelivered masters: ${standIns.join(', ')}`)
  }
  if (missing.length) {
    console.warn(
      `[pqi] ${missing.length} of the board's video passes are not in the manifest: `
      + missing.join(', ')
    )
  }
  if (awaitingThreeJs.length) {
    console.info(`[pqi] board asks for three.js here, not video: ${awaitingThreeJs.join(', ')}`)
  }
}

/**
 * Mounts the device stack into a host element.
 *
 * @param {Element} host element the composition square is positioned within
 * @param {object} [options]
 * @param {AbortSignal} [options.signal]
 * @returns {Promise<object>} controller
 */
export async function mountProtectionVideoLayers(host, { signal } = {}) {
  throwIfAborted(signal)
  const manifest = await loadAlphaVideoManifest()
  throwIfAborted(signal)

  let stage = null
  let overlay = null
  const layers = new Map()
  const missing = []
  const awaitingThreeJs = []
  const standIns = []
  let disposed = false
  let abortDisposer = null

  const cleanup = () => {
    if (disposed) return
    disposed = true
    if (abortDisposer) signal?.removeEventListener('abort', abortDisposer)
    for (const layer of layers.values()) layer.instance.dispose()
    layers.clear()
    stage?.remove()
    overlay?.remove()
  }

  try {
    stage = document.createElement('div')
    stage.className = 'pqi__video-stage'
    stage.setAttribute('aria-hidden', 'true')
    host.append(stage)

    /* The one-shots go in their own box above the three.js canvas, not in the
       stack below it. A reveal has to cover what it is revealing, and the
       particles are drawn by three.js over the layer stack — left down there the
       reveal would uncover the device while the particles sat on top of it the
       whole time, visible before they were revealed. */
    overlay = document.createElement('div')
    overlay.className = 'pqi__video-stage pqi__video-stage--over-scene'
    overlay.setAttribute('aria-hidden', 'true')
    host.append(overlay)

    const sequenceRoles = new Set(SEQUENCE.map(entry => entry.role))

    async function add(entry) {
      if (entry.threeJs) {
        awaitingThreeJs.push(`${entry.order ?? '--'} ${entry.label}`)
        return
      }
      if (!entry.clip || !manifest.clips?.[entry.clip]) {
        missing.push(`${entry.order ?? '--'} ${entry.label}`)
        return
      }
      if (entry.standIn) standIns.push(entry.label)

      const instance = await createAlphaVideo({
        manifest,
        id: entry.clip,
        container: sequenceRoles.has(entry.role) ? overlay : stage,
        loop: Boolean(entry.loop),
        autoplay: false,
        signal
      })
      instance.element.classList.add('pqi__video-layer', `pqi__video-layer--${entry.role}`)
      if (entry.blend) {
        instance.element.style.mixBlendMode = entry.blend
        instance.element.classList.add('pqi__video-layer--additive')
      }
      layers.set(entry.role, { ...entry, instance })
    }

    /* In parallel and tolerant of failure: these wait on one another's first frame
       for no benefit, and one clip that never decodes should cost its own pass
       rather than the whole device. */
    const wanted = [...LAYER_STACK, ...SEQUENCE]
    const settled = await Promise.allSettled(wanted.map(add))
    for (const [index, result] of settled.entries()) {
      if (result.status === 'rejected') {
        missing.push(`${wanted[index].order ?? '--'} ${wanted[index].label}`)
        console.warn(`[pqi] ${wanted[index].label} failed to load`, result.reason)
      }
    }
    if (signal?.aborted) {
      cleanup()
      throwIfAborted(signal)
    }
    report(missing, awaitingThreeJs, standIns)

    /* Only a clip with no alpha needs this, which now means only an `additive`
       one. Those are premultiplied over black, and plus-lighter is what makes the
       black disappear — but plus-lighter only cancels black against something.
       Over a transparent backdrop it returns the source unchanged, so wherever
       such a clip overhangs the die it shows as an opaque black rectangle, faded
       in by the voltage dial.

       A clip carrying real alpha has none of this problem: its empty regions have
       zero alpha, so plus-lighter contributes nothing there and the black never
       appears. Clipping one would only crop light that is meant to spill past the
       die, so it is left alone. */
    const plate = layers.get('base')?.instance
    if (plate) {
      const target = plate.placement
      for (const layer of layers.values()) {
        if (!layer.blend || layer.instance.clip.layout !== 'additive') continue
        /* inset() resolves against the element's own box, and every layer sits on
           its own rectangle inside the composition, so the plate's bounds have to
           be expressed per layer rather than shared. */
        const own = layer.instance.placement
        const edge = (value) => `${(Math.max(0, value) * 100).toFixed(3)}%`
        layer.instance.element.style.clipPath = `inset(${[
          edge((target.top - own.top) / own.height),
          edge(1 - ((target.left + target.width - own.left) / own.width)),
          edge(1 - ((target.top + target.height - own.top) / own.height)),
          edge((target.left - own.left) / own.width)
        ].join(' ')})`
      }
    }

    const of = role => layers.get(role)?.instance ?? null
    const show = (instance, visible) => {
      if (instance) instance.element.style.opacity = visible ? '1' : '0'
    }

    /* `fromStart` is false only for a clip already parked where it should begin —
       the armed intro. Everything else rewinds, so a sequence played twice does
       not sit at its own last frame. */
    function playOnce(instance, { fromStart = true } = {}) {
      /* A still has nothing to wait for: it is already on screen. */
      if (!instance?.video) return Promise.resolve()
      return new Promise(resolve => {
        const done = () => resolve()
        instance.video.addEventListener('ended', done, { once: true })
        const start = fromStart ? instance.seek(0) : Promise.resolve()
        start.then(() => instance.play()).catch(done)
      })
    }

    const controller = {
      element: stage,
      elements: [stage, overlay],

      /* Both boxes, since the stack is split across them. */
      setStackOpacity(value) {
        for (const box of [stage, overlay]) box.style.opacity = String(value)
      },

      missing,
      awaitingThreeJs,

      /* The resting device: the stack minus the one-shots, with the passes that
         respond to a dial held at zero until it moves. */
      showStack() {
        for (const entry of LAYER_STACK) {
          const instance = of(entry.role)
          if (!instance) continue
          const driven = entry.role.startsWith('electricity')
            || entry.role === 'h-bar'
            || entry.role === 'add-on-fx'
          show(instance, !driven)
          if (!driven) instance.play().catch(() => {})
        }
        for (const entry of SEQUENCE) show(of(entry.role), false)
      },

      /* The reveal plays over the top of the assembled stack, uncovering what is
         already there — it is not a title card shown in place of the device. The
         board says as much of the outro too: "over top of the stacked layers and
         reveal in full". So the stack goes up first and stays up, and the reveal
         runs above it; the sequence passes are appended after the stack, so they
         are already the topmost layers. */
      /* Puts the reveal in its covering state without playing it, so the module
         can be assembled behind it and then faded up as one finished picture
         rather than arriving a piece at a time. */
      async prepareIntro() {
        controller.showStack()
        const intro = of('intro')
        if (!intro) return
        await intro.seek(INTRO_COVER_SECONDS).catch(() => {})
        show(intro, true)
      },

      async playIntro() {
        controller.showStack()
        const intro = of('intro')
        if (!intro) return
        show(intro, true)
        /* Already parked at its cover point by prepareIntro. */
        await playOnce(intro, { fromStart: false })
        show(intro, false)
      },

      /* Board state 02: the voltage dial drives the electricity pass. A level
         rather than a toggle, because the dial is one. */
      setElectricity(level) {
        const amount = Math.max(0, Math.min(1, level))
        for (const [role, peak] of Object.entries(VOLTAGE_PASS_PEAK_OPACITY)) {
          const instance = of(role)
          if (!instance) continue
          instance.element.style.opacity = String(amount * peak)
          if (amount > 0) instance.play().catch(() => {})
          else instance.pause()
        }
      },

      /* The glow follows the voltage dial. Faded rather than scrubbed: the clip
         carries its reveal as an eleven-second wait and a three-second fade, and
         seeking that window every frame to follow a knob is both expensive and
         jerky. Parking it on its steady state and fading it gives the same
         reveal, smoothly, and takes it back off when the dial comes down. */
      setAddOnFx(level) {
        const amount = Math.max(0, Math.min(1, level)) * ADD_ON_FX_PEAK_OPACITY
        const instance = of('add-on-fx')
        if (!instance) return
        instance.element.style.opacity = String(amount)
      },

      /* Board state 03. No video pass: the board asks for three.js arcs here, so
         this is the hook they will hang from rather than a layer to fade. */
      setMagnetics() {},

      /* The board's ending, in its order: the device fades out over the top of the
         stacked layers, then the reveal comes back up over them. Full FX Outro
         takes the second half when its master arrives; until then the
         de-reveal does. Each step is skipped if its clip is not here, so a
         missing master shortens the sequence rather than stopping it. */
      async playOutro() {
        const fadeOut = of('device-fade-out')
        if (fadeOut) {
          show(fadeOut, true)
          await playOnce(fadeOut)
        }
        const reveal = of('full-fx-outro') ?? of('outro-fade-in')
        if (reveal) {
          show(reveal, true)
          await playOnce(reveal)
        }
        show(fadeOut, false)
      },

      pauseAll() {
        for (const layer of layers.values()) layer.instance.pause()
      },

      dispose() {
        cleanup()
      }
    }
    controller.dispose = controller.dispose.bind(controller)
    abortDisposer = controller.dispose
    signal?.addEventListener('abort', abortDisposer, { once: true })
    if (signal?.aborted) {
      controller.dispose()
      throwIfAborted(signal)
    }

    /* Past the fade, where the glow is fully up and holding. Paused there, since
       the layer's visibility is the dial's business now, not the clip's. */
    const addOnFx = of('add-on-fx')
    if (addOnFx) {
      await addOnFx.seek(ADD_ON_FX_HELD_SECONDS).catch(() => {})
      addOnFx.pause()
    }

    controller.showStack()
    throwIfAborted(signal)
    return controller
  } catch (error) {
    cleanup()
    throw error
  }
}
