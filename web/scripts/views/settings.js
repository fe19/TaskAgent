import { $, flashNote, withButton } from '../ui.js';
import { state } from '../store.js';
import { esc } from '../format.js';
import { put } from '../api-client.js';

const FIELDS = [
  'assistant',
  'max_concurrent_agents',
  'max_runtime_minutes',
  'model',
  'reasoning_effort',
  'usd_per_aic',
  'workspace_root',
];
const NUMERIC = new Set(['max_concurrent_agents', 'max_runtime_minutes', 'usd_per_aic']);

function fillSelect(select, values, selected) {
  select.innerHTML = values
    .map((v) => `<option value="${esc(v)}"${v === selected ? ' selected' : ''}>${esc(v)}</option>`)
    .join('');
}

function fillAssistants(select, options, selected) {
  select.innerHTML = options
    .map(({ id, name, preview }) => {
      const attrs = `${id === selected ? ' selected' : ''}${preview ? ' disabled' : ''}`;
      return `<option value="${esc(id)}"${attrs}>${esc(name)}${preview ? ' (preview)' : ''}</option>`;
    })
    .join('');
}

export function render() {
  const { settings, spec } = state;
  if (!settings || !spec) return;

  // Use the server schema; the backend owns valid values.
  fillAssistants($('assistant-select'), spec.assistant.options, settings.assistant);
  fillSelect($('model-select'), spec.model.values, settings.model);
  fillSelect($('effort-select'), spec.reasoning_effort.values, settings.reasoning_effort);

  const form = $('settings-form');
  form.elements.max_concurrent_agents.value = settings.max_concurrent_agents;
  form.elements.max_runtime_minutes.value = settings.max_runtime_minutes;
  form.elements.usd_per_aic.value = settings.usd_per_aic;
  form.elements.workspace_root.value = settings.workspace_root;
}

export function mount({ refresh }) {
  const form = $('settings-form');
  form.addEventListener(
    'submit',
    withButton($('settings-save'), async (event) => {
      event.preventDefault();
      const body = Object.fromEntries(
        FIELDS.map((name) => [
          name,
          NUMERIC.has(name) ? Number(form.elements[name].value) : form.elements[name].value,
        ]),
      );
      const { settings } = await put('/api/settings', body);
      state.settings = settings;
      // Show the normalized path the server stored.
      form.elements.workspace_root.value = settings.workspace_root;
      flashNote('settings-note');
      await refresh();
    }),
  );
}
