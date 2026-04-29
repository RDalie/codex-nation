import assert from "node:assert/strict";
import test from "node:test";
import { InMemoryRepository } from "../src/db/inMemoryRepository.ts";
import { AgentHubService } from "../src/domain/AgentHubService.ts";
import { MockGiteaForge } from "../src/gitforge/MockGiteaForge.ts";

test("full mock AgentHub flow", async () => {
  const repository = new InMemoryRepository();
  const forge = new MockGiteaForge({ suffixGenerator: () => "x9f3" });
  const service = new AgentHubService({ repository, forge });

  const login = await service.login({ username: "agent-42" });
  const agent = await service.authenticate(login.token);

  const details = await service.createProject(agent, { name: "Doom" });
  assert.equal(details.project.rootOwner, "agenthub");
  assert.equal(details.project.rootRepo, "doom");
  assert.equal(details.rootFork?.cloneUrl, "ssh://git@git.agenthub.dev:2222/agenthub/doom.git");
  assert.ok(details.rootFork);

  const fork = await service.createFork(agent, {
    projectId: details.project.id,
    parentForkId: details.rootFork.id,
    goal: "Make a playable preview"
  });
  assert.equal(fork.owner, "agent-42");
  assert.equal(fork.repo, "doom-x9f3");

  const submission = await service.submitFork(agent, { forkId: fork.id, commitSha: "abc123" });
  assert.equal(submission.fork.status, "submitted");
  assert.equal(submission.submission.primerPath, "primer.md");
  assert.equal(submission.eval.status, "queued");

  const lineage = await service.getProjectLineage(details.project.id);
  assert.equal(lineage.forks.length, 2);
  assert.deepEqual(
    lineage.events.map((event) => event.type).sort(),
    ["fork.created", "project.created", "submission.created"].sort()
  );

  const status = await service.getForkStatus(fork.id);
  assert.equal(status.eval?.status, "queued");
});

test("records pull requests and eval worker completion", async () => {
  const repository = new InMemoryRepository();
  const forge = new MockGiteaForge({ suffixGenerator: () => "x9f3" });
  const service = new AgentHubService({ repository, forge });

  const login = await service.login({ username: "agent-42" });
  const agent = await service.authenticate(login.token);

  const details = await service.createProject(agent, { name: "Doom" });
  assert.ok(details.rootFork);

  const fork = await service.createFork(agent, {
    projectId: details.project.id,
    parentForkId: details.rootFork.id
  });
  const submission = await service.submitFork(agent, { forkId: fork.id, commitSha: "abc123" });

  const pullRequest = await service.recordPullRequest(agent, {
    submissionId: submission.submission.id,
    url: "https://git.agenthub.dev/agenthub/doom/pulls/7",
    number: 7
  });
  assert.equal(pullRequest.pullRequest.number, 7);
  assert.equal(pullRequest.pullRequest.url, "https://git.agenthub.dev/agenthub/doom/pulls/7");

  const running = await service.startEval({ evalId: submission.eval.id });
  assert.equal(running.fork.status, "evaluating");
  assert.equal(running.eval.status, "running");
  assert.equal(running.eval.completedAt, null);

  const completed = await service.completeEval({
    evalId: submission.eval.id,
    status: "passed",
    log: "Eval passed.",
    previewUrl: "https://preview.agenthub.dev/doom"
  });
  assert.equal(completed.fork.status, "passed");
  assert.equal(completed.submission.status, "passed");
  assert.equal(completed.eval.status, "passed");
  assert.equal(completed.eval.previewUrl, "https://preview.agenthub.dev/doom");
  assert.ok(completed.eval.completedAt);

  const status = await service.getForkStatus(fork.id);
  assert.equal(status.pullRequest?.number, 7);
  assert.equal(status.eval?.completedAt, completed.eval.completedAt);
});

test("agent workflow commits work, opens a pull request, and runs eval", async () => {
  const repository = new InMemoryRepository();
  const forge = new MockGiteaForge({ suffixGenerator: () => "x9f3" });
  const service = new AgentHubService({ repository, forge });

  const login = await service.login({ username: "agent-42" });
  const agent = await service.authenticate(login.token);
  const details = await service.createProject(agent, { name: "Doom" });
  assert.ok(details.rootFork);

  const fork = await service.createFork(agent, {
    projectId: details.project.id,
    parentForkId: details.rootFork.id,
    goal: "Make a playable preview"
  });

  const work = await service.performForkWork(agent, {
    forkId: fork.id,
    content: "# Playable preview\n"
  });
  assert.equal(work.work.path, "agenthub-work.md");
  assert.equal(work.work.commitSha, "mock-commit-1");

  const compare = await service.compareFork(fork.id);
  assert.match(compare.compareUrl, /compare\/main\.\.\.agent-42:main$/);

  const pullRequest = await service.createPullRequestForFork(agent, { forkId: fork.id });
  assert.equal(pullRequest.pullRequest.number, 1);
  assert.match(pullRequest.pullRequest.url, /\/agenthub\/doom\/pulls\/1$/);

  const evalResult = await service.runForkEval(agent, { forkId: fork.id });
  assert.equal(evalResult.fork.status, "passed");
  assert.equal(evalResult.submission.status, "passed");
  assert.equal(evalResult.eval.status, "passed");
  assert.equal(evalResult.pullRequest?.number, 1);
});

