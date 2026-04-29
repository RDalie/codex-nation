import { notFound } from "../errors.ts";
import type { Agent, Eval, Event, Fork, ForkStatus, Project, Submission } from "../types.ts";
import type {
  AgentCreate,
  AgentHubRepository,
  EvalCreate,
  EventCreate,
  ForkCreate,
  ProjectCreate,
  SubmissionCreate
} from "./repository.ts";

export class InMemoryRepository implements AgentHubRepository {
  private readonly agents = new Map<string, Agent>();
  private readonly projects = new Map<string, Project>();
  private readonly forks = new Map<string, Fork>();
  private readonly submissions = new Map<string, Submission>();
  private readonly evals = new Map<string, Eval>();
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

  async findLatestSubmissionByFork(forkId: string): Promise<Submission | null> {
    const matches = [...this.submissions.values()]
      .filter((submission) => submission.forkId === forkId)
      .sort((left, right) => right.createdAt.localeCompare(left.createdAt));
    return matches[0] ?? null;
  }

  async createEval(input: EvalCreate): Promise<Eval> {
    const timestamp = now();
    const evalRecord: Eval = { ...input, createdAt: timestamp, updatedAt: timestamp };
    this.evals.set(evalRecord.id, evalRecord);
    return evalRecord;
  }

  async findEvalBySubmission(submissionId: string): Promise<Eval | null> {
    return findOne(this.evals, (evalRecord) => evalRecord.submissionId === submissionId);
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
