// Headless-Chrome smoke test against a running app. Restores all settings afterwards.
// Usage: APP_URL=http://127.0.0.1:4317 npm run verify:ui [screenshot-dir]
import { existsSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { launchChrome, openPage, sleep, until } from './lib/chrome.js';

const APP = process.env.APP_URL ?? 'http://127.0.0.1:4317';
const OUT = process.argv[2] ?? '.';
const CUSTOM_ROOT = join(tmpdir(), `acr-ui-root-${Date.now()}`);
const MARKER = `ui-verify-${Date.now()}`;

const checks = [];
function check(name, ok, detail = '') {
  checks.push({ name, ok });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? `  — ${detail}` : ''}`);
}

const api = (path, init) => fetch(`${APP}${path}`, init).then((r) => r.json());
const putJson = (path, body) =>
  fetch(`${APP}${path}`, { method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });

/** Runs `fn(...args)` in the page; `fn` must be self-contained. */
const inPage = (page, fn, ...args) => page.evaluate(`(${fn})(...${JSON.stringify(args)})`);

async function topbar(page) {
  check('page loads', (await page.evaluate('document.title')) === 'Agents Tasks');

  const s = await inPage(page, () => {
    const text = (id) => document.getElementById(id).textContent;
    const group = document.getElementById('usage-group');
    return {
      claude: document.querySelector('[name=assistant]').value === 'claude-code',
      aicHidden: document.getElementById('stat-aic-box').hidden,
      aic: text('stat-aic'),
      usd: text('stat-usd'),
      grouped: ['stat-tokens', 'stat-aic', 'stat-usd'].every((id) => group.contains(document.getElementById(id))),
      rate: document.querySelector('[name=usd_per_aic]').value,
      cpu: text('stat-cpu'),
      ram: text('stat-ram'),
      hwTip: document.getElementById('hw-group').title,
      conn: document.getElementById('conn').dataset.state,
      banner: document.getElementById('error-banner').getBoundingClientRect().height,
      skeletons: [...document.querySelectorAll('.skeleton-list')].filter((e) => e.getBoundingClientRect().height > 0)
        .length,
    };
  });
  // "n/a", never a made-up 0, when no run reported usage.
  if (s.claude) {
    check('AIC used is hidden while Claude Code is the assistant', s.aicHidden, `hidden=${s.aicHidden}`);
  } else {
    check('topbar shows AI Credits used', !s.aicHidden && (s.aic === 'n/a' || /^\d+(\.\d+)?$/.test(s.aic)), s.aic);
  }
  check(
    'tokens, AIC and dollar cost sit in one group; cost is a dollar amount or n/a',
    s.grouped && (s.usd === 'n/a' || /^(\$\d+(\.\d+)?|<\$0\.01)$/.test(s.usd)) && Number(s.rate) > 0,
    `${s.usd} at $${s.rate}/AIC`,
  );
  check(
    "topbar shows the agents' CPU and RAM",
    /^\d+(\.\d)?%$/.test(s.cpu) && /^\d+(\.\d)? [MG]B$/.test(s.ram) && /cores/.test(s.hwTip),
    `${s.cpu} · ${s.ram} · ${s.hwTip}`,
  );
  const q = await until(
    () => inPage(page, () => {
      const value = document.getElementById('stat-left').textContent;
      const pct = document.getElementById('stat-left-pct').textContent;
      const tip = document.getElementById('quota-stat').title;
      const claude = document.querySelector('[name=assistant]').value === 'claude-code';
      const labels = [document.getElementById('stat-left-label').textContent, document.getElementById('stat-left-pct-label').textContent];
      const group = document.getElementById('usage-group');
      const grouped = ['stat-left', 'stat-left-pct'].every((id) => group.contains(document.getElementById(id)));
      return value === '–' ? null : { value, pct, tip, grouped, claude, labels };
    }),
    { attempts: 20, intervalMs: 500 },
  );
  check(
    q?.claude
      ? 'topbar shows the Claude Code 5-hour and weekly limits left, or why they are unknown'
      : 'topbar shows the remaining Copilot allowance in dollars and percent, or why it is unknown',
    Boolean(q?.grouped) &&
      (q.claude
        ? /^5h left/.test(q.labels[0]) && /^week left/.test(q.labels[1]) &&
          (/^\d+%$/.test(q.value) ? /Claude Code 5-hour limit/.test(q.tip) : q.value === 'n/a' && q.tip.length > 0)
        : /^\$\d+(\.\d+)?$/.test(q.value) ? /AI Credits left/.test(q.tip) && /^\d+%$/.test(q.pct)
        : q.value === '∞' ? /Unlimited/.test(q.tip)
        : q.value === 'n/a' && q.tip.length > 0),
    q ? `${q.labels.join(' / ')}: ${q.value} · ${q.pct} · ${q.tip}` : 'never loaded',
  );
  check('SSE stream reports live', s.conn === 'live', `state=${s.conn}`);
  check('no error banner when nothing failed', s.banner === 0, `height=${s.banner}`);
  check('loading skeletons hidden once loaded', s.skeletons === 0, `${s.skeletons} visible`);
}

async function settingsForm(page) {
  const saved = await inPage(
    page,
    async (root) => {
      const f = document.getElementById('settings-form');
      f.elements.max_concurrent_agents.value = '2';
      f.elements.max_runtime_minutes.value = '4';
      f.elements.model.value = 'claude-haiku-4.5';
      f.elements.reasoning_effort.value = 'default';
      f.elements.workspace_root.value = root;
      f.requestSubmit();
      await new Promise((r) => setTimeout(r, 1200));
      return (await (await fetch('/api/settings')).json()).settings;
    },
    CUSTOM_ROOT,
  );
  check(
    'workflow 1: settings saved via the UI form',
    saved.max_runtime_minutes === 4 && saved.max_concurrent_agents === 2,
    `${saved.max_concurrent_agents} agents · ${saved.max_runtime_minutes} min · ${saved.model}`,
  );
  check(
    'custom agent working directory saved and created on disk',
    saved.workspace_root === CUSTOM_ROOT && existsSync(CUSTOM_ROOT),
    `${saved.workspace_root} (exists=${existsSync(CUSTOM_ROOT)})`,
  );
}

async function assistantSwitch(page) {
  const a = await inPage(page, async () => {
    const wait = (ms) => new Promise((r) => setTimeout(r, ms));
    const f = document.getElementById('settings-form');
    const visible = (name) => !f.elements[name].closest('.field').hidden;
    const select = f.elements.assistant;
    const options = [...select.options].map((o) => ({ id: o.value, disabled: o.disabled }));
    const original = select.value;

    select.value = 'claude-code';
    select.dispatchEvent(new Event('change'));
    const claudeShown = visible('claude_model') && visible('claude_effort') && !visible('model') && !visible('usd_per_aic');
    f.elements.claude_model.value = 'opus';
    f.requestSubmit();
    await wait(1200);
    const res = await (await fetch('/api/settings')).json();
    const enforced = [...document.querySelectorAll('#perm-locked li')].map((li) => li.textContent);

    select.value = 'copilot';
    select.dispatchEvent(new Event('change'));
    await wait(1200);
    const copilotShown = visible('model') && !visible('claude_model');
    const savedOnPick = (await (await fetch('/api/settings')).json()).settings.assistant;

    select.value = original;
    select.dispatchEvent(new Event('change'));
    await wait(1200);
    const restored = (await (await fetch('/api/settings')).json()).settings.assistant;
    return { options, claudeShown, copilotShown, savedOnPick, saved: res.settings, enforced, restored, original };
  });
  check(
    'Claude Code is selectable; Codex is still preview',
    a.options.some((o) => o.id === 'claude-code' && !o.disabled) && a.options.some((o) => o.id === 'codex' && o.disabled),
    a.options.map((o) => `${o.id}${o.disabled ? ' (disabled)' : ''}`).join(', '),
  );
  check(
    'switching the assistant shows only its model and effort fields',
    a.claudeShown && a.copilotShown,
    `claude fields=${a.claudeShown} copilot fields=${a.copilotShown}`,
  );
  check(
    'the Claude Code choice saves and the enforced list follows it',
    a.saved.assistant === 'claude-code' && a.saved.claude_model === 'opus' && a.enforced.some((g) => g.includes('curl can still reach')),
    `${a.saved.assistant} · ${a.saved.claude_model}`,
  );
  check('picking an assistant saves it without pressing Save', a.savedOnPick === 'copilot', a.savedOnPick);
  check('the assistant is switched back to what it was', a.restored === a.original, `${a.original} → ${a.restored}`);
}

async function permissions(page) {
  const p = await inPage(page, async () => {
    const wait = (ms) => new Promise((r) => setTimeout(r, ms));
    const settings = async () => (await (await fetch('/api/settings')).json()).settings;
    const meta = (await (await fetch('/api/settings')).json()).permissions;
    const form = document.getElementById('permissions-form');
    const boxes = [...form.querySelectorAll('input[name="tool"]')];
    const locked = [...document.querySelectorAll('#perm-locked li')].map((li) => li.textContent.trim());

    form.querySelector('input[value="bash"]').checked = false;
    form.elements.denied_commands.value = 'curl, wget';
    form.requestSubmit();
    await wait(1200);
    const saved = await settings();
    const bashChecked = form.querySelector('input[value="bash"]').checked;
    const summary = document.getElementById('perm-summary').textContent.trim();

    // Restore before the agent run; the grid re-renders on save, so re-query.
    for (const b of form.querySelectorAll('input[name="tool"]')) b.checked = true;
    form.elements.denied_commands.value = '';
    form.requestSubmit();
    await wait(1200);
    const restored = await settings();
    return { toolCount: boxes.length, metaCount: meta.tools.length, locked, core: meta.core_denied_commands,
             saved, bashChecked, summary, restored };
  });
  check(
    'permissions section renders a checkbox for every tool the API offers',
    p.toolCount === p.metaCount && p.toolCount > 0,
    `${p.toolCount} checkboxes for ${p.metaCount} tools`,
  );
  check(
    'a tool can be switched off from the UI and it round-trips',
    !p.saved.allowed_tools.includes('bash') && p.bashChecked === false,
    `allowed=${p.saved.allowed_tools.join(',')} · summary="${p.summary}"`,
  );
  check(
    'blocked commands save from the UI',
    p.saved.denied_commands.join(',') === 'curl,wget',
    `denied=${p.saved.denied_commands.join('|')}`,
  );
  check(
    'the always-enforced list shows guardrails the operator cannot remove',
    p.core.every((c) => p.locked.some((l) => l.includes(c))) && p.locked.length > p.core.length,
    `${p.locked.length} locked entries covering ${p.core.join(', ')}`,
  );
  check(
    'permissions can be restored, so the section is not one-way',
    p.restored.allowed_tools.length === p.toolCount && p.restored.denied_commands.length === 0,
    `allowed=${p.restored.allowed_tools.join(',')}`,
  );
}

async function environment(page) {
  const e = await inPage(page, async () => {
    const wait = (ms) => new Promise((r) => setTimeout(r, ms));
    const settings = async () => (await (await fetch('/api/settings')).json()).settings;
    const form = document.getElementById('environment-form');
    const locked = document.getElementById('env-locked').textContent;

    form.elements.passed_env_vars.value = 'JAVA_HOME, GOPATH';
    form.elements.secret_env_vars.value = 'AWS_SECRET_ACCESS_KEY';
    form.requestSubmit();
    await wait(1200);
    const saved = await settings();
    const summary = document.getElementById('env-summary').textContent.trim();

    form.elements.passed_env_vars.value = '';
    form.elements.secret_env_vars.value = '';
    form.requestSubmit();
    await wait(1200);
    return { locked, saved, summary, restored: await settings() };
  });
  check(
    'passed and secret env vars save from the environment section',
    e.saved.passed_env_vars.join(',') === 'JAVA_HOME,GOPATH' && e.saved.secret_env_vars.join(',') === 'AWS_SECRET_ACCESS_KEY',
    `passed=${e.saved.passed_env_vars.join('|')} secrets=${e.saved.secret_env_vars.join('|')} · summary="${e.summary}"`,
  );
  check(
    'the environment section lists what is always passed and always secret',
    ['PATH', 'COPILOT_', 'GH_TOKEN'].every((n) => e.locked.includes(n)),
    e.locked.slice(0, 80),
  );
  check(
    'environment settings can be cleared again',
    e.restored.passed_env_vars.length === 0 && e.restored.secret_env_vars.length === 0,
    `passed=${e.restored.passed_env_vars.length} secrets=${e.restored.secret_env_vars.length}`,
  );
}

const setMode = (page, mode) =>
  inPage(
    page,
    async (mode) => {
      const btn = document.querySelector(`#dispatch-mode [data-mode="${mode}"]`);
      if (btn.getAttribute('aria-checked') !== 'true') btn.click();
      await new Promise((r) => setTimeout(r, 1500));
      return { on: btn.getAttribute('aria-checked') === 'true',
               hint: document.getElementById('dispatch-hint').textContent.trim() };
    },
    mode,
  );

