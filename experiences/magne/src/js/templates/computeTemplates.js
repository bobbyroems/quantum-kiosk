(() => {
  const getFlowMarkup = ({ offsetPercent, barHeightPercent, diagramOpacity, greenDotsMarkup, blueDotsMarkup }) => `
    <div class="compute-flow" style="--flow-bar-offset: ${offsetPercent}%; --flow-bar-height: ${barHeightPercent}vw; --flow-diagram-opacity: ${diagramOpacity};">
      <div class="compute-flow-content">
        <div class="compute-flow-info compute-flow-info--top">
          <h2>Quantum error correction</h2>
          <p>Error management occurs in real time alongside computation</p>
        </div>
        <div class="compute-flow-info compute-flow-info--bottom">
          <h2>Dynamic error correction libraries</h2>
          <p>To achieve reliable results, Microsoft's advanced error-correction software continually monitors for errors and corrects them on the fly. These dynamic error-correction libraries and protocols are built into the platform, allowing quantum computations to proceed with far fewer mistakes<br> than uncorrected qubits would allow.</p>
        </div>
        <div class="compute-flow-stats">
          <div class="compute-flow-code-container">
            <div class="compute-flow-code-label compute-flow-code-label--logical">
              <span>Logical Qubits</span>
              <div class="compute-flow-code-line compute-flow-code-line--logical"></div>
            </div>
            <div class="compute-flow-code-card">
              <div class="compute-flow-code-title">Accurate QVS library</div>
              <div class="compute-flow-code-grid-wrapper">
                <div class="compute-flow-code-grid compute-flow-code-grid--green">
                  ${greenDotsMarkup}
                </div>
                <div class="compute-flow-code-divider"></div>
                <div class="compute-flow-code-grid compute-flow-code-grid--blue">
                  ${blueDotsMarkup}
                </div>
              </div>
            </div>
            <div class="compute-flow-code-label compute-flow-code-label--physical">
              <span>Physical Qubits</span>
              <div class="compute-flow-code-line compute-flow-code-line--physical"></div>
            </div>
          </div>
        </div>
      </div>
      <div class="compute-flow-diagram">
        <div class="compute-flow-divider compute-flow-divider--top">
          <div class="compute-flow-divider-vertical compute-flow-divider-vertical--up"></div>
        </div>
        <div class="compute-flow-steps">
          <div class="step">
            <span class="step-title">Detect</span>
            <span class="step-desc">Identify where errors have occurred.</span>
          </div>
          <div class="step">
            <span class="step-title">Correct</span>
            <span class="step-desc">A correction operation is applied to errors.</span>
          </div>
          <div class="step">
            <span class="step-title">Compute</span>
            <span class="step-desc">The system continues to compute during error handling.</span>
          </div>
        </div>
        <div class="compute-flow-arrow">
          <svg class="compute-flow-arrow-shape" viewBox="0 0 1030.129 227.144" aria-hidden="true">
            <defs>
              <linearGradient id="computeFlowArrowGradient" x1="0" y1="0" x2="1" y2="0">
                <stop offset="0%" stop-color="#e85d48" />
                <stop offset="20%" stop-color="#e85d48" />
                <stop offset="45%" stop-color="#1f6fb8" />
                <stop offset="55%" stop-color="#1f6fb8" />
                <stop offset="80%" stop-color="#4ac5b1" />
                <stop offset="100%" stop-color="#4ac5b1" />
              </linearGradient>
            </defs>
            <path d="M0 37H899V0L1030.129 113.572L899 227.144V190H0Z" fill="url(#computeFlowArrowGradient)" />
          </svg>
          <svg class="compute-flow-arrow-grid" viewBox="0 0 280 118" aria-hidden="true">
            <g stroke="rgba(255,255,255,0.8)" stroke-width="2" fill="none">
              <line x1="0" y1="10" x2="280" y2="10" />
              <line x1="0" y1="30" x2="280" y2="30" />
              <line x1="0" y1="50" x2="280" y2="50" />
              <line x1="0" y1="70" x2="280" y2="70" />
              <line x1="0" y1="90" x2="280" y2="90" />
              <line x1="0" y1="110" x2="280" y2="110" />
              <line x1="20" y1="10" x2="20" y2="118" />
              <line x1="55" y1="90" x2="55" y2="22" />
              <line x1="90" y1="30" x2="90" y2="118" />
              <line x1="125" y1="2" x2="125" y2="110" />
              <line x1="160" y1="50" x2="160" y2="118" />
              <line x1="195" y1="62" x2="195" y2="90" />
              <line x1="230" y1="42" x2="230" y2="110" />
              <line x1="265" y1="50" x2="265" y2="98" />
            </g>
            <g stroke="rgba(255,255,255,0.95)" stroke-width="2" fill="none">
              <circle cx="20" cy="110" r="8" />
              <circle cx="55" cy="30" r="8" />
              <circle cx="90" cy="110" r="8" />
              <circle cx="125" cy="10" r="8" />
              <circle cx="160" cy="110" r="8" />
              <circle cx="195" cy="70" r="8" />
              <circle cx="230" cy="50" r="8" />
              <circle cx="265" cy="90" r="8" />
            </g>
            <g fill="rgba(255,255,255,0.95)">
              <circle cx="20" cy="10" r="3" />
              <circle cx="55" cy="90" r="3" />
              <circle cx="90" cy="30" r="3" />
              <circle cx="125" cy="110" r="3" />
              <circle cx="160" cy="50" r="3" />
              <circle cx="195" cy="90" r="3" />
              <circle cx="230" cy="110" r="3" />
              <circle cx="265" cy="50" r="3" />
            </g>
          </svg>
          <div class="compute-flow-arrow-binary">
            <p>0101001010000101</p>
            <p>1010010010100110</p>
            <p>1010101001010110</p>
            <p>0010100010100101</p>
          </div>
          <div class="compute-flow-arrow-lines">
            <div class="compute-flow-arrow-line compute-flow-arrow-line--one"><span class="compute-flow-arrow-h">H</span></div>
            <div class="compute-flow-arrow-line compute-flow-arrow-line--two"><span class="compute-flow-arrow-h">H</span></div>
            <div class="compute-flow-arrow-line compute-flow-arrow-line--three"><span class="compute-flow-arrow-h">H</span></div>
            <div class="compute-flow-arrow-line compute-flow-arrow-line--four"><span class="compute-flow-arrow-h">H</span></div>
          </div>
        </div>
        <div class="compute-flow-divider compute-flow-divider--bottom">
          <div class="compute-flow-divider-vertical compute-flow-divider-vertical--down"></div>
        </div>
      </div>
      <div class="compute-flow-balls"></div>
    </div>
  `

  window.ComputeTemplates = {
    getFlowMarkup
  }
})()
