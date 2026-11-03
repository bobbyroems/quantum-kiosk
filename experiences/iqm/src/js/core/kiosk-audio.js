/*
 * Sample-based sound layer. The context is created and resumed on user
 * gestures (autoplay policy) and buffers decode lazily after that first
 * gesture; every sound silently no-ops until then.
 */
import { assetUrl } from './asset-url.js'

const SAMPLES = {
  ambient: { src: '/assets/audio/ESM_Living_Caves_Alt_Mix_1_Loop_Roomtone_C_120_Noise_Atmosphere_Scifi_Futuristic_Industrial.ogg' },
  blip: { src: '/assets/audio/ESM_Game_Notification_81_Coin_Blip_Select_Tap_Button.ogg', volume: 0.28 },
  whoosh: { src: '/assets/audio/ESM_End_Call3_Glitch_Soft_Airy_Particle_Processed_Beep_Chrip_Electronic.ogg', volume: 0.2 },
  pop: { src: '/assets/audio/ESM_Perfect_Clean_App_Button_Click_2_Organic_Simple_Classic_Game_Click.ogg', volume: 0.32 },
  dive: { src: '/assets/audio/ESM_Power_On_or_Success_Sync_Radar_Ping_Tonal_LFE_Electronic_Synth.ogg', volume: 0.28 },
  chime: { src: '/assets/audio/ESM_Quiet_BellOctave_Notification_Notification_Synth_Electronic_Particle_Cute_Cartoon.ogg', volume: 0.3 },
  /* Bigger than `chime`: the payoff for finishing a whole task, not for one
     step landing. Currently the three tuned dials in Module 05. */
  bonus: { src: '/assets/audio/ESM_New_Bonus_2_Sound_FX_Arcade_Casino_Kids_Mobile_App.wav', volume: 0.3 },
  matterSolidIce: { src: '/assets/audio/som-ice-crackle.ogg', loop: true },
  matterLiquidWater: { src: '/assets/audio/som-water-drip.ogg', loop: true },
  matterGasSteam: { src: '/assets/audio/som-steam-hiss.ogg', loop: true },
  oceanWaves: { src: '/assets/audio/BRS_Water_Waves_Mexico_Med_2.ogg', loop: true, volume: 0.09 },
  oceanFoley: { src: '/assets/audio/FF_ESFXT_foley_kayaking.ogg', loop: true, volume: 0.34 },
  waterEmerge: { src: '/assets/audio/BRS_Water_Swish_Emerge_14.ogg', volume: 0.45 },
  waterDunk: { src: '/assets/audio/BRS_Underwater_Whoosh_09.ogg', volume: 0.42 },
  interferenceCameraWhoosh: { src: '/assets/audio/285555-Whoosh_-Low_gentle-slow_calm_and_deep.wav', volume: 0.3 },
  coinFlip: { src: '/assets/audio/CoinFlipTossRing_S08FO.689.ogg', volume: 0.4 },
  coinSpin: { src: '/assets/audio/WoodMachineSpin_S011FO.1082.ogg', volume: 0.32 },
  coinDrop: { src: '/assets/audio/ESM_Coin_Drop_2_Quarter_Flip_Game_Tinkle_Shimmer_Shiny.ogg', volume: 0.42 }
}

const AMBIENT_VOLUME = 0.08
const AMBIENT_FADE_IN_SECONDS = 3
const AMBIENT_FADE_OUT_SECONDS = 1.5
const VOLUME_STORAGE_KEY = 'kiosk-audio-volume'
const MUSIC_STORAGE_KEY = 'kiosk-audio-music'

let audioContext = null
let masterGain = null
let loadPromise = null
const buffers = new Map()
const bufferPromises = new Map()
const loopMixers = new Set()
const ambientDucks = new Map()

/* `ambientDesired` is where the kiosk is — the loop belongs under a visitor who
   is interacting, not under the attract screen. `musicEnabled` is what the
   operator asked for in the settings panel. Both have to be true for the loop to
   run, and they are kept apart so muting from the panel does not look to the
   rest of the app like a return to attract. */
let ambientDesired = false
let musicEnabled = readStoredMusicEnabled()
let ambientPlayback = null
let masterVolume = readStoredVolume()

