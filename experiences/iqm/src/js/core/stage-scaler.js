export function calculateStageScale(viewportWidth, viewportHeight, designWidth, designHeight) {
  if ([viewportWidth, viewportHeight, designWidth, designHeight].some(value => value <= 0)) {
    return 1
  }

  return Math.min(viewportWidth / designWidth, viewportHeight / designHeight)
}

export class StageScaler {
  constructor({ stage, designWidth, designHeight, onScale }) {
    this.stage = stage
    this.designWidth = designWidth
    this.designHeight = designHeight
    this.onScale = onScale
    this.handleResize = this.handleResize.bind(this)
  }

  start() {
    window.addEventListener('resize', this.handleResize, { passive: true })
    this.handleResize()
  }

  stop() {
    window.removeEventListener('resize', this.handleResize)
  }

  handleResize() {
    const scale = calculateStageScale(
      window.innerWidth,
      window.innerHeight,
      this.designWidth,
      this.designHeight
    )

    this.stage.style.setProperty('--stage-scale', String(scale))
    this.onScale?.(scale)
  }
}
