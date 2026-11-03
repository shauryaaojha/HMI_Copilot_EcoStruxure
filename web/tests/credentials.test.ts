/**
 * Email and password as the only way in: making an account, being refused,
 * and the two limits that stop a guessing run. No OAuth variable is set
 * anywhere here - the whole point of decision A is that none exists.
 *
 * The hash is checked where it would actually leak: through the route
 * handlers that return a user, not through the model that holds one.
 *
 * These cases are slow on purpose. Each sign-in and each refusal runs bcrypt
 * at the cost the application uses, and a refusal deliberately spends the same
 * time as a success, so a file that does a dozen of them takes a second or so
 * even on an idle machine. Under load - a full suite beside a build, say - it
 * can take several times that, and the default timeout turns the security
 * property into a flake. A test that fails for being slow is one people learn
 * to ignore, so the timeout is stated here rather than the cost being lowered
 * to suit it.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MemoryRepo } from "@/lib/server/repo";
import { ATTEMPTS_PER_EMAIL, ATTEMPTS_PER_IP, clearAttempts, countAttempt } from "@/lib/server/rate-limit";
import { normalizeEmail, signUp, verifyPassword } from "@/lib/server/credentials";
import { providers } from "@/lib/server/session";
import { sample } from "./fixtures/collab";

/** Generous on purpose; see the note above on bcrypt's cost. */
const SLOW = 30_000;

const state = vi.hoisted(() => ({ repo: null as unknown as MemoryRepo, session: null as { id: string; name: string; email?: string } | null }));
vi.mock("@/lib/server/repo", async original => ({ ...await original<typeof import("@/lib/server/repo")>(), repo: () => state.repo }));
vi.mock("@/auth", () => ({ auth: async () => (state.session ? { user: state.session } : null) }));
import { GET as me } from "@/app/api/me/route";
import { POST as signup } from "@/app/api/signup/route";
import { GET as members } from "@/app/api/projects/[id]/members/route";

