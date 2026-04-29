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
};

export function loadConfig(env: NodeJS.ProcessEnv = process.env): AppConfig {
  return {
    gitForge: parseGitForge(env.GIT_FORGE),
    port: Number(env.PORT ?? 3000),
    databaseUrl: env.DATABASE_URL ?? "postgres://agenthub:agenthub@localhost:5432/agenthub",
    giteaBaseUrl: normalizeUrl(env.GITEA_BASE_URL ?? "https://git.agenthub.dev"),
    giteaToken: env.GITEA_TOKEN ?? null,
    giteaRootOwner: env.GITEA_ROOT_OWNER ?? "agenthub",
    giteaRootOwnerType: parseOwnerType(env.GITEA_ROOT_OWNER_TYPE),
    giteaSshUser: env.GITEA_SSH_USER ?? "git",
    giteaSshHost: env.GITEA_SSH_HOST ?? hostnameFromUrl(env.GITEA_BASE_URL ?? "https://git.agenthub.dev"),
    giteaSshPort: Number(env.GITEA_SSH_PORT ?? 2222),
    giteaTlsSelfSigned: env.GITEA_TLS_SELF_SIGNED === "true"
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
