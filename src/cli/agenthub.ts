#!/usr/bin/env node
import { realpathSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { Command } from "commander";
import { AgentHubApiClient } from "./api.ts";
import { defaultApiUrl, loadConfig, resolveApiUrl, resolveToken, saveConfig } from "./config.ts";
import { defaultIo, type CliIo, type OutputMode, writeError, writeHuman, writeJson } from "./output.ts";

type GlobalOptions = {
  json?: boolean;
  apiUrl?: string;
};

export async function runCli(argv = process.argv, io: CliIo = defaultIo): Promise<number> {
  const program = new Command();

  program
    .name("agenthub")
    .description("AgentHub CLI for login, project creation, disposable forks, workflow, and submissions.")
    .version("0.1.0")
    .option("--json", "emit stable JSON")
    .option("--api-url <url>", "AgentHub API URL for this command");

  program
    .command("doctor")
    .description("Check API reachability and local auth/config state")
    .action(async () => {
      const context = await createContext(program);
      const client = new AgentHubApiClient({ apiUrl: context.apiUrl, token: context.token });
      const result: Record<string, unknown> = {
        ok: true,
        apiUrl: context.apiUrl,
        configPath: context.configPath,
        token: {
          available: Boolean(context.token),
          source: context.tokenSource
        }
      };

      try {
        await client.health();
        result.apiReachable = true;
      } catch (error) {
        result.ok = false;
        result.apiReachable = false;
        result.apiError = error instanceof Error ? error.message : "Unknown API error";
      }

      if (context.token) {
        try {
          result.agent = await client.me();
          result.authValid = true;
        } catch (error) {
          result.ok = false;
          result.authValid = false;
          result.authError = error instanceof Error ? error.message : "Unknown auth error";
        }
      } else {
        result.authValid = false;
        result.nextStep = "Run agenthub login [username]";
      }

      writeOutput(io, context.mode, result, formatDoctor(result));
    });

  program
    .command("login")
    .description("Create or authenticate an AgentHub agent and store the token")
    .argument("[username]", "AgentHub agent username, such as agent-42")
    .action(async (username: string | undefined) => {
      const options = program.opts<GlobalOptions>();
      const loaded = await loadConfig();
      const apiUrl = options.apiUrl ?? loaded.config.apiUrl ?? defaultApiUrl();
      const client = new AgentHubApiClient({ apiUrl });
      const input: { username?: string } = {};
      if (username) {
        input.username = username;
      }

      const result = await client.login(input);
      const configPath = await saveConfig({
        ...loaded.config,
        apiUrl,
        token: result.token,
        agentId: result.agentId,
        username: result.username
      });

      writeOutput(
        io,
        outputMode(program),
        { ...result, configPath },
        `Logged in as ${result.username}\nAgent: ${result.agentId}\nConfig: ${configPath}`
      );
    });

  program
    .command("me")
    .description("Read the current authenticated agent")
    .action(async () => {
      const context = await createContext(program, { requireToken: true });
      const result = await new AgentHubApiClient({ apiUrl: context.apiUrl, token: context.token }).me();
      writeOutput(io, context.mode, result, formatMaybeJson(result));
    });

  program
    .command("new")
    .description("Create a root project and root repo metadata")
    .argument("<name>", "project name, such as doom")
    .option("--slug <slug>", "stable project slug")
    .option("--goal <goal>", "initial project goal")
    .action(async (name: string, options: { slug?: string; goal?: string }) => {
      const context = await createContext(program, { requireToken: true });
      const input: { name: string; slug?: string; goal?: string } = { name };
      if (options.slug) {
        input.slug = options.slug;
      }
      if (options.goal) {
        input.goal = options.goal;
      }

      const result = await new AgentHubApiClient({ apiUrl: context.apiUrl, token: context.token }).createProject(input);
      writeOutput(io, context.mode, result, formatProjectCreated(result));
    });

  program
    .command("project")
    .description("Read a project by id")
    .argument("<project-id>", "project id")
    .action(async (projectId: string) => {
      const context = await createContext(program);
      const result = await new AgentHubApiClient({ apiUrl: context.apiUrl, token: context.token }).getProject(projectId);
      writeOutput(io, context.mode, result, formatMaybeJson(result));
    });

  program
    .command("lineage")
    .description("Read fork lineage and activity for a project")
    .argument("<project-id>", "project id")
    .action(async (projectId: string) => {
      const context = await createContext(program);
      const result = await new AgentHubApiClient({ apiUrl: context.apiUrl, token: context.token }).getLineage(projectId);
      writeOutput(io, context.mode, result, formatLineage(result));
    });

  program
    .command("job")
    .description("Read an autonomous work job")
    .argument("<job-id>", "work job id")
    .action(async (jobId: string) => {
      const context = await createContext(program, { requireToken: true });
      const result = await new AgentHubApiClient({ apiUrl: context.apiUrl, token: context.token }).getWorkJob(jobId);
      writeOutput(io, context.mode, result, formatWorkJob(result));
    });

  program
    .command("run-agents")
    .description("Ask the coordinator to launch independent agents across a project pool")
    .argument("[project-id]", "optional project id; omit to let agents choose from all projects")
    .option("--project <project-id>", "project id in the autonomous pool; repeat for multiple projects", collectOption, [])
    .option("--agent <username>", "agent username to launch; repeat for multiple agents", collectOption, [])
    .option("--goal <goal>", "broad shared goal; agents choose their own work within it")
    .option("--pr", "reserved for future autonomous PR runs; current worker runs are push-only")
    .option("--eval", "reserved for future autonomous eval runs; current worker runs are push-only")
    .option("--loop", "keep launching autonomous cycles until interrupted")
    .option("--interval-ms <ms>", "delay between --loop cycles", parseNonNegativeInteger, 300000)
    .action(
      async (
        projectId: string | undefined,
        options: {
          project?: string[];
          agent?: string[];
          goal?: string;
          pr?: boolean;
          eval?: boolean;
          loop?: boolean;
          intervalMs?: number;
        }
      ) => {
        const context = await createContext(program, { requireToken: true });
        if (options.loop && context.mode === "json") {
          throw new Error("--loop cannot be combined with --json; run one cycle at a time for machine-readable output.");
        }

        const client = new AgentHubApiClient({ apiUrl: context.apiUrl, token: context.token });
        let cycle = 0;
        let stopping = false;
        const stop = (): void => {
          stopping = true;
        };

        if (options.loop) {
          process.once("SIGINT", stop);
        }

        try {
          do {
            cycle += 1;
            const result = await client.runAgents(projectId ?? null, buildRunAgentsInput(options, cycle));
            writeOutput(io, context.mode, result, formatAutonomousRun(result, cycle));

            if (!options.loop || stopping) {
              break;
            }

            await sleep(options.intervalMs ?? 300000);
          } while (!stopping);

          if (options.loop) {
            writeHuman(io, `Stopped autonomous run after ${cycle} cycle${cycle === 1 ? "" : "s"}.`);
          }
        } finally {
          if (options.loop) {
            process.off("SIGINT", stop);
          }
        }
      }
    );

  program
    .command("fork")
    .description("Create a disposable fork for a project")
    .argument("<project-id>", "project id")
    .option("--parent <fork-id>", "parent fork id; defaults to the project root fork")
    .option("--goal <goal>", "fork goal")
    .action(async (projectId: string, options: { parent?: string; goal?: string }) => {
      const context = await createContext(program, { requireToken: true });
      const input: { projectId: string; parentForkId?: string; goal?: string } = { projectId };
      if (options.parent) {
        input.parentForkId = options.parent;
      }
      if (options.goal) {
        input.goal = options.goal;
      }

      const result = await new AgentHubApiClient({ apiUrl: context.apiUrl, token: context.token }).createFork(input);
      writeOutput(io, context.mode, result, formatForkCreated(result));
    });

  program
    .command("work")
    .description("Create a visible work commit in a fork")
    .argument("<fork-id>", "fork id")
    .option("--path <path>", "file path to write", "agenthub-work.md")
    .option("--message <message>", "commit message")
    .option("--content <content>", "file content; defaults to generated AgentHub work notes")
    .action(async (forkId: string, options: { path?: string; message?: string; content?: string }) => {
      const context = await createContext(program, { requireToken: true });
      const input: { path?: string; message?: string; content?: string } = {};
      if (options.path) {
        input.path = options.path;
      }
      if (options.message) {
        input.message = options.message;
      }
      if (options.content) {
        input.content = options.content;
      }
      const result = await new AgentHubApiClient({ apiUrl: context.apiUrl, token: context.token }).performWork(
        forkId,
        input
      );
      writeOutput(io, context.mode, result, formatWork(result));
    });

  program
    .command("compare")
    .description("Read comparison details for a fork")
    .argument("<fork-id>", "fork id")
    .action(async (forkId: string) => {
      const context = await createContext(program);
      const result = await new AgentHubApiClient({ apiUrl: context.apiUrl, token: context.token }).compareFork(forkId);
      writeOutput(io, context.mode, result, formatCompare(result));
    });

  program
    .command("pr")
    .description("Open or read the pull request for a fork")
    .argument("<fork-id>", "fork id")
    .option("--title <title>", "pull request title")
    .option("--body <body>", "pull request body")
    .action(async (forkId: string, options: { title?: string; body?: string }) => {
      const context = await createContext(program, { requireToken: true });
      const input: { title?: string; body?: string } = {};
      if (options.title) {
        input.title = options.title;
      }
      if (options.body) {
        input.body = options.body;
      }
      const result = await new AgentHubApiClient({ apiUrl: context.apiUrl, token: context.token }).createPullRequest(
        forkId,
        input
      );
      writeOutput(io, context.mode, result, formatPullRequest(result));
    });

  program
    .command("submit")
    .description("Submit a fork for evaluation; primer.md is required")
    .argument("<fork-id>", "fork id")
    .option("--commit <sha>", "commit SHA to submit")
    .option("--primer-path <path>", "primer path", "primer.md")
    .action(async (forkId: string, options: { commit?: string; primerPath?: string }) => {
      const context = await createContext(program, { requireToken: true });
      const input: { forkId: string; commitSha?: string; primerPath?: string } = { forkId };
      if (options.commit) {
        input.commitSha = options.commit;
      }
      if (options.primerPath) {
        input.primerPath = options.primerPath;
      }

      const result = await new AgentHubApiClient({ apiUrl: context.apiUrl, token: context.token }).submit(input);
      writeOutput(io, context.mode, result, formatSubmission(result));
    });

  program
    .command("eval")
    .description("Request evaluation for a fork and print eval status")
    .argument("<fork-id>", "fork id")
    .option("--work-path <path>", "work file path to evaluate", "agenthub-work.md")
    .action(async (forkId: string, options: { workPath?: string }) => {
      const context = await createContext(program, { requireToken: true });
      const input: { workPath?: string } = {};
      if (options.workPath) {
        input.workPath = options.workPath;
      }
      const result = await new AgentHubApiClient({ apiUrl: context.apiUrl, token: context.token }).requestEval(
        forkId,
        input
      );
      writeOutput(io, context.mode, result, formatStatus(result));
    });

  program
    .command("status")
    .description("Read fork submission/eval status")
    .argument("<fork-id>", "fork id")
    .action(async (forkId: string) => {
      const context = await createContext(program);
      const result = await new AgentHubApiClient({ apiUrl: context.apiUrl, token: context.token }).getForkStatus(forkId);
      writeOutput(io, context.mode, result, formatStatus(result));
    });

  program
    .command("api")
    .description("Read-only raw AgentHub API escape hatch")
    .argument("<method>", "GET")
    .argument("<path>", "API path, such as /health")
    .action(async (method: string, path: string) => {
      if (method.toUpperCase() !== "GET") {
        throw new Error("Only GET is supported by the raw api command in this MVP");
      }

      const context = await createContext(program);
      const result = await new AgentHubApiClient({ apiUrl: context.apiUrl, token: context.token }).rawGet(path);
      writeOutput(io, context.mode, result, formatMaybeJson(result));
    });

  try {
    await program.parseAsync(argv);
    return 0;
  } catch (error) {
    writeError(io, outputMode(program), error);
    return 1;
  }
}

async function createContext(
  program: Command,
  options: { requireToken?: boolean } = {}
): Promise<{
  mode: OutputMode;
  apiUrl: string;
  token: string | null;
  tokenSource: "env" | "config" | "missing";
  configPath: string;
}> {
  const globalOptions = program.opts<GlobalOptions>();
  const loaded = await loadConfig();
  const apiUrl = globalOptions.apiUrl ?? resolveApiUrl(loaded.config);
  const token = resolveToken(loaded.config);

  if (options.requireToken && !token.token) {
    throw new Error("Missing AgentHub token. Run agenthub login [username].");
  }

  return {
    mode: outputMode(program),
    apiUrl,
    token: token.token,
    tokenSource: token.source,
    configPath: loaded.path
  };
}

function outputMode(program: Command): OutputMode {
  return program.opts<GlobalOptions>().json ? "json" : "human";
}

function writeOutput(io: CliIo, mode: OutputMode, json: unknown, human: string): void {
  if (mode === "json") {
    writeJson(io, json);
    return;
  }

  writeHuman(io, human);
}

function collectOption(value: string, previous: string[]): string[] {
  return [...previous, value];
}

function parseNonNegativeInteger(value: string): number {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 0) {
    throw new Error("Expected a non-negative integer");
  }

  return parsed;
}

