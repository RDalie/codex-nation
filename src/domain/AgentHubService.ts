import type { Agent, Eval, EvalStatus, Event, Fork, Project, PullRequest, Submission, WorkJob } from "../types.ts";
import type { AgentHubRepository } from "../db/repository.ts";
import { badRequest, forbidden, notFound, unauthorized } from "../errors.ts";
import type { GitForge, GitWriteFileResult } from "../gitforge/GitForge.ts";
import { createId, createShortSuffix, createToken, slugify } from "../ids.ts";
import { hashToken } from "../security.ts";

export type LoginResult = {
  agentId: string;
  username: string;
  token: string;
};

export type ProjectDetails = {
  project: Project;
  rootFork: Fork | null;
  forks: Fork[];
  events: Event[];
};

export type ForkStatusDetails = {
  fork: Fork;
  submission: Submission | null;
  eval: Eval | null;
  pullRequest: PullRequest | null;
};

export type PullRequestDetails = {
  fork: Fork;
  submission: Submission;
  pullRequest: PullRequest;
};

export type EvalWorkerDetails = {
  fork: Fork;
  submission: Submission;
  eval: Eval;
};

export type ForkWorkInstructions = {
  fork: Fork;
  project: Pick<Project, "id" | "slug" | "name">;
  branch: string;
  worktree: string;
};

export type ForkWorkResult = {
  fork: Fork;
  work: GitWriteFileResult;
  steps: Array<{ name: string; status: "completed"; detail: string }>;
};

export type ForkCompareResult = {
  fork: Fork;
  base: { owner: string; repo: string; branch: string };
  head: { owner: string; repo: string; branch: string };
  ahead: number | null;
  behind: number | null;
  url: string;
  compareUrl: string;
  pullRequest: PullRequest | null;
};

export type PullRequestResult = {
  fork: Fork;
  submission: Submission;
  eval: Eval | null;
  pullRequest: PullRequest;
  compareUrl: string;
};

export type AutonomousAgentRun = {
  agent: {
    agentId: string;
    username: string;
  };
  identitySeed: number;
  project: Project;
  fork: Fork;
  job: WorkJob;
  work: GitWriteFileResult | null;
  steps: ForkWorkResult["steps"] | [];
  submission: Submission | null;
  eval: Eval | null;
  pullRequest: PullRequest | null;
  compareUrl: string | null;
};

export type AutonomousAgentRunResult = {
  project: Project | null;
  projects: Project[];
  coordinator: {
    agentId: string;
    username: string;
  };
  runs: AutonomousAgentRun[];
};

type AutonomousAgentInput = {
  username?: string;
  goal?: string;
  content?: string;
  projectId?: string;
};

type AutonomousRunInput = {
  projectId?: string;
  projectIds?: string[];
  agents?: AutonomousAgentInput[];
  openPullRequests?: boolean;
  runEval?: boolean;
  cycle?: number;
};

export class AgentHubService {
  private readonly repository: AgentHubRepository;
  private readonly forge: GitForge;

  constructor(input: { repository: AgentHubRepository; forge: GitForge }) {
    this.repository = input.repository;
    this.forge = input.forge;
  }

  async login(input: { username?: string }): Promise<LoginResult> {
    const username = cleanUsername(input.username) ?? `agent-${createShortSuffix()}`;
    const token = createToken();
    const forgeUser = await this.forge.createAgentUser({ username });
    const existing = await this.repository.findAgentByUsername(username);
    const agent = await this.repository.upsertAgent({
      id: existing?.id ?? createId("agt"),
      username,
      tokenHash: hashToken(token),
      giteaUsername: forgeUser.username
    });

    await this.repository.createEvent({
      id: createId("evt"),
      type: "agent.login",
      agentId: agent.id,
      projectId: null,
      forkId: null,
      payload: { username: agent.username }
    });

    return {
      agentId: agent.id,
      username: agent.username,
      token
    };
  }

  async authenticate(token: string | null): Promise<Agent> {
    if (!token) {
      throw unauthorized();
    }

    const agent = await this.repository.findAgentByTokenHash(hashToken(token));
    if (!agent) {
      throw unauthorized();
    }

    return agent;
  }

  async listProjects(): Promise<{ projects: Project[] }> {
    return { projects: await this.repository.listProjects() };
  }

