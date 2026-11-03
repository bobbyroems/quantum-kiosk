(() => {
  const overviewPage = () => `
    <section class="control-shared" data-state="overview">
      <img
        class="control-shared__panel"
        src="assets/images/control/control-slide-one.png"
        alt="Input parameters and circuit visualization"
        loading="eager"
        style="--control-panel-offset: -4%;"
      />
      <div class="control-overview">
        <div class="control-overview__copy">
          <h1 class="control-overview__title">Precise control</h1>
          <p class="control-overview__body">
            Microsoft’s dedicated quantum operating system tightly orchestrates quantum hardware and ensures high-fidelity control. 
          </p>
        </div>
      </div>
      <div class="control-readout">
        <div class="control-readout__analytics">
          <img class="control-readout__tile control-readout__tile--errors" src="assets/images/control/control-slide-two-errors.png" alt="Errors" loading="eager" />
          <img class="control-readout__tile control-readout__tile--recent" src="assets/images/control/control-slide-two-recent-jobs.png" alt="Recent jobs" loading="eager" />
          <img class="control-readout__tile control-readout__tile--target" src="assets/images/control/control-slide-two-target-status.png" alt="Target status" loading="eager" />
        </div>
        <div class="control-readout__copy">
          <h1 class="control-readout__title">Microsoft Quantum Platform</h1>
          <p class="control-readout__body">
           The Microsoft Quantum platform brings quantum hardware, software, AI, and high-performance computing together to create an end-to-end solution.
          </p>
        </div>
      </div>
      <h1 class="control-shared__title">Quantum Development Kit</h1>
      <div class="control-tools">
        <div class="control-tools__stack">
          <img
            class="control-tools__vscode"
            src="assets/images/control/control-slide-three-vscode.png"
            alt="VS Code quantum development environment"
            loading="eager"
          />
          <img
            class="control-tools__copilot"
            src="assets/images/control/control-slide-three-copilot.png"
            alt="Copilot prompt"
            loading="eager"
          />
        </div>
        <div class="control-tools__copy">
          <h2>Your tools,<br>all in one place</h2>
          <p>
           We aspire to empower quantum development in the tools and environments researchers already rely on—like VS Code and Python—augmented by built-in visualization, circuit introspection, and AI-assisted 
coding capabilities. 
          </p>
        </div>
      </div>
      <div class="control-optimize">
        <div class="control-optimize__stack">
          <div class="control-optimize__from-wrap">
            <span class="control-optimize__label control-optimize__label--from">From</span>
            <img
              class="control-optimize__from"
              src="assets/images/control/control-slide-four-from.png"
              alt="VS Code before optimization"
              loading="eager"
            />
          </div>
          <div class="control-optimize__to-wrap">
            <span class="control-optimize__label control-optimize__label--to">To</span>
            <img
              class="control-optimize__to"
              src="assets/images/control/control-slide-four-to.png"
              alt="VS Code after optimization"
              loading="eager"
            />
          </div>
        </div>
        <div class="control-optimize__copy">
          <h2>Optimization to reduce resource requirements</h2>
          <p>
            Best in class classical chemistry methods and chemistry aware quantum algorithms, designed
for today's hardware.
          </p>
        </div>
      </div>
      <div class="control-modular">
        <div class="control-modular__stack">
          <img
            class="control-modular__vscode"
            src="assets/images/control/control-slide-five-new.png"
            alt="VS Code modular workflow"
            loading="eager"
          />
          <div class="control-modular__workflow" aria-hidden="true">
            <!-- Row 1: Chemical structure → Active space engineering → Hamiltonian formation -->
            <div class="control-modular__workflow-row">
              <div class="control-modular__workflow-box" style="--box-index: 0;">
                <span class="control-modular__workflow-text">Chemical<br>structure</span>
              </div>
              <div class="control-modular__workflow-box" style="--box-index: 1;">
                <span class="control-modular__workflow-text">Active space<br>engineering</span>
              </div>
              <div class="control-modular__workflow-box" style="--box-index: 2;">
                <span class="control-modular__workflow-text">Hamiltonian<br>formation</span>
              </div>
            </div>
            <!-- Row 2: Hamiltonian encoding ← Pauli operators optimization ← State Prep -->
            <div class="control-modular__workflow-row">
              <div class="control-modular__workflow-box" style="--box-index: 3;">
                <span class="control-modular__workflow-text">Hamiltonian<br>encoding</span>
              </div>
              <div class="control-modular__workflow-box" style="--box-index: 4;">
                <span class="control-modular__workflow-text">Pauli operators<br>optimization</span>
              </div>
              <div class="control-modular__workflow-box" style="--box-index: 5;">
                <span class="control-modular__workflow-text">State Prep</span>
              </div>
            </div>
            <!-- Row 3: Debugging → Simulation → Execution on hardware -->
            <div class="control-modular__workflow-row">
              <div class="control-modular__workflow-box" style="--box-index: 6;">
                <span class="control-modular__workflow-text">Debugging</span>
              </div>
              <div class="control-modular__workflow-box" style="--box-index: 7;">
                <span class="control-modular__workflow-text">Simulation</span>
              </div>
              <div class="control-modular__workflow-box" style="--box-index: 8;">
                <span class="control-modular__workflow-text">Execution on<br>hardware</span>
              </div>
            </div>
            <!-- SVG overlay: viewBox 530x500 (3×120 boxes + 2×85 gaps, 3×120 + 2×70) -->
            <svg class="control-modular__workflow-arrows" viewBox="0 0 530 500" preserveAspectRatio="none">
              <!-- Row 1 arrows (→): y=60, 15px gap from boxes -->
              <g class="workflow-arrow" style="--arrow-index: 0;">
                <line x1="135" y1="60" x2="180" y2="60" />
                <polygon points="190,60 182,56 182,64" />
              </g>
              <g class="workflow-arrow" style="--arrow-index: 1;">
                <line x1="340" y1="60" x2="385" y2="60" />
                <polygon points="395,60 387,56 387,64" />
              </g>
              <!-- Right elbow: curves outside right, points LEFT at box3-row2 -->
              <g class="workflow-arrow workflow-arrow--elbow" style="--arrow-index: 2;">
                <path d="M 545 60 Q 585 60 585 100 L 585 210 Q 585 250 555 250" fill="none" />
                <polygon points="545,250 553,246 553,254" />
              </g>
              <!-- Row 2 arrows (←): y=250, 15px gap from boxes -->
              <g class="workflow-arrow" style="--arrow-index: 3;">
                <line x1="395" y1="250" x2="350" y2="250" />
                <polygon points="340,250 348,246 348,254" />
              </g>
              <g class="workflow-arrow" style="--arrow-index: 4;">
                <line x1="190" y1="250" x2="145" y2="250" />
                <polygon points="135,250 143,246 143,254" />
              </g>
              <!-- Left elbow: curves outside left, points RIGHT at box1-row3 -->
              <g class="workflow-arrow workflow-arrow--elbow" style="--arrow-index: 5;">
                <path d="M -15 250 Q -55 250 -55 290 L -55 400 Q -55 440 -25 440" fill="none" />
                <polygon points="-15,440 -23,436 -23,444" />
              </g>
              <!-- Row 3 arrows (→): y=440, 15px gap from boxes -->
              <g class="workflow-arrow" style="--arrow-index: 6;">
                <line x1="135" y1="440" x2="180" y2="440" />
                <polygon points="190,440 182,436 182,444" />
              </g>
              <g class="workflow-arrow" style="--arrow-index: 7;">
                <line x1="340" y1="440" x2="385" y2="440" />
                <polygon points="395,440 387,436 387,444" />
              </g>
            </svg>
          </div>
          <img
            class="control-modular__copilot"
            src="assets/images/control/control-slide-five-copilot.png"
            alt="Copilot prompt"
            loading="eager"
          />
        </div>
        <div class="control-modular__copy">
          <h2>Modular</br>architecture</h2>
          <p>
            A unified interface lets users effortlessly swap components across their quantum application workflows, while also enabling them to modify, extend, and experiment with the latest quantum chemistry algorithms.
          </p>
        </div>
      </div>
      <div class="control-community">
        <div class="control-community__hub">
          <div class="control-community__line control-community__line--1"></div>
          <div class="control-community__line control-community__line--2"></div>
          <div class="control-community__line control-community__line--3"></div>
          <div class="control-community__line control-community__line--4"></div>
          <img
            class="control-community__vscode"
            src="assets/images/control/control-slide-six-vscode.png"
            alt="VS Code"
            loading="eager"
          />
          <img
            class="control-community__node control-community__node--1"
            src="assets/images/control/control-slide-six-image1.png"
            alt="Figma integration"
            loading="eager"
          />
          <img
            class="control-community__node control-community__node--2"
            src="assets/images/control/control-slide-six-image2.png"
            alt="Developer"
            loading="eager"
          />
          <img
            class="control-community__node control-community__node--3"
            src="assets/images/control/control-slide-six-image3.png"
            alt="Developer"
            loading="eager"
          />
          <img
            class="control-community__node control-community__node--4"
            src="assets/images/control/control-slide-six-image4.png"
            alt="Molecular structure"
            loading="eager"
          />
        </div>
        <div class="control-community__copy">
          <h2>Come build with us</h2>
          <p>
            Designed for extensibility and fully open source on GitHub, enabling the developer community to collaboratively advance practical quantum applications.
          </p>
        </div>
      </div>
      <div class="control-learnmore">
        <div class="control-learnmore__dots control-learnmore__dots--upper">
          <div class="dot upper-warm"></div>
          <div class="dot-placeholder"></div>
          <div class="dot-placeholder"></div>
          <div class="dot-placeholder"></div>
          <div class="dot upper-warm"></div>
          <div class="dot upper-warm"></div>
          <div class="dot-placeholder"></div>
          <div class="dot-placeholder"></div>
          <div class="dot-placeholder"></div>
          <div class="dot upper-warm"></div>
          <div class="dot orange"></div>
          <div class="dot yellow2"></div>
          <div class="dot upper-warm"></div>
          <div class="dot upper-warm"></div>
          <div class="dot upper-warm"></div>
          <div class="dot upper-warm"></div>
          <div class="dot upper-warm"></div>
          <div class="dot teal"></div>
          <div class="dot yellow"></div>
          <div class="dot upper-warm"></div>
          <div class="dot upper-warm"></div>
          <div class="dot upper-warm"></div>
          <div class="dot upper-warm"></div>
          <div class="dot upper-warm"></div>
          <div class="dot orange"></div>
          <div class="dot upper-warm"></div>
          <div class="dot upper-warm"></div>
          <div class="dot upper-warm"></div>
        </div>
        <div class="control-learnmore__content">
          <h1 class="control-learnmore__title">Learn more about QuNorth<br>and Microsoft Quantum</h1>
          <div class="control-learnmore__qr-row">
            <div class="control-learnmore__qr-item">
              <div class="control-learnmore__qr-code">
                <img src="assets/images/control/qr-qunorth.svg" alt="QR code for qunorth.com" />
              </div>
              <span class="control-learnmore__qr-label">qunorth.com</span>
            </div>
            <div class="control-learnmore__qr-item">
              <div class="control-learnmore__qr-code">
                <img src="assets/images/control/qr-microsoft-quantum.svg" alt="QR code for quantum.microsoft.com" />
              </div>
              <span class="control-learnmore__qr-label">quantum.microsoft.com</span>
            </div>
          </div>
        </div>
        <div class="control-learnmore__dots control-learnmore__dots--lower">
          <div class="dot lower-warm"></div>
          <div class="dot lower-warm"></div>
          <div class="dot lower-warm"></div>
          <div class="dot lower-warm"></div>
          <div class="dot lower-warm"></div>
          <div class="dot pure-white"></div>
          <div class="dot dark"></div>
          <div class="dot lower-warm"></div>
          <div class="dot lower-warm"></div>
          <div class="dot lower-warm"></div>
          <div class="dot lower-warm"></div>
          <div class="dot-placeholder"></div>
          <div class="dot blue2"></div>
          <div class="dot blue"></div>
          <div class="dot lower-warm"></div>
          <div class="dot lower-warm"></div>
          <div class="dot lower-warm"></div>
          <div class="dot lower-warm"></div>
          <div class="dot orange"></div>
          <div class="dot-placeholder"></div>
          <div class="dot lower-warm"></div>
          <div class="dot-placeholder"></div>
          <div class="dot lower-warm"></div>
          <div class="dot-placeholder"></div>
          <div class="dot-placeholder"></div>
          <div class="dot-placeholder"></div>
          <div class="dot lower-cool"></div>
          <div class="dot lower-cool"></div>
          <div class="dot-placeholder"></div>
          <div class="dot-placeholder"></div>
          <div class="dot-placeholder"></div>
          <div class="dot lower-cool"></div>
        </div>
      </div>
    </section>
  `

  window.ControlTemplates = {
    overviewPage
  }
})()
