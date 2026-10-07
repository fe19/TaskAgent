import { test } from 'node:test';
import assert from 'node:assert/strict';
import { resultFileName, resultMarkdown } from '../../src/domain/result-document.js';

const RUN = {
  id: 7,
  task_title: 'Capital',
  task_prompt: 'What is the capital of France?',
  status: 'succeeded',
  model: 'claude-haiku-4.5',
  finished_at: '2026-10-03 14:00:00',
  workspace_dir: '/w/task-1',
  session_id: 'abc',
  result_text: 'Paris',
};

test('the download records the outcome and prompt, not just the text', () => {
  const md = resultMarkdown(RUN);
  assert.match(md, /^# Run 7 — Capital\n/);
  assert.match(md, /- Status: succeeded/);
  assert.match(md, /## Prompt\n\nWhat is the capital of France\?/);
  assert.match(md, /## Result\n\nParis\n$/);
});

test('an unfinished run is labelled as its last message', () => {
  assert.match(resultMarkdown({ ...RUN, status: 'timed_out' }), /## Last message \(unfinished\)\n\nParis/);
});

test('the proposed file name is the tile label plus the short model', () => {
  const run = { ...RUN, task_prompt: 'Top news today', model: 'claude-opus-5.5' };
  assert.equal(resultFileName(run), 'TopNewsToday-opus-5-5.md');
  assert.equal(resultFileName({ ...RUN, model: 'gpt-5.4' }), 'CapitalOfFrance-gpt-5-4.md');
});

test('the file name stays header-safe whatever the prompt holds', () => {
  const run = { ...RUN, task_prompt: 'Résumé "quotes"; café/über.txt', model: 'claude-haiku-4.5' };
  assert.equal(resultFileName(run), 'ResumeQuotesCafeUberTxt-haiku-4-5.md');
  assert.equal(resultFileName({ ...RUN, task_prompt: '???', task_title: '' }), 'Run7-haiku-4-5.md');
});
