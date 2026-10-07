import { $, withButton } from '../ui.js';
import { isAutoDispatch, liveAgents, queuedTasks } from '../store.js';
import { post, put } from '../api-client.js';

export function render() {
  const auto = isAutoDispatch();
  const queued = queuedTasks().filter((t) => !t.held).length;
  const live = liveAgents().length;

  for (const button of $('dispatch-mode').querySelectorAll('[data-mode]')) {
    button.setAttribute('aria-checked', String((button.dataset.mode === 'auto') === auto));
  }

  $('stop-all').hidden = live === 0;
  $('stop-all').textContent = `Stop all (${live})`;

  const hint = $('dispatch-hint');
  hint.dataset.state = auto ? 'running' : 'paused';
  hint.textContent = auto ? autoHint(live, queued) : manualHint(live);
}

function autoHint(live, queued) {
  if (live > 0) return `Auto — ${live} agent(s) working, ${queued} queued.`;
  if (queued > 0) return `Auto — starting ${queued} queued task(s).`;
  return 'Auto — new tasks start automatically.';
}

function manualHint(live) {
  const working = live > 0 ? ` ${live} agent(s) working.` : '';
  return `Manual — press \u25b6 on a queued task to start it.${working}`;
}

export function mount({ refresh, reloadSettings }) {
  const group = $('dispatch-mode');
  group.addEventListener('click', async (event) => {
    const button = event.target.closest('[data-mode]');
    if (!button || button.getAttribute('aria-checked') === 'true') return;
    await withButton(button, async () => {
      await put('/api/dispatch', { running: button.dataset.mode === 'auto' });
      await reloadSettings();
      await refresh();
    })();
  });

  const stopAll = $('stop-all');
  stopAll.addEventListener(
    'click',
    withButton(stopAll, async () => {
      await post('/api/agents/stop-all');
      await refresh();
    }),
  );
}