function buildRunAgentsInput(
  options: { project?: string[]; agent?: string[]; goal?: string; pr?: boolean; eval?: boolean },
  cycle: number
): {
  projectIds?: string[];
  agents?: Array<{ username?: string; goal?: string }>;
  openPullRequests?: boolean;
  runEval?: boolean;
  cycle: number;
} {
  const usernames = (options.agent ?? []).map((username) => username.trim()).filter(Boolean);
  const projectIds = (options.project ?? []).map((projectId) => projectId.trim()).filter(Boolean);
  const goal = options.goal?.trim();
  const input: {
    projectIds?: string[];
    agents?: Array<{ username?: string; goal?: string }>;
    openPullRequests?: boolean;
    runEval?: boolean;
    cycle: number;
  } = { cycle };

  if (projectIds.length > 0) {
    input.projectIds = projectIds;
  }

  if (options.pr || options.eval) {
    input.openPullRequests = true;
  }

  if (options.eval) {
    input.runEval = true;
  }

  if (usernames.length > 0) {
    input.agents = usernames.map((username) => {
      const agent: { username?: string; goal?: string } = { username };
      if (goal) {
        agent.goal = goal;
      }
      return agent;
    });
    return input;
  }

  if (goal) {
    input.agents = [{ goal }, { goal }];
  }

  return input;
}

