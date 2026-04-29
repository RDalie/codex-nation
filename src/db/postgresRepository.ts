import type { Pool } from "pg";
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

export class PostgresRepository implements AgentHubRepository {
  private readonly pool: Pool;

  constructor(pool: Pool) {
    this.pool = pool;
  }

  async upsertAgent(input: AgentCreate): Promise<Agent> {
    const result = await this.pool.query(
      `
        INSERT INTO agents (id, username, token_hash, gitea_username)
        VALUES ($1, $2, $3, $4)
        ON CONFLICT (username)
        DO UPDATE SET token_hash = EXCLUDED.token_hash, gitea_username = EXCLUDED.gitea_username
        RETURNING *
      `,
      [input.id, input.username, input.tokenHash, input.giteaUsername]
    );
    return mapAgent(result.rows[0]);
  }

  async findAgentByUsername(username: string): Promise<Agent | null> {
    const result = await this.pool.query("SELECT * FROM agents WHERE username = $1", [username]);
    return result.rows[0] ? mapAgent(result.rows[0]) : null;
  }

  async findAgentByTokenHash(tokenHash: string): Promise<Agent | null> {
    const result = await this.pool.query("SELECT * FROM agents WHERE token_hash = $1", [tokenHash]);
    return result.rows[0] ? mapAgent(result.rows[0]) : null;
  }

  async createProject(input: ProjectCreate): Promise<Project> {
    const result = await this.pool.query(
      `
        INSERT INTO projects (id, name, slug, root_owner, root_repo, created_by_agent_id)
        VALUES ($1, $2, $3, $4, $5, $6)
        RETURNING *
      `,
      [input.id, input.name, input.slug, input.rootOwner, input.rootRepo, input.createdByAgentId]
    );
    return mapProject(result.rows[0]);
  }

  async findProjectById(id: string): Promise<Project | null> {
    const result = await this.pool.query("SELECT * FROM projects WHERE id = $1", [id]);
    return result.rows[0] ? mapProject(result.rows[0]) : null;
  }

  async findProjectBySlug(slug: string): Promise<Project | null> {
    const result = await this.pool.query("SELECT * FROM projects WHERE slug = $1", [slug]);
    return result.rows[0] ? mapProject(result.rows[0]) : null;
  }

  async createFork(input: ForkCreate): Promise<Fork> {
    const result = await this.pool.query(
      `
        INSERT INTO forks (
          id, project_id, parent_fork_id, owner, repo, source_owner, source_repo,
          clone_url, goal, status, created_by_agent_id
        )
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
        RETURNING *
      `,
      [
        input.id,
        input.projectId,
        input.parentForkId,
        input.owner,
        input.repo,
        input.sourceOwner,
        input.sourceRepo,
        input.cloneUrl,
        input.goal,
        input.status,
        input.createdByAgentId
      ]
    );
    return mapFork(result.rows[0]);
  }

  async findForkById(id: string): Promise<Fork | null> {
    const result = await this.pool.query("SELECT * FROM forks WHERE id = $1", [id]);
    return result.rows[0] ? mapFork(result.rows[0]) : null;
  }

  async findRootFork(projectId: string): Promise<Fork | null> {
    const result = await this.pool.query(
      "SELECT * FROM forks WHERE project_id = $1 AND parent_fork_id IS NULL LIMIT 1",
      [projectId]
    );
    return result.rows[0] ? mapFork(result.rows[0]) : null;
  }

  async listForksByProject(projectId: string): Promise<Fork[]> {
    const result = await this.pool.query(
      "SELECT * FROM forks WHERE project_id = $1 ORDER BY created_at ASC",
      [projectId]
    );
    return result.rows.map(mapFork);
  }

  async updateForkStatus(id: string, status: ForkStatus): Promise<Fork> {
    const result = await this.pool.query("UPDATE forks SET status = $2 WHERE id = $1 RETURNING *", [id, status]);
    if (!result.rows[0]) {
      throw notFound("Fork");
    }

    return mapFork(result.rows[0]);
  }

