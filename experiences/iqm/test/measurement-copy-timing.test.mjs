import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { MEASUREMENT_COPY_ENTRANCE_MS } from '../src/js/modules/measurement-based/index.js'

const css = readFileSync(
  new URL('../src/js/modules/measurement-based/measurement-based.css', import.meta.url),
  'utf8'
)

const keyframes = name => css.match(new RegExp(`@keyframes ${name}\\s*\\{[\\s\\S]*?\\r?\\n\\}`))

/* The module schedules the next clip's decode for the moment the copy has
   finished arriving, but the stylesheet is what actually times the copy. Two
   files describing one duration is the shape of bug that only shows up as a
   stutter on a kiosk, so the numbers are compared rather than trusted. */
test('the copy entrance the module waits out matches the one the stylesheet runs', () => {
  const hold = css.match(/--mbqc-copy-hold:\s*(\d+)ms/)
  const inDelay = css.match(/--mbqc-copy-in-delay:\s*calc\(var\(--mbqc-copy-hold\)\s*\+\s*(\d+)ms\)/)
  const travel = css.match(/animation:\s*mbqc-copy-in\s+(\d+)ms/)

  assert.ok(hold, 'the stylesheet still declares --mbqc-copy-hold')
  assert.ok(inDelay, 'the entrance delay is still the hold plus a fixed offset')
  assert.ok(travel, 'the entrance still names its own duration')

  assert.equal(Number(hold[1]), MEASUREMENT_COPY_ENTRANCE_MS.hold)
  assert.equal(Number(inDelay[1]), MEASUREMENT_COPY_ENTRANCE_MS.offset)
  assert.equal(Number(travel[1]), MEASUREMENT_COPY_ENTRANCE_MS.travel)
  assert.equal(MEASUREMENT_COPY_ENTRANCE_MS.total, 1530)
})

/* The exit is held for the same wait as the entrance. Letting it run at 0ms
   again would put a gap between the two halves and read as two movements. */
test('both halves of the copy choreography wait out the same hold', () => {
  const exits = [...css.matchAll(/animation:\s*mbqc-copy-out\s+\d+ms[^;]*?var\(--mbqc-copy-hold\)/g)]
  assert.equal(exits.length, 2, 'both copy-out rules are held')
})

/* The one that actually caused "not one consistent move". A CSS timing
   function runs between each pair of keyframes, not across the animation, so
   an intermediate stop under an ease-out decelerates to zero there and then
   re-accelerates: two movements with a dead stop between them, at any frame
   rate. The entrance has to stay a single segment, and the fade that used to
   hang off that mid stop is its own animation now. */
test('the copy entrance is a single uninterrupted segment', () => {
  const block = keyframes('mbqc-copy-in')
  assert.ok(block, 'mbqc-copy-in is still declared')

  const stops = [...block[0].matchAll(/^\s*(from|to|\d+%)\s*\{/gm)].map(match => match[1])
  assert.deepEqual(stops, ['from', 'to'], 'no intermediate keyframe stop')
  assert.ok(!/opacity/.test(block[0]), 'the entrance carries travel only')

  const fade = keyframes('mbqc-copy-in-fade')
  assert.ok(fade, 'the fade is carried as its own animation')
  assert.ok(!/transform/.test(fade[0]), 'the fade carries opacity only')

  const paired = [...css.matchAll(/mbqc-copy-in\s+\d+ms[^;]*?mbqc-copy-in-fade\s+\d+ms[^;]*;/g)]
  assert.equal(paired.length, 3, 'every entrance runs the travel and the fade together')
})

/* A scaling layer of live text is re-rastered as the scale changes, which on a
   software compositor lands in the same frames as the build clip's decode. */
test('the copy keyframes travel and fade only', () => {
  for (const name of ['mbqc-copy-in', 'mbqc-copy-out']) {
    const block = keyframes(name)
    assert.ok(block, `${name} is still declared`)
    assert.ok(!/scale/.test(block[0]), `${name} carries no scale`)
  }
})
