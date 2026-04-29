import Fastify, {
  type FastifyInstance,
  type FastifyReply,
  type FastifyRequest,
  type RouteGenericInterface
} from "fastify";
import type { Agent } from "../types.ts";
import { AppError, badRequest } from "../errors.ts";
import { AgentHubService } from "../domain/AgentHubService.ts";

type AuthenticatedHandler<TRoute extends RouteGenericInterface> = (
  agent: Agent,
  request: FastifyRequest<TRoute>
) => Promise<unknown>;

export function createApp(service: AgentHubService, options: { logger?: boolean } = {}): FastifyInstance {
  const app = Fastify({ logger: options.logger ?? true });

  app.setErrorHandler((error, request, reply) => {
    if (error instanceof AppError) {
      reply.status(error.statusCode).send({
        error: {
          code: error.code,
          message: error.message
        }
      });
      return;
    }

    request.log.error(error);
    reply.status(500).send({
      error: {
        code: "internal_error",
        message: "Internal server error"
      }
    });
  });

  app.get("/health", async () => ({ ok: true }));

  app.post<{ Body: { username?: string } }>("/agents/login", async (request) => {
    return service.login(optionalBody(request.body));
  });

  app.get("/agents/me", withAgent(service, async (agent) => ({
    agentId: agent.id,
    username: agent.username,
    giteaUsername: agent.giteaUsername,
    createdAt: agent.createdAt
  })));

  app.post<{ Body: { name: string; slug?: string; goal?: string } }>(
    "/projects",
    withAgent<{ Body: { name: string; slug?: string; goal?: string } }>(
      service,
      async (agent, request) => {
        return service.createProject(agent, optionalBody(request.body));
      }
    )
  );

  app.get<{ Params: { id: string } }>("/projects/:id", async (request) => {
    return service.getProjectDetails(request.params.id);
  });

  app.get<{ Params: { id: string } }>("/projects/:id/lineage", async (request) => {
    return service.getProjectLineage(request.params.id);
  });

  app.post<{ Body: { projectId: string; parentForkId?: string; goal?: string } }>(
    "/forks",
    withAgent<{ Body: { projectId: string; parentForkId?: string; goal?: string } }>(
      service,
      async (agent, request) => {
        return service.createFork(agent, optionalBody(request.body));
      }
    )
  );

  app.post<{ Body: { forkId: string; commitSha?: string; primerPath?: string } }>(
    "/submissions",
    withAgent<{ Body: { forkId: string; commitSha?: string; primerPath?: string } }>(
      service,
      async (agent, request) => {
        return service.submitFork(agent, optionalBody(request.body));
      }
    )
  );

  app.get<{ Params: { id: string } }>("/forks/:id/status", async (request) => {
    return service.getForkStatus(request.params.id);
  });

  return app;
}

function optionalBody<TBody>(body: TBody | undefined): Partial<TBody> {
  return body ?? {};
}

function withAgent<TRoute extends RouteGenericInterface = RouteGenericInterface>(
  service: AgentHubService,
  handler: AuthenticatedHandler<TRoute>
) {
  return async (request: FastifyRequest<TRoute>, reply: FastifyReply): Promise<void> => {
    const agent = await service.authenticate(readBearerToken(request.headers.authorization));
    const response = await handler(agent, request);
    reply.send(response);
  };
}

function readBearerToken(authorization: string | undefined): string | null {
  if (!authorization) {
    return null;
  }

  const [scheme, token] = authorization.split(" ");
  if (scheme?.toLowerCase() !== "bearer" || !token) {
    throw badRequest("Authorization header must use Bearer token format");
  }

  return token;
}
