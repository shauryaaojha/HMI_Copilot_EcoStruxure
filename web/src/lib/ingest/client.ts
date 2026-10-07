/**
 * Reading an import route's answer in the browser, failure included.
 *
 * Every upload site did `await response.json()` and then threw `data.error`.
 * Two ways that went wrong: a platform-level refusal (a 413 from the host, a
 * 504 from a timeout) answers with HTML, so `.json()` itself threw "Unexpected
 * token <" at the engineer; and the hint the routes now send - what to do about
 * it - was thrown away. This keeps both.
 */

export interface ApiFailure {
  error?: string;
  code?: string;
  hint?: string;
}

/** The body as JSON, or null when it is not JSON. Never throws. */
export async function jsonOrNull<T>(response: Response): Promise<(T & ApiFailure) | null> {
  try {
    return (await response.json()) as T & ApiFailure;
  } catch {
    return null;
  }
}

const STATUS_TEXT: Record<number, string> = {
  413: "the file is too large for the server to accept",
  415: "that kind of file is not supported here",
  502: "the server did not answer",
  503: "the server is not ready",
  504: "the server took too long - a very large file can do this",
};

/** One sentence for a failed response: the route's error and hint, or the status. */
export function failureMessage(response: Response, data: ApiFailure | null, what: string): string {
  if (data?.error) return data.hint ? `${data.error} ${data.hint}` : data.error;
  return `${what} failed: ${STATUS_TEXT[response.status] ?? `the server answered ${response.status}`}`;
}

/** Fetch's response as T, or an Error carrying the sentence above. */
export async function expectJson<T>(response: Response, what: string): Promise<T> {
  const data = await jsonOrNull<T>(response);
  if (!response.ok || !data || data.error) throw new Error(failureMessage(response, data, what));
  return data;
}
