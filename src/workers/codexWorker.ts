import { execFile, spawn } from "node:child_process";
import { mkdir, mkdtemp, readFile } from "node:fs/promises";
import { join } from "node:path";
import { promisify } from "node:util";
import type { AppConfig } from "../config.ts";
import type { AgentHubRepository } from "../db/repository.ts";
import type { Agent, Fork, Project, WorkJob } from "../types.ts";

const execFileAsync = promisify(execFile);

class CommandTimeoutError extends Error {}

export type CodexWorkerResult = {
  job: WorkJob;
  pushed: boolean;
};

export type CodexWorkerLogEvent = {
  event: string;
  jobId: string;
  forkId: string;
  detail?: Record<string, unknown>;
};

export class CodexGitWorker {
  private readonly repository: AgentHubRepository;
  private readonly config: AppConfig;
  private readonly onLog: ((event: CodexWorkerLogEvent) => void) | null;

  constructor(input: {
    repository: AgentHubRepository;
    config: AppConfig;
    onLog?: (event: CodexWorkerLogEvent) => void;
  }) {
    this.repository = input.repository;
    this.config = input.config;
    this.onLog = input.onLog ?? null;
  }

  async runNext(workerId: string): Promise<CodexWorkerResult | null> {
    const job = await this.repository.claimNextWorkJob(workerId);
    if (!job) {
      return null;
    }

    try {
      this.log(job, "job.claimed", { workerId });
      const result = await this.runJob(job);
      return { job: result, pushed: result.status === "pushed" };
    } catch (error) {
      const workerError = normalizeWorkerError(error, this.config.codexBin);
      const failed = await this.repository.updateWorkJob({
        id: job.id,
        status: "failed",
        error: workerError instanceof Error ? workerError.message : "Unknown worker error",
        completedAt: new Date().toISOString()
      });
      this.log(failed, "job.failed", { error: failed.error });
      return { job: failed, pushed: false };
    }
  }

  private async runJob(job: WorkJob): Promise<WorkJob> {
    if (!this.config.giteaToken) {
      throw new Error("GITEA_TOKEN is required for git worker clone/push access");
    }

    const [agent, project, fork] = await Promise.all([
      this.readAgent(job.agentId),
      this.readProject(job.projectId),
      this.readFork(job.forkId)
    ]);
    await mkdir(this.config.workerWorkDir, { recursive: true });
    const jobDir = await mkdtemp(join(this.config.workerWorkDir, `${job.id}-`));
    const worktree = join(jobDir, "repo");
    const outputPath = join(jobDir, "codex-result.txt");
    const repoUrl = `${this.config.giteaBaseUrl}/${encodeURIComponent(fork.owner)}/${encodeURIComponent(fork.repo)}.git`;
    const authHeader = `Authorization: token ${this.config.giteaToken}`;
    const gitHttpKey = gitExtraHeaderKey(this.config.giteaBaseUrl);

    const cloneArgs = gitHttpKey
      ? ["-c", `${gitHttpKey}=${authHeader}`, "clone", repoUrl, worktree]
      : ["clone", repoUrl, worktree];
    this.log(job, "git.clone.started", { repoUrl, worktree });
    await run("git", cloneArgs);
    this.log(job, "git.clone.finished", { worktree });
    if (gitHttpKey) {
      await run("git", ["config", gitHttpKey, authHeader], { cwd: worktree });
    }
    await run("git", ["config", "user.name", agent.giteaUsername], { cwd: worktree });
    await run("git", ["config", "user.email", `${agent.giteaUsername}@agenthub.invalid`], { cwd: worktree });
    const beforeHead = await readStdout("git", ["rev-parse", "HEAD"], { cwd: worktree });

    const codexPrompt = buildCodexPrompt(job.prompt, this.config);
    const codexArgs = buildCodexArgs({ config: this.config, worktree, outputPath, prompt: codexPrompt });
    this.log(job, "codex.started", {
      codexBin: this.config.codexBin,
      worktree,
      timeoutMs: this.config.codexTimeoutMs,
      tokenBudget: this.config.codexTokenBudget,
      maxChangedFiles: this.config.codexMaxChangedFiles,
      demoMode: this.config.codexDemoMode
    });
    let codexTimedOut = false;
    try {
      await run(this.config.codexBin, codexArgs, { timeoutMs: this.config.codexTimeoutMs });
      this.log(job, "codex.finished", { outputPath });
    } catch (error) {
      if (!(error instanceof CommandTimeoutError)) {
        throw error;
      }

      codexTimedOut = true;
      this.log(job, "codex.timed_out", { outputPath, timeoutMs: this.config.codexTimeoutMs });
    }

    const afterCodexHead = await readStdout("git", ["rev-parse", "HEAD"], { cwd: worktree });
    const status = await readStdout("git", ["status", "--porcelain"], { cwd: worktree });
    const committedChangedFiles =
      afterCodexHead === beforeHead ? [] : await readChangedFiles(worktree, beforeHead, afterCodexHead);
    const changedFileSet = new Set([...committedChangedFiles, ...readStatusChangedFiles(status)]);
    const changedFileCount = changedFileSet.size;
    if (changedFileCount > this.config.codexMaxChangedFiles) {
      throw new Error(
        `Codex changed ${changedFileCount} files, exceeding AGENTHUB_CODEX_MAX_CHANGED_FILES=${this.config.codexMaxChangedFiles}`
      );
    }
    const finalHead =
      afterCodexHead !== beforeHead && status.trim() === ""
        ? afterCodexHead
        : await this.commitWorkerChanges({ worktree, project, agent, status });

    if (!finalHead) {
      if (codexTimedOut) {
        throw new Error(`${this.config.codexBin} timed out after ${this.config.codexTimeoutMs}ms without file changes`);
      }

      const message = await readOptionalFile(outputPath);
      const noChange = await this.repository.updateWorkJob({
        id: job.id,
        status: "no_change",
        result: {
          worktree,
          codexMessage: message
        },
        completedAt: new Date().toISOString()
      });
      this.log(noChange, "job.no_change", { worktree });
      return noChange;
    }

    this.log(job, "git.push.started", { branch: job.branch, commitSha: finalHead });
    await run("git", ["push", "origin", `HEAD:${job.branch}`], { cwd: worktree });
    const changedFiles = await readChangedFiles(worktree, beforeHead, finalHead);
    const message = await readOptionalFile(outputPath);

    const pushed = await this.repository.updateWorkJob({
      id: job.id,
      status: "pushed",
      commitSha: finalHead,
      result: {
        worktree,
        changedFiles,
        codexMessage: message,
        codexTimedOut
      },
      completedAt: new Date().toISOString()
    });
    this.log(pushed, "job.pushed", { commitSha: finalHead, changedFiles });
    return pushed;
  }