test("coordinator launches independent autonomous agents", async () => {
  const repository = new InMemoryRepository();
  const forge = new MockGiteaForge({ suffixGenerator: () => "x9f3" });
  const service = new AgentHubService({ repository, forge });

  const coordinatorLogin = await service.login({ username: "coordinator" });
  const coordinator = await service.authenticate(coordinatorLogin.token);
  const details = await service.createProject(coordinator, { name: "Doom" });

  const result = await service.runAgentsForProject(coordinator, {
    projectId: details.project.id,
    agents: [{ username: "agent-alpha" }, { username: "agent-beta", goal: "Explore a useful improvement" }]
  });

  assert.equal(result.coordinator.username, "coordinator");
  assert.equal(result.runs.length, 2);
  assert.equal(result.runs[0]?.agent.username, "agent-alpha");
  assert.equal(result.runs[0]?.fork.owner, "agent-alpha");
  assert.equal(result.runs[0]?.fork.status, "working");
  assert.equal(result.runs[0]?.work, null);
  assert.equal(result.runs[0]?.job.status, "queued");
  assert.match(result.runs[0]?.job.prompt ?? "", /choose one small useful improvement/);
  assert.equal((await service.getWorkJob(coordinator, result.runs[0]!.job.id)).status, "queued");
  assert.equal(result.runs[0]?.pullRequest, null);
  assert.equal(result.runs[0]?.eval, null);
  assert.equal(result.runs[1]?.agent.username, "agent-beta");
  assert.equal(result.runs[1]?.fork.owner, "agent-beta");
  assert.equal(result.runs[1]?.pullRequest, null);
  assert.equal(result.runs[1]?.eval, null);

  const lineage = await service.getProjectLineage(details.project.id);
  assert.equal(lineage.forks.length, 3);
  assert.ok(lineage.events.some((event) => event.type === "project.agents_run"));
  assert.equal(lineage.events.filter((event) => event.type === "pull_request.created").length, 0);
});

test("autonomous agents continue on their existing forks across cycles", async () => {
  const repository = new InMemoryRepository();
  const forge = new MockGiteaForge({ suffixGenerator: () => "x9f3" });
  const service = new AgentHubService({ repository, forge });

  const coordinatorLogin = await service.login({ username: "coordinator" });
  const coordinator = await service.authenticate(coordinatorLogin.token);
  const details = await service.createProject(coordinator, { name: "Doom" });
  const input = {
    projectId: details.project.id,
    agents: [{ username: "agent-alpha" }, { username: "agent-beta" }]
  };

  const first = await service.runAgentsForProject(coordinator, input);
  const second = await service.runAgentsForProject(coordinator, input);

  assert.equal(second.runs[0]?.fork.id, first.runs[0]?.fork.id);
  assert.equal(second.runs[1]?.fork.id, first.runs[1]?.fork.id);
  assert.equal(second.runs[0]?.job.status, "queued");
  assert.equal(second.runs[1]?.job.status, "queued");
  assert.equal(second.runs[0]?.pullRequest, null);
  assert.equal(second.runs[1]?.pullRequest, null);

  const lineage = await service.getProjectLineage(details.project.id);
  assert.equal(lineage.forks.length, 3);
  assert.equal(lineage.events.filter((event) => event.type === "fork.reused").length, 2);
});

test("autonomous agents can choose from multiple projects", async () => {
  const repository = new InMemoryRepository();
  const forge = new MockGiteaForge({ suffixGenerator: () => "x9f3" });
  const service = new AgentHubService({ repository, forge });

  const coordinatorLogin = await service.login({ username: "coordinator" });
  const coordinator = await service.authenticate(coordinatorLogin.token);
  const doom = await service.createProject(coordinator, { name: "Doom" });
  const quake = await service.createProject(coordinator, { name: "Quake" });

  const result = await service.runAgents(coordinator, {
    projectIds: [doom.project.id, quake.project.id],
    agents: [{ username: "agent-alpha" }, { username: "agent-beta" }],
    cycle: 0
  });

  assert.equal(result.project, null);
  assert.equal(result.projects.length, 2);
  assert.ok([doom.project.id, quake.project.id].includes(result.runs[0]?.project.id ?? ""));
  assert.equal(result.runs[0]?.fork.owner, "agent-alpha");
  assert.ok([doom.project.id, quake.project.id].includes(result.runs[1]?.project.id ?? ""));
  assert.equal(result.runs[1]?.fork.owner, "agent-beta");
  assert.equal(result.runs[0]?.pullRequest, null);
  assert.equal(result.runs[1]?.pullRequest, null);
});
