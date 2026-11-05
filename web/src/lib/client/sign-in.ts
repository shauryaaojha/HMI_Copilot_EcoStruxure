/**
 * Asking someone to sign in, from anywhere in the app.
 *
 * Most of what costs money or reads the server needs an account, and those
 * checks live on the server. A check that only ever answers 401 leaves the
 * visitor reading "Sign in to use the Copilot" with nothing to press. So one
 * watcher sees every answer the app gets, and a refusal opens the sign-in
 * prompt, whichever feature ran into it.
 *
 * What does not prompt, on purpose:
 * - the sign-in routes themselves, where a refusal is the form's own business;
 * - calls that run on their own and have a way to carry on without an account,
 *   like live sync and matching tags, so nothing pops up unasked;
 * - other reads, because a panel that loads on sight should say so in place
 *   (SignInNotice) and not open a dialog over the page.
 */

export type SignInMode = "in" | "up";

export interface SignInAsk {
  mode?: SignInMode;
  /** The sentence the prompt opens with: usually the server's own. */
  reason?: string;
}

const ASKED = "hmi-sign-in";
/** Told when the server has just refused someone, so a stale "signed in" gets rechecked. */
export const SIGN_IN_REFUSED = "hmi-sign-in-refused";

export function openSignIn(ask: SignInAsk = {}): void {
  window.dispatchEvent(new CustomEvent<SignInAsk>(ASKED, { detail: ask }));
}

export function onSignInAsked(listener: (ask: SignInAsk) => void): () => void {
  const heard = (event: Event) => listener((event as CustomEvent<SignInAsk>).detail ?? {});
  window.addEventListener(ASKED, heard);
  return () => window.removeEventListener(ASKED, heard);
}

const held = (place: string) => `hmi-sign-in-draft:${place}:${window.location.pathname}`;

/** Signing in reloads the page, so what someone had just typed waits for them here. */
export function holdDraft(place: string, text: string): void {
  try {
    window.sessionStorage.setItem(held(place), text);
  } catch {
    // A private window may refuse. The draft stays in the box until the reload.
  }
}

export function takeDraft(place: string): string | null {
  try {
    const text = window.sessionStorage.getItem(held(place));
    window.sessionStorage.removeItem(held(place));
    return text;
  } catch {
    return null;
  }
}

const NEVER: RegExp[] = [
  /^\/api\/auth(\/|$)/,
  /^\/api\/me$/,
  /^\/api\/signup$/,
  /^\/api\/mcp(\/|$)/,
  /^\/api\/oauth(\/|$)/,
  /^\/api\/realtime(\/|$)/,
  // A share link has its own page for this, and it comes back to the link.
  /^\/api\/shares\/open$/,
  // Runs by itself after a tag upload, and falls back to the rules when refused.
  /^\/api\/tags\/match$/,
  /\/presence$/,
  /\/realtime-token$/,
];

/** The project's own saves and reads, which repeat without anyone pressing anything. */
const AUTOMATIC: RegExp[] = [/^\/api\/projects$/, /^\/api\/projects\/[^/]+$/, /^\/api\/projects\/[^/]+\/changes$/];

/**
 * "action": someone pressed something, so every refusal prompts.
 * "automatic": it repeats by itself, so it prompts once a page load.
 * null: no prompt.
 */
export function promptKind(path: string, method: string): "action" | "automatic" | null {
  if (!path.startsWith("/api/") || NEVER.some((rule) => rule.test(path))) return null;
  const verb = method.toUpperCase();
  const reading = verb === "GET" || verb === "HEAD" || verb === "OPTIONS";
  if (reading) return /^\/api\/projects\/[^/]+$/.test(path) ? "automatic" : null;
  if (verb !== "DELETE" && AUTOMATIC.some((rule) => rule.test(path))) return "automatic";
  return "action";
}

/** The server's sentence for a refusal, read from a response nothing else will read. */
export async function signInSentence(response: Response): Promise<string> {
  const body = (await response.json().catch(() => null)) as { error?: unknown } | null;
  return typeof body?.error === "string" && body.error ? body.error : "Sign in to continue.";
}

function requestOf(input: RequestInfo | URL, init: RequestInit | undefined, origin: string): { path: string; method: string } | null {
  try {
    const isRequest = typeof Request !== "undefined" && input instanceof Request;
    const url = new URL(isRequest ? input.url : String(input), origin);
    if (url.origin !== origin) return null;
    return { path: url.pathname, method: init?.method ?? (isRequest ? input.method : "GET") };
  } catch {
    return null;
  }
}

/**
 * A fetch that behaves exactly like the real one and also reports a refusal.
 * The caller still gets the whole 401 to read, and any answer other than 401 is
 * not touched at all, so streams and downloads cost nothing.
 */
export function watchFetch(real: typeof fetch, ask: (ask: SignInAsk) => void, origin: string): typeof fetch {
  let askedAutomatically = false;
  return async (input, init) => {
    const response = await real(input, init);
    if (response.status !== 401) return response;
    const request = requestOf(input, init, origin);
    const kind = request && promptKind(request.path, request.method);
    if (!kind) return response;
    if (kind === "automatic") {
      if (askedAutomatically) return response;
      askedAutomatically = true;
    }
    void signInSentence(response.clone()).then((reason) => ask({ mode: "in", reason }));
    return response;
  };
}