  async getWorkJob(_agent: Agent, jobId: string): Promise<WorkJob> {
    const job = await this.repository.findWorkJobById(jobId);
    if (!job) {
      throw notFound("Work job");
    }

    return job;
  }

  async runAgentsForProject(
    coordinator: Agent,
    input: AutonomousRunInput
  ): Promise<AutonomousAgentRunResult> {
    return this.runAgents(coordinator, input);
  }

  async runAgents(coordinator: Agent, input: AutonomousRunInput): Promise<AutonomousAgentRunResult> {
    const projects = await this.readAutonomousProjectPool(input);
    const singleProject = projects.length === 1 ? projects[0]! : null;
    const openPullRequests = input.openPullRequests === true;
    const runEval = input.runEval === true;
    if (openPullRequests || runEval) {
      throw badRequest("Autonomous worker runs enqueue push jobs first; open PRs after a job has pushed commits");
    }

    const agentInputs: AutonomousAgentInput[] = input.agents?.length ? input.agents : [{}, {}];
    const runs: AutonomousAgentRun[] = [];
    const cycle = Number.isInteger(input.cycle) ? input.cycle ?? 0 : 0;

    for (const [index, agentInput] of agentInputs.entries()) {
      const loginInput: { username?: string } = {};
      if (agentInput.username !== undefined) {
        loginInput.username = agentInput.username;
      }
      const login = await this.login(loginInput);
      const agent = await this.authenticate(login.token);
      const identitySeed = createAutonomousIdentitySeed(agent.username);
      const project = await this.chooseAutonomousProject(projects, {
        agentInput,
        agent,
        identitySeed,
        cycle,
        index
      });
      await this.ensureProjectRootRepository(project);
      const fork = await this.findOrCreateAutonomousFork(agent, {
        project,
        goal: agentInput.goal?.trim() || `Autonomous work by ${agent.username}`
      });
      const prompt = createAutonomousWorkerPrompt({
        agent,
        project,
        fork,
        identitySeed,
        cycle,
        goal: agentInput.goal?.trim() || null
      });
      const job = await this.repository.createWorkJob({
        id: createId("job"),
        agentId: agent.id,
        projectId: project.id,
        forkId: fork.id,
        status: "queued",
        identitySeed,
        prompt,
        branch: "main",
        commitSha: null,
        result: null,
        error: null
      });

      await this.repository.createEvent({
        id: createId("evt"),
        type: "work_job.queued",
        agentId: agent.id,
        projectId: project.id,
        forkId: fork.id,
        payload: {
          jobId: job.id,
          fork: `${fork.owner}/${fork.repo}`,
          identitySeed
        }
      });

      runs.push({
        agent: {
          agentId: login.agentId,
          username: login.username
        },
        identitySeed,
        project,
        fork,
        job,
        work: null,
        steps: [],
        submission: null,
        eval: null,
        pullRequest: null,
        compareUrl: null
      });
    }

    await this.repository.createEvent({
      id: createId("evt"),
      type: singleProject ? "project.agents_run" : "agents.run",
      agentId: coordinator.id,
      projectId: singleProject?.id ?? null,
      forkId: null,
      payload: {
        coordinator: coordinator.username,
        projects: projects.map((project) => `${project.rootOwner}/${project.rootRepo}`),
        agents: runs.map((run) => run.agent.username),
        forks: runs.map((run) => `${run.fork.owner}/${run.fork.repo}`),
        openPullRequests,
        runEval
      }
    });

    return {
      project: singleProject,
      projects,
      coordinator: {
        agentId: coordinator.id,
        username: coordinator.username
      },
      runs
    };
  }

  async createProject(agent: Agent, input: { name?: string; slug?: string; goal?: string }): Promise<ProjectDetails> {
    const name = input.name?.trim();
    if (!name) {
      throw badRequest("Project name is required");
    }

    const slug = slugify(input.slug ?? name);
    if (!slug) {
      throw badRequest("Project slug must contain at least one letter or number");
    }

    const existing = await this.repository.findProjectBySlug(slug);
    if (existing) {
      throw badRequest(`Project slug '${slug}' already exists`);
    }

    const rootRepo = await this.forge.createRootRepo({ name, slug });
    const project = await this.repository.createProject({
      id: createId("prj"),
      name,
      slug,
      rootOwner: rootRepo.owner,
      rootRepo: rootRepo.repo,
      createdByAgentId: agent.id
    });

    const rootFork = await this.repository.createFork({
      id: createId("frk"),
      projectId: project.id,
      parentForkId: null,
      owner: rootRepo.owner,
      repo: rootRepo.repo,
      sourceOwner: null,
      sourceRepo: null,
      cloneUrl: rootRepo.cloneUrl,
      goal: input.goal?.trim() || null,
      status: "working",
      createdByAgentId: agent.id
    });

    await this.repository.createEvent({
      id: createId("evt"),
      type: "project.created",
      agentId: agent.id,
      projectId: project.id,
      forkId: rootFork.id,
      payload: {
        project: `${project.rootOwner}/${project.rootRepo}`,
        cloneUrl: rootFork.cloneUrl
      }
    });

    return this.getProjectDetails(project.id);
  }

