import { createKioskExplainer, disposeKioskExplainer } from '../../core/kiosk-explainer.js'
import { createKioskTooltip } from '../../core/kiosk-tooltip.js'
import { createInterferenceLesson, disposeInterferenceLesson } from './interference-lesson.js'
import { INTERFERENCE_FINALE } from './interference-presentation.js'

/* One grid keeps the active card and its hint together as copy or fonts change.
   The game controls visibility; CSS owns all sizing and spacing. */
export function createInterferenceGuidance() {
  const element = document.createElement('div')
  element.className = 'qvc-interference__guidance'
  const lesson = createInterferenceLesson()
  const finaleExplainer = createKioskExplainer({
    ariaHidden: true,
    body: INTERFERENCE_FINALE.body,
    className: 'qvc-interference__finale',
    tagName: 'section',
    title: INTERFERENCE_FINALE.title,
    visible: false
  })
  finaleExplainer.element.dataset.finale = ''
  finaleExplainer.title.classList.add('qvc-interference__tooltip-title')
  finaleExplainer.body.classList.add('qvc-interference__tooltip-description')
  const interactionTooltip = createKioskTooltip({
    className: 'kiosk-tooltip--light qvc-interference__interaction-tip',
    hidden: true
  })
  interactionTooltip.element.dataset.interferenceTip = ''
  element.append(lesson, finaleExplainer.element, interactionTooltip.element)

  return {
    element,
    lesson,
    finaleExplainer,
    interactionTooltip,
    dispose() {
      disposeInterferenceLesson(lesson)
      disposeKioskExplainer(finaleExplainer)
      element.remove()
    }
  }
}
