import { z } from "zod";

// Single stable list of machine-readable error codes. The client switches on
// `code`, never on `message` text (CLAUDE.md §4).
export const ERROR_CODES = [
  "UNAUTHENTICATED",
  "NOT_A_MEMBER",
  "PROFANITY_BLOCKED",
  "IMAGE_REJECTED",
  "INVALID_FILE_TYPE",
  "FILE_TOO_LARGE",
  "RATE_LIMITED",
  "VALIDATION_FAILED",
] as const;

export const ErrorCodeSchema = z.enum(ERROR_CODES);
export type ErrorCode = z.infer<typeof ErrorCodeSchema>;

// HTTP status per code, kept next to the codes so route handlers and the
// client agree on both without re-deriving the mapping twice.
export const ERROR_STATUS: Record<ErrorCode, number> = {
  UNAUTHENTICATED: 401,
  NOT_A_MEMBER: 403,
  PROFANITY_BLOCKED: 422,
  IMAGE_REJECTED: 422,
  INVALID_FILE_TYPE: 422,
  FILE_TOO_LARGE: 422,
  RATE_LIMITED: 429,
  VALIDATION_FAILED: 400,
};

export const ApiErrorBodySchema = z.object({
  error: z.object({
    code: ErrorCodeSchema,
    message: z.string(),
    details: z.unknown().optional(),
  }),
});
export type ApiErrorBody = z.infer<typeof ApiErrorBodySchema>;

export class ApiError extends Error {
  code: ErrorCode;
  details?: unknown;

  constructor(code: ErrorCode, message: string, details?: unknown) {
    super(message);
    this.code = code;
    this.details = details;
  }

  toBody(): ApiErrorBody {
    return { error: { code: this.code, message: this.message, details: this.details } };
  }

  get status(): number {
    return ERROR_STATUS[this.code];
  }
}