function readStoredVolume() {
  try {
    const raw = window.localStorage.getItem(VOLUME_STORAGE_KEY)
    if (raw !== null && raw !== '') {
      const value = Number(raw)
      if (Number.isFinite(value) && value >= 0 && value <= 1) return value
    }
  } catch {
    /* storage unavailable — ignore */
  }
  return 1
}

function readStoredMusicEnabled() {
  try {
    return window.localStorage.getItem(MUSIC_STORAGE_KEY) !== 'off'
  } catch {
    /* storage unavailable - ignore */
    return true
  }
}

export function isMusicEnabled() {
  return musicEnabled
}

/* Turning music off fades the loop out but leaves `ambientDesired` alone, so
   turning it back on mid-session picks the loop up again without waiting for the
   visitor to return to the attract screen and come back in. */
export function setMusicEnabled(next) {
  const value = next !== false
  if (value === musicEnabled) return
  musicEnabled = value
  try {
    window.localStorage.setItem(MUSIC_STORAGE_KEY, value ? 'on' : 'off')
  } catch {
    /* storage unavailable - ignore */
  }
  if (value) void ensureAmbient()
  else fadeOutAmbient()
}

export function getVolume() {
  return masterVolume
}

export function setVolume(value) {
  masterVolume = Math.min(1, Math.max(0, Number(value) || 0))
  if (masterGain) {
    masterGain.gain.setTargetAtTime(masterVolume, audioContext.currentTime, 0.05)
  }
  try {
    window.localStorage.setItem(VOLUME_STORAGE_KEY, String(masterVolume))
  } catch {
    /* storage unavailable — ignore */
  }
}

export function initAudio() {
  const AudioContextClass = window.AudioContext || window.webkitAudioContext
  if (!AudioContextClass) return
  if (!audioContext) {
    audioContext = new AudioContextClass()
    masterGain = audioContext.createGain()
    masterGain.gain.value = masterVolume
    masterGain.connect(audioContext.destination)
  }
  if (audioContext.state === 'suspended') void audioContext.resume()
  void loadBuffers()
  for (const mixer of loopMixers) void mixer.ensureStarted()
}

function loadBuffers() {
  if (loadPromise) return loadPromise
  loadPromise = Promise.all(Object.keys(SAMPLES)
    .filter(name => !SAMPLES[name].loop)
    .map(loadBuffer))
  return loadPromise
}

function loadBuffer(name) {
  if (!audioContext || !SAMPLES[name]) return Promise.resolve(null)
  if (buffers.has(name)) return Promise.resolve(buffers.get(name))
  if (bufferPromises.has(name)) return bufferPromises.get(name)

  const promise = (async () => {
    try {
      const response = await fetch(assetUrl(SAMPLES[name].src))
      if (!response.ok) throw new Error(`HTTP ${response.status}`)
      const buffer = await audioContext.decodeAudioData(await response.arrayBuffer())
      buffers.set(name, buffer)
      return buffer
    } catch (error) {
      console.warn(`Audio sample "${name}" could not be loaded.`, error)
      return null
    } finally {
      bufferPromises.delete(name)
    }
  })()

  bufferPromises.set(name, promise)
  return promise
}

function play(name, { rate = 1 } = {}) {
  if (!audioContext || audioContext.state !== 'running') return
  const buffer = buffers.get(name)
  if (!buffer) return
  const source = audioContext.createBufferSource()
  const gain = audioContext.createGain()
  source.buffer = buffer
  source.playbackRate.value = rate
  gain.gain.value = SAMPLES[name].volume ?? 0.3
  source.connect(gain).connect(masterGain)
  source.start()
}

/*
 * A one-shot that can be cut short, for sounds covering a motion that ends
 * before the sample does. Returns a handle, or null when audio is not
 * running — callers should treat a missing handle as "nothing to stop".
 */
function playStoppable(name, { rate = 1, fadeSeconds = 0.14, delaySeconds = 0 } = {}) {
  if (!audioContext || audioContext.state !== 'running') return null
  const buffer = buffers.get(name)
  if (!buffer) return null
  const source = audioContext.createBufferSource()
  const gain = audioContext.createGain()
  const startAt = audioContext.currentTime + Math.max(0, Number(delaySeconds) || 0)
  source.buffer = buffer
  source.playbackRate.value = rate
  gain.gain.value = SAMPLES[name].volume ?? 0.3
  source.connect(gain).connect(masterGain)
  source.start(startAt)

  let stopped = false
  return {
    stop() {
      if (stopped) return
      stopped = true
      const now = audioContext.currentTime
      gain.gain.cancelScheduledValues(now)
      if (now < startAt) {
        gain.gain.setValueAtTime(0, now)
        source.stop(now)
        return
      }
      /* Ramp off rather than cutting the source dead, which would click. */
      gain.gain.setValueAtTime(Math.max(gain.gain.value, 0.0001), now)
      gain.gain.exponentialRampToValueAtTime(0.0001, now + fadeSeconds)
      source.stop(now + fadeSeconds)
    }
  }
}

