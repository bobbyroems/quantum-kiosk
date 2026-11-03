'use strict';
(() => {
  const bridge = window.launcher;
  let buttons = [...document.querySelectorAll('[data-experience]')];
  const group = document.querySelector('.experiences');
  const status = document.getElementById('status');
  const labels = new Map(buttons.map(button => [button.dataset.experience, button.dataset.experience.toUpperCase()]));
  let busy = false;
  let launching = false;
  let connected = false;
  let active = true;
  let revision = 0;
  let currentState = {};

  function render(state) {
    if (!active) return;
    currentState = state;
    busy = Boolean(state.isLoading);
    buttons.forEach(button => { button.disabled = busy || launching || !connected; });
    group.setAttribute('aria-busy', String(busy || launching));
    status.dataset.error = String(Boolean(state.error));
    status.textContent = state.error || (busy ? `Opening ${labels.get(state.experienceId) || 'experience'}…` : '');
  }

  if (!bridge) {
    render({ error: 'Open this screen through the Quantum launcher application to start an experience.' });
    return;
  }

  function bindButton(button) {
    button.addEventListener('click', async () => {
      if (!active || !connected || busy || launching) return;
      launching = true;
      render({ isLoading: true, experienceId: button.dataset.experience });
      try {
        const result = await bridge.launchExperience(button.dataset.experience);
        launching = false;
        render(result.state);
      } catch {
        launching = false;
        render({ error: 'The experience could not open. Ask an operator to check its build, then try again.' });
      }
    });
  }

  function populate(experiences) {
    if (!Array.isArray(experiences) || experiences.some(entry => !entry || typeof entry.id !== 'string' || typeof entry.label !== 'string')) {
      throw new Error('Invalid experience list');
    }
    if (!active) return;
    labels.clear();
    buttons = experiences.map(entry => {
      const button = document.createElement('button');
      button.className = 'experience';
      button.type = 'button';
      button.dataset.experience = entry.id;
      const label = document.createElement('span');
      label.className = 'experience__label';
      label.textContent = entry.label;
      const action = document.createElement('span');
      action.className = 'experience__action';
      action.setAttribute('aria-hidden', 'true');
      action.textContent = 'Begin ';
      const arrow = document.createElement('span');
      arrow.textContent = '→';
      action.append(arrow);
      button.append(label, action);
      labels.set(entry.id, entry.label);
      bindButton(button);
      return button;
    });
    group.replaceChildren(...buttons);
  }

  render({});
  const unsubscribe = bridge.onStateChanged(state => { revision++; render(state); });
  const initialRevision = revision;
  const stateRead = bridge.getState().then(state => {
    if (initialRevision === revision) render(state);
  });
  const experienceRead = typeof bridge.getExperiences === 'function'
    ? bridge.getExperiences().then(populate)
    : Promise.resolve().then(() => { buttons.forEach(bindButton); });
  Promise.all([stateRead, experienceRead]).then(() => {
    connected = true;
    render(currentState);
  }).catch(() => {
    connected = false;
    render({ error: 'The launcher is unavailable. Ask an operator to restart the application.' });
  });
  window.addEventListener('pagehide', () => { active = false; unsubscribe(); }, { once: true });
})();