function sleep(milliseconds: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, milliseconds);
  });
}

function formatDoctor(result: Record<string, unknown>): string {
  const token = result.token as { available?: boolean; source?: string };
  const lines = [
    `API: ${result.apiUrl}`,
    `Reachable: ${result.apiReachable ? "yes" : "no"}`,
    `Token: ${token.available ? "available" : "missing"} (${token.source})`
  ];

  if (result.nextStep) {
    lines.push(`Next: ${result.nextStep}`);
  }

  return lines.join("\n");
}

function formatProjectCreated(result: unknown): string {
  const data = result as {
    project?: { id?: string; rootOwner?: string; rootRepo?: string };
    rootFork?: { id?: string; cloneUrl?: string };
  };

  return [
    `Project: ${data.project?.rootOwner}/${data.project?.rootRepo}`,
    `Project ID: ${data.project?.id}`,
    `Root fork ID: ${data.rootFork?.id}`,
    `Clone: ${data.rootFork?.cloneUrl}`
  ].join("\n");
}

function formatForkCreated(result: unknown): string {
  const data = result as { id?: string; owner?: string; repo?: string; cloneUrl?: string };
  return [`Fork: ${data.owner}/${data.repo}`, `Fork ID: ${data.id}`, `Clone: ${data.cloneUrl}`].join("\n");
}