  async createFork(
    agent: Agent,
    input: { projectId?: string; parentForkId?: string; goal?: string }
  ): Promise<Fork> {
    if (!input.projectId?.trim()) {
      throw badRequest("Project id is required");
    }

    const project = await this.repository.findProjectById(input.projectId);
    if (!project) {
      throw notFound("Project");
    }

    const parentFork = input.parentForkId
      ? await this.repository.findForkById(input.parentForkId)
      : await this.repository.findRootFork(project.id);

    if (!parentFork || parentFork.projectId !== project.id) {
      throw notFound("Parent fork");
    }

    const forgeFork = await this.forge.createFork({
      sourceOwner: parentFork.owner,
      sourceRepo: parentFork.repo,
      targetOwner: agent.giteaUsername
    });

    const fork = await this.repository.createFork({
      id: createId("frk"),
      projectId: project.id,
      parentForkId: parentFork.id,
      owner: forgeFork.owner,
      repo: forgeFork.repo,
      sourceOwner: parentFork.owner,
      sourceRepo: parentFork.repo,
      cloneUrl: forgeFork.cloneUrl,
      goal: input.goal?.trim() || null,
      status: "working",
      createdByAgentId: agent.id
    });

    await this.repository.createEvent({
      id: createId("evt"),
      type: "fork.created",
      agentId: agent.id,
      projectId: project.id,
      forkId: fork.id,
      payload: {
        from: `${parentFork.owner}/${parentFork.repo}`,
        to: `${fork.owner}/${fork.repo}`,
        cloneUrl: fork.cloneUrl
      }
    });

    return fork;
  }

  async getForkWork(agent: Agent, input: { forkId?: string }): Promise<ForkWorkInstructions> {
    const { fork, project } = await this.readForkProject(input.forkId);
    ensureForkOwner(agent, fork);

    return {
      fork,
      project: {
        id: project.id,
        slug: project.slug,
        name: project.name
      },
      branch: "main",
      worktree: fork.repo
    };
  }

  async submitFork(
    agent: Agent,
    input: { forkId?: string; commitSha?: string; primerPath?: string }
  ): Promise<{ fork: Fork; submission: Submission; eval: Eval }> {
    if (!input.forkId?.trim()) {
      throw badRequest("Fork id is required");
    }

    const fork = await this.repository.findForkById(input.forkId);
    if (!fork) {
      throw notFound("Fork");
    }

    if (fork.createdByAgentId !== agent.id) {
      throw forbidden("Only the fork owner can submit this fork");
    }

    return this.queueSubmission(agent, fork, input);
  }

  async performForkWork(
    agent: Agent,
    input: { forkId?: string; path?: string; content?: string; message?: string }
  ): Promise<ForkWorkResult> {
    const fork = await this.requireOwnedFork(agent, input.forkId);
    const project = await this.requireProject(fork.projectId);
    const path = input.path?.trim() || "agenthub-work.md";
    const content = input.content ?? defaultWorkContent({ agent, fork, project, path });
    const message = input.message?.trim() || `AgentHub work by ${agent.username}`;

    const work = await this.forge.writeFile({
      owner: fork.owner,
      repo: fork.repo,
      path,
      content,
      message,
      targetUser: agent.giteaUsername,
      branch: "main"
    });
    const updatedFork = fork.status === "working" ? fork : await this.repository.updateForkStatus(fork.id, "working");

    await this.repository.createEvent({
      id: createId("evt"),
      type: "fork.work_committed",
      agentId: agent.id,
      projectId: fork.projectId,
      forkId: fork.id,
      payload: {
        fork: `${fork.owner}/${fork.repo}`,
        path: work.path,
        branch: work.branch,
        commitSha: work.commitSha,
        commitUrl: work.commitUrl
      }
    });

    return {
      fork: updatedFork,
      work,
      steps: [
        { name: "clone fork", status: "completed", detail: fork.cloneUrl },
        { name: "edit files", status: "completed", detail: work.path },
        { name: "commit code", status: "completed", detail: work.commitSha ?? "created by Gitea" },
        { name: "push to Gitea", status: "completed", detail: `${work.owner}/${work.repo}@${work.branch}` }
      ]
    };
  }