async function queueing(page) {
  const manual = await setMode(page, 'manual');
  check('manual mode can be selected from the overview', manual.on && /manual/i.test(manual.hint), manual.hint);

  const shortcut = await inPage(page, () => {
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'n', ctrlKey: true, bubbles: true, cancelable: true }));
    const dialog = document.getElementById('task-dialog');
    const result = { opened: dialog.open, focused: document.activeElement?.name };
    dialog.close();
    return result;
  });
  check(
    'Ctrl+N opens the new-task dialog with the prompt focused',
    shortcut.opened && shortcut.focused === 'prompt',
    JSON.stringify(shortcut),
  );

  const q = await inPage(
    page,
    async (marker) => {
      document.getElementById('task-new').click();
      const opened = document.getElementById('task-dialog').open;
      const f = document.getElementById('task-form');
      f.elements.prompt.value = `Create a file named ${marker}.txt in the current directory containing the word verified. Do nothing else.`;
      f.elements.priority.value = '9';
      f.requestSubmit();
      await new Promise((r) => setTimeout(r, 1500));
      const tiles = document.querySelectorAll('#lane-queued .tile[data-outcome="queued"]');
      const mine = [...tiles].find((t) => t.title.includes(marker)) ?? tiles[0];
      mine?.click();
      await new Promise((r) => setTimeout(r, 200));
      const dlg = document.getElementById('run-dialog');
      const prompt = { open: dlg.open, text: dlg.querySelector('.prompt-text')?.textContent || '' };
      dlg.close();
      return { count: tiles.length, opened, closed: !document.getElementById('task-dialog').open,
               startable: Boolean(mine?.querySelector('[data-action="start-task"]')),
               lane: document.getElementById('count-queued').textContent.trim(),
               label: mine?.querySelector('.tile-label')?.textContent.trim() ?? '', prompt };
    },
    MARKER,
  );
  check(
    'the + button in the Queued lane opens the new-task dialog, which closes on submit',
    q.opened && q.closed,
    `opened=${q.opened} closed=${q.closed}`,
  );
  check(
    'workflow 2: task added and shown as a tile in the Queued lane',
    q.count > 0 && q.lane === String(q.count),
    `${q.count} queued tile(s), lane count=${q.lane}, label="${q.label}"`,
  );
  check('in manual mode a queued tile has a start button', q.startable, `startable=${q.startable}`);
  const words = q.label.split(/\s+/).length;
  check(
    'a queued tile is labelled with a short description, not the whole prompt',
    q.label.length > 0 && words <= 5,
    `"${q.label}" (${words} words)`,
  );
  check('clicking a queued tile shows its full prompt', q.prompt.open && q.prompt.text.includes(MARKER),
    q.prompt.text.slice(0, 80));

  const e = await inPage(
    page,
    async (marker) => {
      const wait = (ms) => new Promise((r) => setTimeout(r, ms));
      const mine = () => [...document.querySelectorAll('#lane-queued .tile')].find((t) => t.title.includes(marker));
      const task = async () => (await (await fetch('/api/tasks')).json()).tasks.find((t) => t.prompt.includes(marker));
      const form = document.getElementById('task-form');
      const dialog = document.getElementById('task-dialog');

      mine().querySelector('[data-action="edit-task"]').click();
      await wait(200);
      const prefilled = dialog.open && form.elements.prompt.value === (await task()).prompt;
      const original = form.elements.prompt.value;
      form.elements.prompt.value = `${original} Edited.`;
      form.requestSubmit();
      await wait(900);
      const saved = (await task()).prompt;

      // Restore through the dialog's Edit button.
      mine().click();
      await wait(200);
      const button = document.querySelector('#run-dialog [data-action="edit-task"]');
      button?.click();
      await wait(200);
      form.elements.prompt.value = original;
      form.requestSubmit();
      await wait(900);
      return { prefilled, saved, closed: !dialog.open, viaDialog: Boolean(button),
               restored: (await task()).prompt === original };
    },
    MARKER,
  );
  check(
    'a queued task prompt can be edited from its tile and its dialog',
    e.prefilled && e.saved.endsWith(' Edited.') && e.closed && e.viaDialog && e.restored,
    JSON.stringify({ prefilled: e.prefilled, saved: e.saved.endsWith(' Edited.'), viaDialog: e.viaDialog, restored: e.restored }),
  );

  const d = await inPage(
    page,
    async (marker) => {
      const wait = (ms) => new Promise((r) => setTimeout(r, ms));
      const res = await fetch('/api/tasks', { method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ prompt: `drag-check ${marker}` }) });
      const { task } = await res.json();
      const status = async () => (await (await fetch('/api/tasks')).json()).tasks.find((t) => t.id === task.id);
      const drag = async (from, to) => {
        const tile = document.querySelector(`#lane-${from} .tile[data-drag-task="${task.id}"]`);
        if (!tile) return `no draggable tile in ${from}`;
        const lane = document.querySelector(`.lane[data-lane="${to}"]`);
        const dt = new DataTransfer();
        tile.dispatchEvent(new DragEvent('dragstart', { bubbles: true, dataTransfer: dt }));
        const highlighted = document.getElementById('board').dataset.dragFrom === from;
        const over = new DragEvent('dragover', { bubbles: true, cancelable: true, dataTransfer: dt });
        lane.dispatchEvent(over);
        const accepted = over.defaultPrevented && lane.classList.contains('drop-target');
        lane.dispatchEvent(new DragEvent('drop', { bubbles: true, cancelable: true, dataTransfer: dt }));
        tile.dispatchEvent(new DragEvent('dragend', { bubbles: true, dataTransfer: dt }));
        await wait(1200);
        return highlighted && accepted ? 'ok' : `highlighted=${highlighted} accepted=${accepted}`;
      };
      await wait(1200);
      const toDone = await drag('queued', 'done');
      const afterDone = (await status()).status;
      const toQueued = await drag('done', 'queued');
      const after = await status();
      await fetch(`/api/tasks/${task.id}`, { method: 'DELETE' });
      return { toDone, afterDone, toQueued, afterQueued: after.status, held: after.held,
               leftovers: document.querySelectorAll('.drop-target, .tile.dragging, .board[data-drag-from]').length };
    },
    MARKER,
  );
  check(
    'dragging a tile between lanes cancels and requeues it',
    d.toDone === 'ok' && d.afterDone === 'cancelled' && d.toQueued === 'ok' && d.afterQueued === 'queued' &&
      d.held === 0 && d.leftovers === 0,
    JSON.stringify(d),
  );

  await sleep(2500);
  const held = await inPage(
    page,
    async (marker) => {
      const { tasks } = await (await fetch('/api/tasks')).json();
      return { status: tasks.find((t) => t.prompt.includes(marker))?.status ?? 'missing',
               live: document.querySelectorAll('#lane-running .tile').length };
    },
    MARKER,
  );
  check('a new task stays queued in manual mode', held.status === 'queued' && held.live === 0,
    `status=${held.status}, live agents=${held.live}`);

  const old = await inPage(page, async () => {
    const wait = (ms) => new Promise((r) => setTimeout(r, ms));
    const json = async (path, method = 'GET', body) => (await fetch(path, {
      method, headers: { 'content-type': 'application/json' }, body: body && JSON.stringify(body) })).json();
    const prompt = `FAIL old-run-check ${Date.now()}`;
    const { task } = await json('/api/tasks', 'POST', { prompt });
    const failedRuns = async () => (await json('/api/agents')).agents
      .filter((a) => a.task_id === task.id && a.status === 'failed').length;
    const runOnce = async (n) => {
      await json(`/api/tasks/${task.id}/start`, 'POST', {});
      for (let i = 0; i < 40 && (await failedRuns()) < n; i += 1) await wait(150);
    };
    await runOnce(1);
    await json(`/api/tasks/${task.id}/requeue`, 'POST', {});
    await runOnce(2);
    await wait(1200);
    const tiles = () => [...document.querySelectorAll(`#lane-done .tile[data-drag-task="${task.id}"]`)];
    const draggableWhenFinished = tiles().length;

    await json(`/api/tasks/${task.id}/requeue`, 'POST', {});
    await wait(1200);
    const tile = tiles()[0];
    const copyFlag = tile?.dataset.dragCopy === 'true';
    const dt = new DataTransfer();
    const lane = document.querySelector('.lane[data-lane="queued"]');
    tile?.dispatchEvent(new DragEvent('dragstart', { bubbles: true, dataTransfer: dt }));
    lane.dispatchEvent(new DragEvent('dragover', { bubbles: true, cancelable: true, dataTransfer: dt }));
    lane.dispatchEvent(new DragEvent('drop', { bubbles: true, cancelable: true, dataTransfer: dt }));
    tile?.dispatchEvent(new DragEvent('dragend', { bubbles: true, dataTransfer: dt }));
    await wait(1200);
    const mine = (await json('/api/tasks')).tasks.filter((t) => t.prompt === prompt);
    for (const t of mine) await fetch(`/api/tasks/${t.id}`, { method: 'DELETE' });
    return { draggableWhenFinished, copyFlag, copies: mine.length,
             copyQueued: mine.filter((t) => t.status === 'queued').length };
  });
  check(
    'every finished run can be dragged; an old run of an active task is queued as a copy',
    old.draggableWhenFinished === 2 && old.copyFlag && old.copies === 2 && old.copyQueued === 2,
    JSON.stringify(old),
  );
}