  private async commitWorkerChanges(input: {
    worktree: string;
    project: Project;
    agent: Agent;
    status: string;
  }): Promise<string | null> {
    if (!input.status.trim()) {
      return null;
    }

    await run("git", ["add", "-A"], { cwd: input.worktree });
    const staged = await readStdout("git", ["diff", "--cached", "--name-only"], { cwd: input.worktree });
    if (!staged.trim()) {
      return null;
    }

    await run("git", ["commit", "-m", `${input.agent.username}: improve ${input.project.slug}`], {
      cwd: input.worktree
    });
    return readStdout("git", ["rev-parse", "HEAD"], { cwd: input.worktree });
  }

  private async readAgent(id: string): Promise<Agent> {
    const agent = await this.repository.findAgentById(id);
    if (!agent) {
      throw new Error(`Agent ${id} not found`);
    }

    return agent;
  }

  private async readProject(id: string): Promise<Project> {
    const project = await this.repository.findProjectById(id);
    if (!project) {
      throw new Error(`Project ${id} not found`);
    }

    return project;
  }

  private async readFork(id: string): Promise<Fork> {
    const fork = await this.repository.findForkById(id);
    if (!fork) {
      throw new Error(`Fork ${id} not found`);
    }

    return fork;
  }

  private log(job: WorkJob, event: string, detail?: Record<string, unknown>): void {
    const payload: CodexWorkerLogEvent = {
      event,
      jobId: job.id,
      forkId: job.forkId
    };
    if (detail !== undefined) {
      payload.detail = detail;
    }

    this.onLog?.(payload);
  }
}

async function readChangedFiles(worktree: string, beforeHead: string, finalHead: string): Promise<string[]> {
  const stdout = await readStdout("git", ["diff", "--name-only", beforeHead, finalHead], { cwd: worktree });
  return stdout
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);
}

async function readOptionalFile(path: string): Promise<string | null> {
  try {
    return await readFile(path, "utf8");
  } catch {
    return null;
  }
}

async function readStdout(command: string, args: string[], options: { cwd?: string } = {}): Promise<string> {
  const { stdout } = await execFileAsync(command, args, {
    cwd: options.cwd,
    maxBuffer: 1024 * 1024 * 20
  });
  return stdout.trim();
}

