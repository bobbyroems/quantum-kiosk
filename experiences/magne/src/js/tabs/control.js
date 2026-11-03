class ControlTab {
  constructor() {
    this.id = 'control'
    this.title = 'Control'
    this._deck = null
    this._sharedRoot = null
    this._interactiveDots = null
    this._learnmoreTimer = null
    this.views = [
      {
        label: 'Control Overview',
        panelKey: 'control-shared',
        render: (panel) => this._renderShared(panel),
        onEnter: () => this._setSharedState('overview')
      },
      {
        label: 'Control Readout',
        panelKey: 'control-shared',
        onEnter: () => this._setSharedState('readout')
      },
      {
        label: 'Control Tools',
        panelKey: 'control-shared',
        onEnter: () => this._setSharedState('tools')
      },
      {
        label: 'Control Optimize',
        panelKey: 'control-shared',
        onEnter: () => this._setSharedState('optimize')
      },
      {
        label: 'Control Modular',
        panelKey: 'control-shared',
        onEnter: () => this._setSharedState('modular')
      },
      {
        label: 'Control Community',
        panelKey: 'control-shared',
        onEnter: () => this._setSharedState('community')
      },
      {
        label: 'Learn More',
        panelKey: 'control-shared',
        onEnter: () => this._setSharedState('learnmore')
      }
    ]
  }

  render(container, options = {}) {
    if (this._deck) {
      this._deck.destroy()
      this._deck = null
    }

    this._onSwitchTab = options.onSwitchTab || null

    container.innerHTML = `<div class="tab-slides"></div>`
    const deckHost = container.querySelector('.tab-slides')
    this._deck = new Slideshow({
      container: deckHost,
      slides: this.views,
      initialIndex: 0,
      unmountInactive: true,
      useSwipe: false,
      onOverflowPrev: () => {
        // Switch to Compute tab (last slide) when swiping before first Control slide
        if (this._onSwitchTab) {
          this._onSwitchTab('compute', { slideIndex: 999 }) // 999 will be clamped to last slide
        }
      }
    })
  }

  _placeholder(index) {
    return `<div class="slide-placeholder">${this.title} - Page ${index}</div>`
  }

  _renderShared(panel) {
    panel.innerHTML = window.ControlTemplates ? window.ControlTemplates.overviewPage() : ''
    this._sharedRoot = panel.querySelector('.control-shared')
    return () => {
      this._sharedRoot = null
    }
  }

  _setSharedState(state) {
    // Clean up interactive dots when leaving learnmore state
    if (this._interactiveDots) {
      this._interactiveDots.destroy()
      this._interactiveDots = null
    }
    if (this._learnmoreTimer) {
      clearTimeout(this._learnmoreTimer)
      this._learnmoreTimer = null
    }

    if (this._sharedRoot) {
      this._sharedRoot.dataset.state = state

      // Initialize interactive dots when entering learnmore state
      if (state === 'learnmore' && window.InteractiveDots) {
        const learnmoreEl = this._sharedRoot.querySelector('.control-learnmore')
        if (learnmoreEl) {
          // Small delay to allow CSS transition to complete
          this._learnmoreTimer = setTimeout(() => {
            this._learnmoreTimer = null
            this._interactiveDots = new window.InteractiveDots(learnmoreEl)
            this._interactiveDots.init()
          }, 500)
        }
      }
    }
  }

}

window.ControlTab = ControlTab
