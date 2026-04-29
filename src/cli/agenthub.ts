#!/usr/bin/env node
import { realpathSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { Command } from "commander";
import { AgentHubApiClient } from "./api.ts";
import { createBundle } from "./bundle.ts";
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
    .description("AgentHub CLI for login, project creation, disposable forks, and submissions.")
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
    .command("submit")
    .description("Submit a fork for evaluation; primer.md is required")
    .argument("<fork-id>", "fork id")
    .option("--commit <sha>", "commit SHA to submit")
    .option("--primer-path <path>", "primer path", "primer.md")
    .option("--bundle <dir>", "upload a local directory as an immutable submission repo")
    .action(async (forkId: string, options: { commit?: string; primerPath?: string; bundle?: string }) => {
      const context = await createContext(program, { requireToken: true });
      if (options.commit && options.bundle) {
        throw new Error("Use either --commit or --bundle, not both.");
      }

      const input: {
        forkId: string;
        commitSha?: string;
        primerPath?: string;
        bundle?: { files: Awaited<ReturnType<typeof createBundle>>["files"] };
      } = { forkId };
      if (options.commit) {
        input.commitSha = options.commit;
      }
      if (options.primerPath) {
        input.primerPath = options.primerPath;
      }
      if (options.bundle) {
        const bundle = await createBundle({
          rootPath: options.bundle,
          primerPath: options.primerPath ?? "primer.md"
        });
        input.bundle = { files: bundle.files };
      }

      const result = await new AgentHubApiClient({ apiUrl: context.apiUrl, token: context.token }).submit(input);
      writeOutput(io, context.mode, result, formatSubmission(result));
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

function formatSubmission(result: unknown): string {
  const data = result as {
    fork?: { owner?: string; repo?: string; status?: string };
    submission?: {
      id?: string;
      primerPath?: string;
      snapshotOwner?: string | null;
      snapshotRepo?: string | null;
      snapshotCloneUrl?: string | null;
    };
    eval?: { status?: string; previewUrl?: string | null };
  };
  const snapshot =
    data.submission?.snapshotOwner && data.submission?.snapshotRepo
      ? `${data.submission.snapshotOwner}/${data.submission.snapshotRepo}`
      : "none";

  return [
    `Submitted: ${data.fork?.owner}/${data.fork?.repo}`,
    `Fork status: ${data.fork?.status}`,
    `Submission ID: ${data.submission?.id}`,
    `Primer: ${data.submission?.primerPath}`,
    `Snapshot: ${snapshot}`,
    `Snapshot clone: ${data.submission?.snapshotCloneUrl ?? "none"}`,
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

function formatStatus(result: unknown): string {
  const data = result as {
    fork?: { owner?: string; repo?: string; status?: string };
    submission?: { status?: string } | null;
    eval?: { status?: string; previewUrl?: string | null } | null;
  };

  return [
    `Fork: ${data.fork?.owner}/${data.fork?.repo}`,
    `Fork status: ${data.fork?.status}`,
    `Submission: ${data.submission?.status ?? "none"}`,
    `Eval: ${data.eval?.status ?? "none"}`,
    `Preview: ${data.eval?.previewUrl ?? "pending"}`
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
