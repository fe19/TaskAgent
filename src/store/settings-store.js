import { decodeSettings, validateSettings } from '../domain/settings-schema.js';
import { badRequest } from '../errors.js';

/** Key/value settings. `resolvePath` checks the workspace dir (needs the filesystem). */
export function createSettingsStore({ db, resolvePath, defaultWorkspaceRoot }) {
  const selectAll = db.prepare('SELECT key, value FROM settings');
  const upsert = db.prepare(
    `INSERT INTO settings (key, value) VALUES (?, ?)
       ON CONFLICT(key) DO UPDATE SET value = excluded.value`,
  );

  function read() {
    const raw = Object.fromEntries(selectAll.all().map((r) => [r.key, r.value]));
    return decodeSettings(raw, { defaultWorkspaceRoot });
  }

  /** Applies a patch atomically: one bad field rejects the whole thing. */
  function update(patch) {
    const { values, errors } = validateSettings(patch, { resolvePath });
    if (errors.length > 0) throw badRequest(errors.join('; '));
    for (const [key, value] of Object.entries(values)) upsert.run(key, value);
    return read();
  }

  return { read, update };
}