async function liveRun(page) {
  const auto = await setMode(page, 'auto');
  check('switching to Auto dispatches the queued task', auto.on && /auto/i.test(auto.hint), auto.hint);

  const live = await until(() =>
    inPage(page, () => {
      const tile = document.querySelector('#lane-running .tile');
      if (!tile) return null;
      return {
        outcome: tile.dataset.outcome,
        label: tile.querySelector('.tile-label').textContent.trim(),
        activity: tile.querySelector('.tile-sub > span:not(.tile-actions):not(.spinner)').textContent.trim(),
        elapsed: tile.querySelector('.tile-stat[data-tick]')?.textContent?.trim() ?? null,
        stoppable: Boolean(tile.querySelector('button[data-action="stop-run"]')),
        laneCount: document.getElementById('count-running').textContent.trim(),
      };
    }),
  );
  check('workflow 3: a running agent appears in the overview', Boolean(live), JSON.stringify(live));
  writeFileSync(join(OUT, 'ui-running.png'), await page.screenshot());
  if (!live) return;

  check('running agent shows a live activity description', live.activity.length > 0, live.activity);
  check('running agent shows an elapsed timer', Boolean(live.elapsed), live.elapsed ?? 'none');
  check(
    'a working tile is colour-coded and stoppable',
    /^(starting|running|stopping)$/.test(live.outcome) && live.stoppable && live.laneCount !== '0',
    `outcome=${live.outcome}, stop button=${live.stoppable}, lane count=${live.laneCount}`,
  );
  check('a working tile keeps the short label, not the raw prompt', live.label.split(/\s+/).length <= 5,
    `"${live.label}"`);

  const dialogState = () => {
    const dlg = document.getElementById('run-dialog');
    if (!dlg.open) return null;
    return { steps: dlg.querySelectorAll('.timeline li').length, status: dlg.querySelector('.badge').textContent.trim(),
             title: document.getElementById('run-dialog-title').textContent.trim(),
             usage: [...dlg.querySelectorAll('.empty')].map((e) => e.textContent.trim()).join(' | '),
             hasUsageTable: /Total/.test(dlg.querySelector('.dialog-body').textContent) };
  };
  await inPage(page, () => document.querySelector('#lane-running .tile').click());
  await sleep(900);
  const first = await inPage(page, dialogState);
  check('clicking a working tile opens its detail', Boolean(first), `title="${first?.title}" · ${first?.steps} step(s)`);
  if (!first) return;
  check(
    'token usage is explicit while unavailable, never a fake zero',
    /not reported yet|did not report/i.test(first.usage) || first.hasUsageTable,
    first.usage || '(real usage table present)',
  );
  const grew = await until(async () => {
    const now = await inPage(page, dialogState);
    return now && (now.steps > first.steps || now.status !== first.status) ? now : null;
  });
  check(
    'an open detail dialog updates live without a reload',
    Boolean(grew),
    `${first.steps} step(s)/${first.status} → ${grew?.steps} step(s)/${grew?.status}`,
  );
  await page.evaluate('document.getElementById("run-dialog").close()');
}

