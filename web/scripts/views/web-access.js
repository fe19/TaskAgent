import { $, flashNote, withButton } from '../ui.js';
import { state } from '../store.js';
import { put } from '../api-client.js';
import { mergeSites, siteOf } from '/domain/web-access.js';
import { WEB_TOOL, render as renderPermissions } from './permissions.js';

/**
 * The Web access section: allow all websites, the web tool, the allowed and blocked websites.
 * Edits stay here until "Save web access".
 */
let pendingSites = null; // the edited list, until saved

const sites = () => pendingSites ?? state.settings.shell_allowed_domains;

function setNote(text) {
  $('web-note').textContent = text;
}

function renderSites() {
  const list = $('allowed-sites');
  if (sites().length === 0) {
    const empty = document.createElement('li');
    empty.className = 'site-empty';
    empty.textContent = 'None yet.';
    list.replaceChildren(empty);
    return;
  }
  list.replaceChildren(
    ...sites().map((site) => {
      const item = document.createElement('li');
      item.className = 'site-chip';
      const name = document.createElement('span');
      name.textContent = site;
      const remove = document.createElement('button');
      remove.type = 'button';
      remove.className = 'site-remove';
      remove.dataset.site = site;
      remove.setAttribute('aria-label', `Remove ${site}`);
      remove.textContent = '×';
      item.append(name, remove);
      return item;
    }),
  );
}

/** "Allow all" is Claude Code only: srt, which wraps Copilot, refuses "*". */
function renderAllowAllHint(allowAll) {
  const copilot = state.settings.assistant === 'copilot';
  $('allow-all-hint').textContent = copilot
    ? 'Claude Code only. GitHub Copilot’s sandbox cannot allow all websites, so Copilot still reaches only the allowed websites below.'
    : 'Every site except the blocked ones, for the web tool and shell commands.';
  const hint = $('allowed-sites-hint');
  hint.textContent =
    allowAll && !copilot
      ? 'While all websites are allowed, this list only matters if you switch to GitHub Copilot.'
      : 'A site covers all its pages: www.bbc.co.uk allows www.bbc.co.uk/news. Copilot also reaches its own servers. A broad site such as github.com can be used to send data out.';
  hint.dataset.dimmed = String(allowAll && !copilot);
}

export function render() {
  const { settings } = state;
  if (!settings) return;
  const form = $('web-form');
  form.elements.allow_all_websites.checked = settings.allow_all_websites;
  form.elements.web_tool.checked = settings.allowed_tools.includes(WEB_TOOL);
  form.elements.blocked_urls.value = settings.blocked_urls.join(', ');
  pendingSites = null;
  renderSites();
  renderAllowAllHint(settings.allow_all_websites);
}

function changeSites(next) {
  pendingSites = next;
  renderSites();
  setNote('Not saved yet');
}

export function mount() {
  const form = $('web-form');
  const input = $('site-input');

  const add = () => {
    const site = siteOf(input.value);
    if (!site) {
      setNote(input.value.trim() ? 'Not a website, e.g. www.bbc.co.uk' : '');
      return;
    }
    changeSites(mergeSites(sites(), [site]));
    input.value = '';
  };
  $('site-add').addEventListener('click', add);
  input.addEventListener('keydown', (event) => {
    if (event.key !== 'Enter') return;
    event.preventDefault(); // adds the site; saving is the button's job
    add();
  });
  $('allowed-sites').addEventListener('click', (event) => {
    const remove = event.target.closest('[data-site]');
    if (remove) changeSites(sites().filter((s) => s !== remove.dataset.site));
  });
  form.elements.allow_all_websites.addEventListener('change', (event) => {
    renderAllowAllHint(event.target.checked);
    setNote('Not saved yet');
  });
  form.elements.web_tool.addEventListener('change', () => setNote('Not saved yet'));
  form.elements.blocked_urls.addEventListener('input', () => setNote('Not saved yet'));

  form.addEventListener(
    'submit',
    withButton($('web-save'), async (event) => {
      event.preventDefault();
      const tools = state.settings.allowed_tools.filter((t) => t !== WEB_TOOL);
      try {
        const { settings } = await put('/api/settings', {
          allow_all_websites: form.elements.allow_all_websites.checked,
          allowed_tools: form.elements.web_tool.checked ? [...tools, WEB_TOOL] : tools,
          shell_allowed_domains: sites(),
          blocked_urls: form.elements.blocked_urls.value,
        });
        state.settings = settings;
        render();
        renderPermissions(); // the summary counts and enforced list follow
        flashNote('web-note');
      } catch (err) {
        setNote(err.message);
      }
    }),
  );
}
