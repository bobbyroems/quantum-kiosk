export const FRAME_COUNT = 300
export const LAST_FRAME = FRAME_COUNT - 1

/* IQM asked for a fourth stop past gas (25 Aug), reaching a screen the footage
   does not cover — the state the whole module has been building towards.
   The slider therefore runs further than the clip: the first three quarters
   scrub it, and this last stretch holds its final frame while the new screen
   arrives. frameToTime already clamps to the last real frame, so the video
   parks itself rather than needing to be told to.

   This is the "for now" IQM asked for. They expect to reach that screen some
   other way later, which is why the extra travel is one constant rather than
   a second mechanism threaded through the scrub. */
export const TOPOCONDUCTOR_FRAMES = 100
export const TIMELINE_LAST_FRAME = LAST_FRAME + TOPOCONDUCTOR_FRAMES
export const GAS_FADE_OUT_START_FRAME = LAST_FRAME - 18

export const MATTER_PHASES = Object.freeze([
  Object.freeze({ id: 'solid', label: 'Solid', startFrame: 0, endFrame: 99 }),
  Object.freeze({ id: 'liquid', label: 'Liquid', startFrame: 100, endFrame: 199 }),
  Object.freeze({ id: 'gas', label: 'Gas', startFrame: 200, endFrame: LAST_FRAME }),
  Object.freeze({
    id: 'topoconductor',
    label: 'Topoconductor',
    startFrame: FRAME_COUNT,
    endFrame: TIMELINE_LAST_FRAME
  })
])

function finiteNumber(value, fallback = 0) {
  const number = Number(value)
  return Number.isFinite(number) ? number : fallback
}

export function clampProgress(progress) {
  return Math.min(1, Math.max(0, finiteNumber(progress)))
}

export function clampFrame(frame) {
  return Math.min(TIMELINE_LAST_FRAME, Math.max(0, Math.round(finiteNumber(frame))))
}

export function progressToFrame(progress) {
  return clampFrame(clampProgress(progress) * TIMELINE_LAST_FRAME)
}

export function frameToProgress(frame) {
  return clampFrame(frame) / TIMELINE_LAST_FRAME
}

/**
 * The source is 300 frames long. Mapping frame 299 to the beginning of its
 * frame interval avoids seeking to the video's end marker (where some video
 * decoders briefly display no frame).
 */
export function frameToTime(frame, durationSeconds, frameCount = FRAME_COUNT) {
  const duration = Math.max(0, finiteNumber(durationSeconds))
  const count = Math.max(1, Math.round(finiteNumber(frameCount, FRAME_COUNT)))
  const lastFrame = count - 1
  const safeFrame = Math.min(lastFrame, Math.max(0, Math.round(finiteNumber(frame))))

  return duration * (safeFrame / count)
}

export function timeToFrame(timeSeconds, durationSeconds, frameCount = FRAME_COUNT) {
  const duration = Math.max(0, finiteNumber(durationSeconds))
  const count = Math.max(1, Math.round(finiteNumber(frameCount, FRAME_COUNT)))
  if (duration === 0) return 0

  const lastFrame = count - 1
  const frame = Math.floor((Math.max(0, finiteNumber(timeSeconds)) / duration) * count)
  return Math.min(lastFrame, frame)
}

export function phaseForFrame(frame) {
  const safeFrame = clampFrame(frame)
  return MATTER_PHASES.find(phase => safeFrame <= phase.endFrame) || MATTER_PHASES.at(-1)
}

export function frameForKeyboardKey(key, frame, pageStep = 30) {
  const currentFrame = clampFrame(frame)
  const safePageStep = Math.max(1, Math.round(finiteNumber(pageStep, 30)))

  if (key === 'Home') return 0
  if (key === 'End') return TIMELINE_LAST_FRAME
  if (key === 'ArrowLeft' || key === 'ArrowDown') return clampFrame(currentFrame - 1)
  if (key === 'ArrowRight' || key === 'ArrowUp') return clampFrame(currentFrame + 1)
  if (key === 'PageDown') return clampFrame(currentFrame - safePageStep)
  if (key === 'PageUp') return clampFrame(currentFrame + safePageStep)
  return null
}

