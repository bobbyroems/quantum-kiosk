import { INTERFERENCE_STAGES } from './interference-stages.js'

export const INTERFERENCE_TIPS = Object.freeze({
  [INTERFERENCE_STAGES.FIRST_SOURCE]: 'Tap the glowing buoy to create a wave',
  [INTERFERENCE_STAGES.FIRST_LESSON]: 'Tap anywhere to continue',
  [INTERFERENCE_STAGES.SECOND_SOURCE]: 'Tap the new buoy to create a second wave',
  [INTERFERENCE_STAGES.SECOND_LESSON]: 'Tap anywhere to continue',
  [INTERFERENCE_STAGES.THIRD_LESSON]: 'Tap anywhere to continue',
  [INTERFERENCE_STAGES.FIELD_SEQUENCE]:
    'Keep tapping the next glowing buoy'
})

/* The rendered finale and spoken announcement share the same copy. CSS wraps
   it to the panel width rather than requiring separately maintained lines. */
export const INTERFERENCE_FINALE = Object.freeze({
  body: 'Quantum algorithms use interference to make promising outcomes stand out from millions of possibilities.',
  tip: 'Tap to finish',
  title: 'An outcome emerges!'
})

export function getInterferencePresentation({
  stage,
  outcome = false
}) {
  if (outcome) {
    return Object.freeze({
      body: INTERFERENCE_FINALE.body,
      showTitle: true,
      tip: INTERFERENCE_FINALE.tip,
      title: INTERFERENCE_FINALE.title
    })
  }

  if (stage === INTERFERENCE_STAGES.RESOLVING) {
    return Object.freeze({
      body: '',
      showTitle: false,
      tip: null,
      title: ''
    })
  }

  return Object.freeze({
    body: '',
    showTitle: false,
    tip: INTERFERENCE_TIPS[stage] ?? null,
    title: ''
  })
}
