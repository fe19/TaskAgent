import { nextOccurrence } from '../domain/schedule.js';

/** How often due tasks are looked for; a scheduled task starts at most this late. */
const TICK_MS = 5000;

/**
 * Starts scheduled tasks when their time comes, in Manual and Auto mode alike, and puts a
 * repeating task back in the queue at its next occurrence after each run. A due task that finds
 * no free slot stays due and starts as soon as one frees.
 */
export class TaskClock {
  constructor({ tasks, scheduler, bus, now = () => Date.now(), tickMs = TICK_MS }) {
    Object.assign(this, { tasks, scheduler, bus, now, tickMs });
    this.onEvent = ({ type, payload }) => {
      if (type === 'run.finished') this.afterRun(payload.taskId);
    };
  }

  start() {
    this.bus.on('event', this.onEvent);
    this.timer = setInterval(() => this.tick(), this.tickMs);
    this.timer.unref?.();
    // Starts missed on downtime run now, once.
    this.tick();
    return this;
  }

  stop() {
    clearInterval(this.timer);
    this.bus.off('event', this.onEvent);
  }

  /** Starts every due task a free slot allows. Returns how many started. */
  tick() {
    let started = 0;
    for (const task of this.tasks.listDue()) {
      if (this.scheduler.capacity() === 0) break;
      if (this.scheduler.startTask(task.id)) started += 1;
    }
    return started;
  }

  /** A repeating task waits for its next occurrence; stopping one run does not end the series. */
  afterRun(taskId) {
    const task = this.tasks.get(taskId);
    if (!task?.repeat || task.status === 'queued' || task.status === 'running') return null;
    const runAt = nextOccurrence(task.repeat, task.run_at, this.now());
    if (!runAt) return null;
    this.tasks.reschedule(task.id, runAt);
    this.bus.publish('task.rescheduled', { taskId: task.id, runAt });
    return runAt;
  }
}