  async compareFork(forkId: string): Promise<ForkCompareResult> {
    if (!forkId.trim()) {
      throw badRequest("Fork id is required");
    }

    const fork = await this.repository.findForkById(forkId);
    if (!fork) {
      throw notFound("Fork");
    }

    const rootFork = await this.requireRootFork(fork.projectId);
    const pullRequest = await this.findLatestPullRequestByFork(fork.id);
    const compareUrl = this.forge.compareUrl({
      sourceOwner: fork.owner,
      sourceBranch: "main",
      targetOwner: rootFork.owner,
      targetRepo: rootFork.repo,
      targetBranch: "main"
    });

    return {
      fork,
      base: { owner: rootFork.owner, repo: rootFork.repo, branch: "main" },
      head: { owner: fork.owner, repo: fork.repo, branch: "main" },
      ahead: null,
      behind: null,
      url: compareUrl,
      compareUrl,
      pullRequest
    };
  }

  async createPullRequestForFork(
    agent: Agent,
    input: { forkId?: string; title?: string; body?: string }
  ): Promise<PullRequestResult> {
    const fork = await this.requireOwnedFork(agent, input.forkId);
    const rootFork = await this.requireRootFork(fork.projectId);
    const queued = await this.ensureQueuedSubmission(agent, fork);
    const compare = await this.compareFork(fork.id);
    const existingPullRequest = await this.repository.findPullRequestBySubmission(queued.submission.id);
    if (existingPullRequest) {
      return {
        fork,
        submission: queued.submission,
        eval: queued.eval,
        pullRequest: existingPullRequest,
        compareUrl: compare.compareUrl
      };
    }

    const title = input.title?.trim() || `AgentHub work from ${agent.username}`;
    const body =
      input.body?.trim() ||
      [
        `Agent: ${agent.username}`,
        `Fork: ${fork.owner}/${fork.repo}`,
        `Goal: ${fork.goal ?? "No goal recorded"}`,
        `Fork ID: ${fork.id}`
      ].join("\n");

    const created = await this.forge.createPullRequest({
      sourceOwner: fork.owner,
      sourceRepo: fork.repo,
      sourceBranch: "main",
      targetOwner: rootFork.owner,
      targetRepo: rootFork.repo,
      targetBranch: "main",
      title,
      body,
      targetUser: agent.giteaUsername
    });

    const pullRequest = await this.repository.upsertPullRequest({
      id: createId("pr"),
      submissionId: queued.submission.id,
      url: created.url,
      number: created.number,
      status: "open"
    });

    await this.repository.createEvent({
      id: createId("evt"),
      type: "pull_request.created",
      agentId: agent.id,
      projectId: fork.projectId,
      forkId: fork.id,
      payload: {
        fork: `${fork.owner}/${fork.repo}`,
        target: `${rootFork.owner}/${rootFork.repo}`,
        number: pullRequest.number,
        url: pullRequest.url,
        compareUrl: compare.compareUrl
      }
    });

    return {
      fork,
      submission: queued.submission,
      eval: queued.eval,
      pullRequest,
      compareUrl: compare.compareUrl
    };
  }