function smoothstep(startFrame, endFrame, frame) {
  const progress = Math.min(1, Math.max(0, (frame - startFrame) / (endFrame - startFrame)))
  return progress * progress * (3 - (2 * progress))
}

function phaseWeightsForFrame(frame) {
  const liquidProgress = smoothstep(92, 108, frame)
  const gasProgress = smoothstep(192, 208, frame)
  /* Held back until the scrub is clear of the footage, so the last frames of
     gas still read as gas and the fourth state arrives as its own step rather
     than bleeding into the one before it. */
  const topoconductorProgress = smoothstep(FRAME_COUNT + 8, FRAME_COUNT + 62, frame)

  return Object.freeze({
    solid: 1 - liquidProgress,
    liquid: liquidProgress * (1 - gasProgress),
    gas: gasProgress * (1 - topoconductorProgress),
    topoconductor: topoconductorProgress
  })
}

/**
 * Returns presentation weights for a source frame without changing the
 * semantic 0-99 / 100-199 / 200-299 matter phase boundaries.
 */
export function visualStateForFrame(frame) {
  const safeFrame = clampFrame(frame)
  const labels = phaseWeightsForFrame(safeFrame)
  /* Copy follows the design state-for-state: Solid frames the everyday states,
     Liquid introduces the topoconductor, and Gas closes on where the quantum
     information actually lives. */
  const copy = Object.freeze({ ...labels })
  /*
   * The scrub is an amount, and the scene opens cold: the ice is already on at
   * frame 0 — that is the starting state of the experience, not something the
   * visitor has to drag into existence — while the rain and the fog build up from
   * nothing as the scrub advances.
   *
   * The labels are the schedule. phaseWeightsForFrame above settles "Liquid" at
   * 108 and "Gas" at 208, and each effect is timed against those so the caption
   * and the visuals always agree:
   *
   *   - rain reaches full exactly as "Liquid" lands, and is gone by "Gas"
   *   - fog does not begin until the gas phase does, at frame 200
   *
   * Rain deliberately overlaps the ice, and the ice begins retreating from the first
   * frame of the drag rather than holding full through the solid phase. Fog does
   * not overlap in the same way — it waits for its phase, so the gas step reads as
   * a distinct arrival rather than a wash that was already creeping in.
   *
   * Gas clears during the final part of its own range and is fully gone before
   * the topoconductor phase begins. This keeps the fourth state visually clean
   * instead of carrying the previous environment beneath its artwork.
   */
  /* Linear, and from frame 0, so the ice answers the very first pixel of the drag.
     An eased ramp leaves the first stretch of the scrub visually dead — its slope at
     the start is zero — and the whole point of the scrub is that it reads as an
     amount. */
  const frost = 1 - Math.min(1, safeFrame / 185)
  const condensation = smoothstep(24, 108, safeFrame) * (1 - smoothstep(150, 208, safeFrame))
  const fogEntrance = smoothstep(200, 258, safeFrame)
  const fogExit = 1 - smoothstep(GAS_FADE_OUT_START_FRAME, FRAME_COUNT, safeFrame)
  const fog = fogEntrance * fogExit

  return Object.freeze({
    frame: safeFrame,
    phase: phaseForFrame(safeFrame),
    labels,
    copy,
    vfx: Object.freeze({
      frost,
      condensation,
      fog,
      videoBlurPx: fog * 14,
      whiteFogOpacity: fog * 0.25
    }),
    audio: Object.freeze({
      ice: labels.solid + (labels.liquid * 0.35),
      water: labels.liquid,
      steam: fog
    })
  })
}
