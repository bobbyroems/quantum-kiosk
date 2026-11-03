'use strict'

// MAGNE's standalone development switch also changes idle behavior. Only its cursor class is adapted.
const adapters = Object.freeze({
  magne: Object.freeze({
    cursorPolicy: Object.freeze({ hideClass: 'kiosk-mode' }),
    returnControl: Object.freeze({ selector: '#attract-screen', activeClass: 'active', theme: 'magne' })
  }),
  iqm: Object.freeze({
    returnControl: Object.freeze({ selector: '[data-screen="attract"]', activeClass: 'is-active', theme: 'iqm' })
  })
})
function getRuntimeAdapter(name) {
  return Object.hasOwn(adapters, name) ? adapters[name] : {}
}
module.exports = { getRuntimeAdapter }
