'use strict'

// Electron inserts this into the trusted document, including renderers that reject inline styles.
const RETURN_CONTROL_CSS = `
[data-quantum-return] {
  position: absolute;
  z-index: 60;
  top: clamp(16px, 3vw, 64px);
  right: clamp(16px, 3vw, 64px);
  max-width: calc(100% - 32px);
  font-family: inherit;
  font-size: clamp(16px, 3vw, 64px);
  line-height: 1.25;
  text-align: right;
}
[data-quantum-return] button {
  display: block;
  box-sizing: border-box;
  min-height: clamp(48px, 9vw, 192px);
  max-width: 100%;
  margin-left: auto;
  padding: 0.55em 0.9em;
  border: 2px solid rgba(255, 255, 255, 0.75);
  border-radius: 0.75em;
  background: #102134;
  color: #fff;
  font: inherit;
  letter-spacing: 0.02em;
  cursor: pointer;
  touch-action: manipulation;
}
[data-quantum-return] button:focus-visible {
  outline: 3px solid #fff;
  outline-offset: 4px;
}
[data-quantum-return] button:active { background: #25405c; }
[data-quantum-return] button:disabled { opacity: 0.7; }
[data-quantum-return] p {
  max-width: 20em;
  margin: 0.5em 0 0;
  padding: 0.5em;
  border-radius: 0.4em;
  background: #102134;
  color: #fff;
  font: inherit;
  font-size: 0.85em;
}
[data-quantum-return][hidden], [data-quantum-return] [hidden] { display: none !important; }
[data-quantum-return="iqm"] {
  top: 176px;
  right: 96px;
  max-width: calc(100% - 192px);
  font-size: 64px;
}
[data-quantum-return="iqm"] button {
  min-height: 192px;
  border-width: 6px;
}
[data-quantum-return="iqm"] button:focus-visible {
  outline-width: 12px;
  outline-offset: 16px;
}
`

module.exports = { RETURN_CONTROL_CSS }
