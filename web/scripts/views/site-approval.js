import { $ } from '../ui.js';
import { put } from '../api-client.js';
import { state } from '../store.js';
import { allowsAllWebsites, mergeSites, sitesNotAllowed } from '/domain/web-access.js';
import { render as renderWebAccess } from './web-access.js';

/**
 * Asks whether a task may reach websites that are not allowed. Resolves to 'task' (this task
 * only), 'permanent' (add to the allowed websites), 'skip' (go on without) or null (cancel).
 */
export function askToAllow(sites, { text = 'This task needs websites that are not allowed:', skip = true } = {}) {
  const dialog = $('sites-dialog');
  $('sites-dialog-text').textContent = text;
  $('sites-dialog-list').replaceChildren(
    ...sites.map((site) => {
      const item = document.createElement('li');
      item.className = 'site-chip';
      item.textContent = site;
      return item;
    }),
  );
  $('sites-skip').hidden = !skip;

  return new Promise((resolve) => {
    const choose = (event) => {
      const button = event.target.closest('[data-choice]');
      if (!button) return;
      finish(button.dataset.choice || null);
    };
    const finish = (choice) => {
      dialog.removeEventListener('click', choose);
      dialog.removeEventListener('cancel', cancel);
      dialog.close();
      resolve(choice);
    };
    const cancel = (event) => {
      event.preventDefault();
      finish(null);
    };
    dialog.addEventListener('click', choose);
    dialog.addEventListener('cancel', cancel);
    dialog.showModal();
  });
}

/**
 * Before a task is saved: asks about websites in its prompt that are not allowed. Returns the
 * sites allowed for this task only, or null when the user cancels. "Add to allowed websites"
 * saves them for every task right away.
 */
export async function checkPromptSites(prompt, taskSites = []) {
  if (allowsAllWebsites(state.settings)) return taskSites; // nothing to ask
  const allowed = state.settings?.shell_allowed_domains ?? [];
  const missing = sitesNotAllowed(prompt, allowed, taskSites);
  if (missing.length === 0) return taskSites;

  const choice = await askToAllow(missing);
  if (choice === null) return null;
  if (choice === 'task') return mergeSites(taskSites, missing);
  if (choice === 'permanent') {
    const { settings } = await put('/api/settings', { shell_allowed_domains: mergeSites(allowed, missing) });
    state.settings = settings;
    renderWebAccess(); // the new sites show in the Web access card at once
  }
  return taskSites;
}
