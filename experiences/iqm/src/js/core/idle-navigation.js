import { getIdleTimeouts } from './idle-timeouts.js'

export function armIdleController(idleController, activeModuleId) {
  const { returnToMenuMs, returnToHomeMs } = getIdleTimeouts()
  idleController.start(activeModuleId ? returnToMenuMs : returnToHomeMs)
}

export function routeIdle({
  activeModuleId,
  goHome,
  idleController,
  isOpeningExperience,
  openMenu
}) {
  if (isOpeningExperience) {
    idleController.reset()
    return 'reset'
  }
  if (activeModuleId) {
    openMenu()
    return 'menu'
  }
  goHome()
  return 'home'
}

export function rearmIdleController(idleController, activeModuleId) {
  if (idleController.enabled) armIdleController(idleController, activeModuleId)
}
