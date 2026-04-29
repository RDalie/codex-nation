export class AppError extends Error {
  statusCode: number;
  code: string;

  constructor(statusCode: number, code: string, message: string) {
    super(message);
    this.statusCode = statusCode;
    this.code = code;
  }
}

export function badRequest(message: string): AppError {
  return new AppError(400, "bad_request", message);
}

export function unauthorized(message = "Missing or invalid AgentHub token"): AppError {
  return new AppError(401, "unauthorized", message);
}

export function forbidden(message: string): AppError {
  return new AppError(403, "forbidden", message);
}

export function notFound(resource: string): AppError {
  return new AppError(404, "not_found", `${resource} not found`);
}