const PASSWORD = "correct horse battery";
const post = (body: unknown) => new Request("http://localhost/api/signup", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
const from = (ip: string) => new Request("http://localhost/api/auth/callback/credentials", { method: "POST", headers: { "x-forwarded-for": ip } });

beforeEach(() => {
  state.repo = new MemoryRepo();
  state.session = null;
  // Nothing OAuth remains, so these are set empty on purpose: the suite proves
  // sign-in works without them rather than merely not reading them.
  for (const key of ["VERCEL", "AUTH_GITHUB_ID", "AUTH_GITHUB_SECRET", "AUTH_GOOGLE_ID", "AUTH_GOOGLE_SECRET"]) vi.stubEnv(key, "");
  vi.stubEnv("AUTH_SECRET", "test-only");
});
afterEach(() => vi.unstubAllEnvs());

describe("accounts", { timeout: SLOW }, () => {
  it("signs in with an email and a password, and nothing else configured", async () => {
    expect(providers()).toEqual(["credentials"]);
    const made = await signUp({ email: "Alice@Example.com", password: PASSWORD, name: "Alice" });
    expect(made.id).toMatch(/^user:[0-9a-f]{24}$/);
    expect(made).toMatchObject({ email: "Alice@Example.com", name: "Alice" });
    // The address is one account however it is capitalised.
    expect((await verifyPassword("alice@example.com", PASSWORD, from("10.0.0.1")))?.id).toBe(made.id);
    expect((await verifyPassword("  ALICE@example.com  ", PASSWORD, from("10.0.0.1")))?.id).toBe(made.id);
  });

  it("refuses a wrong password, an unknown address and a short one", async () => {
    await signUp({ email: "alice@example.com", password: PASSWORD, name: "Alice" });
    expect(await verifyPassword("alice@example.com", "wrong password here", from("10.0.0.1"))).toBeNull();
    expect(await verifyPassword("bob@example.com", PASSWORD, from("10.0.0.1"))).toBeNull();
    await expect(signUp({ email: "bob@example.com", password: "short" })).rejects.toMatchObject({ status: 400, code: "weak-password" });
    await expect(signUp({ email: "not-an-address", password: PASSWORD })).rejects.toMatchObject({ status: 400, code: "invalid" });
  });

  it("refuses a second account on one address without saying it is taken", async () => {
    expect((await signup(post({ email: "alice@example.com", password: PASSWORD, name: "Alice" }))).status).toBe(201);
    const again = await signup(post({ email: "ALICE@example.com", password: PASSWORD, name: "Someone else" }));
    expect(again.status).toBe(409);
    const body = await again.json();
    expect(body.code).toBe("unavailable");
    // Not "taken", not "already registered", not "exists": a refusal that
    // confirmed the address would answer who has an account here.
    expect(body.error).not.toMatch(/taken|registered|exists|in use/i);
    expect(body.error).toMatch(/cannot be used/i);
  });

  it("keeps the hash out of every route that returns a user", async () => {
    const made = await signUp({ email: "alice@example.com", password: PASSWORD, name: "Alice" });
    const hash = (await state.repo.users.credential("alice@example.com"))?.passwordHash;
    expect(hash).toMatch(/^\$2[aby]\$/);
    await state.repo.projects.create(made.id, sample());
    state.session = { id: made.id, name: "Alice", email: "alice@example.com" };
    const responses = [
      await signup(post({ email: "bob@example.com", password: PASSWORD, name: "Bob" })),
      await me(),
      await members(new Request("http://localhost/api/projects/project-test/members"), { params: Promise.resolve({ id: "project-test" }) }),
    ];
    for (const response of responses) {
      const text = await response.text();
      expect(response.status).toBeLessThan(400);
      expect(text).not.toContain(hash!);
      expect(text).not.toContain("$2b$");
      expect(text).not.toMatch(/passwordHash|emailKey/);
      expect(text).not.toContain(PASSWORD);
    }
    expect(await state.repo.users.get(made.id)).not.toHaveProperty("passwordHash");
  });

  it("counts attempts per email and per IP, each with its own allowance", async () => {
    for (let i = 0; i < ATTEMPTS_PER_EMAIL; i++) await countAttempt("email", "alice@example.com", ATTEMPTS_PER_EMAIL, state.repo);
    await expect(countAttempt("email", "alice@example.com", ATTEMPTS_PER_EMAIL, state.repo)).rejects.toMatchObject({ status: 429, code: "too-many-attempts" });
    // Another address, and the same address under the IP scope, are untouched.
    await countAttempt("email", "bob@example.com", ATTEMPTS_PER_EMAIL, state.repo);
    await countAttempt("ip", "alice@example.com", ATTEMPTS_PER_IP, state.repo);
    await clearAttempts("email", "alice@example.com", state.repo);
    await countAttempt("email", "alice@example.com", ATTEMPTS_PER_EMAIL, state.repo);
  });

  it("stops sign-in on a full email window, and on a full IP window for any email", async () => {
    await signUp({ email: "alice@example.com", password: PASSWORD, name: "Alice" });
    for (let i = 0; i < ATTEMPTS_PER_EMAIL; i++) await countAttempt("email", "alice@example.com", ATTEMPTS_PER_EMAIL, state.repo);
    // The right password, from an address that has never tried: the email's
    // own window is what refuses, before any hashing happens.
    await expect(verifyPassword("alice@example.com", PASSWORD, from("10.0.0.9"))).rejects.toMatchObject({ status: 429, code: "too-many-attempts" });
    for (let i = 0; i < ATTEMPTS_PER_IP; i++) await countAttempt("ip", "10.0.0.7", ATTEMPTS_PER_IP, state.repo);
    // A different address, unused so far, still refused: the IP is full.
    await expect(verifyPassword("bob@example.com", PASSWORD, from("10.0.0.7"))).rejects.toMatchObject({ status: 429, code: "too-many-attempts" });
    expect(await verifyPassword("bob@example.com", PASSWORD, from("10.0.0.8"))).toBeNull();
  });

  it("forgets an email's failures once it has been used", async () => {
    await signUp({ email: "alice@example.com", password: PASSWORD, name: "Alice" });
    expect(await verifyPassword("alice@example.com", "wrong password here", from("10.0.0.1"))).toBeNull();
    expect((await verifyPassword("alice@example.com", PASSWORD, from("10.0.0.1")))?.name).toBe("Alice");
    for (let i = 0; i < ATTEMPTS_PER_EMAIL; i++) await countAttempt("email", "alice@example.com", ATTEMPTS_PER_EMAIL, state.repo);
  });

  it("will not hold an account it could not sign anyone into", async () => {
    vi.stubEnv("AUTH_SECRET", "");
    expect(providers()).toEqual([]);
    await expect(signUp({ email: "alice@example.com", password: PASSWORD })).rejects.toMatchObject({ status: 503, code: "configuration" });
    expect(normalizeEmail(" A@b.co ")).toEqual({ email: "A@b.co", emailKey: "a@b.co" });
  });
});
