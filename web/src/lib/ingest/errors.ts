/**
 * Why a file could not be taken in, as data the UI and the routes can act on.
 *
 * Every import path used to end in `catch (e) { return { error: e.message } }`,
 * which put whatever the deepest library said in front of the engineer:
 * "no such table: Variables", "Unexpected token } in JSON at position 4011",
 * "End of data reached (data length = 0, asked index = 4)". All true, none of
 * them something an engineer can act on, and none of them distinguishable by
 * the UI from a bug.
 *
 * An IngestError carries three things instead: a stable `code` the UI and the
 * tests can switch on, a sentence that says what is wrong with *the file*, and
 * a `hint` that says what to do about it. The HTTP status is derived from the
 * code so every route answers the same failure the same way.
 */

export type IngestCode =
  /** Nothing usable in the request body. */
  | "empty"
  /** Bigger than the tool will hold in memory. */
  | "too-large"
  /** A ZIP whose declared contents would inflate past the limits. */
  | "zip-bomb"
  /** Looks like a ZIP but its directory cannot be read. */
  | "zip-corrupt"
  /** A ZIP with password-protected entries. */
  | "encrypted"
  /** A format we recognise and deliberately do not open (yet), with the reason. */
  | "unsupported-format"
  /** A format we do not recognise at all. */
  | "unknown-format"
  /** The right kind of file, but a part of it the reader needs is broken. */
  | "damaged"
  /** The file was understood and contains nothing to import. */
  | "no-content";

const STATUS: Record<IngestCode, number> = {
  empty: 400,
  "too-large": 413,
  "zip-bomb": 413,
  "zip-corrupt": 422,
  encrypted: 422,
  "unsupported-format": 415,
  "unknown-format": 415,
  damaged: 422,
  "no-content": 422,
};

export class IngestError extends Error {
  readonly code: IngestCode;
  readonly hint?: string;
  /** Extra, machine-readable context: the layout found, the entry that broke. */
  readonly detail?: Record<string, unknown>;

  constructor(code: IngestCode, message: string, hint?: string, detail?: Record<string, unknown>) {
    super(message);
    this.name = "IngestError";
    this.code = code;
    this.hint = hint;
    this.detail = detail;
  }

  get status(): number {
    return STATUS[this.code];
  }

  toJSON() {
    return {
      error: this.message,
      code: this.code,
      ...(this.hint ? { hint: this.hint } : {}),
      ...(this.detail ? { detail: this.detail } : {}),
    };
  }
}

export const isIngestError = (e: unknown): e is IngestError => e instanceof IngestError;

/**
 * Any thrown thing as a response. An IngestError answers as itself; anything
 * else is a defect in this tool rather than in the file, and says so - without
 * the stack, and without pretending the engineer's file was at fault.
 */
export function ingestResponse(error: unknown, fallback = "could not read the file"): Response {
  if (isIngestError(error)) return Response.json(error.toJSON(), { status: error.status });
  const message = error instanceof Error && error.message ? error.message : fallback;
  return Response.json(
    {
      error: `${fallback}: ${message}`,
      code: "internal",
      hint: "This looks like a fault in HMI Copilot rather than in your file. The file was not changed.",
    },
    { status: 500 },
  );
}

/**
 * The file name a client sent in `x-file-name`, decoded without throwing.
 *
 * `decodeURIComponent` throws a URIError on a malformed escape ("%E0"), and the
 * routes called it outside their try blocks, so one odd header turned an import
 * into an unhandled 500. A name that will not decode is used as sent; a missing
 * one falls back. Path separators are stripped - this is a label, never a path.
 */
export function fileNameFrom(request: Request, fallback: string): string {
  const raw = request.headers.get("x-file-name");
  if (!raw) return fallback;
  let name: string;
  try {
    name = decodeURIComponent(raw);
  } catch {
    name = raw;
  }
  name = name.replace(/^.*[\\/]/, "").replace(/[\u0000-\u001f]/g, "").trim();
  return name.slice(0, 255) || fallback;
}
