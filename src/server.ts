import pg from "pg";
import { loadConfig } from "./config.ts";
import { PostgresRepository } from "./db/postgresRepository.ts";
import { AgentHubService } from "./domain/AgentHubService.ts";
import { MockGiteaForge } from "./gitforge/MockGiteaForge.ts";
import { createApp } from "./http/app.ts";

const { Pool } = pg;
const config = loadConfig();
const pool = new Pool({ connectionString: config.databaseUrl });
const repository = new PostgresRepository(pool);
const forge = new MockGiteaForge({ sshPort: config.giteaSshPort });
const service = new AgentHubService({ repository, forge });
const app = createApp(service);

const address = await app.listen({ port: config.port, host: "0.0.0.0" });
app.log.info(`AgentHub API listening at ${address}`);

process.on("SIGTERM", async () => {
  await app.close();
  await pool.end();
});
