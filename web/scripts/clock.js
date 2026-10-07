import { parseUtc, formatDuration } from './format.js';

export function startClock(intervalMs = 1000) {
  return setInterval(() => {
    for (const el of document.querySelectorAll('[data-tick]')) {
      const started = parseUtc(el.dataset.tick);
      if (started != null) el.textContent = formatDuration(Date.now() - started);
    }
  }, intervalMs);
}
