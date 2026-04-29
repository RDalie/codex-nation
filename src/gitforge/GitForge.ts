export type GitRepoRef = {
  owner: string;
  repo: string;
  cloneUrl: string;
};

export type GitFile = {
  content: string;
};

export type GitWriteFileResult = {
  owner: string;
  repo: string;
  path: string;
  branch: string;
  commitSha: string | null;
  commitUrl: string | null;
};

export type GitPullRequestRef = {
  number: number;
  url: string;
};

export interface GitForge {
  createAgentUser(input: { username: string }): Promise<{ username: string }>;
  addSshKey(input: { username: string; title: string; key: string }): Promise<void>;
  createRootRepo(input: { name: string; slug: string }): Promise<GitRepoRef>;
  createFork(input: {
    sourceOwner: string;
    sourceRepo: string;
    targetOwner: string;
  }): Promise<GitRepoRef>;
  getFile(input: {
    owner: string;
    repo: string;
    path: string;
    ref?: string;
  }): Promise<GitFile | null>;
  writeFile(input: {
    owner: string;
    repo: string;
    path: string;
    content: string;
    message: string;
    targetUser: string;
    branch?: string;
  }): Promise<GitWriteFileResult>;
  createPullRequest(input: {
    sourceOwner: string;
    sourceRepo: string;
    targetOwner: string;
    targetRepo: string;
    title: string;
    targetUser: string;
    body?: string;
    sourceBranch?: string;
    targetBranch?: string;
  }): Promise<GitPullRequestRef>;
  compareUrl(input: {
    sourceOwner: string;
    sourceBranch?: string;
    targetOwner: string;
    targetRepo: string;
    targetBranch?: string;
  }): string;
}
