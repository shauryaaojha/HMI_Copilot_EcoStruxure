/**
 * The server's sign-in checks have to meet a button. A refusal opens the prompt,
 * nothing pops up unasked, and /signin and /signup are real pages.
 */
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/server/session", () => ({
  currentUser: async () => null,
  providers: () => ["credentials"],
}));
vi.mock("next-auth/react", () => ({ signIn: async () => ({}), signOut: async () => {} }));

import SignInPage from "@/app/signin/page";
import SignUpPage from "@/app/signup/page";
import { AuthLinks } from "@/components/landing/AuthLinks";
import { holdDraft, promptKind, signInSentence, takeDraft, watchFetch, type SignInAsk } from "@/lib/client/sign-in";

const ORIGIN = "https://hmi.example";

function refused(error = "Sign in to use the Copilot") {
  return new Response(JSON.stringify({ error, code: "unauthorized" }), { status: 401 });
}

function watched(answer: () => Response) {
  const asked: SignInAsk[] = [];
  const real = vi.fn(async () => answer());
  const watch = watchFetch(real as unknown as typeof fetch, (ask) => asked.push(ask), ORIGIN);
  const settled = () => new Promise((resolve) => setTimeout(resolve, 0));
  return { asked, watch, settled };
}

describe("which refusals prompt", () => {
  it.each([
    ["/api/chat", "POST"],
    ["/api/generate", "POST"],
    ["/api/agent", "POST"],
    ["/api/brief/draft", "POST"],
    ["/api/critique", "POST"],
    ["/api/knowledge", "POST"],
    ["/api/account/password", "POST"],
    ["/api/projects/p1/comments", "POST"],
    ["/api/projects/p1", "DELETE"],
  ])("%s %s prompts every time", (path, method) => {
    expect(promptKind(path, method)).toBe("action");
  });

  it.each([
    ["/api/projects", "POST"],
    ["/api/projects/p1", "PUT"],
    ["/api/projects/p1", "GET"],
    ["/api/projects/p1/changes", "POST"],
  ])("%s %s repeats by itself, so it prompts once", (path, method) => {
    expect(promptKind(path, method)).toBe("automatic");
  });

  it.each([
    ["/api/auth/callback/credentials", "POST"],
    ["/api/me", "GET"],
    ["/api/signup", "POST"],
    ["/api/mcp", "POST"],
    ["/api/oauth/token", "POST"],
    ["/api/shares/open", "POST"],
    ["/api/tags/match", "POST"],
    ["/api/projects/p1/presence", "POST"],
    ["/api/projects/p1/realtime-token", "POST"],
    ["/api/knowledge", "GET"],
    ["/api/projects", "GET"],
    ["/signin", "GET"],
  ])("%s %s never pops up", (path, method) => {
    expect(promptKind(path, method)).toBeNull();
  });
});

describe("the watcher", () => {
  it("opens the prompt with the server's sentence and leaves the 401 readable", async () => {
    const { asked, watch, settled } = watched(() => refused());
    const response = await watch("/api/chat", { method: "POST" });
    expect(response.status).toBe(401);
    expect(await response.json()).toMatchObject({ error: "Sign in to use the Copilot" });
    await settled();
    expect(asked).toEqual([{ mode: "in", reason: "Sign in to use the Copilot" }]);
  });

  it("asks again for each thing someone presses, and once for what repeats by itself", async () => {
    const { asked, watch, settled } = watched(() => refused());
    await watch("/api/chat", { method: "POST" });
    await watch("/api/chat", { method: "POST" });
    await settled();
    expect(asked).toHaveLength(2);
    await watch("/api/projects/p1", { method: "PUT" });
    await watch("/api/projects/p1", { method: "PUT" });
    await settled();
    expect(asked).toHaveLength(3);
  });

  it("ignores any other answer, a read of a panel, and another site's 401", async () => {
    const fine = watched(() => new Response("{}", { status: 200 }));
    await fine.watch("/api/chat", { method: "POST" });
    const forbidden = watched(() => new Response("{}", { status: 403 }));
    await forbidden.watch("/api/chat", { method: "POST" });
    const panel = watched(() => refused());
    await panel.watch("/api/knowledge");
    const elsewhere = watched(() => refused());
    await elsewhere.watch("https://api.other.example/api/chat", { method: "POST" });
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect([fine.asked, forbidden.asked, panel.asked, elsewhere.asked].flat()).toEqual([]);
  });

  it("reads the method and address off a Request too", async () => {
    const { asked, watch, settled } = watched(() => refused());
    await watch(new Request(`${ORIGIN}/api/generate`, { method: "POST" }));
    await settled();
    expect(asked).toHaveLength(1);
  });

  it("has a sentence even when the body is not JSON", async () => {
    expect(await signInSentence(new Response("nope", { status: 401 }))).toBe("Sign in to continue.");
  });
});

describe("what was typed before signing in", () => {
  function browserAt(pathname: string, storage = new Map<string, string>()) {
    vi.stubGlobal("window", {
      location: { pathname },
      sessionStorage: {
        getItem: (key: string) => storage.get(key) ?? null,
        setItem: (key: string, value: string) => void storage.set(key, value),
        removeItem: (key: string) => void storage.delete(key),
      },
    });
    return storage;
  }

  it("comes back once, on the same page and box only", () => {
    const storage = browserAt("/project/a");
    holdDraft("chat", "Build a pump screen");
    expect(takeDraft("agent")).toBeNull();
    browserAt("/project/b", storage);
    expect(takeDraft("chat")).toBeNull();
    browserAt("/project/a", storage);
    expect(takeDraft("chat")).toBe("Build a pump screen");
    expect(takeDraft("chat")).toBeNull();
    vi.unstubAllGlobals();
  });

  it("does not break where the browser refuses storage", () => {
    vi.stubGlobal("window", { location: { pathname: "/" }, get sessionStorage() { throw new Error("denied"); } });
    expect(() => holdDraft("chat", "x")).not.toThrow();
    expect(takeDraft("chat")).toBeNull();
    vi.unstubAllGlobals();
  });
});

describe("the pages", () => {
  const html = async (page: typeof SignInPage) =>
    renderToStaticMarkup(await page({ searchParams: Promise.resolve({ next: "/project/p1" }) }));

  it("/signin opens on signing in", async () => {
    const page = await html(SignInPage);
    expect(page).toContain("Sign in to HMI Copilot");
    expect(page).toContain("current-password");
    expect(page).toMatch(/aria-pressed="true"[^>]*>Sign in</);
  });

  it("/signup opens on making an account, with the password rule", async () => {
    const page = await html(SignUpPage);
    expect(page).toContain("Create your account");
    expect(page).toContain("new-password");
    expect(page).toContain("At least 10 characters.");
    expect(page).toMatch(/aria-pressed="true"[^>]*>Sign up</);
    expect(page).toContain(">Create account<");
  });

  it("the landing header has both links in the server's HTML, before any script runs", () => {
    const header = renderToStaticMarkup(createElement(AuthLinks));
    expect(header).toContain('href="/signin"');
    expect(header).toContain('href="/signup"');
  });
});
