import { badRequest, conflict, notFound } from './errors.js';
import { LANES, taskLane } from './domain/run-status.js';

/** Every state-changing operation, shared by every UI. */
export function createActions({ settings, tasks, runs, scheduler, bus }) {
  function requireTask(id) {
    const task = tasks.get(id);
    if (!task) throw notFound('Task not found');
    return task;
  }

  function requireSlotInManualMode() {
    if (!settings.read().auto_dispatch && scheduler.capacity() === 0) {
      throw conflict('All agent slots are busy. Stop an agent or raise Parallel agents.');
    }
  }

  /** An old run of a task that is active again is dragged as a new task with its prompt. */
  function moveCopy(task, to) {
    if (to === 'done') throw badRequest('A copy can only go to queued or running');
    if (to === 'running') requireSlotInManualMode();
    const input = { prompt: task.prompt, title: task.title, priority: task.priority };
    if (to === 'queued') return actions.createTask(input);
    const copy = tasks.create(input);
    bus.publish('task.created', { taskId: copy.id });
    return actions.startTask(copy.id);
  }

  /** Back to the queue without dispatching; `hold` keeps Auto mode from starting it. */
  function requeue(id, { hold = false } = {}) {
    const task = requireTask(id);
    if (task.status === 'running' || task.status === 'queued') {
      throw conflict(`Task is already ${task.status}`);
    }
    if (hold) tasks.hold(id);
    else tasks.requeue(id);
    bus.publish('task.requeued', { taskId: id });
  }

  function saveSettings(patch) {
    const updated = settings.update(patch);
    bus.publish('settings.updated', updated);
    return updated;
  }

  const actions = {
    createTask(input) {
      const task = tasks.create(input);
      bus.publish('task.created', { taskId: task.id });
      scheduler.tick();
      return task;
    },

    /** Only a queued task can change; one that has started keeps its prompt. */
    editTask(id, input) {
      const task = requireTask(id);
      const edited = task.status === 'queued' ? tasks.editQueued(id, input) : null;
      if (!edited) throw conflict('Only a queued task can be edited; this one has already started.');
      bus.publish('task.updated', { taskId: id });
      return edited;
    },

    /** A running task's agent is stopped first, then the task is deleted. */
    async deleteTask(id) {
      const task = requireTask(id);
      if (task.status === 'running') {
        const runId = runs.liveRunIdForTask(id);
        if (!runId || !(await scheduler.stopRunAndWait(runId, 'cancelled'))) {
          throw conflict('No live agent process for this task');
        }
      }
      const result = tasks.remove(id);
      if (result.reason === 'running') throw conflict('Cannot delete a running task. Stop the agent first.');
      if (!result.deleted) throw notFound('Task not found');
      bus.publish('task.deleted', { taskId: id });
    },

    /** Stops a running task's agent or cancels a queued task. */
    cancelTask(id) {
      const task = requireTask(id);
      if (task.status === 'running') {
        const runId = runs.liveRunIdForTask(id);
        if (runId && scheduler.stopRun(runId, 'cancelled')) return { stopping: true };
        throw conflict('No live agent process for this task');
      }
      if (task.status !== 'queued') throw conflict(`Task is already ${task.status}`);
      tasks.setStatus(id, 'cancelled');
      bus.publish('task.cancelled', { taskId: id });
      return { cancelled: true };
    },

    /** A retry runs when a slot frees in Auto mode, or by hand in Manual mode. */
    requeueTask(id) {
      requeue(id);
      scheduler.tick();
      return tasks.get(id);
    },

    /** Starts a queued task now. Without a free slot, auto mode queues it; manual mode refuses. */
    startTask(id) {
      const task = requireTask(id);
      if (task.status !== 'queued') throw conflict('Task is not waiting to be started');
      if (scheduler.startTask(id)) return tasks.get(id);
      if (!settings.read().auto_dispatch) throw conflict('All agent slots are busy. Stop an agent or raise Parallel agents.');
      tasks.release(id);
      bus.publish('task.released', { taskId: id });
      scheduler.tick();
      return tasks.get(id);
    },

    updateSettings(patch) {
      const updated = saveSettings(patch);
      scheduler.tick(); // A larger pool may free a slot.
      return updated;
    },

    setDispatch(running) {
      if (typeof running !== 'boolean') throw badRequest('running must be true or false');
      const updated = saveSettings({ auto_dispatch: running });
      const started = running ? scheduler.tick().filter(Boolean).length : 0;
      return { running: updated.auto_dispatch, started };
    },

    stopRun(runId) {
      if (!scheduler.stopRun(runId, 'cancelled')) throw notFound('No live agent with that run id');
    },

    stopAll: () => scheduler.stopAll('cancelled'),

    /**
     * Drag and drop between board lanes. `from` must match the task's lane, so a stale
     * board cannot trigger the wrong action. `copy` drags an old run of an active task.
     */
    async moveTask(id, { from, to, copy = false } = {}) {
      if (!LANES.includes(from) || !LANES.includes(to)) {
        throw badRequest(`from and to must be one of: ${LANES.join(', ')}`);
      }
      const task = requireTask(id);
      if (copy) {
        if (from !== 'done' || taskLane(task.status) === 'done') throw conflict('Only an old run of an active task is copied');
        return moveCopy(task, to);
      }
      if (taskLane(task.status) !== from) throw conflict(`Task is already ${task.status}`);
      if (from === to) return task;

      if (from === 'running') {
        const runId = runs.liveRunIdForTask(id);
        if (!runId || !(await scheduler.stopRunAndWait(runId, 'cancelled'))) {
          throw conflict('No live agent process for this task');
        }
        // Dragged back by hand: paused until started again.
        if (to === 'queued') requeue(id, { hold: true });
        return tasks.get(id);
      }
      if (to === 'done') {
        actions.cancelTask(id);
        return tasks.get(id);
      }
      if (to === 'queued') return actions.requeueTask(id);
      // to running: finished tasks are retried and started straight away.
      if (from === 'done') {
        requireSlotInManualMode();
        requeue(id);
      }
      return actions.startTask(id);
    },
  };
  return actions;
}
