import { esc, elapsedMs, formatDuration, formatNumber } from '../format.js';
import { isLive, isFailure, OUTCOME_WORD } from '/domain/run-status.js';

const actionButton = (action, id, label, symbol, extra = '') =>
  `<button class="tile-btn" data-action="${action}" data-id="${id}"
           title="${esc(label)}" aria-label="${esc(label)}"${extra}>${symbol}</button>`;

const TRASH_ICON =
  '<svg viewBox="0 0 16 16" width="13" height="13" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M2.5 4h11M6 4V2.5h4V4M4 4l.7 9.5h6.6L12 4M6.8 6.8v4M9.2 6.8v4"/></svg>';

const DELETE = (id, confirm) =>
  actionButton('delete-task', id, 'Delete this task', TRASH_ICON,
    `${confirm ? ` data-confirm="${esc(confirm)}"` : ''} data-variant="danger"`);

const ASSISTANT_TAG = { copilot: 'Copilot', 'claude-code': 'Claude Code' };

const modelTag = (model, assistant) =>
  model
    ? `<span class="tile-model" title="${esc(ASSISTANT_TAG[assistant] ?? assistant ?? 'Model')}: ${esc(model)}">${esc(model.replace(/^claude-/, ''))}</span>`
    : '';

const RETRY = (id) => actionButton('requeue-task', id, 'Retry: move back to the queue', '&#x21bb;');
const START = (id) => actionButton('start-task', id, 'Start this task', '&#x25b6;');

const EDIT_ICON =
  '<svg viewBox="0 0 16 16" width="13" height="13" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M10.5 2.5l3 3L6 13H3v-3z"/></svg>';
const EDIT = (id) => actionButton('edit-task', id, 'Edit the prompt', EDIT_ICON);

const DOWNLOAD_ICON =
  '<svg viewBox="0 0 16 16" width="13" height="13" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M8 2.5v8M4.5 7 8 10.5 11.5 7M3 13.5h10"/></svg>';

const DOWNLOAD = (runId) =>
  `<a class="tile-btn" href="/api/runs/${runId}/result" download
      title="Download the result" aria-label="Download the result">${DOWNLOAD_ICON}</a>`;

const tile = ({ outcome, title, label, sub, head = '', open = null, openTask = null, drag = null, foot = '', buttons = [] }) => `
  <article class="tile" data-outcome="${esc(outcome)}" title="${esc(title)}"
           ${open != null ? `data-open="${open}" role="button" tabindex="0"` : ''}
           ${openTask != null ? `data-open-task="${openTask}" role="button" tabindex="0"` : ''}
           ${drag ? `draggable="true" data-drag-task="${drag.taskId}" data-drag-from="${drag.lane}"` : ''}
           ${drag?.copy ? 'data-drag-copy="true"' : ''}>
    <div class="tile-row">
      <p class="tile-label">${esc(label)}</p>
      ${head}
    </div>
    <p class="tile-sub">${sub}<span class="tile-actions">${buttons.join('')}</span></p>
    ${foot}
  </article>`;

export function queuedTile(task, { model, assistant, manual = false } = {}) {
  const level = task.priority >= 9 ? 'urgent' : task.priority >= 5 ? 'high' : null;
  return tile({
    outcome: 'queued',
    title: task.title,
    openTask: task.id,
    drag: { taskId: task.id, lane: 'queued' },
    label: task.short_label || task.title,
    head: `${modelTag(model, assistant)}${level ? `<span class="prio" data-level="${level}">${level}</span>` : ''}`,
    sub: `<span>${task.held ? 'On hold' : manual ? 'Ready to start' : 'Waiting for a slot'}</span>`,
    buttons: [task.held || manual ? START(task.id) : '', EDIT(task.id), DELETE(task.id)],
  });
}

export function strandedTile(task) {
  return tile({
    outcome: task.status,
    title: task.title,
    openTask: task.id,
    drag: { taskId: task.id, lane: 'done' },
    label: task.short_label || task.title,
    sub: `<span>${esc(OUTCOME_WORD[task.status] ?? task.status)} before starting</span>`,
    buttons: [RETRY(task.id), DELETE(task.id)],
  });
}

function runSubtitle(run) {
  if (isLive(run.status)) return run.current_activity || 'Starting…';
  if (isFailure(run.status)) return run.error || OUTCOME_WORD[run.status] || run.status;
  return run.usage ? `${formatNumber(run.usage.total_tokens)} tokens` : 'no usage reported';
}

export function runTile(run, { canRetry = false, copyOnDrag = false } = {}) {
  const live = isLive(run.status);
  const elapsed = esc(formatDuration(elapsedMs(run)));
  const tick = live ? ` data-tick="${esc(run.started_at)}"` : '';

  return tile({
    outcome: run.status,
    title: run.task_title,
    label: run.short_label || run.task_title,
    open: run.id,
    // Finished tiles stay as history; dragging one retries (or copies) its task.
    drag: live
      ? { taskId: run.task_id, lane: 'running' }
      : canRetry || copyOnDrag
        ? { taskId: run.task_id, lane: 'done', copy: copyOnDrag }
        : null,
    head: `${modelTag(run.model, run.assistant)}<span class="tile-stat"${tick}>${elapsed}</span>`,
    sub: `${live ? '<span class="spinner" aria-hidden="true"></span>' : ''}<span>${esc(runSubtitle(run))}</span>`,
    buttons: [
      !live && run.has_result ? DOWNLOAD(run.id) : '',
      canRetry && !live ? RETRY(run.task_id) : '',
      DELETE(
        run.task_id,
        live
          ? 'Stop this agent and delete the task with its run history?'
          : 'Delete this task with all of its runs and results?',
      ),
    ],
    foot: live
      ? `<button class="tile-x" data-action="stop-run" data-id="${run.id}"
                 title="Stop this agent" aria-label="Stop this agent">&times;</button>`
      : '',
  });
}
