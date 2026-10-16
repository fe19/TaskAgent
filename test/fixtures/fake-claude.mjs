#!/usr/bin/env node
/**
 * Deterministic stand-in for the `claude` binary (`-p --output-format stream-json --verbose`),
 * so tests never hit the network. Mimics Claude Code's stream-json message shapes.
 *
 * Behaviour is driven by markers in the prompt:
 *   HANG          -> never exits (exercises the max-runtime kill path)
 *   FAIL          -> writes to stderr and exits 1
 *   ERROR_RESULT  -> a `result` with is_error true, but exit code 0
 *   BLOCKED_SITE  -> a curl to www.bbc.co.uk that the sandbox refuses (real message format)
 *   FETCH_SITE    -> a web fetch of https://example.com/page that works
 *   otherwise     -> a normal successful run that writes out.txt and env-names.json, exits 0
 * CLAUDE_CODE_FAKE_DELAY_MS delays the normal path (keeps runs visible in UI checks).
 */
import { writeFileSync } from 'node:fs';

const argv = process.argv.slice(2);
const flag = (name) => {
  const i = argv.indexOf(name);
  return i === -1 ? null : argv[i + 1];
};
// The prompt comes last, after `--`.
const prompt = argv.includes('--') ? argv.slice(argv.indexOf('--') + 1).join(' ') : '';
const sessionId = flag('--session-id') ?? 'fake-session';
const model = flag('--model') ?? 'sonnet';
const fullModel = `claude-${model}-fake`;

const emit = (msg) => process.stdout.write(`${JSON.stringify({ session_id: sessionId, ...msg })}\n`);
const assistant = (content) =>
  emit({ type: 'assistant', parent_tool_use_id: null, message: { role: 'assistant', model: fullModel, content } });

if (prompt.includes('FAIL')) {
  process.stderr.write('fake-claude: simulated failure\n');
  process.exit(1);
}

emit({ type: 'system', subtype: 'init', cwd: process.cwd(), model: fullModel, permissionMode: flag('--permission-mode') });

if (prompt.includes('HANG')) {
  assistant([{ type: 'text', text: 'Halfway there.' }]);
  process.on('SIGTERM', () => process.exit(143));
  setInterval(() => {}, 1000);
} else if (prompt.includes('ERROR_RESULT')) {
  emit({
    type: 'result',
    subtype: 'error_during_execution',
    is_error: true,
    result: 'Simulated error during execution',
    num_turns: 1,
    duration_api_ms: 10,
    total_cost_usd: 0.001,
    usage: { input_tokens: 5, output_tokens: 1, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 },
    modelUsage: { [fullModel]: {} },
  });
  process.exit(0);
} else {
  await new Promise((r) => setTimeout(r, Number(process.env.CLAUDE_CODE_FAKE_DELAY_MS) || 0));
  if (prompt.includes('FETCH_SITE')) {
    assistant([{ type: 'tool_use', id: 'f1', name: 'WebFetch', input: { url: 'https://example.com/page', prompt: 'title?' } }]);
    emit({ type: 'user', message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: 'f1', content: 'Example Domain' }] } });
  }
  if (prompt.includes('BLOCKED_SITE')) {
    assistant([{ type: 'tool_use', id: 'w1', name: 'Bash', input: { command: 'curl -sS https://www.bbc.co.uk/news' } }]);
    emit({
      type: 'user',
      message: {
        role: 'user',
        content: [{
          type: 'tool_result',
          tool_use_id: 'w1',
          is_error: true,
          content: 'Exit code 56\ncurl: (56) CONNECT tunnel failed, response 403\n\n<sandbox_violations>\ndeny network-outbound www.bbc.co.uk:443 (host is not on the allow list)\n</sandbox_violations>',
        }],
      },
    });
  }
  assistant([
    { type: 'thinking', thinking: 'I will create the requested file. Then I will stop.' },
    { type: 'tool_use', id: 't1', name: 'Write', input: { file_path: `${process.cwd()}/out.txt`, content: 'hello' } },
  ]);
  writeFileSync(`${process.cwd()}/out.txt`, 'hello\n');
  // Names only, so tests can check what the agent's environment holds.
  writeFileSync(`${process.cwd()}/env-names.json`, JSON.stringify(Object.keys(process.env)));
  emit({ type: 'user', message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: 't1', content: 'ok' }] } });
  // Shape captured from claude 2.1.285; utilization is the share used (0–1).
  emit({
    type: 'rate_limit_event',
    rate_limit_info: {
      status: 'allowed',
      resetsAt: 4102444800,
      rateLimitType: 'five_hour',
      unifiedWindows: {
        five_hour: { utilization: 0.25, resetsAt: 4102444800 },
        seven_day: { utilization: 0.6, resetsAt: 4102963200 },
      },
    },
  });
  assistant([{ type: 'text', text: 'Done. Created out.txt with the content hello.' }]);
  emit({
    type: 'result',
    subtype: 'success',
    is_error: false,
    result: 'Done. Created out.txt with the content hello.',
    num_turns: 2,
    duration_ms: 2345,
    duration_api_ms: 1234,
    total_cost_usd: 0.0421,
    usage: { input_tokens: 1200, output_tokens: 80, cache_read_input_tokens: 3000, cache_creation_input_tokens: 500 },
    modelUsage: { [fullModel]: { inputTokens: 1200, outputTokens: 80, costUSD: 0.0421 } },
    permission_denials: [],
  });
  process.exit(0);
}
