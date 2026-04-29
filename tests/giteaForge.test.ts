import assert from "node:assert/strict";
import test from "node:test";
import { GiteaHttpForge } from "../src/gitforge/GiteaHttpForge.ts";

test("GiteaHttpForge creates agent users when missing", async () => {
  const calls: Array<{ url: string; init: RequestInit }> = [];
  const forge = createForge(async (url, init) => {
    const request = normalizeRequest(url, init);
    calls.push(request);

    if (request.url.endsWith("/api/v1/users/agent-42")) {
      return jsonResponse({ message: "not found" }, 404);
    }

    if (request.url.endsWith("/api/v1/admin/users")) {
      return jsonResponse({ login: "agent-42" }, 201);
    }

    throw new Error(`Unexpected request: ${request.url}`);
  });

  const user = await forge.createAgentUser({ username: "agent-42" });

  assert.equal(user.username, "agent-42");
  assert.equal(calls[0]?.init.method, "GET");
  assert.equal(calls[1]?.init.method, "POST");
  assert.equal(readHeader(calls[1]?.init, "authorization"), "token test-token");
  assert.deepEqual(JSON.parse(calls[1]?.init.body as string).username, "agent-42");
});

test("GiteaHttpForge creates root org repos and returns SSH clone URLs", async () => {
  const calls: Array<{ url: string; init: RequestInit }> = [];
  const forge = createForge(async (url, init) => {
    const request = normalizeRequest(url, init);
    calls.push(request);

    if (request.url === "https://gitea.test/api/v1/orgs/agenthub/repos") {
      assert.equal(request.init.method, "POST");
      return jsonResponse({ owner: { login: "agenthub" }, name: "doom" }, 201);
    }

    if (request.url === "https://gitea.test/api/v1/repos/agenthub/doom/contents/primer.md") {
      if (request.init.method === "GET") {
        return jsonResponse({ message: "not found" }, 404);
      }

      assert.equal(request.init.method, "POST");
      const body = JSON.parse(request.init.body as string);
      assert.equal(Buffer.from(body.content, "base64").toString("utf8"), "# Doom Primer\n\nInitial AgentHub primer.\n");
      return jsonResponse({ content: { path: "primer.md" } }, 201);
    }

    throw new Error(`Unexpected request: ${request.url}`);
  });

  const repo = await forge.createRootRepo({ name: "Doom", slug: "doom" });

  assert.equal(repo.owner, "agenthub");
  assert.equal(repo.repo, "doom");
  assert.equal(repo.cloneUrl, "gitea@git.example.test:agenthub/doom.git");
  assert.equal(JSON.parse(calls[0]?.init.body as string).auto_init, true);
  assert.equal(calls.length, 3);
});

test("GiteaHttpForge forks as the target user via sudo", async () => {
  const forge = createForge(async (url, init) => {
    const request = normalizeRequest(url, init);
    assert.equal(request.url, "https://gitea.test/api/v1/repos/agenthub/doom/forks");
    assert.equal(request.init.method, "POST");
    assert.equal(readHeader(request.init, "sudo"), "agent-42");
    assert.equal(JSON.parse(request.init.body as string).name, "doom-x9f3");

    return jsonResponse({ owner: { login: "agent-42" }, name: "doom-x9f3" }, 202);
  });

  const fork = await forge.createFork({
    sourceOwner: "agenthub",
    sourceRepo: "doom",
    targetOwner: "agent-42"
  });

  assert.equal(fork.cloneUrl, "gitea@git.example.test:agent-42/doom-x9f3.git");
});

test("GiteaHttpForge creates submission snapshot repos and uploads files", async () => {
  const calls: Array<{ url: string; init: RequestInit }> = [];
  const forge = createForge(async (url, init) => {
    const request = normalizeRequest(url, init);
    calls.push(request);

    if (request.url === "https://gitea.test/api/v1/user/repos") {
      assert.equal(request.init.method, "POST");
      assert.equal(readHeader(request.init, "sudo"), "agent-42");
      assert.equal(JSON.parse(request.init.body as string).name, "doom-x9f3-sub-x9f3");
      return jsonResponse({ owner: { login: "agent-42" }, name: "doom-x9f3-sub-x9f3" }, 201);
    }

    if (request.url.endsWith("/contents/primer.md")) {
      if (request.init.method === "GET") {
        return jsonResponse({ message: "not found" }, 404);
      }

      assert.equal(request.init.method, "POST");
      assert.equal(readHeader(request.init, "sudo"), "agent-42");
      assert.equal(Buffer.from(JSON.parse(request.init.body as string).content, "base64").toString("utf8"), "# Primer\n");
      return jsonResponse({ content: { path: "primer.md" } }, 201);
    }

    if (request.url.endsWith("/contents/src/game.ts")) {
      if (request.init.method === "GET") {
        return jsonResponse({ message: "not found" }, 404);
      }

      assert.equal(request.init.method, "POST");
      assert.equal(readHeader(request.init, "sudo"), "agent-42");
      assert.equal(
        Buffer.from(JSON.parse(request.init.body as string).content, "base64").toString("utf8"),
        "export const title = 'doom';\n"
      );
      return jsonResponse({ content: { path: "src/game.ts" } }, 201);
    }

    throw new Error(`Unexpected request: ${request.url}`);
  });

  const snapshot = await forge.createSubmissionSnapshot({
    sourceRepo: "doom-x9f3",
    targetOwner: "agent-42",
    files: [
      { path: "primer.md", contentBase64: Buffer.from("# Primer\n").toString("base64") },
      { path: "src/game.ts", contentBase64: Buffer.from("export const title = 'doom';\n").toString("base64") }
    ]
  });

  assert.equal(snapshot.owner, "agent-42");
  assert.equal(snapshot.repo, "doom-x9f3-sub-x9f3");
  assert.equal(snapshot.cloneUrl, "gitea@git.example.test:agent-42/doom-x9f3-sub-x9f3.git");
  assert.equal(calls.length, 5);
});

test("GiteaHttpForge decodes base64 file contents", async () => {
  const forge = createForge(async (url, init) => {
    const request = normalizeRequest(url, init);
    assert.equal(request.url, "https://gitea.test/api/v1/repos/agent-42/doom/contents/primer.md?ref=abc123");
    assert.equal(request.init.method, "GET");

    return jsonResponse(
      {
        type: "file",
        encoding: "base64",
        content: Buffer.from("# Primer\n").toString("base64")
      },
      200
    );
  });

  const file = await forge.getFile({
    owner: "agent-42",
    repo: "doom",
    path: "primer.md",
    ref: "abc123"
  });

  assert.equal(file?.content, "# Primer\n");
});

function createForge(fetch: typeof globalThis.fetch): GiteaHttpForge {
  return new GiteaHttpForge({
    baseUrl: "https://gitea.test",
    token: "test-token",
    rootOwner: "agenthub",
    rootOwnerType: "org",
    sshUser: "gitea",
    sshHost: "git.example.test",
    sshPort: 22,
    suffixGenerator: () => "x9f3",
    fetch
  });
}

function jsonResponse(body: unknown, status: number): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "content-type": "application/json"
    }
  });
}

function readHeader(init: RequestInit | undefined, name: string): string | null {
  const headers = init?.headers as Record<string, string> | undefined;
  return headers?.[name] ?? null;
}

function normalizeRequest(url: RequestInfo | URL, init: RequestInit | undefined): { url: string; init: RequestInit } {
  return {
    url: String(url),
    init: init ?? {}
  };
}