function formatWork(result: unknown): string {
  const data = result as {
    fork?: { id?: string; owner?: string; repo?: string; cloneUrl?: string; goal?: string | null; status?: string };
    work?: { path?: string; branch?: string; commitSha?: string | null; commitUrl?: string | null };
    steps?: Array<{ name?: string; detail?: string }>;
  };
  const steps = data.steps?.map((step) => `- ${step.name}: ${step.detail}`).join("\n") ?? "";

  return [
    `Fork: ${data.fork?.owner}/${data.fork?.repo}`,
    `Fork ID: ${data.fork?.id}`,
    `Status: ${data.fork?.status ?? "unknown"}`,
    `Goal: ${data.fork?.goal ?? "none"}`,
    `Clone: ${data.fork?.cloneUrl}`,
    `File: ${data.work?.path ?? "pending"}`,
    `Branch: ${data.work?.branch ?? "default"}`,
    `Commit: ${data.work?.commitSha ?? "pending"}`,
    `Commit URL: ${data.work?.commitUrl ?? "pending"}`,
    steps ? `Steps:\n${steps}` : "Steps: none"
  ].join("\n");
}

function formatCompare(result: unknown): string {
  const data = result as {
    fork?: { owner?: string; repo?: string };
    base?: { owner?: string; repo?: string; branch?: string };
    head?: { owner?: string; repo?: string; branch?: string };
    compareUrl?: string;
    pullRequest?: { number?: number | null; url?: string | null } | null;
  };

  return [
    `Compare: ${data.base?.owner}/${data.base?.repo}@${data.base?.branch ?? "main"}...${data.head?.owner ?? data.fork?.owner}:${data.head?.branch ?? "main"}`,
    `URL: ${data.compareUrl ?? "pending"}`,
    `Pull request: ${data.pullRequest?.number ? `#${data.pullRequest.number}` : "none"}`,
    `Pull request URL: ${data.pullRequest?.url ?? "pending"}`
  ].join("\n");
}