async function run(command: string, args: string[], options: { cwd?: string; timeoutMs?: number } = {}): Promise<void> {
  await spawnAndWait(command, args, options);
}

function normalizeWorkerError(error: unknown, codexBin: string): Error | unknown {
  if (isNodeError(error) && error.code === "ENOENT" && error.path === codexBin) {
    return new Error(
      `Could not start Codex binary '${codexBin}'. Set AGENTHUB_CODEX_BIN in .env to the absolute codex executable path.`
    );
  }

  return error;
}

function isNodeError(error: unknown): error is NodeJS.ErrnoException {
  return typeof error === "object" && error !== null && "code" in error;
}

function spawnAndWait(
  command: string,
  args: string[],
  options: { cwd?: string; timeoutMs?: number } = {}
): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd: options.cwd,
      stdio: ["ignore", "pipe", "pipe"]
    });
    let stdout = "";
    let stderr = "";
    let settled = false;
    const timer =
      options.timeoutMs === undefined
        ? null
        : setTimeout(() => {
            settled = true;
            child.kill("SIGTERM");
            reject(new CommandTimeoutError(`${command} timed out after ${options.timeoutMs}ms`));
          }, options.timeoutMs);

    child.stdout.on("data", (chunk) => {
      stdout += chunk.toString();
    });
    child.stderr.on("data", (chunk) => {
      stderr += chunk.toString();
    });
    child.on("error", (error) => {
      if (timer) {
        clearTimeout(timer);
      }
      if (!settled) {
        settled = true;
        reject(error);
      }
    });
    child.on("close", (code, signal) => {
      if (timer) {
        clearTimeout(timer);
      }
      if (settled) {
        return;
      }
      settled = true;
      if (code === 0) {
        resolve();
        return;
      }

      const suffix = [stdout.trim(), stderr.trim()].filter(Boolean).join("\n");
      reject(new Error(`${command} exited with ${signal ?? code}${suffix ? `\n${suffix}` : ""}`));
    });
  });
}

function buildCodexArgs(input: {
  config: AppConfig;
  worktree: string;
  outputPath: string;
  prompt: string;
}): string[] {
  const args = [
    "exec",
    "--cd",
    input.worktree,
    "--sandbox",
    "workspace-write",
    "--full-auto",
    "--skip-git-repo-check",
    "--output-last-message",
    input.outputPath
  ];

  if (input.config.codexModel) {
    args.push("--model", input.config.codexModel);
  }

  args.push(input.prompt);
  return args;
}

function buildCodexPrompt(prompt: string, config: AppConfig): string {
  if (config.codexDemoMode) {
    return [
      prompt,
      "",
      "DEMO OVERRIDE: make the smallest possible visible change.",
      `Hard budget target: stay under about ${config.codexTokenBudget} total tokens.`,
      `Hard change limit: change exactly 1 file and no more than ${config.codexMaxChangedFiles} file total.`,
      "",
      "Do this:",
      "1. Inspect only README.md and primer.md if they exist.",
      "2. Edit exactly one of those files.",
      "3. Add or improve one short sentence or one short bullet that is coherent with the existing text.",
      "4. Do not run tests, do not inspect source trees, do not refactor, do not create new files.",
      "5. Commit immediately with a concrete short commit message.",
      "6. Stop after the commit."
    ].join("\n");
  }

  const limits = [
    "",
    "Per-run limits:",
    `- Token budget target: stay under about ${config.codexTokenBudget} total tokens for this run, including tool use and final response.`,
    `- Change at most ${config.codexMaxChangedFiles} file${config.codexMaxChangedFiles === 1 ? "" : "s"}.`,
    "- Inspect only the files needed for the change.",
    "- Prefer one tiny source/docs/test improvement over broad exploration.",
    "- Skip expensive or full-suite checks; run only a targeted check if it is obvious and fast.",
    "- If the repository is unclear after a quick look, make a minimal documentation or cleanup change and stop."
  ];

  return `${prompt}\n${limits.join("\n")}`;
}

function readStatusChangedFiles(status: string): string[] {
  const files = new Set<string>();
  for (const line of status.split("\n")) {
    const cleaned = line.trim();
    if (!cleaned) {
      continue;
    }

    files.add(cleaned.slice(2).trim());
  }

  return [...files];
}

function gitExtraHeaderKey(baseUrl: string): string | null {
  const protocol = new URL(baseUrl).protocol;
  if (protocol !== "http:" && protocol !== "https:") {
    return null;
  }

  return `http.${baseUrl}/.extraHeader`;
}
