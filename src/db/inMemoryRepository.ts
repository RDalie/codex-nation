import { notFound } from "../errors.ts";
import type { Agent, Eval, Event, Fork, ForkStatus, Project, PullRequest, Submission, WorkJob } from "../types.ts";
import type {
  AgentCreate,
  AgentHubRepository,
  EvalCreate,
  EvalUpdate,
  EventCreate,
  ForkCreate,
  ProjectCreate,
  PullRequestUpsert,
  SubmissionCreate,
  WorkJobCreate,
  WorkJobUpdate
} from "./repository.ts";

export class InMemoryRepository implements AgentHubRepository {
  private readonly agents = new Map<string, Agent>();
  private readonly projects = new Map<string, Project>();
  private readonly forks = new Map<string, Fork>();
  private readonly submissions = new Map<string, Submission>();
  private readonly evals = new Map<string, Eval>();
  private readonly pullRequests = new Map<string, PullRequest>();
  private readonly workJobs = new Map<string, WorkJob>();
  private readonly events = new Map<string, Event>();

  async upsertAgent(input: AgentCreate): Promise<Agent> {
    const existing = await this.findAgentByUsername(input.username);
    const agent: Agent = {
      ...input,
      id: existing?.id ?? input.id,
      createdAt: existing?.createdAt ?? now()
    };
    this.agents.set(agent.id, agent);
    return agent;
  }

  async findAgentByUsername(username: string): Promise<Agent | null> {
    return findOne(this.agents, (agent) => agent.username === username);
  }

  async findAgentById(id: string): Promise<Agent | null> {
    return this.agents.get(id) ?? null;
  }

  async findAgentByTokenHash(tokenHash: string): Promise<Agent | null> {
    return findOne(this.agents, (agent) => agent.tokenHash === tokenHash);
  }

  async createProject(input: ProjectCreate): Promise<Project> {
    const project: Project = { ...input, createdAt: now() };
    this.projects.set(project.id, project);
    return project;
  }

  async findProjectById(id: string): Promise<Project | null> {
    return this.projects.get(id) ?? null;
  }

  async findProjectBySlug(slug: string): Promise<Project | null> {
    return findOne(this.projects, (project) => project.slug === slug);
  }

  async listProjects(): Promise<Project[]> {
    return [...this.projects.values()].sort((left, right) => right.createdAt.localeCompare(left.createdAt));
  }

  async createFork(input: ForkCreate): Promise<Fork> {
    const fork: Fork = { ...input, createdAt: now() };
    this.forks.set(fork.id, fork);
    return fork;
  }

  async findForkById(id: string): Promise<Fork | null> {
    return this.forks.get(id) ?? null;
  }

  async findRootFork(projectId: string): Promise<Fork | null> {
    return findOne(this.forks, (fork) => fork.projectId === projectId && fork.parentForkId === null);
  }

  async findLatestForkByProjectAndAgent(projectId: string, agentId: string): Promise<Fork | null> {
    const matches = [...this.forks.values()]
      .filter((fork) => fork.projectId === projectId && fork.createdByAgentId === agentId && fork.parentForkId !== null)
      .sort((left, right) => right.createdAt.localeCompare(left.createdAt));
    return matches[0] ?? null;
  }

  async listForksByProject(projectId: string): Promise<Fork[]> {
    return [...this.forks.values()]
      .filter((fork) => fork.projectId === projectId)
      .sort((left, right) => left.createdAt.localeCompare(right.createdAt));
  }

  async updateForkStatus(id: string, status: ForkStatus): Promise<Fork> {
    const fork = this.forks.get(id);
    if (!fork) {
      throw notFound("Fork");
    }

    const updated: Fork = { ...fork, status };
    this.forks.set(id, updated);
    return updated;
  }

  async createSubmission(input: SubmissionCreate): Promise<Submission> {
    const submission: Submission = { ...input, createdAt: now() };
    this.submissions.set(submission.id, submission);
    return submission;
  }

  async findSubmissionById(id: string): Promise<Submission | null> {
    return this.submissions.get(id) ?? null;
  }

  async findLatestSubmissionByFork(forkId: string): Promise<Submission | null> {
    const matches = [...this.submissions.values()]
      .filter((submission) => submission.forkId === forkId)
      .sort((left, right) => right.createdAt.localeCompare(left.createdAt));
    return matches[0] ?? null;
  }