/* Fade the melodic loop in once someone starts interacting. */
export function startAmbient() {
  ambientDesired = true
  void ensureAmbient()
}

async function ensureAmbient() {
  if (!audioContext) return
  await Promise.all([audioContext.resume(), loadBuffers()])
  if (!ambientDesired || !musicEnabled) return
  if (ambientPlayback || audioContext.state !== 'running') return
  const buffer = buffers.get('ambient')
  if (!buffer) return
  const source = audioContext.createBufferSource()
  const gain = audioContext.createGain()
  source.buffer = buffer
  source.loop = true
  const now = audioContext.currentTime
  gain.gain.setValueAtTime(0.0001, now)
  gain.gain.exponentialRampToValueAtTime(
    Math.max(0.0001, AMBIENT_VOLUME * effectiveAmbientDuck()),
    now + AMBIENT_FADE_IN_SECONDS
  )
  source.connect(gain).connect(masterGain)
  source.start(now)
  ambientPlayback = { source, gain }
}

/* Fade the loop back out when the kiosk returns to attract mode. */
export function stopAmbient() {
  ambientDesired = false
  fadeOutAmbient()
}

function fadeOutAmbient() {
  if (!ambientPlayback || !audioContext) return
  const { source, gain } = ambientPlayback
  ambientPlayback = null
  const now = audioContext.currentTime
  gain.gain.cancelScheduledValues(now)
  gain.gain.setValueAtTime(Math.max(gain.gain.value, 0.0001), now)
  gain.gain.exponentialRampToValueAtTime(0.0001, now + AMBIENT_FADE_OUT_SECONDS)
  source.stop(now + AMBIENT_FADE_OUT_SECONDS + 0.1)
}

function clampUnit(value, fallback = 0) {
  const number = Number(value)
  if (!Number.isFinite(number)) return fallback
  return Math.min(1, Math.max(0, number))
}

function effectiveAmbientDuck() {
  let factor = 1
  for (const value of ambientDucks.values()) factor = Math.min(factor, value)
  return factor
}

function rampParam(param, target, seconds) {
  if (!audioContext) return
  const now = audioContext.currentTime
  const duration = Math.max(0, Number(seconds) || 0)

  if (typeof param.cancelAndHoldAtTime === 'function') {
    param.cancelAndHoldAtTime(now)
  } else {
    param.cancelScheduledValues(now)
    param.setValueAtTime(Number.isFinite(param.value) ? param.value : target, now)
  }

  if (duration > 0) param.linearRampToValueAtTime(target, now + duration)
  else param.setValueAtTime(target, now)
}

function updateAmbientDuck(fadeSeconds) {
  if (!ambientPlayback || !audioContext) return
  rampParam(
    ambientPlayback.gain.gain,
    AMBIENT_VOLUME * effectiveAmbientDuck(),
    fadeSeconds
  )
}

