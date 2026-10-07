import { AgentRun } from './agent-run.js';

/**
 * Runs up to `max_concurrent_agents` agents. Auto mode (`auto_dispatch`) pulls from the queue;
 * manual mode starts only what `startTask` is asked to.
 */
export class Scheduler {
  constructor({ settings, tasks, runs, bus, agentOptions = {} }) {
    this.settings = settings;
    this.tasks = tasks;
    this.runs = runs;
    this.bus = bus;
    this.agentOptions = agentOptions;
    this.active = new Map(); // runId -> AgentRun
    this.syncing = new Set(); // ended runs still fetching their usage
    this.draining = false;
    this.stopped = false;
  }

  get activeCount() {
    return this.active.size;
  }

  /** Root process of every running agent. */
  livePids() {
    return [...this.active.values()].map((run) => run.child?.pid).filter(Boolean);
  }

  capacity() {
    return Math.max(0, this.settings.read().max_concurrent_agents - this.active.size);
  }

  /** Starts as many agents as capacity allows. Re-entrant calls are ignored. */
  tick() {
    if (this.stopped || this.draining) return [];
    const settings = this.settings.read();
    if (!settings.auto_dispatch) return [];

    this.draining = true;
    const started = [];
    try {
      while (this.active.size < settings.max_concurrent_agents) {
        const task = this.tasks.claimNext();
        if (!task) break;
        started.push(this.#launch(task, settings));
      }
    } finally {
      this.draining = false;
    }

    if (started.length > 0) this.bus?.publish('scheduler.dispatched', { count: started.length });
    return started;
  }

  /** Starts one specific queued task now, if a slot is free. */
  startTask(taskId) {
    if (this.stopped || this.capacity() === 0) return null;
    const task = this.tasks.claim(taskId);
    if (!task) return null;
    const run = this.#launch(task, this.settings.read());
    if (run) this.bus?.publish('scheduler.dispatched', { count: 1 });
    return run;
  }

  #launch(task, settings) {
    const run = new AgentRun({
      runs: this.runs,
      tasks: this.tasks,
      bus: this.bus,
      task,
      settings,
      ...this.agentOptions,
      // An explicit root (tests) wins; otherwise follow the live setting.
      workspaceRoot: this.agentOptions.workspaceRoot ?? settings.workspace_root,
    });

    try {
      run.start();
    } catch (err) {
      // Spawn failed outright (e.g. the binary is missing): do not strand the task.
      this.tasks.setStatus(task.id, 'failed');
      this.bus?.publish('scheduler.error', { taskId: task.id, error: err.message });
      return null;
    }

    this.active.set(run.runId, run);
    // The slot frees once the outcome is recorded; usage syncing must not hold it.
    run.ended.then(() => {
      this.active.delete(run.runId);
      this.syncing.add(run);
      setImmediate(() => this.tick()); // A slot freed up; pull the next task.
    });
    run.exited.then(() => this.syncing.delete(run));
    return run;
  }

  stopRun(runId, reason = 'cancelled') {
    const run = this.active.get(Number(runId));
    if (!run) return false;
    run.stop(reason);
    return true;
  }

  /** Like `stopRun`, but resolves once the run has exited and recorded its outcome. */
  async stopRunAndWait(runId, reason = 'cancelled') {
    const run = this.active.get(Number(runId));
    if (!run) return false;
    run.stop(reason);
    await run.ended;
    return true;
  }

  /** Also waits for usage syncs still writing to the db. */
  async stopAll(reason = 'cancelled') {
    const runs = [...this.active.values()];
    for (const run of runs) run.stop(reason);
    await Promise.allSettled([...runs, ...this.syncing].map((r) => r.exited));
    return runs.length;
  }

  /** Stops scheduling and waits for agents to exit, so the db can be closed. */
  async shutdown(reason = 'cancelled') {
    this.stopped = true;
    const stopped = await this.stopAll(reason);
    // Let any queued setImmediate(tick) callbacks run while `stopped` guards them.
    await new Promise((r) => setImmediate(r));
    return stopped;
  }
}
