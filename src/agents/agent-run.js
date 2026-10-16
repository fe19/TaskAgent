import { spawn } from 'node:child_process';
import { createInterface } from 'node:readline';
import { randomUUID } from 'node:crypto';
import { finalActivity, resolveFinalStatus, stoppingActivity } from '../domain/run-status.js';
import { copilotAdapter } from './copilot-cli.js';
import { createWorkspace } from './workspace.js';
import { resolveBinary, wrapCommand, writePolicy } from './os-sandbox.js';
import { allowsAllWebsites, isSiteAllowed, withTaskSites } from '../domain/web-access.js';
import { DEFAULT_TOOL_IDS } from '../domain/permissions.js';
import { terminate } from './process.js';
import { pollUsage } from './usage-sync.js';

/** How much stderr to keep for the message shown on a failed tile. */
const STDERR_LIMIT = 4000;

/** One CLI agent on one task: spawn, stream, time limit, stop, finish. The adapter knows the CLI. */
export class AgentRun {
  constructor({
    runs,
    tasks,
    bus,
    task,
    settings,
    workspaceRoot,
    adapter = copilotAdapter,
    usageRetries,
    readUsage,
    ...bins // copilotBin, claudeBin: per-adapter binary overrides
  }) {
    Object.assign(this, {
      runs,
      tasks,
      bus,
      task,
      // Sites allowed for this task only are added to the allowed websites, for this run.
      settings: withTaskSites(settings, task.allowed_sites, DEFAULT_TOOL_IDS),
      workspaceRoot,
      adapter,
    });
    this.bin = bins[adapter.binOption] || adapter.defaultBin;
    this.srtBin = bins.srtBin || 'srt';
    this.usageOptions = { retries: usageRetries, read: readUsage };

    this.sessionId = randomUUID();
    this.toolCalls = 0;
    this.stopping = null;
    this.finished = false;
    this.stderr = '';
    this.finalMessage = null;
    this.reportedUsage = null;
    this.reportedError = null;
    this.toolSites = new Map(); // tool call id → sites it targets
    this.blockedSites = new Set();
    this.accessedSites = new Set();
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
      assistant: this.adapter.id,
      model: this.adapter.model(this.settings),
      maxRuntimeSeconds: Math.round(this.settings.max_runtime_minutes * 60),
    });

    this.#spawnProcess(this.adapter.effort(this.settings));

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

    const args = this.adapter.buildArgs({
      prompt: this.task.prompt,
      // Only the run's own workspace: runs can't read each other's files.
      workspace: this.workspace,
      model: this.adapter.model(this.settings),
      sessionId: this.sessionId,
      reasoningEffort,
      permissions: this.settings,
    });

    // Wrapped in srt, a missing CLI would only surface as srt's error; catch it first.
    if (this.adapter.osSandbox && !resolveBinary(this.bin)) {
      queueMicrotask(() => this.#finalize({ status: 'failed', error: this.#notInstalled(this.bin) }));
      return;
    }
    const command = this.#sandboxed(args);
    this.child = spawn(command.bin, command.args, {
      cwd: this.workspace,
      stdio: ['ignore', 'pipe', 'pipe'],
      env: this.adapter.buildEnv({
        workspaceRoot: this.workspaceRoot,
        passedEnvVars: this.settings.passed_env_vars,
        secretEnvVars: this.settings.secret_env_vars,
      }),
    });

    this.runs.markRunning(this.runId, this.child.pid);
    this.#publish('run.started');

    this.child.on('error', (err) => this.#finalize({ status: 'failed', error: this.#spawnError(err) }));
    this.child.stderr.on('data', (chunk) => {
      this.stderr = `${this.stderr}${chunk}`.slice(-STDERR_LIMIT);
    });
    createInterface({ input: this.child.stdout }).on('line', (line) => this.#onLine(line));
    this.child.on('close', (code) => this.#onClose(code));
  }

  /**
   * An assistant without its own sandbox runs entirely inside sandbox-runtime. The policy file
   * lives outside the workspace and is removed when the run ends.
   */
  #sandboxed(args) {
    if (!this.adapter.osSandbox) return { bin: this.bin, args };
    this.policy?.remove();
    this.policy = writePolicy(this.adapter.osSandbox(this.settings, { workspace: this.workspace, bin: this.bin }));
    return wrapCommand({ srtBin: this.srtBin, bin: this.bin, args, policyFile: this.policy.file });
  }

  /** A missing CLI is the most common setup mistake; say which one and how to fix it. */
  #spawnError(err) {
    if (err.code !== 'ENOENT') return err.message;
    if (this.adapter.osSandbox) {
      return `${this.srtBin} (Anthropic sandbox-runtime) is not installed, so this assistant can't run sandboxed. Install it with: npm install -g @anthropic-ai/sandbox-runtime (set SRT_BIN if it lives elsewhere).`;
    }
    return this.#notInstalled(this.bin);
  }

  #notInstalled(bin) {
    const variable = this.adapter.binOption.replace(/Bin$/, '').toUpperCase();
    return `${bin} is not installed or not on PATH. Install it, set ${variable}_BIN, or switch the AI assistant.`;
  }

  #onLine(line) {
    const evt = this.adapter.parseEvent(line);
    if (!evt) return;

    const facts = this.adapter.interpret(evt);
    if (facts.toolCalls) {
      this.toolCalls += facts.toolCalls;
      this.runs.setToolCalls(this.runId, this.toolCalls);
    }
    // The last message before the result is the agent's answer.
    if (facts.message) this.finalMessage = facts.message;
    if (facts.usage) this.reportedUsage = facts.usage;
    if (facts.error) this.reportedError = facts.error;
    // Account-wide, not per run: the control room keeps the latest reading.
    if (facts.limits) this.#publish('assistant.limits', { assistant: this.adapter.id, limits: facts.limits });
    for (const call of facts.toolStarts ?? []) if (call.sites.length) this.toolSites.set(call.id, call.sites);
    const blocked = [...(facts.blockedSites ?? [])];
    for (const end of facts.toolEnds ?? []) {
      const sites = this.toolSites.get(end.id) ?? [];
      // A failed call's sites may have been refused (Copilot's errors don't say); a call that
      // worked reached them.
      if (end.failed) blocked.push(...sites);
      else this.#accessed(sites);
    }
    if (blocked.length > 0) this.#blocked(blocked);
    if (facts.result) {
      this.runs.recordCliResult(this.runId, facts.result);
      // The CLI exits 0 on SIGTERM; "Finished with exit code 0" would mislead.
      if (this.stopping) return;
    }
    for (const a of facts.activities ?? []) this.#record(a.kind, a.summary, evt.timestamp);
  }

  /** Sites the agent reached, kept on the run for the detail view. */
  #accessed(sites) {
    const fresh = [...new Set(sites)].filter((s) => !this.accessedSites.has(s) && !this.blockedSites.has(s));
    if (fresh.length === 0) return;
    for (const s of fresh) this.accessedSites.add(s);
    this.runs.addAccessedSites(this.runId, fresh);
  }

  /** Sites the agent wanted but may not reach: kept on the run so the user can allow them. */
  #blocked(sites) {
    // With all websites allowed, only blocked ones are refused, and those are never offered.
    if (allowsAllWebsites({ ...this.settings, assistant: this.adapter.id })) return;
    // A site the user blocked on purpose is not offered for allowing.
    // One call can report a site twice (the sandbox message and the failed call itself).
    const fresh = [...new Set(sites)].filter(
      (s) =>
        !isSiteAllowed(s, this.settings.shell_allowed_domains ?? []) &&
        !isSiteAllowed(s, this.settings.blocked_urls ?? []) &&
        !this.blockedSites.has(s),
    );
    if (fresh.length === 0) return;
    for (const s of fresh) this.blockedSites.add(s);
    this.runs.addBlockedSites(this.runId, fresh);
    this.#record('warning', `Blocked website${fresh.length === 1 ? '' : 's'} (not allowed): ${fresh.join(', ')}`);
    this.#publish('run.blocked_sites', { sites: [...this.blockedSites] });
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
        `Model ${this.adapter.model(this.settings)} rejected reasoning effort "${this.reasoningEffort}"; retrying with the model default`,
      );
      this.#spawnProcess('default');
      return;
    }

    // A CLI may report an error in its result and still exit 0.
    const exitCode = code === 0 && this.reportedError && !this.stopping ? 1 : code;
    let status = resolveFinalStatus({ exitCode, stopReason: this.stopping });
    // A run refused websites could not do its job, however it ended: it failed.
    if (status === 'succeeded' && this.blockedSites.size > 0) status = 'failed';
    await this.#finalize({ status, error: this.#errorFor(status, code), exitCode: code });
  }

  #shouldRetryWithoutReasoning(code) {
    return (
      code !== 0 &&
      !this.stopping &&
      !this.retriedWithoutReasoning &&
      this.reasoningEffort !== 'default' &&
      Boolean(this.adapter.rejectsEffort?.(this.stderr))
    );
  }

  /** What to tell an operator about why a run did not succeed. */
  #errorFor(status, code) {
    if (status === 'failed') {
      if (this.reportedError) return this.reportedError;
      if (this.blockedSites.size > 0) {
        const sites = [...this.blockedSites].join(', ');
        return `Needs websites that are not allowed: ${sites}. Allow them and retry.`;
      }
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
    this.policy?.remove();
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
    const usage = this.adapter.pollsUsage
      ? await pollUsage(this.sessionId, this.usageOptions)
      : this.reportedUsage;
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
