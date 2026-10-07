import { $, flashNote, withButton } from '../ui.js';
import { state } from '../store.js';
import { esc } from '../format.js';
import { put } from '../api-client.js';

const codes = (names) => names.map((n) => `<code>${esc(n)}</code>`).join(', ');

export function render() {
  const { environmentMeta: meta, settings } = state;
  if (!meta || !settings) return;

  const form = $('environment-form');
  form.elements.passed_env_vars.value = settings.passed_env_vars.join(', ');
  form.elements.secret_env_vars.value = settings.secret_env_vars.join(', ');

  $('env-locked').innerHTML = [
    `<li>${codes(meta.passed)}</li>`,
    `<li>Anything starting ${codes(meta.passed_prefixes)}</li>`,
    `<li>${codes(meta.core_secrets)} are always secret</li>`,
  ].join('');

  const added = settings.passed_env_vars.length;
  const secret = meta.core_secrets.length + settings.secret_env_vars.length;
  $('env-summary').textContent = `${added} added · ${secret} secret`;
}

export function mount() {
  const form = $('environment-form');
  form.addEventListener(
    'submit',
    withButton($('environment-save'), async (event) => {
      event.preventDefault();
      const { settings } = await put('/api/settings', {
        passed_env_vars: form.elements.passed_env_vars.value,
        secret_env_vars: form.elements.secret_env_vars.value,
      });
      state.settings = settings;
      render();
      flashNote('environment-note');
    }),
  );
}