function createLoopMixer(trackNames, {
  volume = 1,
  ambientDuck = 0.4,
  fadeSeconds = 0.25
} = {}) {
  const names = [...new Set(Array.isArray(trackNames) ? trackNames : [trackNames])]
    .filter(name => SAMPLES[name]?.loop)
  const mixVolume = clampUnit(volume, 1)
  const duckFactor = clampUnit(ambientDuck, 0.4)
  const fadeDuration = Math.max(0, Number(fadeSeconds) || 0)
  const weights = new Map(names.map(name => [name, 0]))
  const playbacks = new Map()
  const duckToken = Symbol('loop-mixer')

  let disposed = false
  let generation = 0
  let startPromise = null

  function applyWeights() {
    if (disposed || !audioContext) return
    for (const [name, playback] of playbacks) {
      const sampleVolume = SAMPLES[name].volume ?? 1
      rampParam(
        playback.gain.gain,
        mixVolume * sampleVolume * (weights.get(name) ?? 0),
        fadeDuration
      )
    }
  }

  async function start(generationAtStart) {
    const contextAtStart = audioContext
    const masterAtStart = masterGain
    if (!contextAtStart || !masterAtStart || disposed) return

    try {
      if (contextAtStart.state === 'suspended') await contextAtStart.resume()

      const missingNames = names.filter(name => !playbacks.has(name))
      const loaded = await Promise.all(missingNames.map(async name => [name, await loadBuffer(name)]))

      if (
        disposed ||
        generationAtStart !== generation ||
        audioContext !== contextAtStart ||
        masterGain !== masterAtStart ||
        contextAtStart.state !== 'running'
      ) return

      const now = contextAtStart.currentTime
      for (const [name, buffer] of loaded) {
        if (!buffer || playbacks.has(name)) continue
        const source = contextAtStart.createBufferSource()
        const gain = contextAtStart.createGain()
        source.buffer = buffer
        source.loop = true
        gain.gain.setValueAtTime(0, now)
        source.connect(gain).connect(masterAtStart)
        source.start(now)
        playbacks.set(name, { gain, source })
      }
      applyWeights()
    } catch (error) {
      if (!disposed && generationAtStart === generation) {
        console.warn('Audio loop mixer could not be started.', error)
      }
    }
  }

  function ensureStarted() {
    if (disposed || !audioContext || names.length === 0) return Promise.resolve()
    if (startPromise) return startPromise
    const generationAtStart = generation
    startPromise = start(generationAtStart).finally(() => {
      startPromise = null
    })
    return startPromise
  }

  const registration = { ensureStarted }
  const mixer = {
    setWeights(nextWeights = {}) {
      if (disposed) return
      names.forEach((name, index) => {
        const value = Array.isArray(nextWeights) ? nextWeights[index] : nextWeights[name]
        weights.set(name, clampUnit(value))
      })
      applyWeights()
      void ensureStarted()
    },
    dispose() {
      if (disposed) return
      disposed = true
      generation += 1
      loopMixers.delete(registration)
      ambientDucks.delete(duckToken)
      updateAmbientDuck(fadeDuration)

      if (!audioContext) return
      const now = audioContext.currentTime
      for (const { gain, source } of playbacks.values()) {
        gain.gain.cancelScheduledValues(now)
        gain.gain.setValueAtTime(0, now)
        try {
          source.stop(now)
        } catch {
          /* Already stopped — disposal remains idempotent. */
        }
        source.disconnect()
        gain.disconnect()
      }
      playbacks.clear()
    }
  }

  if (names.length > 0) {
    loopMixers.add(registration)
    ambientDucks.set(duckToken, duckFactor)
    updateAmbientDuck(fadeDuration)
    void ensureStarted()
  }

  return mixer
}

export const sound = {
  /* Soft pitched tick for a shape popping in — pitch maps to playback rate. */
  blip(pitch = 520) {
    play('blip', { rate: Math.min(1.5, Math.max(0.6, pitch / 520)) })
  },
  /* Slide between cards. */
  whoosh() {
    play('whoosh')
  },
  /* Poking a shape. */
  pop() {
    play('pop')
  },
  /* Diving into a module. */
  dive() {
    play('dive')
  },
  /* Reward moments: heal, confetti. */
  chime() {
    play('chime')
  },
  /* The whole task landing, not a step of it. */
  bonus() {
    play('bonus')
  },
  /* A coin flicked into the air. */
  coinFlip() {
    play('coinFlip')
  },
  /* A coin landing after the toss. */
  coinDrop() {
    play('coinDrop')
  },
  /* Coins winding up into a shared phase. The sample runs 6.2s against a
     ~1.2s move, so this hands back a handle instead of playing to the end —
     stop it when the motion arrives. */
  coinSpin(options) {
    return playStoppable('coinSpin', options)
  },
  /* A buoy pushed under the water. */
  waterDunk() {
    play('waterDunk')
  },
  /* A buoy breaching back out of the water. */
  waterEmerge() {
    play('waterEmerge')
  },
  /* Low, gentle lead-in to the Interference outcome camera move. */
  interferenceCameraWhoosh(options) {
    return playStoppable('interferenceCameraWhoosh', options)
  },
  /* Lazily decoded, continuously mixed ambience for interactive modules. */
  createLoopMixer(trackNames, options) {
    return createLoopMixer(trackNames, options)
  }
}
