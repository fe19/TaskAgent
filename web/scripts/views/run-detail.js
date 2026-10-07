import { esc, elapsedMs, formatDuration, formatUsd } from '../format.js';
import { aicToUsd } from '../store.js';
import { isLive, resultLabel } from '/domain/run-status.js';

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
    ['Model', esc(run.model)],
    [
      'Elapsed',
      esc(formatDuration(elapsedMs(run))),
      live ? ` data-tick="${esc(run.started_at)}"` : '',
    ],
    ['Runtime limit', `${esc(run.max_runtime_s / 60)} min`],
    ['Tool calls', esc(run.tool_calls)],
    ['Workspace', code(run.workspace_dir)],
    ['Copilot session', code(run.session_id)],
    run.exit_code == null ? null : ['Exit code', esc(run.exit_code)],
  ]);
}

function renderUsage(run) {
  const u = run.usage;
  if (!u) {
    return note(
      run.usage_state === 'pending'
        ? 'Not reported yet — the Copilot CLI records usage when the run finishes.'
        : 'The Copilot CLI did not report token usage for this session.',
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
    ['AI Credits (AIC)', u.aiu == null ? 'unavailable' : esc(u.aiu.toFixed(4))],
    ['Cost (USD)', esc(formatUsd(aicToUsd(u.aiu)) ?? 'unavailable')],
  ]);
}

function renderPrompt(prompt) {
  return prompt ? `<pre class="prompt-text">${esc(prompt)}</pre>` : note('No prompt recorded.');
}

export function renderTaskDetail(task) {
  const edit = task.status === 'queued'
    ? `<div class="detail-actions">
         <button type="button" class="btn btn-ghost btn-sm" data-action="edit-task" data-id="${esc(task.id)}">Edit prompt</button>
       </div>`
    : '';
  return [label('Prompt'), renderPrompt(task.prompt), edit].join('\n');
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

export function renderDetail(run, events, { showMeta = false } = {}) {
  const live = isLive(run.status);
  return [
    run.error ? `<div class="agent-error">${esc(run.error)}</div>` : '',
    label('Prompt'),
    renderPrompt(run.task_prompt),
    label(resultLabel(run.status)),
    renderResult(run, live),
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