  async runForkEval(
    agent: Agent,
    input: { forkId?: string; workPath?: string }
  ): Promise<{ fork: Fork; submission: Submission; eval: Eval; pullRequest: PullRequest | null }> {
    const fork = await this.requireOwnedFork(agent, input.forkId);
    const queued = await this.ensureQueuedSubmission(agent, fork);
    await this.repository.updateForkStatus(fork.id, "evaluating");

    const running = await this.repository.updateEval({
      id: queued.eval.id,
      status: "running",
      log: "AgentHub eval worker started.",
      previewUrl: null,
      completedAt: null
    });

    const workPath = input.workPath?.trim() || "agenthub-work.md";
    const [workFile, pullRequest] = await Promise.all([
      this.forge.getFile({ owner: fork.owner, repo: fork.repo, path: workPath }),
      this.findLatestPullRequestByFork(fork.id)
    ]);
    const passed = Boolean(workFile && pullRequest);
    const finalStatus = passed ? "passed" : "failed";
    const log = passed
      ? `Eval passed: found ${workPath} and pull request ${pullRequest?.url}.`
      : `Eval failed: ${workFile ? "found work file" : `missing ${workPath}`}; ${
          pullRequest ? "found pull request" : "missing pull request"
        }.`;

    const [updatedFork, submission, evalRecord] = await Promise.all([
      this.repository.updateForkStatus(fork.id, finalStatus),
      this.repository.updateSubmissionStatus(queued.submission.id, finalStatus),
      this.repository.updateEval({
        id: running.id,
        status: finalStatus,
        log,
        previewUrl: pullRequest?.url ?? null,
        completedAt: new Date().toISOString()
      })
    ]);

    await this.repository.createEvent({
      id: createId("evt"),
      type: "eval.completed",
      agentId: agent.id,
      projectId: fork.projectId,
      forkId: fork.id,
      payload: {
        fork: `${fork.owner}/${fork.repo}`,
        status: finalStatus,
        workPath,
        pullRequestUrl: pullRequest?.url ?? null
      }
    });

    return { fork: updatedFork, submission, eval: evalRecord, pullRequest };
  }

  async recordPullRequest(
    agent: Agent,
    input: { submissionId?: string; url?: string; number?: number | null }
  ): Promise<PullRequestDetails> {
    const submissionId = input.submissionId?.trim();
    if (!submissionId) {
      throw badRequest("Submission id is required");
    }

    const submission = await this.repository.findSubmissionById(submissionId);
    if (!submission) {
      throw notFound("Submission");
    }

    const fork = await this.repository.findForkById(submission.forkId);
    if (!fork) {
      throw notFound("Fork");
    }

    if (fork.createdByAgentId !== agent.id) {
      throw forbidden("Only the fork owner can attach a pull request to this submission");
    }

    const pullRequest = await this.repository.upsertPullRequest({
      id: createId("pr"),
      submissionId: submission.id,
      url: cleanHttpUrl(input.url, "Pull request URL"),
      number: cleanPositiveInteger(input.number, "Pull request number"),
      status: "open"
    });

    await this.repository.createEvent({
      id: createId("evt"),
      type: "pull_request.recorded",
      agentId: agent.id,
      projectId: fork.projectId,
      forkId: fork.id,
      payload: {
        submissionId: submission.id,
        url: pullRequest.url,
        number: pullRequest.number
      }
    });

    return { fork, submission, pullRequest };
  }

  async startEval(input: { evalId?: string }): Promise<EvalWorkerDetails> {
    const context = await this.readEvalContext(input.evalId);
    if (context.eval.status === "passed" || context.eval.status === "failed") {
      throw badRequest("Completed evals cannot be started");
    }

    const evalRecord = await this.repository.updateEval({
      id: context.eval.id,
      status: "running",
      log: context.eval.log || "Running evaluation.",
      previewUrl: context.eval.previewUrl,
      completedAt: null
    });
    const submission = await this.repository.updateSubmissionStatus(context.submission.id, "running");
    const fork = await this.repository.updateForkStatus(context.fork.id, "evaluating");

    await this.repository.createEvent({
      id: createId("evt"),
      type: "eval.started",
      agentId: null,
      projectId: fork.projectId,
      forkId: fork.id,
      payload: {
        submissionId: submission.id,
        evalId: evalRecord.id
      }
    });

    return { fork, submission, eval: evalRecord };
  }

