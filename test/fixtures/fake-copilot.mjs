#!/usr/bin/env node
/**
 * Deterministic stand-in for the `copilot` binary, used by the test suite so
 * tests never hit the network. It mimics the real JSONL event shapes captured
 * from `copilot -p ... --output-format json`.
 *
 * Behaviour is driven by markers in the prompt:
 *   HANG  -> never exits (exercises the max-runtime kill path)
 *   FAIL  -> writes to stderr and exits 1
 * FAKE_COPILOT_DELAY_MS delays the normal path (keeps runs visible in UI checks).
 *   otherwise -> emits a normal successful sequence and exits 0
 */
import { writeFileSync } from 'node:fs';

const argv = process.argv.slice(2);

function flag(name) {
  const i = argv.indexOf(name);
  return i === -1 ? null : argv[i + 1];
}

const prompt = flag('-p') ?? '';
const sessionId = flag('--session-id') ?? 'fake-session';
const model = flag('--model') ?? 'fake-model';
const reasoningEffort = flag('--reasoning-effort');

// Mimics models that reject an explicit reasoning effort: fails only while the
// flag is present, so the runner's retry-without-the-flag path can succeed.
if (prompt.includes('REJECT_EFFORT') && reasoningEffort) {
  process.stderr.write(
    `Error: Model "${model}" does not support reasoning effort configuration (requested: "${reasoningEffort}").\n`,
  );
  process.exit(1);
}

function emit(type, data, extra = {}) {
  process.stdout.write(
    `${JSON.stringify({ type, data, id: `${Math.random()}`, timestamp: new Date().toISOString(), ...extra })}\n`,
  );
}

emit('user.message', { content: prompt });
emit('assistant.turn_start', { turnId: '0' });

if (prompt.includes('HANG')) {
  emit('assistant.reasoning', { content: 'Working on a long task that never finishes.' });
  emit('assistant.message', { content: 'Halfway there.', model });
  // Like the real CLI: a clean `result` and exit 0 on SIGTERM.
  process.on('SIGTERM', () => {
    process.stdout.write(`${JSON.stringify({ type: 'result', exitCode: 0, usage: {} })}\n`);
    process.exit(0);
  });
  setInterval(() => {}, 1000); // keep the event loop alive
} else if (prompt.includes('FAIL')) {
  process.stderr.write('fake-copilot: simulated failure\n');
  process.exit(1);
} else {
  await new Promise((r) => setTimeout(r, Number(process.env.FAKE_COPILOT_DELAY_MS) || 0));
  emit('assistant.reasoning', { content: 'I will create the requested file. Then I will stop.' });
  emit('tool.execution_start', {
    toolCallId: 't1',
    toolName: 'create',
    toolTitle: 'Creating file',
    arguments: { path: `${process.cwd()}/out.txt`, file_text: 'hello' },
    model,
  });
  writeFileSync(`${process.cwd()}/out.txt`, 'hello\n');
  emit('tool.execution_complete', {
    toolCallId: 't1',
    success: true,
    result: { content: 'Created file' },
  });
  emit('assistant.message', { content: 'Done. Created out.txt with the content hello.', model });
  emit('assistant.turn_end', { turnId: '0' });
  process.stdout.write(
    `${JSON.stringify({
      type: 'result',
      timestamp: new Date().toISOString(),
      sessionId,
      exitCode: 0,
      usage: {
        premiumRequests: 0.33,
        totalApiDurationMs: 1234,
        sessionDurationMs: 2345,
        codeChanges: { linesAdded: 1, linesRemoved: 0, filesModified: [`${process.cwd()}/out.txt`] },
      },
    })}\n`,
  );
  process.exit(0);
}
