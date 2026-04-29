import { createShortSuffix } from "../ids.ts";
import type { GitFile, GitForge, GitPullRequestRef, GitRepoRef, GitWriteFileResult } from "./GitForge.ts";

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
  private readonly files = new Map<string, string>();
  private commitCounter = 0;
  private pullRequestCounter = 0;

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

  async getFile(input: { owner?: string; repo?: string; path: string; ref?: string }): Promise<GitFile | null> {
    if (input.owner && input.repo) {
      const content = this.files.get(this.fileKey(input.owner, input.repo, input.ref ?? "main", input.path));
      if (content !== undefined) {
        return { content };
      }
    }

    if (input.path === "primer.md") {
      return { content: "# Mock primer\n\nValid placeholder primer for MVP submission checks.\n" };
    }

    return null;
  }

  async writeFile(input: {
    owner: string;
    repo: string;
    path: string;
    content: string;
    targetUser: string;
    branch?: string;
  }): Promise<GitWriteFileResult> {
    const branch = input.branch ?? "main";
    this.files.set(this.fileKey(input.owner, input.repo, branch, input.path), input.content);
    const commitSha = `mock-commit-${++this.commitCounter}`;

    return {
      owner: input.owner,
      repo: input.repo,
      path: input.path,
      branch,
      commitSha,
      commitUrl: `https://${this.sshHost}/${input.owner}/${input.repo}/commit/${commitSha}`
    };
  }

  async createPullRequest(input: {
    targetOwner: string;
    targetRepo: string;
  }): Promise<GitPullRequestRef> {
    const number = ++this.pullRequestCounter;

    return {
      number,
      url: `https://${this.sshHost}/${input.targetOwner}/${input.targetRepo}/pulls/${number}`
    };
  }

  compareUrl(input: {
    sourceOwner: string;
    sourceBranch?: string;
    targetOwner: string;
    targetRepo: string;
    targetBranch?: string;
  }): string {
    return `https://${this.sshHost}/${input.targetOwner}/${input.targetRepo}/compare/${
      input.targetBranch ?? "main"
    }...${input.sourceOwner}:${input.sourceBranch ?? "main"}`;
  }

  private repoRef(owner: string, repo: string): GitRepoRef {
    return {
      owner,
      repo,
      cloneUrl: `ssh://git@${this.sshHost}:${this.sshPort}/${owner}/${repo}.git`
    };
  }

  private fileKey(owner: string, repo: string, branch: string, path: string): string {
    return `${owner}/${repo}@${branch}:${path}`;
  }
}
