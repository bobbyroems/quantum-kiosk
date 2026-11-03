class TabRegistry {
  constructor() {
    this.tabs = {
      connect: new ConnectTab(),
      compute: new ComputeTab(),
      control: new ControlTab()
    }
  }

  get(tabId) {
    return this.tabs[tabId]
  }

  /**
   * Preload assets for all tabs that support it.
   * Call early to avoid hitches when switching tabs.
   */
  preload() {
    Object.values(this.tabs).forEach(tab => {
      if (typeof tab.preload === 'function') {
        tab.preload()
      }
    })
  }
}

window.TabRegistry = TabRegistry
