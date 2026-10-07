import { loadConfig } from './config.js';
import { Bus } from './events.js';
import { createActions } from './actions.js';
import { openDatabase, reconcileOrphanedRuns } from './store/database.js';
import { createSettingsStore } from './store/settings-store.js';
import { createTaskStore } from './store/task-store.js';
import { createRunStore } from './store/run-store.js';
import { Scheduler } from './agents/scheduler.js';
import { createResourceMonitor } from './agents/resource-usage.js';
import { createQuotaReader, ghCopilotUser } from './store/copilot-quota.js';
import { resolveWorkspaceRoot, defaultWorkspaceRoot } from './agents/workspace.js';

/** UI-agnostic composition root. Each UI process owns one. */
export function createControlRoom(overrides = {}) {
  const config = loadConfig(overrides);
  const db = openDatabase(config.dbFile);
  const orphaned = reconcileOrphanedRuns(db);

  const settings = createSettingsStore({
    db,
    resolvePath: resolveWorkspaceRoot,
    defaultWorkspaceRoot: config.workspaceRoot ?? defaultWorkspaceRoot(),
  });
  const tasks = createTaskStore({ db });
  const runs = createRunStore({ db });
  const bus = new Bus();
  const scheduler = new Scheduler({
    settings,
    tasks,
    runs,
    bus,
    agentOptions: {
      copilotBin: config.copilotBin,
      claudeBin: config.claudeBin,
      workspaceRoot: config.workspaceRoot,
      usageRetries: config.usageRetries,
      readUsage: config.readUsage,
    },
  });
  const actions = createActions({ settings, tasks, runs, scheduler, bus });
  const resources = createResourceMonitor({ scheduler, ...config.resourceMonitor });
  const quota = createQuotaReader({ fetchUser: () => ghCopilotUser(config.ghBin) });

  scheduler.tick();

  async function close() {
    await scheduler.shutdown();
    db.close();
  }

  return { config, db, bus, settings, tasks, runs, scheduler, actions, resources, quota, orphaned, close };
}
