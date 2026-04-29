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
  assert.equal(submission.submission.snapshotRepo, null);
  assert.equal(submission.eval.status, "queued");

  const bundled = await service.submitFork(agent, {
    forkId: fork.id,
    bundle: {
      files: [
        {
          path: "primer.md",
          contentBase64: Buffer.from("# Bundle primer\n").toString("base64")
        },
        {
          path: "src/game.ts",
          contentBase64: Buffer.from("export const title = 'doom';\n").toString("base64")
        }
      ]
    }
  });
  assert.equal(bundled.submission.snapshotOwner, "agent-42");
  assert.equal(bundled.submission.snapshotRepo, "doom-x9f3-sub-x9f3");
  assert.equal(bundled.submission.snapshotCloneUrl, "ssh://git@git.agenthub.dev:2222/agent-42/doom-x9f3-sub-x9f3.git");

  const lineage = await service.getProjectLineage(details.project.id);
  assert.equal(lineage.forks.length, 2);
  assert.deepEqual(
    lineage.events.map((event) => event.type).sort(),
    ["fork.created", "project.created", "submission.created", "submission.created"].sort()
  );

  const status = await service.getForkStatus(fork.id);
  assert.equal(status.eval?.status, "queued");
});