async function finishedRun(page) {
  // Wait until usage is settled so the tile shows its final subtitle.
  const done = await until(
    () =>
      inPage(
        page,
        async (marker) => {
          const { agents } = await (await fetch('/api/agents')).json();
          const mine = agents.find((a) => a.task_prompt.includes(marker));
          if (!mine || mine.status !== 'succeeded' || mine.usage_state === 'pending') return null;
          const tile = document.querySelector(`#lane-done .tile[data-open="${mine.id}"]`);
          if (!tile) return null;
          return { runId: mine.id, usage: mine.usage_state, outcome: tile.dataset.outcome,
                   label: tile.querySelector('.tile-label').textContent.trim(),
                   sub: tile.querySelector('.tile-sub').textContent.trim(),
                   borderColor: getComputedStyle(tile).borderLeftColor };
        },
        MARKER,
      ),
    { attempts: 90 },
  );
  check('agent reaches succeeded in the UI without a reload', Boolean(done), JSON.stringify(done));
  if (!done) return;

  check(
    'a finished tile shows its token usage, or says none was reported',
    done.usage === 'available' ? /\d[\d.,km]* tokens/i.test(done.sub) : /no usage reported/.test(done.sub),
    `${done.label} · ${done.sub} (usage ${done.usage})`,
  );
  check(
    'a successful tile is green',
    done.outcome === 'succeeded' && done.borderColor === 'rgb(52, 211, 153)',
    `outcome=${done.outcome}, border=${done.borderColor}`,
  );

  const leaked = await inPage(page, () => document.getElementById('board').innerText.match(/<[a-z/][^>]*>/i)?.[0] ?? '');
  check('no raw HTML rendered as text on the board', leaked === '', leaked);

  const detail = await inPage(
    page,
    async (runId) => {
      document.querySelector(`.tile[data-open="${runId}"]`).click();
      await new Promise((r) => setTimeout(r, 1200));
      const dlg = document.getElementById('run-dialog');
      const meta = () => dlg.querySelector('#run-meta');
      const hiddenByDefault = Boolean(meta()?.hidden);
      dlg.querySelector('[data-meta-toggle]')?.click();
      await new Promise((r) => setTimeout(r, 100));
      return { open: dlg.open, hiddenByDefault, shown: Boolean(meta() && !meta().hidden),
               steps: dlg.querySelectorAll('.timeline li').length,
               prompt: dlg.querySelector('.prompt-text')?.textContent || '',
               text: dlg.querySelector('.dialog-body').innerText.replace(/\s+/g, ' ').slice(0, 1500) };
    },
    done.runId,
  );
  check(
    'run detail shows only the result until details are expanded',
    detail.hiddenByDefault && detail.shown,
    `hiddenByDefault=${detail.hiddenByDefault}, shownAfterToggle=${detail.shown}`,
  );
  check(
    'run detail shows the task prompt',
    detail.prompt.length > 0 && detail.text.indexOf('Prompt') < detail.text.indexOf(detail.prompt.slice(0, 20)),
    detail.prompt.slice(0, 80),
  );
  check(
    'run detail dialog opens with a real activity timeline',
    detail.open && /Tokens|TOKEN USAGE/i.test(detail.text) && detail.steps > 0,
    `${detail.steps} step(s) · ${detail.text.slice(0, 140)}`,
  );

  const result = await inPage(
    page,
    async (runId) => {
      const dlg = document.getElementById('run-dialog');
      const info = await (await fetch(`/api/runs/${runId}`)).json();
      const download = await fetch(`/api/runs/${runId}/result`);
      return {
        shown: dlg.querySelector('.result-text')?.textContent.trim().slice(0, 200) ?? '',
        downloadStatus: download.status,
        downloadBody: await download.text(),
        workspace: info.run.workspace_dir,
        hasLink: Boolean(dlg.querySelector('a[href$="/result"]')),
        tileLink: document.querySelector(`.tile[data-open="${runId}"] a.tile-btn[download]`)?.getAttribute('href') ?? null,
      };
    },
    done.runId,
  );
  check('a succeeded run shows its result in the dialog', result.shown.length > 0, result.shown.slice(0, 120) || '(empty)');
  check(
    'the result downloads on demand from the dialog and the tile',
    result.downloadStatus === 200 && result.hasLink && Boolean(result.tileLink) &&
      result.downloadBody.includes(result.shown.slice(0, 40)),
    `tile link ${result.tileLink} (HTTP ${result.downloadStatus})`,
  );
  check(
    'the agent ran inside the configured working directory',
    typeof result.workspace === 'string' && result.workspace.startsWith(CUSTOM_ROOT),
    `${result.workspace} vs ${CUSTOM_ROOT}`,
  );

  writeFileSync(join(OUT, 'ui-detail.png'), await page.screenshot());
  await page.evaluate('document.getElementById("run-dialog").close()');
}

