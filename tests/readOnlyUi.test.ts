import assert from "node:assert/strict";
import test from "node:test";
import type { FastifyInstance } from "fastify";
import { InMemoryRepository } from "../src/db/inMemoryRepository.ts";
import { AgentHubService, type LoginResult, type ProjectDetails } from "../src/domain/AgentHubService.ts";
import { MockGiteaForge } from "../src/gitforge/MockGiteaForge.ts";
import { createApp } from "../src/http/app.ts";
import type { Fork, Project } from "../src/types.ts";

test("read-only dashboard route returns HTML", async () => {
  const app = createTestApp();

  try {
    const { response } = await fetchDashboard(app);

    assert.match(readHeader(response, "content-type"), /text\/html/i);
    assert.match(response.payload, /<html[\s>]/i);
    assert.match(response.payload, /AgentHub/i);
  } finally {
    await app.close();
  }
});

test("GET /projects lists created projects without write credentials", async () => {
  const app = createTestApp();

  try {
    const token = await login(app, "agent-42");
    const doom = await createProject(app, token, { name: "Doom", slug: "doom" });
    const quake = await createProject(app, token, { name: "Quake", slug: "quake" });

    const response = await app.inject({ method: "GET", url: "/projects" });
    assert.equal(response.statusCode, 200);
    assert.match(readHeader(response, "content-type"), /application\/json/i);

    const listed = parseJson<{ projects: Project[] }>(response).projects;
    assert.deepEqual(
      listed.map((project) => project.id).sort(),
      [doom.project.id, quake.project.id].sort()
    );
    assert.deepEqual(
      listed.map((project) => project.slug).sort(),
      ["doom", "quake"]
    );

    const blockedMutation = await app.inject({
      method: "POST",
      url: "/projects",
      payload: { name: "Unauthorized Write" }
    });
    assert.equal(blockedMutation.statusCode, 401);

    const afterBlockedMutation = parseJson<{ projects: Project[] }>(
      await app.inject({ method: "GET", url: "/projects" })
    ).projects;
    assert.deepEqual(
      afterBlockedMutation.map((project) => project.id).sort(),
      listed.map((project) => project.id).sort()
    );
  } finally {
    await app.close();
  }
});

test("project lineage remains readable through the HTTP API", async () => {
  const app = createTestApp();

  try {
    const token = await login(app, "agent-42");
    const details = await createProject(app, token, { name: "Doom", slug: "doom" });
    assert.ok(details.rootFork);

    const forkResponse = await app.inject({
      method: "POST",
      url: "/forks",
      headers: { authorization: `Bearer ${token}` },
      payload: {
        projectId: details.project.id,
        parentForkId: details.rootFork.id,
        goal: "Make a playable preview"
      }
    });
    assert.equal(forkResponse.statusCode, 200);
    const fork = parseJson<Fork>(forkResponse);

    const lineageResponse = await app.inject({
      method: "GET",
      url: `/projects/${details.project.id}/lineage`
    });
    assert.equal(lineageResponse.statusCode, 200);

    const lineage = parseJson<ProjectDetails>(lineageResponse);
    assert.equal(lineage.project.id, details.project.id);
    assert.equal(lineage.rootFork?.id, details.rootFork.id);
    assert.deepEqual(
      lineage.forks.map((lineageFork) => lineageFork.id).sort(),
      [details.rootFork.id, fork.id].sort()
    );
    assert.deepEqual(
      lineage.events.map((event) => event.type).sort(),
      ["fork.created", "project.created"].sort()
    );
  } finally {
    await app.close();
  }
});

function createTestApp(): FastifyInstance {
  const repository = new InMemoryRepository();
  const forge = new MockGiteaForge({ suffixGenerator: () => "x9f3" });
  const service = new AgentHubService({ repository, forge });
  return createApp(service, { logger: false });
}

async function fetchDashboard(app: FastifyInstance): Promise<{ url: string; response: InjectResponse }> {
  const attempts: string[] = [];

  for (const url of ["/ui", "/"]) {
    const response = await app.inject({ method: "GET", url });
    attempts.push(`${url} -> ${response.statusCode}`);

    if (response.statusCode === 200 && /text\/html/i.test(readHeader(response, "content-type"))) {
      return { url, response };
    }
  }

  assert.fail(`Expected /ui or / to serve dashboard HTML; saw ${attempts.join(", ")}`);
}

async function login(app: FastifyInstance, username: string): Promise<string> {
  const response = await app.inject({
    method: "POST",
    url: "/agents/login",
    payload: { username }
  });
  assert.equal(response.statusCode, 200);
  return parseJson<LoginResult>(response).token;
}

async function createProject(
  app: FastifyInstance,
  token: string,
  input: { name: string; slug: string }
): Promise<ProjectDetails> {
  const response = await app.inject({
    method: "POST",
    url: "/projects",
    headers: { authorization: `Bearer ${token}` },
    payload: input
  });
  assert.equal(response.statusCode, 200);
  return parseJson<ProjectDetails>(response);
}

function parseJson<T>(response: { payload: string }): T {
  return JSON.parse(response.payload) as T;
}

function readHeader(response: InjectResponse, name: string): string {
  const value = response.headers[name];
  if (Array.isArray(value)) {
    return value.join(", ");
  }

  return String(value ?? "");
}

type InjectResponse = Awaited<ReturnType<FastifyInstance["inject"]>>;
