import { $, clearError, reportError } from './ui.js';
import { post, del } from './api-client.js';
import * as runDialog from './views/run-dialog.js';
import * as taskForm from './views/task-form.js';

const ACTIONS = {
  'cancel-task': (id) => post(`/api/tasks/${id}/cancel`),
  'delete-task': (id) => del(`/api/tasks/${id}`),
  'start-task': (id) => post(`/api/tasks/${id}/start`),
  'stop-run': (id) => post(`/api/runs/${id}/stop`),
  'requeue-task': async (id) => {
    await post(`/api/tasks/${id}/requeue`);
    // The retry is a new run, so close the old detail.
    runDialog.close();
  },
};

export function mount({ refresh }) {
  document.addEventListener('click', (event) => onClick(event, refresh));
  document.addEventListener('keydown', onKeydown);
  $('error-dismiss').addEventListener('click', clearError);
}

async function onClick(event, refresh) {
  const button = event.target.closest('button[data-action]');
  if (!button) {
    if (event.target.closest('a[href]')) return;
    openTile(event.target);
    return;
  }
  event.stopPropagation();

  const { action, id } = button.dataset;
  if (action === 'copy-result') return copyResult(button);
  if (action === 'edit-task') {
    runDialog.close();
    return taskForm.edit(id);
  }
  if (button.dataset.confirm && !window.confirm(button.dataset.confirm)) return;

  button.disabled = true;
  const ok = await reportError(async () => {
    await ACTIONS[action]?.(id);
    await refresh();
  });
  if (!ok) button.disabled = false;
}

function onKeydown(event) {
  if (event.key !== 'Enter' && event.key !== ' ') return;
  if (event.target.closest?.('a[href], button')) return;
  if (openTile(event.target)) event.preventDefault();
}

function openTile(target) {
  const tile = target.closest?.('.tile[data-open], .tile[data-open-task]');
  if (!tile) return false;
  if (tile.dataset.open) runDialog.open(tile.dataset.open);
  else runDialog.openTask(tile.dataset.openTask);
  return true;
}

async function copyResult(button) {
  await navigator.clipboard.writeText($('result-text').textContent);
  button.textContent = 'Copied';
  button.disabled = true;
  setTimeout(() => {
    button.textContent = 'Copy';
    button.disabled = false;
  }, 1500);
}