  async completeEval(input: {
    evalId?: string;
    status?: EvalStatus;
    log?: string;
    previewUrl?: string | null;
  }): Promise<EvalWorkerDetails> {
    const status = input.status;
    if (status !== "passed" && status !== "failed") {
      throw badRequest("Completed eval status must be passed or failed");
    }

    const context = await this.readEvalContext(input.evalId);
    const previewUrl =
      input.previewUrl === undefined
        ? context.eval.previewUrl
        : cleanOptionalHttpUrl(input.previewUrl, "Preview URL");
    const evalRecord = await this.repository.updateEval({
      id: context.eval.id,
      status,
      log: input.log?.trim() || context.eval.log,
      previewUrl,
      completedAt: new Date().toISOString()
    });
    const submission = await this.repository.updateSubmissionStatus(context.submission.id, status);
    const fork = await this.repository.updateForkStatus(context.fork.id, status);

    await this.repository.createEvent({
      id: createId("evt"),
      type: "eval.completed",
      agentId: null,
      projectId: fork.projectId,
      forkId: fork.id,
      payload: {
        submissionId: submission.id,
        evalId: evalRecord.id,
        status: evalRecord.status,
        previewUrl: evalRecord.previewUrl
      }
    });

    return { fork, submission, eval: evalRecord };
  }

  async getProjectDetails(projectId: string): Promise<ProjectDetails> {
    const project = await this.repository.findProjectById(projectId);
    if (!project) {
      throw notFound("Project");
    }

    const [rootFork, forks, events] = await Promise.all([
      this.repository.findRootFork(project.id),
      this.repository.listForksByProject(project.id),
      this.repository.listEventsByProject(project.id)
    ]);

    return { project, rootFork, forks, events };
  }

  async getProjectLineage(projectId: string): Promise<ProjectDetails> {
    return this.getProjectDetails(projectId);
  }

  async getForkStatus(forkId: string): Promise<ForkStatusDetails> {
    const fork = await this.repository.findForkById(forkId);
    if (!fork) {
      throw notFound("Fork");
    }

    const submission = await this.repository.findLatestSubmissionByFork(fork.id);
    const [evalRecord, pullRequest] = submission
      ? await Promise.all([
          this.repository.findEvalBySubmission(submission.id),
          this.repository.findPullRequestBySubmission(submission.id)
        ])
      : [null, null];

    return { fork, submission, eval: evalRecord, pullRequest };
  }

  private async requireOwnedFork(agent: Agent, forkId: string | undefined): Promise<Fork> {
    if (!forkId?.trim()) {
      throw badRequest("Fork id is required");
    }

    const fork = await this.repository.findForkById(forkId);
    if (!fork) {
      throw notFound("Fork");
    }

    if (fork.createdByAgentId !== agent.id) {
      throw forbidden("Only the fork owner can operate on this fork");
    }

    return fork;
  }

  private async requireProject(projectId: string): Promise<Project> {
    const project = await this.repository.findProjectById(projectId);
    if (!project) {
      throw notFound("Project");
    }

    return project;
  }

  private async readAutonomousProjectPool(input: AutonomousRunInput): Promise<Project[]> {
    const ids = uniqueStrings([input.projectId, ...(input.projectIds ?? [])]);
    if (ids.length > 0) {
      return Promise.all(ids.map((id) => this.requireProject(id)));
    }

    const projects = await this.repository.listProjects();
    if (projects.length === 0) {
      throw badRequest("Autonomous agents need at least one project to work on");
    }

    return projects;
  }

  private async chooseAutonomousProject(
    projects: Project[],
    input: {
      agentInput: AutonomousAgentInput;
      agent: Agent;
      identitySeed: number;
      cycle: number;
      index: number;
    }
  ): Promise<Project> {
    const explicitProjectId = input.agentInput.projectId?.trim();
    if (explicitProjectId) {
      return this.requireProject(explicitProjectId);
    }

    return projects[(input.cycle + input.index + input.identitySeed) % projects.length] ?? projects[0]!;
  }

  private async requireRootFork(projectId: string): Promise<Fork> {
    const rootFork = await this.repository.findRootFork(projectId);
    if (!rootFork) {
      throw notFound("Root fork");
    }

    return rootFork;
  }

  private async ensureProjectRootRepository(project: Project): Promise<void> {
    try {
      const rootRepo = await this.forge.createRootRepo({
        name: project.name,
        slug: project.rootRepo
      });

      if (rootRepo.owner !== project.rootOwner || rootRepo.repo !== project.rootRepo) {
        throw badRequest(
          `Configured forge root repo ${rootRepo.owner}/${rootRepo.repo} does not match project root ${project.rootOwner}/${project.rootRepo}`
        );
      }
    } catch (error) {
      if (hasHttpStatus(error, 404)) {
        throw badRequest(
          `Project root repo ${project.rootOwner}/${project.rootRepo} is missing in the configured Gitea instance. Create a new project after switching GIT_FORGE=gitea, or ensure the root owner/repo exists in Gitea.`
        );
      }

      throw error;
    }
  }

