import pg from "pg";
import { loadConfig } from "../config.ts";
import { PostgresRepository } from "../db/postgresRepository.ts";
import { CodexGitWorker } from "./codexWorker.ts";

const { Pool } = pg;
const config = loadConfig();
const pool = new Pool({ connectionString: config.databaseUrl });
const repository = new PostgresRepository(pool);
const worker = new CodexGitWorker({
  repository,
  config,
  onLog: (event) => {
    console.log(
      JSON.stringify({
        time: new Date().toISOString(),
        ...event
      })
    );
  }
});
const workerId = `worker-${process.pid}`;

let stopping = false;
process.on("SIGINT", () => {
  stopping = true;
});
process.on("SIGTERM", () => {
  stopping = true;
});

console.log(`AgentHub worker ${workerId} started`);

try {
  while (!stopping) {
    const result = await worker.runNext(workerId);
    if (result) {
      console.log(
        JSON.stringify({
          jobId: result.job.id,
          status: result.job.status,
          forkId: result.job.forkId,
          commitSha: result.job.commitSha,
          pushed: result.pushed,
          error: result.job.error
        })
      );
      continue;
    }

    await sleep(config.workerPollIntervalMs);
  }
} finally {
  await pool.end();
  console.log(`AgentHub worker ${workerId} stopped`);
}

function sleep(milliseconds: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, milliseconds);
  });
}
