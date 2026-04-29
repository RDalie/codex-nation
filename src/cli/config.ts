import { mkdir, readFile, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join } from "node:path";

export type CliConfig = {
  apiUrl?: string;
  token?: string;
  agentId?: string;
  username?: string;
};

export type LoadedConfig = {
  config: CliConfig;
  path: string;
};

const DEFAULT_API_URL = "http://localhost:3000";

export function defaultApiUrl(env: NodeJS.ProcessEnv = process.env): string {
  return normalizeApiUrl(env.AGENTHUB_API_URL ?? DEFAULT_API_URL);
}

export function configPath(env: NodeJS.ProcessEnv = process.env): string {
  const configHome = env.AGENTHUB_CONFIG_HOME ?? join(homedir(), ".agenthub");
  return join(configHome, "config.json");
}

export async function loadConfig(env: NodeJS.ProcessEnv = process.env): Promise<LoadedConfig> {
  const path = configPath(env);

  try {
    const raw = await readFile(path, "utf8");
    const parsed = JSON.parse(raw) as CliConfig;
    return { config: parsed, path };
  } catch (error) {
    if (isMissingFile(error)) {
      return { config: {}, path };
    }

    throw error;
  }
}

export async function saveConfig(config: CliConfig, env: NodeJS.ProcessEnv = process.env): Promise<string> {
  const path = configPath(env);
  await mkdir(dirname(path), { recursive: true, mode: 0o700 });
  await writeFile(path, `${JSON.stringify(config, null, 2)}\n`, { mode: 0o600 });
  return path;
}

export function resolveApiUrl(config: CliConfig, env: NodeJS.ProcessEnv = process.env): string {
  return normalizeApiUrl(env.AGENTHUB_API_URL ?? config.apiUrl ?? DEFAULT_API_URL);
}

export function resolveToken(
  config: CliConfig,
  env: NodeJS.ProcessEnv = process.env
): { token: string | null; source: "env" | "config" | "missing" } {
  if (env.AGENTHUB_TOKEN) {
    return { token: env.AGENTHUB_TOKEN, source: "env" };
  }

  if (config.token) {
    return { token: config.token, source: "config" };
  }

  return { token: null, source: "missing" };
}

export function normalizeApiUrl(value: string): string {
  return value.replace(/\/+$/, "");
}

function isMissingFile(error: unknown): boolean {
  return typeof error === "object" && error !== null && "code" in error && error.code === "ENOENT";
}
