'use strict'

// Electron inserts this into the trusted document, including renderers that reject inline styles.
const RETURN_CONTROL_CSS = `
[data-quantum-return] {
  --return-unit: clamp(1px, 0.1302083333vw, 2.8125px);
  position: absolute;
  z-index: 60;
  top: calc(12 * var(--return-unit));
  right: calc(36 * var(--return-unit));
  max-width: calc(100% - 72 * var(--return-unit));
  font-family: "Segoe UI", Arial, sans-serif;
  font-size: calc(11 * var(--return-unit));
  line-height: 1.25;
  text-align: right;
}
[data-quantum-return] button {
  appearance: none;
  display: flex;
  align-items: center;
  justify-content: center;
  gap: calc(6 * var(--return-unit));
  box-sizing: border-box;
  min-height: calc(26 * var(--return-unit));
  max-width: 100%;
  margin-left: auto !important;
  padding: calc(4 * var(--return-unit)) calc(8 * var(--return-unit)) !important;
  border: calc(1 * var(--return-unit)) solid #ff5a36;
  border-radius: calc(3 * var(--return-unit));
  background: #fff;
  /* User-origin styles must override the imported renderers' button resets. */
  color: #ff5a36 !important;
  font: inherit !important;
  font-weight: 400 !important;
  cursor: pointer;
  touch-action: manipulation;
}
[data-quantum-return] button::after {
  content: "";
  flex: 0 0 auto;
  width: calc(9 * var(--return-unit));
  height: calc(9 * var(--return-unit));
  background:
    linear-gradient(45deg, transparent 45%, currentColor 45%, currentColor 55%, transparent 55%),
    linear-gradient(-45deg, transparent 45%, currentColor 45%, currentColor 55%, transparent 55%);
}
[data-quantum-return] button[aria-busy="true"]::after { visibility: hidden; }
[data-quantum-return] button:focus-visible {
  outline: calc(2 * var(--return-unit)) solid #0055d4 !important;
  outline-offset: calc(3 * var(--return-unit)) !important;
}
[data-quantum-return] button:hover:not(:disabled) { background: #fff5f1; }
[data-quantum-return] button:active:not(:disabled) { background: #ffe5dc; }
[data-quantum-return] button:disabled { opacity: 0.7; cursor: wait; }
[data-quantum-return] p {
  max-width: 20em;
  margin: 0.5em 0 0 !important;
  padding: 0.5em !important;
  border-radius: 0.4em;
  background: #102134;
  color: #fff;
  font: inherit;
  font-size: calc(12 * var(--return-unit));
}
[data-quantum-return][hidden], [data-quantum-return] [hidden] { display: none !important; }
[data-quantum-return="iqm"] {
  /* IQM scales its entire 2160px-wide stage, including this control. */
  --return-unit: 2.8125px;
}
`

module.exports = { RETURN_CONTROL_CSS }
