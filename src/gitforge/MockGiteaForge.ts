import { createShortSuffix } from "../ids.ts";
import type { GitBundleFile, GitFile, GitForge, GitRepoRef } from "./GitForge.ts";

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
    this.writeFile(this.rootOwner, input.slug, "primer.md", "# Mock primer\n\nValid placeholder primer for MVP submission checks.\n");
    return this.repoRef(this.rootOwner, input.slug);
  }

  async createFork(input: {
    sourceOwner: string;
    sourceRepo: string;
    targetOwner: string;
  }): Promise<GitRepoRef> {
    const repo = `${input.sourceRepo}-${this.suffixGenerator()}`;
    this.copyRepo(input.sourceOwner, input.sourceRepo, input.targetOwner, repo);
    return this.repoRef(input.targetOwner, repo);
  }

  async createSubmissionSnapshot(input: {
    sourceRepo: string;
    targetOwner: string;
    files: GitBundleFile[];
  }): Promise<GitRepoRef> {
    const repo = `${input.sourceRepo}-sub-${this.suffixGenerator()}`;
    for (const file of input.files) {
      this.writeFile(input.targetOwner, repo, file.path, Buffer.from(file.contentBase64, "base64").toString("utf8"));
    }
    return this.repoRef(input.targetOwner, repo);
  }

  async getFile(input: { owner: string; repo: string; path: string }): Promise<GitFile | null> {
    const content = this.files.get(fileKey(input.owner, input.repo, input.path));
    return content === undefined ? null : { content };
  }

  private repoRef(owner: string, repo: string): GitRepoRef {
    return {
      owner,
      repo,
      cloneUrl: `ssh://git@${this.sshHost}:${this.sshPort}/${owner}/${repo}.git`
    };
  }

  private writeFile(owner: string, repo: string, path: string, content: string): void {
    this.files.set(fileKey(owner, repo, path), content);
  }

  private copyRepo(sourceOwner: string, sourceRepo: string, targetOwner: string, targetRepo: string): void {
    const prefix = `${sourceOwner}/${sourceRepo}/`;
    for (const [key, content] of this.files.entries()) {
      if (key.startsWith(prefix)) {
        this.files.set(`${targetOwner}/${targetRepo}/${key.slice(prefix.length)}`, content);
      }
    }
  }
}

function fileKey(owner: string, repo: string, path: string): string {
  return `${owner}/${repo}/${path}`;
}
