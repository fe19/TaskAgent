import { TOOL_IDS, parseList, serializeList, invalidEnvNames, invalidUrlPatterns } from './permissions.js';
import { ASSISTANTS, DEFAULT_ASSISTANT } from './assistants.js';

/** Settings schema and validation. Pure: path checks are injected as `resolvePath`. */
// GitHub Copilot list price per AI Credit; editable because plans and discounts differ.
export const DEFAULT_USD_PER_AIC = 0.01;

export const SETTING_SPEC = {
  assistant: {
    type: 'assistant',
    values: ASSISTANTS.filter((a) => !a.preview).map((a) => a.id),
    options: ASSISTANTS,
  },
  max_concurrent_agents: { type: 'int', min: 1, max: 8 },
  max_runtime_minutes: { type: 'int', min: 1, max: 1000 },
  model: {
    type: 'enum',
    values: [
      'claude-haiku-4.5',
      'claude-sonnet-5',
      'claude-opus-5',
      'claude-opus-5.5',
      'gpt-5.4',
      'gpt-5.4-mini',
      'auto',
    ],
  },
  reasoning_effort: {
    type: 'enum',
    values: ['default', 'none', 'minimal', 'low', 'medium', 'high'],
  },
  auto_dispatch: { type: 'bool' },
  usd_per_aic: { type: 'decimal', min: 0, max: 100 },
  workspace_root: { type: 'path' },
  // Permissions. Each maps to a copilot CLI flag; see ./permissions.js.
  allowed_tools: { type: 'tools' },
  denied_commands: { type: 'list' },
  blocked_urls: { type: 'urls' },
  secret_env_vars: { type: 'env-names' },
};

/** Keys whose stored value is a comma-separated list but whose API shape is an array. */
const LIST_KEYS = ['allowed_tools', 'denied_commands', 'blocked_urls', 'secret_env_vars'];

/** Raw key/value rows → typed settings (lists as arrays). */
export function decodeSettings(raw, { defaultWorkspaceRoot }) {
  const settings = {
    assistant: raw.assistant || DEFAULT_ASSISTANT,
    max_concurrent_agents: Number(raw.max_concurrent_agents),
    max_runtime_minutes: Number(raw.max_runtime_minutes),
    model: raw.model,
    reasoning_effort: raw.reasoning_effort,
    auto_dispatch: raw.auto_dispatch === 'true',
    workspace_root: raw.workspace_root || defaultWorkspaceRoot,
    usd_per_aic: Number(raw.usd_per_aic ?? DEFAULT_USD_PER_AIC),
  };
  for (const key of LIST_KEYS) settings[key] = parseList(raw[key]);
  return settings;
}

const VALIDATORS = {
  int(key, value, spec) {
    const n = Number(value);
    if (!Number.isInteger(n) || n < spec.min || n > spec.max) {
      return { error: `${key} must be a whole number between ${spec.min} and ${spec.max}` };
    }
    return { value: String(n) };
  },

  decimal(key, value, spec) {
    const n = value === '' || value == null ? NaN : Number(value);
    if (!Number.isFinite(n) || n < spec.min || n > spec.max) {
      return { error: `${key} must be a number between ${spec.min} and ${spec.max}` };
    }
    return { value: String(n) };
  },

  enum(key, value, spec) {
    if (!spec.values.includes(String(value))) {
      return { error: `${key} must be one of: ${spec.values.join(', ')}` };
    }
    return { value: String(value) };
  },

  assistant(key, value, spec) {
    const option = spec.options.find((a) => a.id === String(value));
    if (!option) return { error: `${key} must be one of: ${spec.options.map((a) => a.id).join(', ')}` };
    if (option.preview) return { error: `${option.name} is in preview and cannot run tasks yet` };
    return { value: option.id };
  },

  bool(key, value) {
    if (typeof value !== 'boolean' && value !== 'true' && value !== 'false') {
      return { error: `${key} must be true or false` };
    }
    return { value: String(value) === 'true' ? 'true' : 'false' };
  },

  tools(key, value) {
    const tools = parseList(value);
    const unknown = tools.filter((t) => !TOOL_IDS.includes(t));
    if (unknown.length > 0) return { error: `${key} contains unknown tools: ${unknown.join(', ')}` };
    if (tools.length === 0) {
      return { error: 'At least one tool must be allowed, otherwise agents cannot do anything' };
    }
    return { value: serializeList(tools) };
  },

  list(key, value) {
    return { value: serializeList(value) };
  },

  urls(key, value) {
    const invalid = invalidUrlPatterns(value);
    if (invalid.length > 0) return { error: `${key} contains invalid websites: ${invalid.join(', ')}` };
    return { value: serializeList(value) };
  },

  'env-names': function envNames(key, value) {
    const invalid = invalidEnvNames(value);
    if (invalid.length > 0) {
      return { error: `${key} contains invalid variable names: ${invalid.join(', ')}` };
    }
    return { value: serializeList(value) };
  },

  path(key, value, spec, { resolvePath }) {
    if (!resolvePath) throw new Error('validateSettings needs a resolvePath to check a path');
    try {
      return { value: resolvePath(value) };
    } catch (err) {
      return { error: err.message };
    }
  },
};

/** Validates a partial patch without writing. Returns `{ values, errors }`. */
export function validateSettings(patch, deps = {}) {
  const values = {};
  const errors = [];

  for (const [key, value] of Object.entries(patch)) {
    const spec = SETTING_SPEC[key];
    if (!spec) {
      errors.push(`Unknown setting: ${key}`);
      continue;
    }

    const result = VALIDATORS[spec.type](key, value, spec, deps);
    if (result.error) errors.push(result.error);
    else values[key] = result.value;
  }

  return { values, errors };
}
