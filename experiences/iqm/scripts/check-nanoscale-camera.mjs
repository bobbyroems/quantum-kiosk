import { validateNanoscaleCamera } from '../src/js/modules/nanoscale/nanoscale-camera.js'

const report = validateNanoscaleCamera({ tolerance: 1, samples: 1001 })

if (!report.valid) {
  console.error('Nanoscale camera validation failed:')
  report.errors.forEach(error => console.error(`- ${error}`))
  process.exitCode = 1
} else {
  console.log(
    `Nanoscale camera checked: ${report.samples} samples, ` +
    `${report.maxVisualFeatureError.toExponential(2)}px max visual feature error, ` +
    `${(report.maxRegisteredExtentMismatch * 100).toFixed(2)}% max registered extent mismatch, ` +
    `${report.maxScreenPathDeviation.toExponential(2)}px max path deviation, ` +
    `${report.maxViewportOverflow.toExponential(2)}px viewport overflow, ` +
    `${report.maxCameraGroupCoverageGap.toExponential(2)}px camera-group coverage gap, ` +
    `${report.minViewportBackdropCoverage.toFixed(3)} minimum backdrop coverage, ` +
    `${report.maxLayerCount} max active layers, ` +
    `${report.maxRetainedScale.toFixed(2)}x max retained scale`
  )
}
