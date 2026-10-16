import { esc, elapsedMs, formatDuration, formatUsd, toLocalInput } from '../format.js';
import { repeatOptions } from './schedule-fields.js';
import { usageUsd } from '../store.js';
import { isLive, resultLabel } from '/domain/run-status.js';
import { ASSISTANTS } from '/domain/assistants.js';
import { repeatLabel } from '/domain/schedule.js';

const assistantName = (id) => ASSISTANTS.find((a) => a.id === id)?.name ?? id;
const isClaude = (run) => run.assistant === 'claude-code';

const rows = (pairs) =>
  `<dl class="kv">${pairs
    .filter(Boolean)
    .map(([term, value, attrs = '']) => `<dt>${esc(term)}</dt><dd${attrs}>${value}</dd>`)
    .join('')}</dl>`;

const note = (text) => `<p class="empty">${esc(text)}</p>`;
const code = (value) => `<code>${esc(value)}</code>`;
const label = (text, live) =>
  `<p class="section-label">${esc(text)}${live ? ' <span class="spinner" aria-hidden="true"></span>' : ''}</p>`;

function renderFacts(run, live) {
  return rows([
    [
      'Status',
      `<span class="badge" data-status="${esc(run.status)}">${esc(run.status.replace('_', ' '))}</span>`,
    ],
    ['Assistant', esc(assistantName(run.assistant))],
    ['Model', esc(run.model)],
    [
      'Elapsed',
      esc(formatDuration(elapsedMs(run))),
      live ? ` data-tick="${esc(run.started_at)}"` : '',
    ],
    ['Runtime limit', `${esc(run.max_runtime_s / 60)} min`],
    ['Tool calls', esc(run.tool_calls)],
    ['Workspace', code(run.workspace_dir)],
    [`${isClaude(run) ? 'Claude Code' : 'Copilot'} session`, code(run.session_id)],
    run.exit_code == null ? null : ['Exit code', esc(run.exit_code)],
  ]);
}

function renderUsage(run) {
  const u = run.usage;
  if (!u) {
    return note(
      run.usage_state === 'pending'
        ? `Not reported yet — ${isClaude(run) ? 'Claude Code' : 'the Copilot CLI'} reports usage when the run finishes.`
        : `${isClaude(run) ? 'Claude Code' : 'The Copilot CLI'} did not report token usage for this session.`,
    );
  }
  const count = (n) => esc(n.toLocaleString());
  return rows([
    ['Input', count(u.input_tokens)],
    ['Output', count(u.output_tokens)],
    ['Cache read', count(u.cache_read_tokens)],
    ['Cache write', count(u.cache_write_tokens)],
    ['Total', `<strong>${count(u.total_tokens)}</strong>`],
    ['API calls', esc(u.api_calls)],
    ['Model time', `${count(u.api_duration_ms)} ms`],
    isClaude(run) ? null : ['AI Credits (AIC)', u.aiu == null ? 'unavailable' : esc(u.aiu.toFixed(4))],
    [
      isClaude(run) ? 'Cost (USD, reported)' : 'Cost (USD)',
      esc(formatUsd(usageUsd(u)) ?? 'unavailable'),
      isClaude(run) ? ' title="Reported by Claude Code at API prices; on a subscription it is an estimate, not a charge."' : '',
    ],
  ]);
}

function renderPrompt(prompt) {
  return prompt ? `<pre class="prompt-text">${esc(prompt)}</pre>` : note('No prompt recorded.');
}

/** Read-only schedule of a task that is no longer queued. */
function renderScheduleFacts(task) {
  if (!task.run_at && !task.repeat) return '';
  return [
    label('Schedule'),
    rows([
      task.run_at ? [task.repeat ? 'Next start' : 'Starts', esc(new Date(task.run_at).toLocaleString())] : null,
      task.repeat ? ['Repeats', esc(repeatLabel(task.repeat))] : null,
    ]),
  ].join('\n');
}

/** A queued task is edited in place: prompt, then schedule, then one Save. */
function renderTaskForm(task) {
  return `
    <form class="task-edit-form" data-edit-task="${esc(task.id)}">
      <label class="field">
        <span class="section-label">Prompt</span>
        <textarea name="prompt" rows="8" required>${esc(task.prompt)}</textarea>
      </label>
      <p class="section-label">Schedule</p>
      <div class="schedule-fields">
        <label class="field">
          <span class="field-label">${task.repeat ? 'Next start' : 'Start at'}</span>
          <input type="datetime-local" name="run_at" value="${esc(toLocalInput(task.run_at))}" />
        </label>
        <label class="field">
          <span class="field-label">Repeat</span>
          <select name="repeat">${repeatOptions(task.repeat)}</select>
        </label>
      </div>
      <p class="field-hint">Leave the start empty to queue it without a time.</p>
      <div class="detail-actions">
        <span class="save-note" id="task-edit-note" aria-live="polite"></span>
        <button type="submit" class="btn btn-primary btn-sm">Save</button>
      </div>
    </form>`;
}

