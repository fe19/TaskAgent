/** The latest usage limits each assistant reported. Account-wide, so one row per assistant. */
export function createLimitsStore({ db }) {
  const statements = {
    save: db.prepare(
      `INSERT INTO assistant_limits (assistant, info, observed_at) VALUES (?, ?, datetime('now'))
       ON CONFLICT(assistant) DO UPDATE SET info = excluded.info, observed_at = excluded.observed_at`,
    ),
    get: db.prepare('SELECT info, observed_at FROM assistant_limits WHERE assistant = ?'),
  };

  return {
    save: (assistant, limits) => statements.save.run(assistant, JSON.stringify(limits)),

    get(assistant) {
      const row = statements.get.get(assistant);
      if (!row) return null;
      try {
        return { ...JSON.parse(row.info), observed_at: `${row.observed_at.replace(' ', 'T')}Z` };
      } catch {
        return null;
      }
    },
  };
}
