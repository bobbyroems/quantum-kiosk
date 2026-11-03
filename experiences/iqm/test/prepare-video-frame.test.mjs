import assert from 'node:assert/strict'
import test from 'node:test'
import { prepareVideoFrame } from '../src/js/core/prepare-video-frame.js'

class Video extends EventTarget {
  play() { return Promise.resolve() }
  requestVideoFrameCallback(callback) { this.callback = callback; return 7 }
  cancelVideoFrameCallback(id) { this.cancelled = id }
}

test('video warmup waits for a frame rather than merely loaded metadata', async () => {
  const video = new Video()
  const ready = prepareVideoFrame(video)
  video.dispatchEvent(new Event('loadeddata'))
  assert.equal(video.cancelled, undefined)
  video.callback()
  assert.equal(await ready, true)
  assert.equal(video.cancelled, 7)
})

test('unavailable video times out and releases the frame callback', async () => {
  const video = new Video()
  assert.equal(await prepareVideoFrame(video, { timeoutMs: 5 }), false)
  assert.equal(video.cancelled, 7)
})

test('leaving during video preparation cancels the pending callback', async () => {
  const video = new Video(), controller = new AbortController()
  const ready = prepareVideoFrame(video, { signal: controller.signal })
  controller.abort()
  assert.equal(await ready, false)
  assert.equal(video.cancelled, 7)
})
