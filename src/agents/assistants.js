import { copilotAdapter } from './copilot-cli.js';
import { claudeAdapter } from './claude-cli.js';

/** CLI adapters by assistant id (domain/assistants.js lists the selectable ones). */
const ADAPTERS = new Map([copilotAdapter, claudeAdapter].map((a) => [a.id, a]));

export function adapterFor(assistantId) {
  const adapter = ADAPTERS.get(assistantId);
  if (!adapter) throw new Error(`No agent backend for assistant "${assistantId}"`);
  return adapter;
}
