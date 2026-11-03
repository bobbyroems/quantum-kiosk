(() => {
  const quNorthPage = () => `
    <div class="connect-qunorth">
      <!-- Background map image with locator dot -->
      <div class="qunorth-map-bg anim-hidden">
        <img src="assets/images/connect/connect-map.png" alt="" />
        <!-- Pulsing locator dot - positioned relative to map -->
        <div class="locator-dot anim-hidden">
          <span class="locator-pulse"></span>
          <span class="locator-center"></span>
        </div>
      </div>

      <!-- Main content -->
      <div class="qunorth-content">
        <!-- QuNorth text section -->
        <div class="qunorth-intro">
          <h2 class="qunorth-title anim-hidden">QuNorth</h2>
          <p class="qunorth-subtitle anim-hidden"><strong>A Nordic Quantum Initiative</strong></p>
          <p class="qunorth-body anim-hidden">
            QuNorth's mission is to empower the Nordic innovation ecosystem by providing reliable and cost-effective access to critical technologies for Nordic researchers and companies.
          </p>
        </div>

        <!-- Location section - revealed on dot tap -->
        <div class="qunorth-location location-hidden">
          <div class="location-card">
            <div class="location-image">
              <img src="assets/images/connect/connect-ronnegade-6.png" alt="Copenhagen's Innovation District" />
            </div>
            <div class="location-info">
              <h3 class="location-title">Copenhagen's Innovation District</h3>
              <p class="location-desc">
                The new quantum facility in Copenhagen's Innovation District will provide the Nordic region with access to Magne, one of the most powerful quantum computers. The high-performance, next-generation hardware at the center of Copenhagen's growing quantum ecosystem will advance both scientific breakthroughs and the Nordics' position in the global quantum landscape.
              </p>
            </div>
          </div>
        </div>
      </div>
    </div>
  `

  const magnePage = () => `
    <div class="connect-magne">
      <!-- Orange circle with video and intro inside -->
      <div class="magne-circle anim-hidden">
        <div class="magne-circle-ring"></div>

        <!-- Image sequence -->
        <div class="magne-video-wrap">
          <img
            class="magne-video-frame"
            src="assets/images/connect/turntable/frame_0001.png"
            alt=""
          />
          <!-- Swipe hint animation overlay -->
          <div class="magne-swipe-hint"></div>
        </div>

        <!-- Title and description inside circle -->
        <div class="magne-intro">
          <h2 class="magne-title anim-hidden">Magne</h2>
          <p class="magne-body anim-hidden">
            Magne will become the world's first commercially available Level 2 quantum computer, featuring 50 logical qubits and over 1,200 physical qubits. It is a full-stack quantum computer, meaning it includes not only the hardware containing qubits, but also algorithms, software, an operating system, compiler, and control electronics.
          </p>
        </div>
      </div>

      <!-- Specs section below circle -->
      <div class="magne-specs anim-hidden">
        <h3 class="specs-title">Specs</h3>
        <div class="specs-table">
          <div class="specs-column">
            <div class="spec-row"><span class="spec-label">Modality</span></div>
            <div class="spec-row"><span class="spec-label">Atom type</span></div>
            <div class="spec-row"><span class="spec-label">Qubit type</span></div>
            <div class="spec-row"><span class="spec-label">Physical qubits (PQs)</span></div>
            <div class="spec-row"><span class="spec-label">Connectivity</span></div>
            <div class="spec-row"><span class="spec-label">1Q gate fidelity</span></div>
            <div class="spec-row"><span class="spec-label">2Q gate fidelity</span></div>
            <div class="spec-row"><span class="spec-label">Parallel gate operations</span></div>
          </div>
          <div class="specs-column">
            <div class="spec-row"><span class="spec-value">Neutral atoms</span></div>
            <div class="spec-row"><span class="spec-value">Ytterbium-171</span></div>
            <div class="spec-row"><span class="spec-value">Nuclear-spin</span></div>
            <div class="spec-row"><span class="spec-value">> 1,200</span></div>
            <div class="spec-row"><span class="spec-value">All-to-All</span></div>
            <div class="spec-row"><span class="spec-value">> 99.9%</span></div>
            <div class="spec-row"><span class="spec-value">> 99.6%</span></div>
            <div class="spec-row"><span class="spec-value">Yes</span></div>
          </div>
        </div>
      </div>
    </div>
  `

  const qdkPage = () => `
    <div class="connect-qdk">
      <!-- Top section: Title + Logos -->
      <div class="qdk-top-section">
        <div class="qdk-intro anim-hidden">
          <h2 class="qdk-title">New tools for quantum development</h2>
          <p class="qdk-body">
           The Quantum Development Kit (QDK) is Microsoft’s open-source developer toolkit for building quantum applications. It provides everything needed to build, simulate, and execute quantum code, both locally and on quantum hardware. 
          </p>
        </div>
        <div class="qdk-logos anim-hidden">
          <img src="assets/images/connect/connect-copilot-vs-logos.svg" alt="VS Code and Copilot logos" />
        </div>
      </div>

      <!-- Middle section: QDK Window + Chemistry info -->
      <div class="qdk-middle-section">
        <div class="qdk-window anim-hidden">
          <img src="assets/images/connect/connect-qdk-window.svg" alt="QDK Window" />
        </div>
        <div class="qdk-molecule anim-hidden">
          <img src="assets/images/connect/connect-molecule.png" alt="Molecule visualization" />
        </div>
        <div class="qdk-chemistry-info anim-hidden">
          <h3 class="qdk-chemistry-title">Integrated chemistry applications</h3>
          <p class="qdk-chemistry-body">
            Nature is quantum, and chemistry is quantum mechanics in action.The simulation of quantum systems in chemistry and materials science is where quantum computers are likely to first deliver true advantage
          </p>
        </div>
      </div>

      <!-- Bottom section: Accelerate info -->

    </div>
  `

  const fullStackPage = () => `
    <div class="connect-fullstack">
      <div class="fs-stack-wrapper">
        <!-- The entire stack is built by JS to match exact reference layout -->
        <div class="fs-stack-content"></div>
      </div>

      <!-- Footer section -->
      <div class="fs-footer anim-hidden">
        <h2 class="fs-footer-title">Integrated full-stack solution for quantum computing</h2>
        <p class="fs-footer-body">Microsoft offers a holistic quantum platform that spans hardware, software, and cloud services. This adaptable platform securely combines quantum hardware options with integrated software toolsand Azure’s cloud infrastructure. Our full-stack approach enables enterprises to access quantum processors, tools, and high-performance classical resources in a unified environment.</p>
      </div>
    </div>
  `

  window.ConnectTemplates = {
    quNorthPage,
    magnePage,
    qdkPage,
    fullStackPage
  }
})()
