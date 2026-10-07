import { test } from 'node:test';
import assert from 'node:assert/strict';
import { shortLabel } from '../../src/domain/task-label.js';

test('a bare question becomes a short label', () => {
  assert.equal(shortLabel('What is the capital of France?'), 'Capital of France');
});

test('leading filler is stripped, however it is stacked', () => {
  assert.equal(shortLabel('Please can you tell me the capital of France'), 'Capital of France');
  assert.equal(shortLabel('I would like you to create notes.md'), 'Create notes.md');
  assert.equal(shortLabel('Task: summarise the readme'), 'Summarise readme');
});

test('labels stay within five words', () => {
  const label = shortLabel('Create a python script that reverses a string and prints the result');
  assert.ok(label.split(' ').length <= 5, label);
});

test('detail that distinguishes similar tasks is kept', () => {
  const us = shortLabel('List all cities from the us');
  const uk = shortLabel('List all cities from the uk');
  assert.notEqual(us, uk);
});

test('"of" is never treated as a clause boundary', () => {
  assert.match(shortLabel('Give me the capital of Australia'), /of Australia$/);
});

test('a label never ends on a dangling connector', () => {
  const label = shortLabel('Write a short summary of the file and then stop');
  assert.ok(!/\b(and|with|to|for|from)$/i.test(label), label);
});

test('filenames survive because a dot only ends a sentence before whitespace', () => {
  assert.match(shortLabel('Create notes.md in the workspace'), /notes\.md/);
});

test('only the first character is capitalised, so casing is never invented', () => {
  assert.equal(shortLabel('create notes.md'), 'Create notes.md');
});

test('very long single-clause prompts are truncated with an ellipsis', () => {
  const label = shortLabel('Refactoring authentication middleware configuration thoroughly today');
  assert.ok(label.length <= 43, `${label.length} chars: ${label}`);
});

test('a prompt made only of filler falls back to the title', () => {
  assert.equal(shortLabel('please', 'Fallback title'), 'Fallback title');
});

test('empty and non-string prompts do not throw', () => {
  assert.equal(shortLabel('', 'Title here'), 'Title here');
  assert.equal(shortLabel(null, 'Title here'), 'Title here');
  assert.equal(shortLabel(undefined, ''), '');
});

test('only the first non-empty line is considered', () => {
  assert.equal(shortLabel('\n\nCreate notes.md\nThen do something else'), 'Create notes.md');
});
