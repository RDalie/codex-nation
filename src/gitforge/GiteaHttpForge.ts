import { randomBytes } from "node:crypto";
import { createShortSuffix } from "../ids.ts";
import type { GitFile, GitForge, GitPullRequestRef, GitRepoRef, GitWriteFileResult } from "./GitForge.ts";

type Fetch = typeof fetch;

export type GiteaHttpForgeOptions = {
  baseUrl: string;
  token: string;
  rootOwner: string;
  rootOwnerType: "org" | "user";
  sshUser: string;
  sshHost: string;
  sshPort: number;
  fetch?: Fetch;
  suffixGenerator?: () => string;
};

type GiteaUser = {
  login: string;
};

type GiteaRepo = {
  name: string;
  owner: {
    login: string;
  };
};

type GiteaContentsResponse = {
  content?: string | null;
  encoding?: string | null;
  sha?: string | null;
  type?: string | null;
};

type GiteaFileResponse = {
  commit?: {
    html_url?: string | null;
    id?: string | null;
    sha?: string | null;
    url?: string | null;
  } | null;
};

type GiteaPullRequest = {
  html_url?: string | null;
  index?: number | null;
  number?: number | null;
  url?: string | null;
};

export class GiteaApiError extends Error {
  status: number;
  body: unknown;

  constructor(status: number, body: unknown) {
    super(readGiteaErrorMessage(status, body));
    this.status = status;
    this.body = body;
  }
}

export class GiteaHttpForge implements GitForge {
  private readonly baseUrl: string;
  private readonly token: string;
  private readonly rootOwner: string;
  private readonly rootOwnerType: "org" | "user";
  private readonly sshUser: string;
  private readonly sshHost: string;
  private readonly sshPort: number;
  private readonly fetch: Fetch;
  private readonly suffixGenerator: () => string;

  constructor(options: GiteaHttpForgeOptions) {
    this.baseUrl = options.baseUrl.replace(/\/+$/, "");
    this.token = options.token;
    this.rootOwner = options.rootOwner;
    this.rootOwnerType = options.rootOwnerType;
    this.sshUser = options.sshUser;
    this.sshHost = options.sshHost;
    this.sshPort = options.sshPort;
    this.fetch = options.fetch ?? fetch;
    this.suffixGenerator = options.suffixGenerator ?? createShortSuffix;
  }

  async doctor(): Promise<{ version: string; user: string; isAdmin: boolean; rootOwner: string; rootOwnerType: string }> {
    const [version, user] = await Promise.all([
      this.request<{ version: string }>("GET", "/api/v1/version"),
      this.request<{ login: string; is_admin: boolean }>("GET", "/api/v1/user")
    ]);

    return {
      version: version.version,
      user: user.login,
      isAdmin: user.is_admin,
      rootOwner: this.rootOwner,
      rootOwnerType: this.rootOwnerType
    };
  }

  async createAgentUser(input: { username: string }): Promise<{ username: string }> {
    const existing = await this.requestOrNull<GiteaUser>("GET", `/api/v1/users/${encodePath(input.username)}`);
    if (existing) {
      return { username: existing.login };
    }

    const created = await this.request<GiteaUser>("POST", "/api/v1/admin/users", {
      username: input.username,
      email: `${input.username}@agenthub.invalid`,
      password: createTemporaryPassword(),
      must_change_password: false,
      send_notify: false,
      visibility: "public"
    });

    return { username: created.login };
  }

  async addSshKey(input: { username: string; title: string; key: string }): Promise<void> {
    await this.request(
      "POST",
      "/api/v1/user/keys",
      {
        title: input.title,
        key: input.key,
        read_only: false
      },
      { sudo: input.username }
    );
  }

  async createRootRepo(input: { name: string; slug: string }): Promise<GitRepoRef> {
    const repo = await this.createRepoForOwner({
      owner: this.rootOwner,
      ownerType: this.rootOwnerType,
      name: input.slug,
      description: `AgentHub project: ${input.name}`
    });
    await this.ensurePrimerFile(repo.owner.login, repo.name, input.name);

    return this.repoRef(repo.owner.login, repo.name);
  }

