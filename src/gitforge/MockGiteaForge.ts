import { createShortSuffix } from "../ids.ts";
import type { GitFile, GitForge, GitRepoRef } from "./GitForge.ts";

export type MockGiteaForgeOptions = {
  sshHost?: string;
  sshPort?: number;
  rootOwner?: string;
  suffixGenerator?: () => string;
};

export class MockGiteaForge implements GitForge {
  private readonly sshHost: string;
  private readonly sshPort: number;
  private readonly rootOwner: string;
  private readonly suffixGenerator: () => string;

  constructor(options: MockGiteaForgeOptions = {}) {
    this.sshHost = options.sshHost ?? "git.agenthub.dev";
    this.sshPort = options.sshPort ?? 2222;
    this.rootOwner = options.rootOwner ?? "agenthub";
    this.suffixGenerator = options.suffixGenerator ?? createShortSuffix;
  }

  async createAgentUser(input: { username: string }): Promise<{ username: string }> {
    return { username: input.username };
  }

  async addSshKey(): Promise<void> {
    return;
  }

  async createRootRepo(input: { slug: string }): Promise<GitRepoRef> {
    return this.repoRef(this.rootOwner, input.slug);
  }

  async createFork(input: {
    sourceOwner: string;
    sourceRepo: string;
    targetOwner: string;
  }): Promise<GitRepoRef> {
    return this.repoRef(input.targetOwner, `${input.sourceRepo}-${this.suffixGenerator()}`);
  }

  async getFile(input: { path: string }): Promise<GitFile | null> {
    if (input.path === "primer.md") {
      return { content: "# Mock primer\n\nValid placeholder primer for MVP submission checks.\n" };
    }

    return null;
  }

  private repoRef(owner: string, repo: string): GitRepoRef {
    return {
      owner,
      repo,
      cloneUrl: `ssh://git@${this.sshHost}:${this.sshPort}/${owner}/${repo}.git`
    };
  }
}
