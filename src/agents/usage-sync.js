import { readCopilotUsage } from '../store/copilot-usage.js';

/** Usage rows can land slightly after process exit, so the read is retried. */
export const USAGE_RETRIES = 6;
const USAGE_RETRY_DELAY_MS = 500;

const wait = (ms) => new Promise((r) => setTimeout(r, ms));

/** Polls briefly for usage (rows land around exit). Returns null, never zeros. */
export async function pollUsage(
  sessionId,
  { read = readCopilotUsage, retries = USAGE_RETRIES, delayMs = USAGE_RETRY_DELAY_MS } = {},
) {
  for (let attempt = 0; attempt < retries; attempt += 1) {
    const usage = read(sessionId);
    if (usage) return usage;
    await wait(delayMs);
  }
  return null;
}
