import { $ } from '../ui.js';
import { state } from '../store.js';
import { esc } from '../format.js';
import { get } from '../api-client.js';
import { renderDetail, renderTaskDetail } from './run-detail.js';
import { isLive } from '/domain/run-status.js';

// Follow new activity only while the reader is near the bottom.
const FOLLOW_THRESHOLD_PX = 40;
// Details are collapsed for finished runs; a live run has no result yet, so they start open.
let showMeta = false;

export async function open(runId) {
  const dialog = $('run-dialog');
  state.openRunId = runId;
  dialog.dataset.runId = runId;

  const known = state.agents.find((a) => String(a.id) === String(runId));
  showMeta = isLive(known?.status);
  $('run-dialog-title').textContent =
    known?.short_label || known?.task_title || `Agent run #${runId}`;
  $('run-dialog-body').innerHTML = '<div class="skeleton"></div>';
  dialog.showModal();
  await refresh(runId);
}

export function openTask(taskId) {
  const task = state.tasks.find((t) => String(t.id) === String(taskId));
  if (!task) return;
  const dialog = $('run-dialog');
  state.openRunId = null;
  delete dialog.dataset.runId;
  $('run-dialog-title').textContent = task.short_label || task.title;
  $('run-dialog-body').innerHTML = renderTaskDetail(task);
  dialog.showModal();
}

export function close() {
  $('run-dialog').close();
}

export async function refresh(runId = state.openRunId) {
  if (runId == null) return;
  const body = $('run-dialog-body');
  try {
    const { run, events } = await get(`/api/runs/${runId}`);
    if (state.openRunId !== runId) return;
    replaceBody(body, renderDetail(run, events, { showMeta }));
  } catch (err) {
    if (state.openRunId === runId) body.innerHTML = `<p class="empty">${esc(err.message)}</p>`;
  }
}

function replaceBody(body, html) {
  const following = body.scrollHeight - body.scrollTop - body.clientHeight < FOLLOW_THRESHOLD_PX;
  const previousTop = body.scrollTop;
  body.innerHTML = html;
  body.scrollTop = following ? body.scrollHeight : previousTop;
}

function toggleMeta(event) {
  const button = event.target.closest('[data-meta-toggle]');
  if (!button) return;
  showMeta = !showMeta;
  $('run-meta').hidden = !showMeta;
  button.setAttribute('aria-expanded', String(showMeta));
  button.textContent = showMeta ? 'Hide details' : 'Show details';
}

export function mount() {
  $('run-dialog-close').addEventListener('click', close);
  $('run-dialog-body').addEventListener('click', toggleMeta);
  $('run-dialog').addEventListener('close', () => {
    state.openRunId = null;
  });
}
