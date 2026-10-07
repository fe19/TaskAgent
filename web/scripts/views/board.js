import { $ } from '../ui.js';
import {
  state,
  isAutoDispatch,
  liveAgents,
  finishedAgents,
  queuedTasks,
  strandedTasks,
  reportedTokens,
  reportedAic,
  reportedUsd,
  currentModel,
} from '../store.js';
import { esc, formatNumber, formatUsd } from '../format.js';
import { queuedTile, runTile, strandedTile } from './tiles.js';
import { isTerminal, LANES } from '/domain/run-status.js';

export function render() {
  // Rebuilding the lanes mid-drag would drop the dragged tile.
  if (state.dragging) return;
  const live = liveAgents();

  $('agents-loading').hidden = state.loaded;

  if (!state.loaded) {
    for (const lane of LANES) $(`lane-${lane}`).innerHTML = '';
    return;
  }

  const queuedOpts = { model: currentModel(), assistant: state.settings?.assistant, manual: !isAutoDispatch() };
  fillLane('queued', queuedTasks().map((task) => queuedTile(task, queuedOpts)), 'Nothing queued.');
  fillLane('running', live.map((run) => runTile(run)), 'No agents working.');
  fillLane(
    'done',
    [
      ...finishedAgents().map((run) => runTile(run, retryMode(run))),
      ...strandedTasks().map(strandedTile),
    ],
    'Nothing finished yet.',
  );
}

/** Any run of a finished task retries it; a run of a task that is active again is copied. */
function retryMode(run) {
  const task = state.tasks.find((t) => t.id === run.task_id);
  if (!task) return {};
  return isTerminal(task.status) ? { canRetry: true } : { copyOnDrag: true };
}

export function renderStats() {
  // AI Credits are Copilot's unit; Claude Code reports dollars.
  $('stat-aic-box').hidden = state.settings?.assistant === 'claude-code';
  if (!state.loaded) {
    $('stat-tokens').textContent = '–';
    $('stat-aic').textContent = '–';
    $('stat-usd').textContent = '–';
    return;
  }
  const tokens = reportedTokens();
  const aic = reportedAic();
  // Unknown usage is shown as n/a, not zero.
  $('stat-tokens').textContent = tokens == null ? 'n/a' : formatNumber(tokens);
  $('stat-aic').textContent = aic == null ? 'n/a' : aic.toFixed(aic >= 100 ? 0 : 2);
  $('stat-usd').textContent = formatUsd(reportedUsd()) ?? 'n/a';
}

function fillLane(name, tiles, emptyText) {
  $(`count-${name}`).textContent = String(tiles.length);
  $(`lane-${name}`).innerHTML = tiles.length
    ? tiles.join('')
    : `<p class="lane-empty">${esc(emptyText)}</p>`;
}