function formatPullRequest(result: unknown): string {
  const data = result as {
    fork?: { owner?: string; repo?: string };
    pullRequest?: { number?: number; status?: string; url?: string };
    compareUrl?: string;
  };

  return [
    `Fork: ${data.fork?.owner}/${data.fork?.repo}`,
    `Pull request: ${data.pullRequest?.number ? `#${data.pullRequest.number}` : "pending"}`,
    `Status: ${data.pullRequest?.status ?? "unknown"}`,
    `URL: ${data.pullRequest?.url ?? "pending"}`,
    `Compare: ${data.compareUrl ?? "pending"}`
  ].join("\n");
}

function formatSubmission(result: unknown): string {
  const data = result as {
    fork?: { owner?: string; repo?: string; status?: string };
    submission?: { id?: string; primerPath?: string };
    eval?: { status?: string; previewUrl?: string | null };
  };

  return [
    `Submitted: ${data.fork?.owner}/${data.fork?.repo}`,
    `Fork status: ${data.fork?.status}`,
    `Submission ID: ${data.submission?.id}`,
    `Primer: ${data.submission?.primerPath}`,
    `Eval: ${data.eval?.status}`,
    `Preview: ${data.eval?.previewUrl ?? "pending"}`
  ].join("\n");
}

function formatLineage(result: unknown): string {
  const data = result as {
    project?: { id?: string; slug?: string };
    forks?: Array<{ id?: string; owner?: string; repo?: string; status?: string }>;
  };
  const forks = data.forks ?? [];
  const lines = [`Project: ${data.project?.slug ?? data.project?.id}`, `Forks: ${forks.length}`];

  for (const fork of forks) {
    lines.push(`- ${fork.owner}/${fork.repo} ${fork.status} ${fork.id}`);
  }

  return lines.join("\n");
}

