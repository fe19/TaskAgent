import { permissionArgs } from '../domain/permissions.js';

/** Copilot CLI adapter: argv, env and JSONL events. Swap this file to support another agent backend. */

/** `--allow-all-tools` only skips approval prompts; real limits are the permission flags. */
export function buildArgs({
  prompt,
  workspace,
  workspaceRoot,
  model,
  sessionId,
  reasoningEffort,
  permissions = {},
}) {
  const args = [
    '-p',
    prompt,
    '-C',
    workspace,
    '--allow-all-tools',
    '--output-format',
    'json',
    '--log-level',
    'none',
    '--no-auto-update',
    // Our own session id lets us attribute token usage (store/copilot-usage.js).
    '--session-id',
    sessionId,
    '--model',
    model,
    '--disable-builtin-mcps',
    ...permissionArgs(permissions),
  ];
  // Lets agents read/write the whole working directory without approval prompts.
  if (workspaceRoot) args.push('--add-dir', workspaceRoot);
  // "default" omits the flag; several models reject it.
  if (reasoningEffort && reasoningEffort !== 'default') {
    args.push('--reasoning-effort', reasoningEffort);
  }
  return args;
}

/** `GIT_CEILING_DIRECTORIES` stops agent `git` from finding the parent repository. */
export function buildEnv({ workspaceRoot }) {
  return {
    ...process.env,
    // '1', never 'true': 'true' also trusts the (agent-writable) workspace.
    COPILOT_ALLOW_ALL: '1',
    NO_COLOR: '1',
    GIT_CEILING_DIRECTORIES: workspaceRoot,
  };
}

/** The CLI rejects this combination up front, so we can recover by dropping the flag. */
export function isReasoningEffortRejection(stderr) {
  return /does not support reasoning effort/i.test(stderr ?? '');
}

/** Parses one line of the CLI's JSONL stream. Non-JSON output is ignored, not fatal. */
export function parseEvent(line) {
  const trimmed = line.trim();
  if (!trimmed.startsWith('{')) return null;
  try {
    return JSON.parse(trimmed);
  } catch {
    return null;
  }
}

/** Turns one CLI event into a short human-readable activity line, or null. */
export function summarizeEvent(evt) {
  const d = evt?.data ?? {};
  switch (evt?.type) {
    case 'user.message':
      return { kind: 'start', summary: 'Received task prompt' };
    case 'assistant.turn_start':
      return { kind: 'thinking', summary: 'Thinking' };
    case 'assistant.reasoning': {
      const text = typeof d.content === 'string' ? d.content.trim() : '';
      // The second reasoning event carries an opaque base64 blob, not prose.
      if (!text || /^[A-Za-z0-9+/=]{80,}$/.test(text.slice(0, 120))) return null;
      return { kind: 'thinking', summary: firstSentence(text) };
    }
    case 'tool.execution_start':
      return {
        kind: 'tool',
        summary: d.toolTitle ? `${d.toolTitle}${describeTarget(d)}` : `Running ${d.toolName}`,
      };
    case 'tool.execution_complete':
      return { kind: 'tool_done', summary: d.success === false ? 'Tool call failed' : null };
    case 'assistant.message': {
      const text = typeof d.content === 'string' ? d.content.trim() : '';
      if (text) return { kind: 'message', summary: firstSentence(text) };
      const intent = d.toolRequests?.[0]?.intentionSummary;
      return intent ? { kind: 'plan', summary: capitalize(intent) } : null;
    }
    case 'result':
      return { kind: 'result', summary: `Finished with exit code ${evt.exitCode}` };
    default:
      return null;
  }
}

/** The `result` event has code changes and premium requests, not tokens. */
export function readResultMetrics(evt) {
  const usage = evt?.usage ?? {};
  const changes = usage.codeChanges ?? {};
  return {
    premiumRequests: usage.premiumRequests ?? null,
    linesAdded: changes.linesAdded ?? null,
    linesRemoved: changes.linesRemoved ?? null,
    filesModified: changes.filesModified ?? null,
  };
}

function describeTarget(d) {
  const path = d.arguments?.path;
  if (typeof path === 'string') return `: ${path.split('/').pop()}`;
  const command = d.arguments?.command;
  if (typeof command === 'string') return `: ${truncate(command, 60)}`;
  return '';
}

function firstSentence(text) {
  const clean = text.replace(/\s+/g, ' ').trim();
  const match = clean.match(/^.{0,140}?[.!?](\s|$)/);
  return truncate(match ? match[0].trim() : clean, 140);
}

function truncate(s, n) {
  return s.length > n ? `${s.slice(0, n - 1)}…` : s;
}

function capitalize(s) {
  return s.charAt(0).toUpperCase() + s.slice(1);
}
