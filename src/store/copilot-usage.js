import { DatabaseSync } from 'node:sqlite';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { existsSync } from 'node:fs';

/** Token usage lives in the Copilot CLI session store, joined on our `--session-id`. Returns null, never zeros. */
export function defaultStorePath() {
  const home = process.env.COPILOT_HOME || join(homedir(), '.copilot');
  return join(home, 'session-store.db');
}

const TOTALS_SQL = `
  SELECT COUNT(*)                AS api_calls,
         SUM(input_tokens)       AS input_tokens,
         SUM(output_tokens)      AS output_tokens,
         SUM(cache_read_tokens)  AS cache_read_tokens,
         SUM(cache_write_tokens) AS cache_write_tokens,
         SUM(reasoning_tokens)   AS reasoning_tokens,
         SUM(total_nano_aiu)     AS nano_aiu,
         SUM(duration_ms)        AS api_duration_ms
    FROM assistant_usage_events
   WHERE session_id = ?`;

const MODELS_SQL = `
  SELECT model, COUNT(*) AS calls FROM assistant_usage_events
   WHERE session_id = ? GROUP BY model ORDER BY calls DESC`;

export function readCopilotUsage(sessionId, storePath = defaultStorePath()) {
  if (!sessionId || !existsSync(storePath)) return null;

  let db;
  try {
    db = new DatabaseSync(storePath, { readOnly: true });
    const totals = db.prepare(TOTALS_SQL).get(sessionId);
    if (!totals || !totals.api_calls) return null;

    const models = db.prepare(MODELS_SQL).all(sessionId);
    return {
      api_calls: Number(totals.api_calls),
      input_tokens: Number(totals.input_tokens ?? 0),
      output_tokens: Number(totals.output_tokens ?? 0),
      cache_read_tokens: Number(totals.cache_read_tokens ?? 0),
      cache_write_tokens: Number(totals.cache_write_tokens ?? 0),
      reasoning_tokens: Number(totals.reasoning_tokens ?? 0),
      nano_aiu: Number(totals.nano_aiu ?? 0),
      api_duration_ms: Number(totals.api_duration_ms ?? 0),
      model: models.map((m) => m.model).join(', ') || null,
    };
  } catch {
    // A locked store or an upstream schema change must never take the app down.
    return null;
  } finally {
    db?.close();
  }
}

/** 1 AIU == 1e9 nano-AIU. */
export function nanoAiuToAiu(nanoAiu) {
  return nanoAiu == null ? null : Number(nanoAiu) / 1e9;
}
