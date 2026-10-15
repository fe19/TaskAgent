import { $ } from '../ui.js';

/** Board | Monitoring. The open tab lives in the URL hash, so a reload stays on it. */
const TABS = ['board', 'monitoring'];
let current = 'board';
const listeners = [];

export const currentTab = () => current;

/** `fn(tab)` runs whenever a tab is shown, including on load. */
export function onShow(fn) {
  listeners.push(fn);
}

function select(tab, { focus = false } = {}) {
  current = TABS.includes(tab) ? tab : 'board';
  for (const name of TABS) {
    const active = name === current;
    const button = $(`tab-btn-${name}`);
    button.setAttribute('aria-selected', String(active));
    button.tabIndex = active ? 0 : -1;
    $(`view-${name}`).hidden = !active;
  }
  if (focus) $(`tab-btn-${current}`).focus();
  const hash = current === 'board' ? '' : `#${current}`;
  if (location.hash !== hash) history.replaceState(null, '', hash || location.pathname + location.search);
  for (const fn of listeners) fn(current);
}

export function mount() {
  const list = $('view-tabs');
  list.addEventListener('click', (event) => {
    const button = event.target.closest('[data-tab]');
    if (button) select(button.dataset.tab);
  });
  // Arrow keys move between tabs (the ARIA tabs pattern).
  list.addEventListener('keydown', (event) => {
    if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return;
    event.preventDefault();
    const step = event.key === 'ArrowRight' ? 1 : TABS.length - 1;
    select(TABS[(TABS.indexOf(current) + step) % TABS.length], { focus: true });
  });
  window.addEventListener('hashchange', () => select(location.hash.slice(1)));
  select(location.hash.slice(1));
}
