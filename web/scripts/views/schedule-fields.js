import { esc } from '../format.js';
import { REPEATS } from '/domain/schedule.js';

/** The Repeat options; '' is "Never". */
export function repeatOptions(selected = null) {
  return [{ id: '', label: 'Never' }, ...REPEATS]
    .map((r) => `<option value="${esc(r.id)}"${r.id === (selected ?? '') ? ' selected' : ''}>${esc(r.label)}</option>`)
    .join('');
}

/** Reads `run_at` (a local datetime-local value) and `repeat` from a form, as the API takes them. */
export function readSchedule(form) {
  const local = form.elements.run_at.value;
  return {
    run_at: local ? new Date(local).toISOString() : null,
    repeat: form.elements.repeat.value || null,
  };
}