  private async findOrCreateAutonomousFork(
    agent: Agent,
    input: { project: Project; goal: string }
  ): Promise<Fork> {
    const existing = await this.repository.findLatestForkByProjectAndAgent(input.project.id, agent.id);
    if (existing) {
      await this.repository.createEvent({
        id: createId("evt"),
        type: "fork.reused",
        agentId: agent.id,
        projectId: input.project.id,
        forkId: existing.id,
        payload: {
          fork: `${existing.owner}/${existing.repo}`,
          goal: existing.goal,
          reason: "autonomous agent continued work on its existing Gitea fork"
        }
      });
      return existing;
    }

    return this.createFork(agent, {
      projectId: input.project.id,
      goal: input.goal
    });
  }

  private async ensureQueuedSubmission(
    agent: Agent,
    fork: Fork
  ): Promise<{ fork: Fork; submission: Submission; eval: Eval }> {
    const existingSubmission = await this.repository.findLatestSubmissionByFork(fork.id);
    if (existingSubmission) {
      const existingEval = await this.repository.findEvalBySubmission(existingSubmission.id);
      if (existingEval) {
        return { fork, submission: existingSubmission, eval: existingEval };
      }
    }

    return this.queueSubmission(agent, fork, {});
  }

  private async queueSubmission(
    agent: Agent,
    fork: Fork,
    input: { commitSha?: string; primerPath?: string }
  ): Promise<{ fork: Fork; submission: Submission; eval: Eval }> {
    const primerPath = input.primerPath?.trim() || "primer.md";
    const getFileInput: { owner: string; repo: string; path: string; ref?: string } = {
      owner: fork.owner,
      repo: fork.repo,
      path: primerPath
    };
    const commitSha = input.commitSha?.trim();
    if (commitSha) {
      getFileInput.ref = commitSha;
    }

    const primer = await this.forge.getFile(getFileInput);

    if (!primer) {
      throw badRequest("Every submission must include primer.md");
    }

    const submittedFork = await this.repository.updateForkStatus(fork.id, "submitted");
    const submission = await this.repository.createSubmission({
      id: createId("sub"),
      forkId: fork.id,
      commitSha: commitSha || null,
      primerPath,
      status: "queued"
    });
    const evalRecord = await this.repository.createEval({
      id: createId("evl"),
      submissionId: submission.id,
      status: "queued",
      log: "Queued for evaluation by AgentHub worker.",
      previewUrl: null
    });

    await this.repository.createEvent({
      id: createId("evt"),
      type: "submission.created",
      agentId: agent.id,
      projectId: fork.projectId,
      forkId: fork.id,
      payload: {
        fork: `${fork.owner}/${fork.repo}`,
        commitSha: submission.commitSha,
        primerPath: submission.primerPath,
        evalStatus: evalRecord.status
      }
    });

    return { fork: submittedFork, submission, eval: evalRecord };
  }

  private async findLatestPullRequestByFork(forkId: string): Promise<PullRequest | null> {
    const submission = await this.repository.findLatestSubmissionByFork(forkId);
    return submission ? this.repository.findPullRequestBySubmission(submission.id) : null;
  }

  private async readEvalContext(evalId: string | undefined): Promise<{
    fork: Fork;
    submission: Submission;
    eval: Eval;
  }> {
    const id = evalId?.trim();
    if (!id) {
      throw badRequest("Eval id is required");
    }

    const evalRecord = await this.repository.findEvalById(id);
    if (!evalRecord) {
      throw notFound("Eval");
    }

    const submission = await this.repository.findSubmissionById(evalRecord.submissionId);
    if (!submission) {
      throw notFound("Submission");
    }

    const fork = await this.repository.findForkById(submission.forkId);
    if (!fork) {
      throw notFound("Fork");
    }

    return { fork, submission, eval: evalRecord };
  }

  private async readForkProject(forkId: string | undefined): Promise<{ fork: Fork; project: Project }> {
    const id = forkId?.trim();
    if (!id) {
      throw badRequest("Fork id is required");
    }

    const fork = await this.repository.findForkById(id);
    if (!fork) {
      throw notFound("Fork");
    }

    const project = await this.repository.findProjectById(fork.projectId);
    if (!project) {
      throw notFound("Project");
    }

    return { fork, project };
  }
}

