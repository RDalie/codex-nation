import type { Agent, Eval, Event, Fork, Project, Submission } from "../types.ts";
import type { AgentHubRepository } from "../db/repository.ts";
import { badRequest, forbidden, notFound, unauthorized } from "../errors.ts";
import type { GitBundleFile, GitForge, GitRepoRef } from "../gitforge/GitForge.ts";
import { createId, createShortSuffix, createToken, slugify } from "../ids.ts";
import { hashToken } from "../security.ts";

const MAX_BUNDLE_FILES = 300;
const MAX_BUNDLE_BYTES = 5 * 1024 * 1024;

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

  async submitFork(
    agent: Agent,
    input: {
      forkId?: string;
      commitSha?: string;
      primerPath?: string;
      bundle?: { files?: GitBundleFile[] };
    }
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

    const primerPath = input.primerPath?.trim() || "primer.md";
    const commitSha = input.commitSha?.trim();
    const bundleFiles = normalizeBundle(input.bundle, primerPath);
    let snapshotRepo: GitRepoRef | null = null;

    if (bundleFiles) {
      if (commitSha) {
        throw badRequest("Bundle submissions cannot also specify a commit SHA");
      }

      snapshotRepo = await this.forge.createSubmissionSnapshot({
        sourceRepo: fork.repo,
        targetOwner: agent.giteaUsername,
        files: bundleFiles
      });
    } else {
      const getFileInput: { owner: string; repo: string; path: string; ref?: string } = {
        owner: fork.owner,
        repo: fork.repo,
        path: primerPath
      };
      if (commitSha) {
        getFileInput.ref = commitSha;
      }

      const primer = await this.forge.getFile(getFileInput);

      if (!primer) {
        throw badRequest("Every submission must include primer.md");
      }
    }

    const submittedFork = await this.repository.updateForkStatus(fork.id, "submitted");
    const submission = await this.repository.createSubmission({
      id: createId("sub"),
      forkId: fork.id,
      commitSha: commitSha || null,
      primerPath,
      snapshotOwner: snapshotRepo?.owner ?? null,
      snapshotRepo: snapshotRepo?.repo ?? null,
      snapshotCloneUrl: snapshotRepo?.cloneUrl ?? null,
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
        snapshot:
          submission.snapshotOwner && submission.snapshotRepo
            ? `${submission.snapshotOwner}/${submission.snapshotRepo}`
            : null,
        snapshotCloneUrl: submission.snapshotCloneUrl,
        evalStatus: evalRecord.status
      }
    });

    return { fork: submittedFork, submission, eval: evalRecord };
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
    const evalRecord = submission ? await this.repository.findEvalBySubmission(submission.id) : null;

    return { fork, submission, eval: evalRecord };
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

function normalizeBundle(
  bundle: { files?: GitBundleFile[] } | undefined,
  primerPath: string
): GitBundleFile[] | null {
  if (!bundle) {
    return null;
  }

  if (!Array.isArray(bundle.files) || bundle.files.length === 0) {
    throw badRequest("Bundle submissions must include at least one file");
  }

  if (bundle.files.length > MAX_BUNDLE_FILES) {
    throw badRequest(`Bundle submissions can include at most ${MAX_BUNDLE_FILES} files`);
  }

  const normalized: GitBundleFile[] = [];
  const seen = new Set<string>();
  let totalBytes = 0;

  for (const file of bundle.files) {
    const path = normalizeBundlePath(file.path);
    if (seen.has(path)) {
      throw badRequest(`Bundle includes duplicate file '${path}'`);
    }

    if (typeof file.contentBase64 !== "string") {
      throw badRequest(`Bundle file '${path}' must include base64 content`);
    }

    const content = Buffer.from(file.contentBase64, "base64");
    totalBytes += content.byteLength;
    if (totalBytes > MAX_BUNDLE_BYTES) {
      throw badRequest(`Bundle submissions can include at most ${MAX_BUNDLE_BYTES} bytes`);
    }

    seen.add(path);
    normalized.push({ path, contentBase64: content.toString("base64") });
  }

  const normalizedPrimerPath = normalizeBundlePath(primerPath);
  if (!seen.has(normalizedPrimerPath)) {
    throw badRequest("Every submission must include primer.md");
  }

  return normalized;
}

function normalizeBundlePath(path: string): string {
  if (typeof path !== "string") {
    throw badRequest("Bundle file path must be a string");
  }

  const normalized = path.replaceAll("\\", "/").replace(/^\/+/, "").replace(/^\.\//, "");
  const parts = normalized.split("/");
  if (!normalized || parts.some((part) => !part || part === "." || part === "..") || normalized.includes("\0")) {
    throw badRequest(`Invalid bundle file path '${path}'`);
  }

  return normalized;
}
