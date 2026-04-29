export type ForkStatus = "working" | "submitted" | "evaluating" | "passed" | "failed";
export type EvalStatus = "queued" | "running" | "passed" | "failed";

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
  snapshotOwner: string | null;
  snapshotRepo: string | null;
  snapshotCloneUrl: string | null;
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
