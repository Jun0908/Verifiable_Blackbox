export type ErrorCode = "INVALID_REQUEST" | "INVALID_EVIDENCE" | "SERVICE_ERROR";

export class AppError extends Error {
  constructor(
    public readonly code: ErrorCode,
    public readonly reason: string,
    public readonly status: number,
    public readonly retryable = false,
  ) {
    super(reason);
    this.name = "AppError";
  }
}

export function invalidRequest(reason: string): AppError {
  return new AppError("INVALID_REQUEST", reason, 400);
}

export function invalidEvidence(reason: string): AppError {
  return new AppError("INVALID_EVIDENCE", reason, 422);
}

export function serviceError(reason = "SERVICE_UNAVAILABLE"): AppError {
  return new AppError("SERVICE_ERROR", reason, 503, true);
}

export function normalizeError(error: unknown): AppError {
  if (error instanceof AppError) return error;
  return serviceError();
}
