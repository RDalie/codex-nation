export type ApiClientOptions = {
  apiUrl: string;
  token?: string | null;
};

export class ApiError extends Error {
  status: number;
  body: unknown;

  constructor(status: number, body: unknown) {
    super(readErrorMessage(status, body));
    this.status = status;
    this.body = body;
  }
}

export class AgentHubApiClient {
  private readonly apiUrl: string;
  private readonly token: string | null;

  constructor(options: ApiClientOptions) {
    this.apiUrl = options.apiUrl;
    this.token = options.token ?? null;
  }

  async health(): Promise<unknown> {
    return this.request("GET", "/health");
  }

  async login(input: { username?: string }): Promise<{
    agentId: string;
    username: string;
    token: string;
  }> {
    return this.request("POST", "/agents/login", input);
  }

  async me(): Promise<unknown> {
    return this.request("GET", "/agents/me");
  }

  async createProject(input: { name: string; slug?: string; goal?: string }): Promise<unknown> {
    return this.request("POST", "/projects", input);
  }

  async getProject(projectId: string): Promise<unknown> {
    return this.request("GET", `/projects/${encodeURIComponent(projectId)}`);
  }

  async getLineage(projectId: string): Promise<unknown> {
    return this.request("GET", `/projects/${encodeURIComponent(projectId)}/lineage`);
  }

  async createFork(input: { projectId: string; parentForkId?: string; goal?: string }): Promise<unknown> {
    return this.request("POST", "/forks", input);
  }

  async submit(input: { forkId: string; commitSha?: string; primerPath?: string }): Promise<unknown> {
    return this.request("POST", "/submissions", input);
  }

  async getForkStatus(forkId: string): Promise<unknown> {
    return this.request("GET", `/forks/${encodeURIComponent(forkId)}/status`);
  }

  async rawGet(path: string): Promise<unknown> {
    return this.request("GET", normalizePath(path));
  }

  private async request<T>(method: string, path: string, body?: unknown): Promise<T> {
    const headers: Record<string, string> = {
      accept: "application/json"
    };

    if (body !== undefined) {
      headers["content-type"] = "application/json";
    }

    if (this.token) {
      headers.authorization = `Bearer ${this.token}`;
    }

    const init: RequestInit = {
      method,
      headers
    };

    if (body !== undefined) {
      init.body = JSON.stringify(body);
    }

    const response = await fetch(`${this.apiUrl}${path}`, init);

    const payload = await readPayload(response);
    if (!response.ok) {
      throw new ApiError(response.status, payload);
    }

    return payload as T;
  }
}

function normalizePath(path: string): string {
  if (!path.startsWith("/")) {
    return `/${path}`;
  }

  return path;
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

function readErrorMessage(status: number, body: unknown): string {
  if (
    typeof body === "object" &&
    body !== null &&
    "error" in body &&
    typeof body.error === "object" &&
    body.error !== null &&
    "message" in body.error &&
    typeof body.error.message === "string"
  ) {
    return body.error.message;
  }

  return `AgentHub API request failed with status ${status}`;
}
