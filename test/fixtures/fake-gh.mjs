#!/usr/bin/env node
// Offline stand-in for `gh api /copilot_internal/user`. FAKE_GH_FAIL=1 simulates a logged-out gh.
const args = process.argv.slice(2).join(' ');
if (process.env.FAKE_GH_FAIL || args !== 'api /copilot_internal/user') {
  process.stderr.write('gh: To get started with GitHub CLI, please run:  gh auth login\n');
  process.exit(4);
}
process.stdout.write(JSON.stringify({
  copilot_plan: 'business',
  quota_reset_date_utc: '2026-11-01T00:00:00.000Z',
  quota_snapshots: {
    chat: { unlimited: true, entitlement: 0, remaining: 0 },
    premium_interactions: {
      unlimited: false,
      entitlement: 120000,
      remaining: 88017,
      quota_remaining: 88017.1,
      percent_remaining: 73.3,
      overage_permitted: true,
    },
  },
}));