  async createFork(input: { sourceOwner: string; sourceRepo: string; targetOwner: string }): Promise<GitRepoRef> {
    const forkName = `${input.sourceRepo}-${this.suffixGenerator()}`;

    try {
      const repo = await this.request<GiteaRepo>(
        "POST",
        `/api/v1/repos/${encodePath(input.sourceOwner)}/${encodePath(input.sourceRepo)}/forks`,
        { name: forkName },
        { sudo: input.targetOwner }
      );
      return this.repoRef(repo.owner.login, repo.name);
    } catch (error) {
      if (error instanceof GiteaApiError && error.status === 409) {
        const existingFork = await this.findExistingFork(input);
        if (existingFork) {
          return existingFork;
        }

        const repo = await this.requestOrNull<GiteaRepo>(
          "GET",
          `/api/v1/repos/${encodePath(input.targetOwner)}/${encodePath(forkName)}`
        );
        if (repo) {
          return this.repoRef(repo.owner.login, repo.name);
        }
      }

      throw error;
    }
  }

  async getFile(input: { owner: string; repo: string; path: string; ref?: string }): Promise<GitFile | null> {
    const query = input.ref ? `?ref=${encodeURIComponent(input.ref)}` : "";
    const response = await this.requestOrNull<GiteaContentsResponse>(
      "GET",
      `/api/v1/repos/${encodePath(input.owner)}/${encodePath(input.repo)}/contents/${encodeFilePath(input.path)}${query}`
    );

    if (!response?.content || response.type !== "file") {
      return null;
    }

    if (response.encoding === "base64") {
      return { content: Buffer.from(response.content.replace(/\s/g, ""), "base64").toString("utf8") };
    }

    return { content: response.content };
  }

  async writeFile(input: {
    owner: string;
    repo: string;
    path: string;
    content: string;
    message: string;
    targetUser: string;
    branch?: string;
  }): Promise<GitWriteFileResult> {
    const branch = input.branch ?? "main";
    const contentsPath = `/api/v1/repos/${encodePath(input.owner)}/${encodePath(input.repo)}/contents/${encodeFilePath(input.path)}`;
    const existing = await this.requestOrNull<GiteaContentsResponse>(
      "GET",
      `${contentsPath}?ref=${encodeURIComponent(branch)}`,
      undefined,
      { sudo: input.targetUser }
    );

    const body = {
      content: Buffer.from(input.content, "utf8").toString("base64"),
      message: input.message,
      branch
    };

    const response =
      existing === null
        ? await this.request<GiteaFileResponse>("POST", contentsPath, body, { sudo: input.targetUser })
        : await this.updateFile(contentsPath, body, existing, input.targetUser);

    const commitSha = response.commit?.sha ?? response.commit?.id ?? null;

    return {
      owner: input.owner,
      repo: input.repo,
      path: input.path,
      branch,
      commitSha,
      commitUrl: response.commit?.html_url ?? response.commit?.url ?? this.commitUrl(input.owner, input.repo, commitSha)
    };
  }

  async createPullRequest(input: {
    sourceOwner: string;
    sourceRepo: string;
    targetOwner: string;
    targetRepo: string;
    title: string;
    targetUser: string;
    body?: string;
    sourceBranch?: string;
    targetBranch?: string;
  }): Promise<GitPullRequestRef> {
    const targetBranch = input.targetBranch ?? "main";
    const response = await this.request<GiteaPullRequest>(
      "POST",
      `/api/v1/repos/${encodePath(input.targetOwner)}/${encodePath(input.targetRepo)}/pulls`,
      {
        title: input.title,
        body: input.body ?? "",
        head: `${input.sourceOwner}:${input.sourceBranch ?? "main"}`,
        base: targetBranch
      },
      { sudo: input.targetUser }
    );
    const number = response.number ?? response.index;

    if (number === undefined || number === null) {
      throw new Error("Gitea pull request response did not include a number");
    }

    return {
      number,
      url: response.html_url ?? response.url ?? this.pullRequestUrl(input.targetOwner, input.targetRepo, number)
    };
  }

  compareUrl(input: {
    sourceOwner: string;
    sourceBranch?: string;
    targetOwner: string;
    targetRepo: string;
    targetBranch?: string;
  }): string {
    const targetBranch = input.targetBranch ?? "main";
    const sourceBranch = input.sourceBranch ?? "main";
    return `${this.baseUrl}/${encodePath(input.targetOwner)}/${encodePath(input.targetRepo)}/compare/${encodePath(
      targetBranch
    )}...${encodePath(input.sourceOwner)}:${encodePath(sourceBranch)}`;
  }

  private async createRepoForOwner(input: {
    owner: string;
    ownerType: "org" | "user";
    name: string;
    description: string;
  }): Promise<GiteaRepo> {
    const path =
      input.ownerType === "org"
        ? `/api/v1/orgs/${encodePath(input.owner)}/repos`
        : "/api/v1/user/repos";

    try {
      return await this.request<GiteaRepo>(
        "POST",
        path,
        {
          name: input.name,
          description: input.description,
          private: false,
          auto_init: true,
          default_branch: "main",
          readme: "Default"
        },
        input.ownerType === "user" ? { sudo: input.owner } : undefined
      );
    } catch (error) {
      if (error instanceof GiteaApiError && error.status === 409) {
        return this.request<GiteaRepo>("GET", `/api/v1/repos/${encodePath(input.owner)}/${encodePath(input.name)}`);
      }

      throw error;
    }
  }

