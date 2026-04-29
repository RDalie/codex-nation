export type AppConfig = {
  gitForge: "mock" | "gitea";
  port: number;
  databaseUrl: string;
  giteaBaseUrl: string;
  giteaToken: string | null;
  giteaRootOwner: string;
  giteaRootOwnerType: "org" | "user";
  giteaSshUser: string;
  giteaSshHost: string;
  giteaSshPort: number;
  giteaTlsSelfSigned: boolean;
  workerWorkDir: string;
  workerPollIntervalMs: number;
  codexBin: string;
  codexModel: string | null;
  codexTimeoutMs: number;
  codexDemoMode: boolean;
  codexTokenBudget: number;
  codexMaxChangedFiles: number;
};

export function loadConfig(env: NodeJS.ProcessEnv = process.env): AppConfig {
  return {
    gitForge: parseGitForge(env.GIT_FORGE),
    port: Number(env.PORT ?? 3000),
    databaseUrl: env.DATABASE_URL ?? "postgres://agenthub:agenthub_dev_password@localhost:5432/agenthub",
    giteaBaseUrl: normalizeUrl(env.GITEA_BASE_URL ?? "https://git.agenthub.dev"),
    giteaToken: env.GITEA_TOKEN ?? null,
    giteaRootOwner: env.GITEA_ROOT_OWNER ?? "agenthub",
    giteaRootOwnerType: parseOwnerType(env.GITEA_ROOT_OWNER_TYPE),
    giteaSshUser: env.GITEA_SSH_USER ?? "git",
    giteaSshHost: env.GITEA_SSH_HOST ?? hostnameFromUrl(env.GITEA_BASE_URL ?? "https://git.agenthub.dev"),
    giteaSshPort: Number(env.GITEA_SSH_PORT ?? 2222),
    giteaTlsSelfSigned: env.GITEA_TLS_SELF_SIGNED === "true",
    workerWorkDir: env.AGENTHUB_WORKER_DIR ?? "/tmp/agenthub-work",
    workerPollIntervalMs: Number(env.AGENTHUB_WORKER_POLL_INTERVAL_MS ?? 5000),
    codexBin: env.AGENTHUB_CODEX_BIN ?? "codex",
    codexModel: cleanOptionalString(env.AGENTHUB_CODEX_MODEL),
    codexTimeoutMs: Number(env.AGENTHUB_CODEX_TIMEOUT_MS ?? 600000),
    codexDemoMode: env.AGENTHUB_CODEX_DEMO_MODE === "true",
    codexTokenBudget: Number(env.AGENTHUB_CODEX_TOKEN_BUDGET ?? 2500),
    codexMaxChangedFiles: Number(env.AGENTHUB_CODEX_MAX_CHANGED_FILES ?? 2)
  };
}

function parseGitForge(value: string | undefined): "mock" | "gitea" {
  if (value === "gitea") {
    return "gitea";
  }

  return "mock";
}

function parseOwnerType(value: string | undefined): "org" | "user" {
  if (value === "user") {
    return "user";
  }

  return "org";
}

function normalizeUrl(value: string): string {
  return value.replace(/\/+$/, "");
}

function hostnameFromUrl(value: string): string {
  return new URL(value).hostname;
}

function cleanOptionalString(value: string | undefined): string | null {
  const cleaned = value?.trim();
  return cleaned || null;
}
