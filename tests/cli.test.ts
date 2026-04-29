import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { createServer, type IncomingMessage } from "node:http";
import type { AddressInfo } from "node:net";
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

    const status = await agenthub("--json", "status", readPath(fork, "id"));
    assert.equal(readPath(status, "eval.status"), "queued");

    const health = await agenthub("--json", "api", "GET", "/health");
    assert.equal(readPath(health, "ok"), true);
  } finally {
    await app.close();
    await rm(configHome, { recursive: true, force: true });
  }
});

test("agenthub CLI prepares fork workflow HTTP contracts", async () => {
  const projectId = "prj_demo";
  const forkId = "frk_workflow";
  const fork = {
    id: forkId,
    owner: "agent-42",
    repo: "doom-x9f3",
    cloneUrl: "ssh://git@git.agenthub.dev:2222/agent-42/doom-x9f3.git",
    goal: "Make a playable preview",
    status: "working"
  };
  const compareUrl = "https://git.agenthub.dev/agenthub/doom/compare/main...agent-42:main";
  const contract = await createContractServer(
    new Map<string, unknown>([
      [
        "POST /agents/run",
        {
          project: null,
          projects: [
            { id: "prj_a", rootOwner: "agenthub", rootRepo: "alpha" },
            { id: "prj_b", rootOwner: "agenthub", rootRepo: "beta" }
          ],
          coordinator: { username: "coordinator" },
          runs: [
            {
              agent: { username: "agent-gamma" },
              identitySeed: 183244,
              project: { id: "prj_b", rootOwner: "agenthub", rootRepo: "beta" },
              fork: { owner: "agent-gamma", repo: "beta-gamma", status: "working" },
              job: { id: "job_gamma", status: "queued", commitSha: null, error: null },
              work: null,
              pullRequest: null,
              eval: null
            }
          ]
        }
      ],
      [
        `POST /projects/${projectId}/run-agents`,
        {
          project: { id: projectId, rootOwner: "agenthub", rootRepo: "doom" },
          projects: [{ id: projectId, rootOwner: "agenthub", rootRepo: "doom" }],
          coordinator: { username: "coordinator" },
          runs: [
            {
              agent: { username: "agent-alpha" },
              identitySeed: 975420,
              project: { id: projectId, rootOwner: "agenthub", rootRepo: "doom" },
              fork: { owner: "agent-alpha", repo: "doom-alpha", status: "working" },
              job: { id: "job_alpha", status: "queued", commitSha: null, error: null },
              work: null,
              pullRequest: null,
              eval: null
            },
            {
              agent: { username: "agent-beta" },
              identitySeed: 151006,
              project: { id: projectId, rootOwner: "agenthub", rootRepo: "doom" },
              fork: { owner: "agent-beta", repo: "doom-beta", status: "working" },
              job: { id: "job_beta", status: "queued", commitSha: null, error: null },
              work: null,
              pullRequest: null,
              eval: null
            }
          ]
        }
      ],
      [
        "GET /work-jobs/job_gamma",
        {
          id: "job_gamma",
          status: "queued",
          forkId: forkId,
          identitySeed: 183244,
          commitSha: null,
          result: null,
          error: null
        }
      ],
      [
        `POST /forks/${forkId}/work`,
        {
          fork,
          work: {
            owner: "agent-42",
            repo: "doom-x9f3",
            path: "agenthub-work.md",
            branch: "main",
            commitSha: "abc123",
            commitUrl: "https://git.agenthub.dev/agent-42/doom-x9f3/commit/abc123"
          },
          steps: [{ name: "push to Gitea", detail: "agent-42/doom-x9f3@main" }]
        }
      ],
      [
        `GET /forks/${forkId}/compare`,
        {
          fork,
          base: { owner: "agenthub", repo: "doom", branch: "main" },
          head: { owner: "agent-42", repo: "doom-x9f3", branch: "main" },
          compareUrl
        }
      ],
      [
        `POST /forks/${forkId}/pr`,
        {
          fork,
          pullRequest: {
            number: 17,
            status: "open",
            url: "https://git.agenthub.dev/agenthub/doom/pulls/17"
          },
          compareUrl
        }
      ],
      [
        `POST /forks/${forkId}/eval`,
        {
          fork: { ...fork, status: "evaluating" },
          submission: { id: "sub_123", status: "queued" },
          eval: {
            id: "evl_123",
            status: "running",
            previewUrl: "https://preview.agenthub.dev/frk_workflow"
          }
        }
      ]
    ])
  );
  const configHome = await mkdtemp(join(tmpdir(), "agenthub-cli-contract-"));

  async function agenthub(...args: string[]): Promise<unknown> {
    const { stdout } = await execFileAsync("bin/agenthub", ["--api-url", contract.url, "--json", ...args], {
      cwd: process.cwd(),
      env: {
        ...process.env,
        AGENTHUB_CONFIG_HOME: configHome,
        AGENTHUB_TOKEN: "ah_test",
        NODE_BIN: process.execPath
      }
    });

    return JSON.parse(stdout);
  }

  try {
    const poolRun = await agenthub(
      "run-agents",
      "--project",
      "prj_a",
      "--project",
      "prj_b",
      "--agent",
      "agent-gamma"
    );
    assert.equal(readPath(poolRun, "project"), null);
    assert.equal(readPath(poolRun, "runs.0.project.id"), "prj_b");
    assert.equal(readPath(poolRun, "runs.0.job.status"), "queued");

    const job = await agenthub("job", "job_gamma");
    assert.equal(readPath(job, "status"), "queued");
    assert.equal(readPath(job, "identitySeed"), 183244);

    const autonomous = await agenthub(
      "run-agents",
      projectId,
      "--agent",
      "agent-alpha",
      "--agent",
      "agent-beta",
      "--goal",
      "Explore freely"
    );
    assert.equal(readPath(autonomous, "runs.0.agent.username"), "agent-alpha");
    assert.equal(readPath(autonomous, "runs.0.job.status"), "queued");
    assert.equal(readPath(autonomous, "runs.1.pullRequest"), null);

    const work = await agenthub("work", forkId);
    assert.equal(readPath(work, "fork.cloneUrl"), fork.cloneUrl);
    assert.equal(readPath(work, "work.branch"), "main");
    assert.equal(readPath(work, "work.commitSha"), "abc123");

    const compare = await agenthub("compare", forkId);
    assert.equal(readPath(compare, "compareUrl"), compareUrl);

    const pullRequest = await agenthub("pr", forkId);
    assert.equal(readPath(pullRequest, "pullRequest.number"), 17);
    assert.equal(readPath(pullRequest, "pullRequest.status"), "open");

    const evalResult = await agenthub("eval", forkId);
    assert.equal(readPath(evalResult, "fork.status"), "evaluating");
    assert.equal(readPath(evalResult, "eval.status"), "running");

    assert.deepEqual(
      contract.requests.map((request) => ({
        method: request.method,
        url: request.url,
        authorization: request.authorization,
        body: request.body
      })),
      [
        {
          method: "POST",
          url: "/agents/run",
          authorization: "Bearer ah_test",
          body: {
            projectIds: ["prj_a", "prj_b"],
            agents: [{ username: "agent-gamma" }],
            cycle: 1
          }
        },
        {
          method: "GET",
          url: "/work-jobs/job_gamma",
          authorization: "Bearer ah_test",
          body: null
        },
        {
          method: "POST",
          url: `/projects/${projectId}/run-agents`,
          authorization: "Bearer ah_test",
          body: {
            agents: [
              { username: "agent-alpha", goal: "Explore freely" },
              { username: "agent-beta", goal: "Explore freely" }
            ],
            cycle: 1
          }
        },
        {
          method: "POST",
          url: `/forks/${forkId}/work`,
          authorization: "Bearer ah_test",
          body: { path: "agenthub-work.md" }
        },
        {
          method: "GET",
          url: `/forks/${forkId}/compare`,
          authorization: "Bearer ah_test",
          body: null
        },
        {
          method: "POST",
          url: `/forks/${forkId}/pr`,
          authorization: "Bearer ah_test",
          body: {}
        },
        {
          method: "POST",
          url: `/forks/${forkId}/eval`,
          authorization: "Bearer ah_test",
          body: { workPath: "agenthub-work.md" }
        }
      ]
    );
  } finally {
    await contract.close();
    await rm(configHome, { recursive: true, force: true });
  }
});

