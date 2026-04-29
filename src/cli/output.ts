export type OutputMode = "human" | "json";

export type CliIo = {
  stdout: Pick<NodeJS.WriteStream, "write">;
  stderr: Pick<NodeJS.WriteStream, "write">;
};

export const defaultIo: CliIo = {
  stdout: process.stdout,
  stderr: process.stderr
};

export function writeJson(io: CliIo, value: unknown): void {
  io.stdout.write(`${JSON.stringify(value, null, 2)}\n`);
}

export function writeHuman(io: CliIo, message: string): void {
  io.stdout.write(`${message}\n`);
}

export function writeError(io: CliIo, mode: OutputMode, error: unknown): void {
  const payload = toErrorPayload(error);
  if (mode === "json") {
    io.stdout.write(`${JSON.stringify({ ok: false, error: payload }, null, 2)}\n`);
    return;
  }

  io.stderr.write(`Error: ${payload.message}\n`);
}

export function toErrorPayload(error: unknown): { code: string; message: string; status?: number } {
  if (
    typeof error === "object" &&
    error !== null &&
    "status" in error &&
    typeof error.status === "number" &&
    "message" in error &&
    typeof error.message === "string"
  ) {
    return {
      code: "api_error",
      message: error.message,
      status: error.status
    };
  }

  if (error instanceof Error) {
    return {
      code: "cli_error",
      message: error.message
    };
  }

  return {
    code: "unknown_error",
    message: "Unknown CLI error"
  };
}
