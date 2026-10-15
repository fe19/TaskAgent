import { showError, clearError } from './ui.js';
import { state } from './store.js';
import { get } from './api-client.js';
import { connectStream } from './live-stream.js';
import { startClock } from './clock.js';
import * as actions from './actions.js';
import * as settingsView from './views/settings.js';
import * as permissionsView from './views/permissions.js';
import * as environmentView from './views/environment.js';
import * as taskForm from './views/task-form.js';
import * as dispatchView from './views/dispatch.js';
import * as board from './views/board.js';
import * as runDialog from './views/run-dialog.js';
import * as sidebar from './views/sidebar.js';
import * as resources from './views/resources.js';
import * as quota from './views/quota.js';
import * as dragDrop from './views/drag-drop.js';

// Poll if SSE silently dies.
const POLL_MS = 10000;

const VIEWS = [sidebar, settingsView, permissionsView, environmentView, taskForm, dispatchView, runDialog, resources, quota, dragDrop, actions];

async function reloadSettings() {
  const { settings, spec, permissions, environment } = await get('/api/settings');
  Object.assign(state, { settings, spec, permissionMeta: permissions, environmentMeta: environment });
  settingsView.render();
  permissionsView.render();
  environmentView.render();
  dispatchView.render();
  // Shows the selected assistant's allowance; the price per AIC converts Copilot's to dollars.
  quota.load();
  // Queued tiles show the current model; the AIC stat applies to Copilot only.
  board.render();
  board.renderStats();
}

async function refresh() {
  const [agents, tasks] = await Promise.all([get('/api/agents'), get('/api/tasks')]);
  state.agents = agents.agents;
  state.tasks = tasks.tasks;
  // Agents include settings updates from other tabs.
  if (agents.settings) state.settings = agents.settings;
  state.loaded = true;

  board.render();
  board.renderStats();
  dispatchView.render();
  // Claude Code reports its limits during runs; reading them back is a cheap local call.
  if (state.settings?.assistant === 'claude-code') quota.load();
  await runDialog.refresh();
}

async function boot() {
  const context = { refresh, reloadSettings };
  for (const view of VIEWS) view.mount(context);

  try {
    await reloadSettings();
    // Not awaited: the board must not wait for a Claude call.
    quota.refreshClaudeLimits();
    await refresh();
    clearError();
  } catch (err) {
    showError(`Could not reach the server: ${err.message}`);
    state.loaded = true;
    board.render();
    board.renderStats();
  }

  startClock();
  connectStream(() => refresh().catch((err) => showError(err.message)));
  setInterval(() => refresh().catch(() => {}), POLL_MS);
}

boot();
