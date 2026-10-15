import { $, flashNote, withButton } from '../ui.js';
import { state } from '../store.js';
import { esc } from '../format.js';
import { put } from '../api-client.js';

export function render() {
  const { permissionMeta: meta, settings } = state;
  if (!meta || !settings) return;

  const allowed = new Set(settings.allowed_tools);
  $('tool-grid').innerHTML = meta.tools
    .map(
      (tool) => `
      <label class="tool" title="${esc(tool.hint)}">
        <input type="checkbox" name="tool" value="${esc(tool.id)}"${allowed.has(tool.id) ? ' checked' : ''} />
        <span class="tool-body">
          <span class="tool-label">${esc(tool.label)}</span>
          <span class="tool-hint">${esc(tool.hint)}</span>
        </span>
      </label>`,
    )
    .join('');

  const form = $('permissions-form');
  form.elements.denied_commands.value = settings.denied_commands.join(', ');
  form.elements.blocked_urls.value = settings.blocked_urls.join(', ');
  form.elements.shell_allowed_domains.value = settings.shell_allowed_domains.join(', ');

  // Copilot's CLI has no OS sandbox: say so wherever its shell is on.
  $('perm-warning').hidden = !(settings.assistant === 'copilot' && allowed.has('bash'));

  $('perm-locked').innerHTML = [
    ...meta.core_denied_commands.map((c) => `<li><code>${esc(c)}</code> is always blocked</li>`),
    ...meta.enforced.map((g) => `<li>${esc(g)}</li>`),
  ].join('');

  const off = meta.tools.length - allowed.size;
  const blocked = meta.core_denied_commands.length + settings.denied_commands.length + settings.blocked_urls.length;
  $('perm-summary').textContent =
    `${allowed.size}/${meta.tools.length} tools · ${blocked} blocked` + (off > 0 ? ` · ${off} off` : '');
}

export function mount() {
  const form = $('permissions-form');
  form.addEventListener(
    'submit',
    withButton($('permissions-save'), async (event) => {
      event.preventDefault();
      const { settings } = await put('/api/settings', {
        allowed_tools: [...form.querySelectorAll('input[name="tool"]:checked')].map((i) => i.value),
        denied_commands: form.elements.denied_commands.value,
        blocked_urls: form.elements.blocked_urls.value,
        shell_allowed_domains: form.elements.shell_allowed_domains.value,
      });
      state.settings = settings;
      render();
      flashNote('permissions-note');
    }),
  );
}
