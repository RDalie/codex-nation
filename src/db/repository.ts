import type { Agent, Eval, Event, Fork, ForkStatus, Project, Submission } from "../types.ts";

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

export type EventCreate = {
  id: string;
  type: string;
  agentId: string | null;
  projectId: string | null;
  forkId: string | null;
  payload: Record<string, unknown>;
};

export interface AgentHubRepository {
  upsertAgent(input: AgentCreate): Promise<Agent>;
  findAgentByUsername(username: string): Promise<Agent | null>;
  findAgentByTokenHash(tokenHash: string): Promise<Agent | null>;

  createProject(input: ProjectCreate): Promise<Project>;
  findProjectById(id: string): Promise<Project | null>;
  findProjectBySlug(slug: string): Promise<Project | null>;

  createFork(input: ForkCreate): Promise<Fork>;
  findForkById(id: string): Promise<Fork | null>;
  findRootFork(projectId: string): Promise<Fork | null>;
  listForksByProject(projectId: string): Promise<Fork[]>;
  updateForkStatus(id: string, status: ForkStatus): Promise<Fork>;

  createSubmission(input: SubmissionCreate): Promise<Submission>;
  findLatestSubmissionByFork(forkId: string): Promise<Submission | null>;

  createEval(input: EvalCreate): Promise<Eval>;
  findEvalBySubmission(submissionId: string): Promise<Eval | null>;

  createEvent(input: EventCreate): Promise<Event>;
  listEventsByProject(projectId: string): Promise<Event[]>;
}
