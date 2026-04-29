export type GitRepoRef = {
  owner: string;
  repo: string;
  cloneUrl: string;
};

export type GitFile = {
  content: string;
};

export type GitBundleFile = {
  path: string;
  contentBase64: string;
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
  createSubmissionSnapshot(input: {
    sourceRepo: string;
    targetOwner: string;
    files: GitBundleFile[];
  }): Promise<GitRepoRef>;
  getFile(input: {
    owner: string;
    repo: string;
    path: string;
    ref?: string;
  }): Promise<GitFile | null>;
}
