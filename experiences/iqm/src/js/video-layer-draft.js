import { createKioskExplainer, updateKioskExplainer } from './core/kiosk-explainer.js'
import { StageScaler } from './core/stage-scaler.js'

const DRAFT_ASSET_ROOT = '/assets/drafts/video-key/'

const clips = Object.freeze([
  {
    file: 'intro-reveal-alpha.webm',
    label: 'Intro reveal',
    source: 'TPT_Intro-Reveal_SHORT.mp4',
    title: 'Intro reveal after black removal',
    body: 'The black background was converted to smooth alpha. The light app background still reveals dark edges caused by H.264 compression.'
  },
  {
    file: 'add-on-fx-alpha.webm',
    label: 'Add-on FX',
    source: 'TPT_Add-on-FX.mp4',
    title: 'Additional light layer',
    body: 'This clip is closest to a classic effects layer. Keying preserves the blue light while removing the black field.'
  },
  {
    file: 'electricity-pulses-alpha.webm',
    label: 'Electricity pulses',
    source: 'TPT_Electricicy_Pulses.mp4',
    title: 'Electrical pulses',
    body: 'Yellow pulses remain visible on the light background, but some soft glow is subtler than against black.'
  },
  {
    file: 'particles-a-alpha.webm',
    label: 'Particles A',
    source: 'TPT_PARTICLES-A.mp4',
    title: 'Particles — layer A',
    body: 'The particles separate well from the background. The darkest edge pixels remain a limitation of the source MP4.'
  },
  {
    file: 'particles-b-alpha.webm',
    label: 'Particles B',
    source: 'TPT_PARTICLES-B.mp4',
    title: 'Particles — layer B',
    body: 'The second layer retains independent motion and can be composited separately. The preview plays a representative segment.'
  },
  {
    file: 'device-fade-top-alpha.webm',
    label: 'Device fade top',
    source: 'TPT_DeviceFadeTop.mp4',
    title: 'Top of device',
    body: 'The key removes the black field but can affect very dark device details. This layer needs an export with native alpha.'
  },
  {
    file: 'device-electrons-outro-alpha.webm',
    label: 'Device + electrons outro',
    source: 'Device_wElectrons+Electricity-OUTRO.mp4',
    title: 'Device and electrons — outro',
    body: 'The full object is readable, but the black matte was already baked into the edges. The draft shows the recoverable quality.'
  },
  {
    file: 'full-fx-outro-alpha.webm',
    label: 'Full FX outro',
    source: 'TPT_wFullFX-OUTRO.mp4',
    title: 'Full effects set — outro',
    body: 'The composition regains a transparent background, but soft light and dark elements compete in the same luminance range.'
  },
  {
    file: 'outro-dereveal-alpha.webm',
    label: 'Outro de-reveal',
    source: 'TPT_Outro-DeReveal_SHORT.mp4',
    title: 'Outro de-reveal',
    body: 'A short keyed outro layer. The light background makes the dark fringe left by the source H.264 easy to see.'
  },
  {
    file: 'nanowire-opaque.mp4',
    label: 'Nanowire inset — bez klucza',
    source: 'TPT_Nanowire_InsetWindow.mp4',
    title: 'Nanowire inset remains opaque',
    body: 'This clip has no black background to remove. The blue-grey field is part of the image, so it is shown without keying.'
  }
])

const backgrounds = Object.freeze([
  { id: 'app', label: 'Background: app' },
  { id: 'checker', label: 'Background: alpha check' },
  { id: 'dark', label: 'Background: dark' }
])

const stage = document.getElementById('kiosk-stage')
const surface = document.querySelector('.video-draft__surface')
const media = document.querySelector('[data-draft-media]')
const video = document.querySelector('[data-draft-video]')
const loading = document.querySelector('[data-draft-loading]')
const error = document.querySelector('[data-draft-error]')
const select = document.querySelector('[data-draft-select]')
const status = document.querySelector('[data-draft-status]')
const playButton = document.querySelector('[data-draft-action="play"]')
const backgroundButton = document.querySelector('[data-draft-action="background"]')

let activeIndex = 0
let backgroundIndex = 0
let loadSequence = 0

const explainer = createKioskExplainer({
  className: 'video-draft__explainer',
  headingLevel: 1,
  title: clips[0].title,
  body: clips[0].body,
  visible: true,
  ariaHidden: false
})
document.querySelector('[data-draft-explainer]').append(explainer.element)

for (const [index, clip] of clips.entries()) {
  const option = document.createElement('option')
  option.value = String(index)
  option.textContent = clip.label
  select.append(option)
}

function setPlayButton(paused) {
  playButton.textContent = paused ? 'Play' : 'Pause'
  playButton.setAttribute('aria-pressed', String(paused))
}

async function loadClip(index) {
  activeIndex = (index + clips.length) % clips.length
  const clip = clips[activeIndex]
  const sequence = ++loadSequence

  select.value = String(activeIndex)
  media.classList.remove('is-ready')
  loading.hidden = false
  error.hidden = true
  status.textContent = `Source: ${clip.source}`
  updateKioskExplainer(explainer, {
    title: clip.title,
    body: clip.body,
    visible: true,
    ariaHidden: false
  })

  video.pause()
  video.src = `${DRAFT_ASSET_ROOT}${clip.file}`
  video.load()

  try {
    await new Promise((resolve, reject) => {
      const onReady = () => resolve()
      const onError = () => reject(new Error('Could not read the local preview file.'))
      video.addEventListener('loadeddata', onReady, { once: true })
      video.addEventListener('error', onError, { once: true })
    })
    if (sequence !== loadSequence) return
    await video.play()
    media.classList.add('is-ready')
    loading.hidden = true
    setPlayButton(false)
  } catch (loadError) {
    if (sequence !== loadSequence) return
    loading.hidden = true
    error.textContent = `${loadError.message} Restart the draft generator and refresh the page.`
    error.hidden = false
    setPlayButton(true)
  }
}

function changeBackground() {
  backgroundIndex = (backgroundIndex + 1) % backgrounds.length
  const background = backgrounds[backgroundIndex]
  surface.dataset.draftBackground = background.id
  backgroundButton.textContent = background.label
}

document.querySelector('[data-draft-action="previous"]').addEventListener('click', () => {
  void loadClip(activeIndex - 1)
})

document.querySelector('[data-draft-action="next"]').addEventListener('click', () => {
  void loadClip(activeIndex + 1)
})

playButton.addEventListener('click', async () => {
  if (video.paused) {
    try {
      await video.play()
      setPlayButton(false)
    } catch {
      setPlayButton(true)
    }
  } else {
    video.pause()
    setPlayButton(true)
  }
})

backgroundButton.addEventListener('click', changeBackground)

select.addEventListener('change', () => {
  void loadClip(Number(select.value))
})

document.addEventListener('visibilitychange', () => {
  if (document.hidden) {
    video.pause()
    setPlayButton(true)
  }
})

new StageScaler({
  stage,
  designWidth: 2160,
  designHeight: 3840
}).start()

void loadClip(0)