type ContractRequest = {
  method: string;
  url: string;
  authorization: string | undefined;
  body: unknown;
};

async function createContractServer(routes: Map<string, unknown>): Promise<{
  url: string;
  requests: ContractRequest[];
  close: () => Promise<void>;
}> {
  const requests: ContractRequest[] = [];
  const server = createServer(async (request, response) => {
    const body = await readRequestBody(request);
    const record = {
      method: request.method ?? "GET",
      url: request.url ?? "/",
      authorization: request.headers.authorization,
      body
    };
    requests.push(record);

    const route = routes.get(`${record.method} ${record.url}`);
    if (!route) {
      response.writeHead(404, { "content-type": "application/json" });
      response.end(
        JSON.stringify({
          error: {
            code: "not_found",
            message: `No contract route for ${record.method} ${record.url}`
          }
        })
      );
      return;
    }

    response.writeHead(200, { "content-type": "application/json" });
    response.end(JSON.stringify(route));
  });

  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      server.off("error", reject);
      resolve();
    });
  });

  const address = server.address();
  assert.equal(typeof address, "object");
  assert.ok(address);
  const { port } = address as AddressInfo;

  return {
    url: `http://127.0.0.1:${port}`,
    requests,
    close: () =>
      new Promise<void>((resolve, reject) => {
        server.close((error) => {
          if (error) {
            reject(error);
            return;
          }

          resolve();
        });
      })
  };
}

async function readRequestBody(request: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];
  for await (const chunk of request) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }

  const text = Buffer.concat(chunks).toString("utf8");
  if (!text) {
    return null;
  }

  return JSON.parse(text);
}

function readPath<T = any>(value: unknown, path: string): T {
  const parts = path.split(".");
  let current: any = value;

  for (const part of parts) {
    current = current?.[part];
  }

  return current as T;
}
