import { shortLabel } from './task-label.js';

/** ASCII words only: accents folded, everything else is a separator. */
const asciiWords = (text) =>
  (text ?? '')
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .split(/[^A-Za-z0-9]+/)
    .filter(Boolean);

/** "Top news today" + "claude-opus-5.5" → "TopNewsToday-opus-5-5.md". */
export function resultFileName(run) {
  const label = asciiWords(shortLabel(run.task_prompt, run.task_title))
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join('');
  const model = asciiWords((run.model ?? '').replace(/^claude-/, '')).join('-').toLowerCase();
  return `${[label || `Run${run.id}`, model].filter(Boolean).join('-')}.md`;
}

/** The downloadable markdown for a run, built on request from the stored result. */
export function resultMarkdown(run) {
  return `${[
    `# Run ${run.id} — ${run.task_title}`,
    '',
    `- Status: ${run.status}`,
    `- Model: ${run.model}`,
    `- Finished: ${run.finished_at ?? 'not yet'}`,
    `- Workspace: ${run.workspace_dir}`,
    `- Copilot session: ${run.session_id}`,
    '',
    '## Prompt',
    '',
    run.task_prompt,
    '',
    run.status === 'succeeded' ? '## Result' : '## Last message (unfinished)',
    '',
    run.result_text,
  ].join('\n')}\n`;
}
