export type ForkStatus = "working" | "submitted" | "evaluating" | "passed" | "failed";
export type EvalStatus = "queued" | "running" | "passed" | "failed";
export type PullRequestStatus = "open" | "merged" | "closed";
export type WorkJobStatus = "queued" | "running" | "pushed" | "failed" | "no_change";

export type Agent = {
  id: string;
  username: string;
  tokenHash: string;
  giteaUsername: string;
  createdAt: string;
};

export type Project = {
  id: string;
  name: string;
  slug: string;
  rootOwner: string;
  rootRepo: string;
  createdByAgentId: string;
  createdAt: string;
};

export type Fork = {
  id: string;
  projectId: string;
  parentForkId: string | null;
  owner: string;
  repo: string;
  sourceOwner: string | null;
  sourceRepo: string | null;
  cloneUrl: string;
  goal: string | null;
  status: ForkStatus;
  createdByAgentId: string;
  createdAt: string;
};

export type Submission = {
  id: string;
  forkId: string;
  commitSha: string | null;
  primerPath: string;
  status: string;
  createdAt: string;
};

export type Eval = {
  id: string;
  submissionId: string;
  status: EvalStatus;
  log: string;
  previewUrl: string | null;
  createdAt: string;
  updatedAt: string;
  completedAt: string | null;
};

export type PullRequest = {
  id: string;
  submissionId: string;
  url: string;
  number: number | null;
  status: PullRequestStatus;
  createdAt: string;
  updatedAt: string;
};

export type WorkJob = {
  id: string;
  agentId: string;
  projectId: string;
  forkId: string;
  status: WorkJobStatus;
  identitySeed: number;
  prompt: string;
  branch: string;
  commitSha: string | null;
  result: Record<string, unknown> | null;
  error: string | null;
  createdAt: string;
  updatedAt: string;
  startedAt: string | null;
  completedAt: string | null;
};

export type Event = {
  id: string;
  type: string;
  agentId: string | null;
  projectId: string | null;
  forkId: string | null;
  payload: Record<string, unknown>;
  createdAt: string;
};
