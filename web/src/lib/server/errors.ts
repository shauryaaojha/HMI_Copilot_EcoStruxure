/**
 * HTTP failures shared by the repository and its route adapters. Domain code
 * throws data, not Responses, so the same revision and access rules can be
 * exercised without a running Next server. Unexpected failures stay private.
 */
export class ServerError extends Error {
  constructor(public status: number, public code: string, message: string, public detail: Record<string, unknown> = {}) { super(message); }
}
export function errorResponse(error: unknown): Response {
  if (error instanceof ServerError) return Response.json({ error: error.message, code: error.code, ...error.detail }, { status: error.status });
  if (error instanceof SyntaxError) return Response.json({ error: "Expected valid JSON", code: "invalid" }, { status: 400 });
  if (error && typeof error === "object" && "status" in error && "code" in error && error instanceof Error) {
    return Response.json({ error: error.message, code: error.code }, { status: Number(error.status) });
  }
  return Response.json({ error: "Server storage is unavailable", code: "internal" }, { status: 500 });
}
