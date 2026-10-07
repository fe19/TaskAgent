import { showError, reportError } from '../ui.js';
import { state } from '../store.js';
import { post } from '../api-client.js';
import * as board from './board.js';

export function mount({ refresh }) {
  document.addEventListener('dragstart', onDragStart);
  document.addEventListener('dragover', onDragOver);
  document.addEventListener('dragleave', onDragLeave);
  document.addEventListener('drop', (event) => onDrop(event, refresh));
  document.addEventListener('dragend', endDrag);
}

const targetLane = (event) => {
  const lane = event.target.closest?.('.lane[data-lane]');
  return lane && state.dragging && lane.dataset.lane !== state.dragging.from ? lane : null;
};

function onDragStart(event) {
  const tile = event.target.closest?.('.tile[data-drag-task]');
  if (!tile) return;
  state.dragging = { taskId: tile.dataset.dragTask, from: tile.dataset.dragFrom, copy: Boolean(tile.dataset.dragCopy) };
  event.dataTransfer.effectAllowed = 'move';
  event.dataTransfer.setData('text/plain', tile.dataset.dragTask);
  tile.classList.add('dragging');
  document.getElementById('board').dataset.dragFrom = state.dragging.from;
}

function onDragOver(event) {
  const lane = targetLane(event);
  if (!lane) return;
  event.preventDefault();
  event.dataTransfer.dropEffect = 'move';
  lane.classList.add('drop-target');
}

function onDragLeave(event) {
  const lane = event.target.closest?.('.lane');
  if (lane && !lane.contains(event.relatedTarget)) lane.classList.remove('drop-target');
}

async function onDrop(event, refresh) {
  const lane = targetLane(event);
  if (!lane) return;
  event.preventDefault();
  const { taskId, from, copy } = state.dragging;
  endDrag();
  await reportError(() => post(`/api/tasks/${taskId}/move`, { from, to: lane.dataset.lane, copy }));
  await refresh().catch((err) => showError(err.message));
}

function endDrag() {
  if (!state.dragging) return;
  state.dragging = null;
  delete document.getElementById('board').dataset.dragFrom;
  for (const el of document.querySelectorAll('.drop-target, .tile.dragging')) {
    el.classList.remove('drop-target', 'dragging');
  }
  board.render();
}
