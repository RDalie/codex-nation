export type AppConfig = {
  port: number;
  databaseUrl: string;
  giteaBaseUrl: string;
  giteaSshPort: number;
};

export function loadConfig(env: NodeJS.ProcessEnv = process.env): AppConfig {
  return {
    port: Number(env.PORT ?? 3000),
    databaseUrl: env.DATABASE_URL ?? "postgres://agenthub:agenthub@localhost:5432/agenthub",
    giteaBaseUrl: env.GITEA_BASE_URL ?? "https://git.agenthub.dev",
    giteaSshPort: Number(env.GITEA_SSH_PORT ?? 2222)
  };
}
