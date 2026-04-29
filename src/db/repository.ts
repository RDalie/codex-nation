import type {
  Agent,
  Eval,
  Event,
  Fork,
  ForkStatus,
  Project,
  PullRequest,
  Submission,
  WorkJob,
  WorkJobStatus
} from "../types.ts";

export type AgentCreate = {
  id: string;
  username: string;
  tokenHash: string;
  giteaUsername: string;
};

export type ProjectCreate = {
  id: string;
  name: string;
  slug: string;
  rootOwner: string;
  rootRepo: string;
  createdByAgentId: string;
};

export type ForkCreate = {
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
};

export type SubmissionCreate = {
  id: string;
  forkId: string;
  commitSha: string | null;
  primerPath: string;
  status: string;
};

export type EvalCreate = {
  id: string;
  submissionId: string;
  status: Eval["status"];
  log: string;
  previewUrl: string | null;
};

export type EvalUpdate = {
  id: string;
  status: Eval["status"];
  log: string;
  previewUrl: string | null;
  completedAt: string | null;
};

export type PullRequestUpsert = {
  id: string;
  submissionId: string;
  url: string;
  number: number | null;
  status: PullRequest["status"];
};

export type EventCreate = {
  id: string;
  type: string;
  agentId: string | null;
  projectId: string | null;
  forkId: string | null;
  payload: Record<string, unknown>;
};

export type WorkJobCreate = {
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
};

export type WorkJobUpdate = {
  id: string;
  status: WorkJobStatus;
  commitSha?: string | null;
  result?: Record<string, unknown> | null;
  error?: string | null;
  startedAt?: string | null;
  completedAt?: string | null;
};

export interface AgentHubRepository {
  upsertAgent(input: AgentCreate): Promise<Agent>;
  findAgentById(id: string): Promise<Agent | null>;
  findAgentByUsername(username: string): Promise<Agent | null>;
  findAgentByTokenHash(tokenHash: string): Promise<Agent | null>;

  createProject(input: ProjectCreate): Promise<Project>;
  findProjectById(id: string): Promise<Project | null>;
  findProjectBySlug(slug: string): Promise<Project | null>;
  listProjects(): Promise<Project[]>;

  createFork(input: ForkCreate): Promise<Fork>;
  findForkById(id: string): Promise<Fork | null>;
  findRootFork(projectId: string): Promise<Fork | null>;
  findLatestForkByProjectAndAgent(projectId: string, agentId: string): Promise<Fork | null>;
  listForksByProject(projectId: string): Promise<Fork[]>;
  updateForkStatus(id: string, status: ForkStatus): Promise<Fork>;

  createSubmission(input: SubmissionCreate): Promise<Submission>;
  findSubmissionById(id: string): Promise<Submission | null>;
  findLatestSubmissionByFork(forkId: string): Promise<Submission | null>;
  updateSubmissionStatus(id: string, status: string): Promise<Submission>;

  createEval(input: EvalCreate): Promise<Eval>;
  findEvalById(id: string): Promise<Eval | null>;
  findEvalBySubmission(submissionId: string): Promise<Eval | null>;
  updateEval(input: EvalUpdate): Promise<Eval>;

  upsertPullRequest(input: PullRequestUpsert): Promise<PullRequest>;
  findPullRequestBySubmission(submissionId: string): Promise<PullRequest | null>;

  createWorkJob(input: WorkJobCreate): Promise<WorkJob>;
  findWorkJobById(id: string): Promise<WorkJob | null>;
  claimNextWorkJob(workerId: string): Promise<WorkJob | null>;
  updateWorkJob(input: WorkJobUpdate): Promise<WorkJob>;

  createEvent(input: EventCreate): Promise<Event>;
  listEventsByProject(projectId: string): Promise<Event[]>;
}