function formatAutonomousRun(result: unknown, cycle = 1): string {
  const data = result as {
    project?: { id?: string; slug?: string; rootOwner?: string; rootRepo?: string } | null;
    projects?: Array<{ id?: string; slug?: string; rootOwner?: string; rootRepo?: string }>;
    coordinator?: { username?: string };
    runs?: Array<{
      agent?: { username?: string };
      identitySeed?: number;
      project?: { id?: string; slug?: string; rootOwner?: string; rootRepo?: string };
      fork?: { id?: string; owner?: string; repo?: string; status?: string };
      work?: { path?: string; commitSha?: string | null; commitUrl?: string | null };
      job?: { id?: string; status?: string; commitSha?: string | null; error?: string | null };
      eval?: { status?: string; previewUrl?: string | null } | null;
      pullRequest?: { number?: number | null; url?: string | null } | null;
      compareUrl?: string | null;
    }>;
  };
  const runs = data.runs ?? [];
  const projects = data.projects ?? [];
  const projectLabel = data.project
    ? `${data.project.rootOwner}/${data.project.rootRepo}`
    : `${projects.length} project${projects.length === 1 ? "" : "s"}`;
  const lines = [
    `Cycle: ${cycle}`,
    `Project pool: ${projectLabel}`,
    `Coordinator: ${data.coordinator?.username ?? "unknown"}`,
    `Agents: ${runs.length}`
  ];

  for (const run of runs) {
    lines.push(
      `- ${run.agent?.username ?? "agent"} seed=${run.identitySeed ?? "n/a"} on ${run.project?.rootOwner}/${run.project?.rootRepo} -> ${run.fork?.owner}/${run.fork?.repo} ${run.fork?.status ?? "unknown"}`
    );
    lines.push(`  Job: ${run.job?.id ?? "none"} ${run.job?.status ?? "unknown"}`);
    if (run.job?.commitSha) {
      lines.push(`  Commit: ${run.job.commitSha}`);
    }
    if (run.work) {
      lines.push(`  Work: ${run.work.path ?? "pending"} @ ${run.work.commitSha ?? "pending"}`);
    }
    if (run.pullRequest || run.eval) {
      lines.push(`  Pull request: ${run.pullRequest?.number ? `#${run.pullRequest.number}` : "none"}`);
      lines.push(`  PR URL: ${run.pullRequest?.url ?? "none"}`);
      lines.push(`  Eval: ${run.eval?.status ?? "none"}`);
    } else {
      lines.push("  Mode: push-only");
    }
  }

  return lines.join("\n");
}

function formatWorkJob(result: unknown): string {
  const data = result as {
    id?: string;
    status?: string;
    forkId?: string;
    identitySeed?: number;
    commitSha?: string | null;
    error?: string | null;
    result?: { changedFiles?: string[] } | null;
  };
  const lines = [
    `Job: ${data.id}`,
    `Status: ${data.status}`,
    `Fork ID: ${data.forkId}`,
    `Seed: ${data.identitySeed}`,
    `Commit: ${data.commitSha ?? "pending"}`
  ];
  if (data.result?.changedFiles?.length) {
    lines.push(`Changed files: ${data.result.changedFiles.join(", ")}`);
  }
  if (data.error) {
    lines.push(`Error: ${data.error}`);
  }

  return lines.join("\n");
}

function formatStatus(result: unknown): string {
  const data = result as {
    fork?: { owner?: string; repo?: string; status?: string };
    submission?: { status?: string } | null;
    eval?: { status?: string; previewUrl?: string | null } | null;
    pullRequest?: { number?: number | null; url?: string | null } | null;
  };

  return [
    `Fork: ${data.fork?.owner}/${data.fork?.repo}`,
    `Fork status: ${data.fork?.status}`,
    `Submission: ${data.submission?.status ?? "none"}`,
    `Eval: ${data.eval?.status ?? "none"}`,
    `Preview: ${data.eval?.previewUrl ?? "pending"}`,
    `Pull request: ${data.pullRequest?.number ? `#${data.pullRequest.number}` : "none"}`,
    `Pull request URL: ${data.pullRequest?.url ?? "pending"}`
  ].join("\n");
}

function formatMaybeJson(result: unknown): string {
  return JSON.stringify(result, null, 2);
}

if (isEntrypoint()) {
  const code = await runCli();
  process.exitCode = code;
}

function isEntrypoint(): boolean {
  if (!process.argv[1]) {
    return false;
  }

  return realpathSync(fileURLToPath(import.meta.url)) === realpathSync(process.argv[1]);
}
