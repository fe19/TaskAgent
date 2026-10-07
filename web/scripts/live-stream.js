import { $ } from './ui.js';

const REFRESH_EVENTS = [
  'run.started',
  'run.activity',
  'run.finished',
  'run.usage',
  'run.usage_unavailable',
  'task.created',
  'task.updated',
  'task.deleted',
  'task.cancelled',
  'task.requeued',
  'task.released',
  'scheduler.dispatched',
  'scheduler.error',
  'settings.updated',
  'assistant.limits',
];

function setConnection(name, label) {
  $('conn').dataset.state = name;
  $('conn-label').textContent = label;
}

export function connectStream(refresh) {
  const source = new EventSource('/api/stream');
  let debounce;

  const scheduleRefresh = () => {
    // Debounce SSE bursts; busy agents emit many events per second.
    clearTimeout(debounce);
    debounce = setTimeout(refresh, 120);
  };

  source.addEventListener('connected', () => setConnection('live', 'live'));
  for (const type of REFRESH_EVENTS) source.addEventListener(type, scheduleRefresh);

  source.onopen = () => setConnection('live', 'live');
  // EventSource reconnects on its own; the polling fallback keeps data fresh.
  source.onerror = () => setConnection('offline', 'reconnecting');

  return source;
}
