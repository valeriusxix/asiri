import * as z from "zod";

/** An error that maps directly to an HTTP response `{ error: code, ...extra }`. */
export class HttpError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    readonly extra: Record<string, unknown> = {},
  ) {
    super(code);
    this.name = "HttpError";
  }
}

/** Validate a request body; throws `400 validation_error` with field messages (never input values). */
export function parseBody<S extends z.ZodType>(schema: S, body: unknown): z.output<S> {
  const result = schema.safeParse(body ?? {});
  if (!result.success) {
    throw new HttpError(400, "validation_error", { details: z.flattenError(result.error) });
  }
  return result.data;
}