  async updateSubmissionStatus(id: string, status: string): Promise<Submission> {
    const submission = this.submissions.get(id);
    if (!submission) {
      throw notFound("Submission");
    }

    const updated: Submission = { ...submission, status };
    this.submissions.set(id, updated);
    return updated;
  }

  async createEval(input: EvalCreate): Promise<Eval> {
    const timestamp = now();
    const evalRecord: Eval = { ...input, createdAt: timestamp, updatedAt: timestamp, completedAt: null };
    this.evals.set(evalRecord.id, evalRecord);
    return evalRecord;
  }

  async findEvalById(id: string): Promise<Eval | null> {
    return this.evals.get(id) ?? null;
  }

  async findEvalBySubmission(submissionId: string): Promise<Eval | null> {
    return findOne(this.evals, (evalRecord) => evalRecord.submissionId === submissionId);
  }

  async updateEval(input: EvalUpdate): Promise<Eval> {
    const evalRecord = this.evals.get(input.id);
    if (!evalRecord) {
      throw notFound("Eval");
    }

    const updated: Eval = {
      ...evalRecord,
      status: input.status,
      log: input.log,
      previewUrl: input.previewUrl,
      completedAt: input.completedAt,
      updatedAt: now()
    };
    this.evals.set(input.id, updated);
    return updated;
  }

  async upsertPullRequest(input: PullRequestUpsert): Promise<PullRequest> {
    const existing = await this.findPullRequestBySubmission(input.submissionId);
    const timestamp = now();
    const pullRequest: PullRequest = {
      ...input,
      id: existing?.id ?? input.id,
      createdAt: existing?.createdAt ?? timestamp,
      updatedAt: timestamp
    };
    this.pullRequests.set(pullRequest.id, pullRequest);
    return pullRequest;
  }

  async findPullRequestBySubmission(submissionId: string): Promise<PullRequest | null> {
    return findOne(this.pullRequests, (pullRequest) => pullRequest.submissionId === submissionId);
  }

  async createWorkJob(input: WorkJobCreate): Promise<WorkJob> {
    const timestamp = now();
    const job: WorkJob = {
      ...input,
      createdAt: timestamp,
      updatedAt: timestamp,
      startedAt: null,
      completedAt: null
    };
    this.workJobs.set(job.id, job);
    return job;
  }

  async findWorkJobById(id: string): Promise<WorkJob | null> {
    return this.workJobs.get(id) ?? null;
  }

  async claimNextWorkJob(): Promise<WorkJob | null> {
    const job = [...this.workJobs.values()]
      .filter((candidate) => candidate.status === "queued")
      .sort((left, right) => left.createdAt.localeCompare(right.createdAt))[0];
    if (!job) {
      return null;
    }

    return this.updateWorkJob({
      id: job.id,
      status: "running",
      startedAt: now(),
      error: null
    });
  }

  async updateWorkJob(input: WorkJobUpdate): Promise<WorkJob> {
    const job = this.workJobs.get(input.id);
    if (!job) {
      throw notFound("Work job");
    }

    const updated: WorkJob = {
      ...job,
      status: input.status,
      commitSha: input.commitSha === undefined ? job.commitSha : input.commitSha,
      result: input.result === undefined ? job.result : input.result,
      error: input.error === undefined ? job.error : input.error,
      startedAt: input.startedAt === undefined ? job.startedAt : input.startedAt,
      completedAt: input.completedAt === undefined ? job.completedAt : input.completedAt,
      updatedAt: now()
    };
    this.workJobs.set(job.id, updated);
    return updated;
  }

  async createEvent(input: EventCreate): Promise<Event> {
    const event: Event = { ...input, createdAt: now() };
    this.events.set(event.id, event);
    return event;
  }

  async listEventsByProject(projectId: string): Promise<Event[]> {
    return [...this.events.values()]
      .filter((event) => event.projectId === projectId)
      .sort((left, right) => right.createdAt.localeCompare(left.createdAt));
  }
}

function findOne<T>(map: Map<string, T>, predicate: (value: T) => boolean): T | null {
  for (const value of map.values()) {
    if (predicate(value)) {
      return value;
    }
  }

  return null;
}

function now(): string {
  return new Date().toISOString();
}
