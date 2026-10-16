import { $, flashNote, withButton } from '../ui.js';
import { state } from '../store.js';
import { esc } from '../format.js';
import { put } from '../api-client.js';

/** The web tool lives in the Web access section (web-access.js), not in this grid. */
export const WEB_TOOL = 'web_fetch';

export function render() {
  const { permissionMeta: meta, settings } = state;
  if (!meta || !settings) return;

  const allowed = new Set(settings.allowed_tools);
  $('tool-grid').innerHTML = meta.tools
    .filter((tool) => tool.id !== WEB_TOOL)
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

  $('permissions-form').elements.denied_commands.value = settings.denied_commands.join(', ');

  // Copilot's sandbox needs srt and is not yet verified with the real CLI: say so.
  $('perm-warning').hidden = settings.assistant !== 'copilot';

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
      // The web tool is saved with Web access; keep its current setting here.
      const web = state.settings.allowed_tools.includes(WEB_TOOL) ? [WEB_TOOL] : [];
      const { settings } = await put('/api/settings', {
        allowed_tools: [...[...form.querySelectorAll('input[name="tool"]:checked')].map((i) => i.value), ...web],
        denied_commands: form.elements.denied_commands.value,
      });
      state.settings = settings;
      render();
      flashNote('permissions-note');
    }),
  );
}