export function renderTaskDetail(task) {
  if (task.status === 'queued') return renderTaskForm(task);
  return [renderScheduleFacts(task), label('Prompt'), renderPrompt(task.prompt)].join('\n');
}

function renderResult(run, live) {
  if (!run.result) {
    return note(live ? 'The agent has not finished yet.' : 'This run produced no closing message.');
  }
  return `
    <div class="result">
      <pre class="result-text" id="result-text">${esc(run.result)}</pre>
      <div class="result-foot">
        <span class="result-actions">
          <button type="button" class="btn btn-ghost btn-sm" data-action="copy-result">Copy</button>
          <a class="btn btn-ghost btn-sm" href="/api/runs/${esc(run.id)}/result" download>Download</a>
        </span>
      </div>
    </div>`;
}

function renderTimeline(events, live) {
  if (events.length === 0) {
    return note(live ? 'Waiting for the agent to report activity…' : 'No activity recorded.');
  }
  return `<ul class="timeline">${events
    .map(
      (e) => `<li><time>${esc((e.ts || '').slice(11, 19))}</time><span>${esc(e.summary)}</span></li>`,
    )
    .join('')}</ul>`;
}

function renderActions(run, live, showMeta) {
  return `
    <div class="detail-actions">
      ${
        live
          ? ''
          : `<button type="button" class="btn btn-ghost btn-sm" data-action="requeue-task" data-id="${esc(run.task_id)}">
               Run again
             </button>`
      }
      <button type="button" class="btn btn-ghost btn-sm meta-toggle" data-meta-toggle aria-expanded="${showMeta}"
              aria-controls="run-meta">${showMeta ? 'Hide details' : 'Show details'}</button>
    </div>`;
}

/** The websites a run reached, and those it was refused. */
function renderWebsites(run, live) {
  const accessed = run.accessed_sites ?? [];
  const blocked = run.blocked_sites ?? [];
  if (accessed.length === 0 && blocked.length === 0) {
    return note(live ? 'No websites accessed yet.' : 'No websites accessed.');
  }
  const chips = (sites, kind) =>
    sites.map((s) => `<li class="site-chip"${kind ? ` data-kind="${kind}"` : ''}>${esc(s)}</li>`).join('');
  return `<ul class="site-chips run-sites" aria-label="Websites">${chips(accessed, '')}${chips(blocked, 'blocked')}</ul>
    ${blocked.length ? '<p class="field-hint">Red: refused, because the site is not allowed.</p>' : ''}`;
}

/** A finished run that was refused websites: name them and offer to allow them and retry. */
function renderBlockedSites(run, live) {
  const sites = run.blocked_sites ?? [];
  if (live || sites.length === 0) return '';
  const list = esc(sites.join(','));
  return `
    <div class="blocked-sites">
      <p><strong>Blocked websites:</strong> ${sites.map((s) => `<code>${esc(s)}</code>`).join(', ')}</p>
      <p class="field-hint">The agent wanted these sites but they are not allowed. Allow them and run the task again:</p>
      <div class="detail-actions">
        <button type="button" class="btn btn-primary btn-sm" data-action="allow-sites" data-id="${esc(run.task_id)}" data-sites="${list}">
          Allow for this task and retry
        </button>
        <button type="button" class="btn btn-ghost btn-sm" data-action="allow-sites" data-id="${esc(run.task_id)}" data-sites="${list}" data-permanent="true">
          Add to allowed websites and retry
        </button>
      </div>
    </div>`;
}

export function renderDetail(run, events, { showMeta = false } = {}) {
  const live = isLive(run.status);
  return [
    run.error ? `<div class="agent-error">${esc(run.error)}</div>` : '',
    renderBlockedSites(run, live),
    label('Prompt'),
    renderPrompt(run.task_prompt),
    label(resultLabel(run.status)),
    renderResult(run, live),
    label('Websites'),
    renderWebsites(run, live),
    renderActions(run, live, showMeta),
    `<div class="run-meta" id="run-meta"${showMeta ? '' : ' hidden'}>`,
    renderFacts(run, live),
    label('Token usage'),
    renderUsage(run),
    label('Activity', live),
    renderTimeline(events, live),
    '</div>',
  ].join('\n');
}