async function responsive(page) {
  await page.setViewport({ width: 420, height: 900, deviceScaleFactor: 2, mobile: true });
  await sleep(700);
  const overflow = await page.evaluate('document.documentElement.scrollWidth - document.documentElement.clientWidth');
  check('no horizontal overflow at 420px', overflow <= 1, `overflow=${overflow}px`);
  writeFileSync(join(OUT, 'ui-mobile.png'), await page.screenshot());

  // A first visit on a phone opens on the board; the forms are one tap away.
  await page.evaluate(`localStorage.removeItem('am.sidebar.collapsed')`);
  await page.send('Page.reload');
  await sleep(1800);
  const phone = await inPage(page, async () => {
    const collapsed = document.body.classList.contains('sidebar-collapsed');
    const boardTop = Math.round(document.getElementById('board').getBoundingClientRect().top);
    document.querySelector('.sidebar-rail.sidebar-toggle').click();
    await new Promise((r) => setTimeout(r, 200));
    const opened = !document.body.classList.contains('sidebar-collapsed');
    const overflow = document.documentElement.scrollWidth - document.documentElement.clientWidth;
    localStorage.removeItem('am.sidebar.collapsed');
    return { collapsed, boardTop, innerHeight, opened, overflow };
  });
  check(
    'on a phone the board is on the first screen and the configuration opens on tap',
    phone.collapsed && phone.boardTop < phone.innerHeight && phone.opened && phone.overflow <= 1,
    JSON.stringify(phone),
  );
}

const before = (await api('/api/settings')).settings;
const browser = launchChrome();
let page;
let failed = 1;

try {
  page = await openPage({ port: browser.port, url: APP });
  await sleep(3500);
  for (const section of [topbar, settingsForm, assistantSwitch, permissions, environment, queueing, liveRun, finishedRun, responsive]) {
    await section(page);
  }
  failed = checks.filter((c) => !c.ok).length;
  console.log(`\n${checks.length - failed}/${checks.length} UI checks passed`);
} catch (err) {
  console.error('UI verification error:', err.message);
} finally {
  page?.close();
  try {
    const { auto_dispatch, ...rest } = before;
    await putJson('/api/settings', rest);
    await putJson('/api/dispatch', { running: auto_dispatch });
  } catch {
    // The app may already be down.
  }
  rmSync(CUSTOM_ROOT, { recursive: true, force: true });
  await browser.close();
}

process.exit(failed ? 1 : 0);