  async createSubmission(input: SubmissionCreate): Promise<Submission> {
    const result = await this.pool.query(
      `
        INSERT INTO submissions (id, fork_id, commit_sha, primer_path, status)
        VALUES ($1, $2, $3, $4, $5)
        RETURNING *
      `,
      [input.id, input.forkId, input.commitSha, input.primerPath, input.status]
    );
    return mapSubmission(result.rows[0]);
  }

  async findLatestSubmissionByFork(forkId: string): Promise<Submission | null> {
    const result = await this.pool.query(
      "SELECT * FROM submissions WHERE fork_id = $1 ORDER BY created_at DESC LIMIT 1",
      [forkId]
    );
    return result.rows[0] ? mapSubmission(result.rows[0]) : null;
  }

  async createEval(input: EvalCreate): Promise<Eval> {
    const result = await this.pool.query(
      `
        INSERT INTO evals (id, submission_id, status, log, preview_url)
        VALUES ($1, $2, $3, $4, $5)
        RETURNING *
      `,
      [input.id, input.submissionId, input.status, input.log, input.previewUrl]
    );
    return mapEval(result.rows[0]);
  }

  async findEvalBySubmission(submissionId: string): Promise<Eval | null> {
    const result = await this.pool.query("SELECT * FROM evals WHERE submission_id = $1", [submissionId]);
    return result.rows[0] ? mapEval(result.rows[0]) : null;
  }

  async createEvent(input: EventCreate): Promise<Event> {
    const result = await this.pool.query(
      `
        INSERT INTO events (id, type, agent_id, project_id, fork_id, payload)
        VALUES ($1, $2, $3, $4, $5, $6)
        RETURNING *
      `,
      [input.id, input.type, input.agentId, input.projectId, input.forkId, input.payload]
    );
    return mapEvent(result.rows[0]);
  }

  async listEventsByProject(projectId: string): Promise<Event[]> {
    const result = await this.pool.query(
      "SELECT * FROM events WHERE project_id = $1 ORDER BY created_at DESC",
      [projectId]
    );
    return result.rows.map(mapEvent);
  }
}

function mapAgent(row: Record<string, any>): Agent {
  return {
    id: row.id,
    username: row.username,
    tokenHash: row.token_hash,
    giteaUsername: row.gitea_username,
    createdAt: row.created_at.toISOString()
  };
}

function mapProject(row: Record<string, any>): Project {
  return {
    id: row.id,
    name: row.name,
    slug: row.slug,
    rootOwner: row.root_owner,
    rootRepo: row.root_repo,
    createdByAgentId: row.created_by_agent_id,
    createdAt: row.created_at.toISOString()
  };
}

function mapFork(row: Record<string, any>): Fork {
  return {
    id: row.id,
    projectId: row.project_id,
    parentForkId: row.parent_fork_id,
    owner: row.owner,
    repo: row.repo,
    sourceOwner: row.source_owner,
    sourceRepo: row.source_repo,
    cloneUrl: row.clone_url,
    goal: row.goal,
    status: row.status,
    createdByAgentId: row.created_by_agent_id,
    createdAt: row.created_at.toISOString()
  };
}

function mapSubmission(row: Record<string, any>): Submission {
  return {
    id: row.id,
    forkId: row.fork_id,
    commitSha: row.commit_sha,
    primerPath: row.primer_path,
    status: row.status,
    createdAt: row.created_at.toISOString()
  };
}

function mapEval(row: Record<string, any>): Eval {
  return {
    id: row.id,
    submissionId: row.submission_id,
    status: row.status,
    log: row.log,
    previewUrl: row.preview_url,
    createdAt: row.created_at.toISOString(),
    updatedAt: row.updated_at.toISOString()
  };
}

function mapEvent(row: Record<string, any>): Event {
  return {
    id: row.id,
    type: row.type,
    agentId: row.agent_id,
    projectId: row.project_id,
    forkId: row.fork_id,
    payload: row.payload,
    createdAt: row.created_at.toISOString()
  };
}
