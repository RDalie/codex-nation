import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import test from "node:test";
import { InMemoryRepository } from "../src/db/inMemoryRepository.ts";
import { AgentHubService } from "../src/domain/AgentHubService.ts";
import { MockGiteaForge } from "../src/gitforge/MockGiteaForge.ts";
import { createApp } from "../src/http/app.ts";

const execFileAsync = promisify(execFile);

test("agenthub CLI drives the mock HTTP flow", async () => {
  const repository = new InMemoryRepository();
  const forge = new MockGiteaForge({ suffixGenerator: () => "x9f3" });
  const service = new AgentHubService({ repository, forge });
  const app = createApp(service, { logger: false });
  const address = await app.listen({ host: "127.0.0.1", port: 0 });
  const configHome = await mkdtemp(join(tmpdir(), "agenthub-cli-"));
  const bundleDir = await mkdtemp(join(tmpdir(), "agenthub-bundle-"));

  async function agenthub(...args: string[]): Promise<unknown> {
    const { stdout } = await execFileAsync("bin/agenthub", args, {
      cwd: process.cwd(),
      env: {
        ...process.env,
        AGENTHUB_CONFIG_HOME: configHome,
        NODE_BIN: process.execPath
      }
    });

    return JSON.parse(stdout);
  }

  try {
    const doctor = await agenthub("--api-url", address, "--json", "doctor");
    assert.equal(readPath(doctor, "apiReachable"), true);
    assert.equal(readPath(doctor, "token.available"), false);

    const login = await agenthub("--api-url", address, "--json", "login", "agent-42");
    assert.equal(readPath(login, "username"), "agent-42");
    assert.match(readPath(login, "token"), /^ah_/);

    const me = await agenthub("--json", "me");
    assert.equal(readPath(me, "username"), "agent-42");

    const project = await agenthub("--json", "new", "Doom");
    assert.equal(readPath(project, "project.rootOwner"), "agenthub");
    assert.equal(readPath(project, "project.rootRepo"), "doom");

    const fork = await agenthub("--json", "fork", readPath(project, "project.id"), "--goal", "Make a playable preview");
    assert.equal(readPath(fork, "owner"), "agent-42");
    assert.equal(readPath(fork, "repo"), "doom-x9f3");

    const submission = await agenthub("--json", "submit", readPath(fork, "id"), "--commit", "abc123");
    assert.equal(readPath(submission, "fork.status"), "submitted");
    assert.equal(readPath(submission, "eval.status"), "queued");

    await mkdir(join(bundleDir, "src"));
    await writeFile(join(bundleDir, "primer.md"), "# Primer\n");
    await writeFile(join(bundleDir, "src", "game.ts"), "export const title = 'doom';\n");
    await writeFile(join(bundleDir, ".env"), "SHOULD_NOT_UPLOAD=true\n");

    const bundledSubmission = await agenthub("--json", "submit", readPath(fork, "id"), "--bundle", bundleDir);
    assert.equal(readPath(bundledSubmission, "fork.status"), "submitted");
    assert.equal(readPath(bundledSubmission, "submission.snapshotOwner"), "agent-42");
    assert.equal(readPath(bundledSubmission, "submission.snapshotRepo"), "doom-x9f3-sub-x9f3");

    const status = await agenthub("--json", "status", readPath(fork, "id"));
    assert.equal(readPath(status, "eval.status"), "queued");

    const health = await agenthub("--json", "api", "GET", "/health");
    assert.equal(readPath(health, "ok"), true);
  } finally {
    await app.close();
    await rm(configHome, { recursive: true, force: true });
    await rm(bundleDir, { recursive: true, force: true });
  }
});

function readPath<T = any>(value: unknown, path: string): T {
  const parts = path.split(".");
  let current: any = value;

  for (const part of parts) {
    current = current?.[part];
  }

  return current as T;
}
