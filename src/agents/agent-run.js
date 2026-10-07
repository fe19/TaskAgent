import { spawn } from 'node:child_process';
import { createInterface } from 'node:readline';
import { randomUUID } from 'node:crypto';
import { finalActivity, resolveFinalStatus, stoppingActivity } from '../domain/run-status.js';
import {
  buildArgs,
  buildEnv,
  isReasoningEffortRejection,
  parseEvent,
  readResultMetrics,
  summarizeEvent,
} from './copilot-cli.js';
import { createWorkspace, hasTrustedConfig } from './workspace.js';
import { terminate } from './process.js';
import { pollUsage } from './usage-sync.js';

/** How much stderr to keep for the message shown on a failed tile. */
const STDERR_LIMIT = 4000;

/** One Copilot CLI agent on one task: spawn, stream, time limit, stop, finish. */
export class AgentRun {
  constructor({
    runs,
    tasks,
    bus,
    task,
    settings,
    workspaceRoot,
    copilotBin = process.env.COPILOT_BIN || 'copilot',
    usageRetries,
    readUsage,
  }) {
    Object.assign(this, {
      runs,
      tasks,
      bus,
      task,
      settings,
      workspaceRoot,
      copilotBin,
    });
    this.usageOptions = { retries: usageRetries, read: readUsage };

    this.sessionId = randomUUID();
    this.toolCalls = 0;
    this.stopping = null;
    this.finished = false;
    this.stderr = '';
    this.finalMessage = null;
  }

  start() {
    this.workspace = createWorkspace(this.workspaceRoot, {
      taskId: this.task.id,
      sessionId: this.sessionId,
    });

    this.runId = this.runs.create({
      taskId: this.task.id,
      sessionId: this.sessionId,
      workspaceDir: this.workspace,
      model: this.settings.model,
      maxRuntimeSeconds: Math.round(this.settings.max_runtime_minutes * 60),
    });

    this.#spawnProcess(this.settings.reasoning_effort);

    this.timer = setTimeout(() => this.stop('timed_out'), this.settings.max_runtime_minutes * 60_000);
    // `ended`: process gone and outcome recorded. `exited`: usage synced too.
    this.ended = new Promise((res) => {
      this.resolveEnd = res;
    });
    this.exited = new Promise((res) => {
      this.resolveExit = res;
    });
    return this;
  }

  #spawnProcess(reasoningEffort) {
    this.reasoningEffort = reasoningEffort;
    this.stderr = '';

    const args = buildArgs({
      prompt: this.task.prompt,
      workspace: this.workspace,
      workspaceRoot: this.#sharedRoot(),
      model: this.settings.model,
      sessionId: this.sessionId,
      reasoningEffort,
      permissions: this.settings,
    });

    this.child = spawn(this.copilotBin, args, {
      cwd: this.workspace,
      stdio: ['ignore', 'pipe', 'pipe'],
      env: buildEnv({ workspaceRoot: this.workspaceRoot }),
    });

    this.runs.markRunning(this.runId, this.child.pid);
    this.#publish('run.started');

    this.child.on('error', (err) => this.#finalize({ status: 'failed', error: err.message }));
    this.child.stderr.on('data', (chunk) => {
      this.stderr = `${this.stderr}${chunk}`.slice(-STDERR_LIMIT);
    });
    createInterface({ input: this.child.stdout }).on('line', (line) => this.#onLine(line));
    this.child.on('close', (code) => this.#onClose(code));
  }

  /** The root agents may access freely, unless it holds config `--add-dir` would trust. */
  #sharedRoot() {
    if (!hasTrustedConfig(this.workspaceRoot)) return this.workspaceRoot;
    this.#record('warning', 'Working directory has .github/skills or agents; access limited to the run workspace');
    return null;
  }

  #onLine(line) {
    const evt = parseEvent(line);
    if (!evt) return;

    this.#observe(evt);

    // The CLI exits 0 on SIGTERM; "Finished with exit code 0" would mislead.
    if (evt.type === 'result' && this.stopping) return;
    const summary = summarizeEvent(evt);
    if (summary?.summary) this.#record(summary.kind, summary.summary, evt.timestamp);
  }

  /** Pulls the facts we track out of a CLI event. Everything else is only logged. */
  #observe(evt) {
    switch (evt.type) {
      case 'tool.execution_start':
        this.toolCalls += 1;
        this.runs.setToolCalls(this.runId, this.toolCalls);
        break;
      case 'assistant.message': {
        // The last assistant message before `result` is the agent's answer.
        const text = typeof evt.data?.content === 'string' ? evt.data.content.trim() : '';
        if (text) this.finalMessage = text;
        break;
      }
      case 'result':
        this.runs.recordCliResult(this.runId, readResultMetrics(evt));
        break;
      default:
        break;
    }
  }

  #record(kind, summary, ts) {
    this.runs.appendEvent(this.runId, { ts, kind, summary });
    this.runs.setActivity(this.runId, summary);
    this.#publish('run.activity', { kind, summary });
  }

  async #onClose(code) {
    // Some models reject an explicit reasoning effort: retry once without it.
    if (this.#shouldRetryWithoutReasoning(code)) {
      this.retriedWithoutReasoning = true;
      this.#record(
        'retry',
        `Model ${this.settings.model} rejected reasoning effort "${this.reasoningEffort}"; retrying with the model default`,
      );
      this.#spawnProcess('default');
      return;
    }

    const status = resolveFinalStatus({ exitCode: code, stopReason: this.stopping });
    await this.#finalize({ status, error: this.#errorFor(status, code), exitCode: code });
  }

  #shouldRetryWithoutReasoning(code) {
    return (
      code !== 0 &&
      !this.stopping &&
      !this.retriedWithoutReasoning &&
      this.reasoningEffort !== 'default' &&
      isReasoningEffortRejection(this.stderr)
    );
  }

  /** What to tell an operator about why a run did not succeed. */
  #errorFor(status, code) {
    if (status === 'failed') {
      return this.stderr.trim().split('\n').slice(-3).join('\n') || `Exited with code ${code}`;
    }
    if (status === 'timed_out') {
      return `Exceeded max runtime of ${this.settings.max_runtime_minutes} min`;
    }
    return null;
  }

  async #finalize({ status, error = null, exitCode = null }) {
    if (this.finished) return;
    this.finished = true;
    clearTimeout(this.timer);
    this.cancelKill?.();

    // Kept in the database only; downloaded on demand.
    if (this.finalMessage) this.runs.saveResult(this.runId, this.finalMessage);
    if (status !== 'succeeded' && finalActivity(status)) this.#record('end', finalActivity(status));
    this.runs.finish(this.runId, { status, error, exitCode });
    this.tasks.setStatus(this.task.id, status);
    this.#publish('run.finished', { status, error });
    this.resolveEnd?.({ status, error });

    await this.#syncUsage();
    this.resolveExit?.({ status, error });
  }

  async #syncUsage() {
    const usage = await pollUsage(this.sessionId, this.usageOptions);
    if (!usage) {
      this.#publish('run.usage_unavailable');
      return null;
    }
    this.runs.saveUsage(this.runId, usage);
    this.#publish('run.usage', usage);
    return usage;
  }

  stop(reason = 'cancelled') {
    if (this.finished || this.stopping) return;
    this.stopping = reason;
    this.runs.setActivity(this.runId, stoppingActivity(reason));
    this.cancelKill = terminate(this.child);
  }

  #publish(type, extra = {}) {
    this.bus?.publish(type, {
      runId: this.runId,
      taskId: this.task.id,
      sessionId: this.sessionId,
      ...extra,
    });
  }
}
