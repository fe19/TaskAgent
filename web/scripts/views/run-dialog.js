import { $ } from '../ui.js';
import { state } from '../store.js';
import { esc } from '../format.js';
import { get, put } from '../api-client.js';
import { renderDetail, renderTaskDetail } from './run-detail.js';
import { readSchedule } from './schedule-fields.js';
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

/** Saves a queued task edited in its detail dialog: prompt and schedule; priority stays. */
async function saveTask(event, refreshBoard) {
  const form = event.target.closest('[data-edit-task]');
  if (!form) return;
  event.preventDefault();
  const task = state.tasks.find((t) => String(t.id) === form.dataset.editTask);
  if (!task) return;
  const button = form.querySelector('button[type="submit"]');
  button.disabled = true;
  try {
    const schedule = readSchedule(form);
    const { task: saved } = await put(`/api/tasks/${task.id}`, {
      prompt: form.elements.prompt.value,
      priority: task.priority,
      ...schedule,
    });
    // A server started before scheduling existed accepts the edit but drops the time.
    if (schedule.run_at && !saved.run_at) throw new Error('The server did not save the start time. Restart the server.');
    close();
    await refreshBoard();
  } catch (err) {
    // Shown in the dialog: the page's error banner is hidden behind it.
    const note = $('task-edit-note');
    note.textContent = err.message;
    note.dataset.state = 'error';
    button.disabled = false;
  }
}

export function mount({ refresh: refreshBoard }) {
  $('run-dialog-close').addEventListener('click', close);
  $('run-dialog-body').addEventListener('click', toggleMeta);
  $('run-dialog-body').addEventListener('submit', (event) => saveTask(event, refreshBoard));
  $('run-dialog').addEventListener('close', () => {
    state.openRunId = null;
  });
}