function cleanUsername(username: string | undefined): string | null {
  const cleaned = username?.trim().toLowerCase();
  if (!cleaned) {
    return null;
  }

  const slug = slugify(cleaned);
  if (!slug) {
    throw badRequest("Username must contain at least one letter or number");
  }

  return slug;
}

function cleanHttpUrl(value: string | undefined, label: string): string {
  const cleaned = value?.trim();
  if (!cleaned) {
    throw badRequest(`${label} is required`);
  }

  return parseHttpUrl(cleaned, label);
}

function cleanOptionalHttpUrl(value: string | null, label: string): string | null {
  const cleaned = value?.trim();
  if (!cleaned) {
    return null;
  }

  return parseHttpUrl(cleaned, label);
}

function parseHttpUrl(value: string, label: string): string {
  try {
    const url = new URL(value);
    if (url.protocol !== "http:" && url.protocol !== "https:") {
      throw new Error("Unsupported URL protocol");
    }

    return url.toString();
  } catch {
    throw badRequest(`${label} must be a valid HTTP URL`);
  }
}

function cleanPositiveInteger(value: number | null | undefined, label: string): number | null {
  if (value === null || value === undefined) {
    return null;
  }

  if (!Number.isInteger(value) || value <= 0) {
    throw badRequest(`${label} must be a positive integer`);
  }

  return value;
}

function ensureForkOwner(agent: Agent, fork: Fork): void {
  if (fork.createdByAgentId !== agent.id) {
    throw forbidden("Only the fork owner can use this fork workflow");
  }
}

function hasHttpStatus(error: unknown, status: number): boolean {
  return typeof error === "object" && error !== null && "status" in error && error.status === status;
}

function uniqueStrings(values: Array<string | undefined>): string[] {
  const seen = new Set<string>();
  for (const value of values) {
    const cleaned = value?.trim();
    if (cleaned) {
      seen.add(cleaned);
    }
  }

  return [...seen];
}

function createAutonomousIdentitySeed(username: string): number {
  return scoreString(username) % 1000000;
}

function scoreString(...parts: string[]): number {
  let score = 0;
  for (const part of parts) {
    for (const char of part) {
      score = (score * 31 + char.charCodeAt(0)) >>> 0;
    }
  }

  return score;
}

function createAutonomousWorkerPrompt(input: {
  agent: Agent;
  identitySeed: number;
  fork: Fork;
  project: Project;
  cycle: number;
  goal: string | null;
}): string {
  return [
    `You are AgentHub agent ${input.agent.username}.`,
    `Your numeric identity seed is ${input.identitySeed}. Use it only as a deterministic tie-breaker when several useful changes look equally good.`,
    "",
    "Work independently in this repository. Inspect the codebase first, choose one small useful improvement, edit real project files, and commit the result.",
    "",
    "Context:",
    `- Project: ${input.project.name} (${input.project.slug})`,
    `- Fork: ${input.fork.owner}/${input.fork.repo}`,
    `- Cycle: ${input.cycle}`,
    `- Broad goal: ${input.goal ?? input.fork.goal ?? "choose a useful incremental improvement"}`,
    "",
    "Rules:",
    "- Do not ask the user questions.",
    "- Do not wait for coordinator instructions.",
    "- Prefer source, tests, docs, or configuration changes that are coherent with the repository.",
    "- Avoid empty heartbeat commits and avoid writing placeholder files just to prove activity.",
    "- Keep the change small enough to review.",
    "- Run relevant checks if the repository makes that practical.",
    "- Leave the repository with exactly one new git commit on the current branch.",
    "- Use a clear commit message that describes the concrete change.",
    "",
    "The surrounding worker will push your commit after you finish."
  ].join("\n");
}

function defaultWorkContent(input: { agent: Agent; fork: Fork; project: Project; path: string }): string {
  return [
    "# AgentHub Work",
    "",
    `Agent: ${input.agent.username}`,
    `Project: ${input.project.name}`,
    `Fork: ${input.fork.owner}/${input.fork.repo}`,
    `Fork ID: ${input.fork.id}`,
    `Goal: ${input.fork.goal ?? "No goal recorded"}`,
    `Path: ${input.path}`,
    `Created: ${new Date().toISOString()}`,
    "",
    "This commit was produced by AgentHub's agent workflow and pushed to Gitea."
  ].join("\n");
}