  private async findExistingFork(input: {
    sourceOwner: string;
    sourceRepo: string;
    targetOwner: string;
  }): Promise<GitRepoRef | null> {
    const forks = await this.requestOrNull<GiteaRepo[]>(
      "GET",
      `/api/v1/repos/${encodePath(input.sourceOwner)}/${encodePath(input.sourceRepo)}/forks?limit=50`
    );
    const fork = forks?.find((repo) => repo.owner.login === input.targetOwner);
    return fork ? this.repoRef(fork.owner.login, fork.name) : null;
  }

  private async updateFile(
    contentsPath: string,
    body: { content: string; message: string; branch: string },
    existing: GiteaContentsResponse,
    targetUser: string
  ): Promise<GiteaFileResponse> {
    if (existing.type !== "file" || !existing.sha) {
      throw new Error("Cannot update repository path because it is not an existing file");
    }

    return this.request<GiteaFileResponse>("PUT", contentsPath, { ...body, sha: existing.sha }, { sudo: targetUser });
  }

  private async ensurePrimerFile(owner: string, repo: string, projectName: string): Promise<void> {
    const existing = await this.getFile({ owner, repo, path: "primer.md" });
    if (existing) {
      return;
    }

    await this.request(
      "POST",
      `/api/v1/repos/${encodePath(owner)}/${encodePath(repo)}/contents/primer.md`,
      {
        content: Buffer.from(`# ${projectName} Primer\n\nInitial AgentHub primer.\n`).toString("base64"),
        message: "Add AgentHub primer",
        branch: "main"
      }
    );
  }

  private repoRef(owner: string, repo: string): GitRepoRef {
    return {
      owner,
      repo,
      cloneUrl:
        this.sshPort === 22
          ? `${this.sshUser}@${this.sshHost}:${owner}/${repo}.git`
          : `ssh://${this.sshUser}@${this.sshHost}:${this.sshPort}/${owner}/${repo}.git`
    };
  }

  private commitUrl(owner: string, repo: string, commitSha: string | null): string | null {
    if (!commitSha) {
      return null;
    }

    return `${this.baseUrl}/${encodePath(owner)}/${encodePath(repo)}/commit/${encodePath(commitSha)}`;
  }

  private pullRequestUrl(owner: string, repo: string, number: number): string {
    return `${this.baseUrl}/${encodePath(owner)}/${encodePath(repo)}/pulls/${number}`;
  }

  private async requestOrNull<T>(
    method: string,
    path: string,
    body?: unknown,
    options?: { sudo?: string }
  ): Promise<T | null> {
    try {
      return await this.request<T>(method, path, body, options);
    } catch (error) {
      if (error instanceof GiteaApiError && error.status === 404) {
        return null;
      }

      throw error;
    }
  }

  private async request<T>(
    method: string,
    path: string,
    body?: unknown,
    options?: { sudo?: string }
  ): Promise<T> {
    const headers: Record<string, string> = {
      accept: "application/json",
      authorization: `token ${this.token}`
    };

    const init: RequestInit = {
      method,
      headers
    };

    if (body !== undefined) {
      headers["content-type"] = "application/json";
      init.body = JSON.stringify(body);
    }

    if (options?.sudo) {
      headers.sudo = options.sudo;
    }

    const response = await this.fetch(`${this.baseUrl}${path}`, init);
    const payload = await readPayload(response);

    if (!response.ok) {
      throw new GiteaApiError(response.status, payload);
    }

    return payload as T;
  }
}

function encodePath(value: string): string {
  return encodeURIComponent(value);
}

function encodeFilePath(value: string): string {
  return value.split("/").map(encodeURIComponent).join("/");
}

async function readPayload(response: Response): Promise<unknown> {
  const text = await response.text();
  if (!text) {
    return null;
  }

  const contentType = response.headers.get("content-type") ?? "";
  if (contentType.includes("application/json")) {
    return JSON.parse(text);
  }

  return text;
}

function readGiteaErrorMessage(status: number, body: unknown): string {
  if (typeof body === "object" && body !== null && "message" in body && typeof body.message === "string") {
    return body.message;
  }

  return `Gitea API request failed with status ${status}`;
}

function createTemporaryPassword(): string {
  return `Aa1!${randomBytes(24).toString("hex")}`;
}
