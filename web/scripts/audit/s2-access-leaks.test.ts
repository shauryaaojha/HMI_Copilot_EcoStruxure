/**
 * Two small leaks in the read path.
 *
 * S2-09: requireReader (src/lib/server/access.ts:67-70) looks the project up
 * before it asks who is calling, so a signed-out stranger is told 404 for an
 * id that does not exist and 401 for one that does. Production shows the 404
 * half read-only: GET /api/projects/abc -> 404 with no session. Routes on
 * requireAccess (members, shares, versions) answer 401 either way.
 *
 * S2-10: GET /api/projects/[id]/members (route.ts:15-27) gives every member,
 * viewers included, the email address of every other member. A viewer is
 * anyone who opened a viewer link while signed in (lib/server/shares.ts:105).
 */
import { beforeEach, expect, it, vi } from "vitest";
import { MemoryRepo, type User } from "@/lib/server/repo";
import { sample } from "../../tests/fixtures/collab";

const state = vi.hoisted(() => ({ repo: null as unknown as MemoryRepo, user: null as User | null }));
vi.mock("@/lib/server/repo", async original => ({ ...await original<typeof import("@/lib/server/repo")>(), repo: () => state.repo }));
vi.mock("@/lib/server/session", () => ({ currentUser: async () => state.user }));
import { GET as getProject } from "@/app/api/projects/[id]/route";
import { GET as members } from "@/app/api/projects/[id]/members/route";

const ctx = (id: string) => ({ params: Promise.resolve({ id }) });
const get = (id: string) => new Request(`http://localhost/api/projects/${id}`);

beforeEach(async () => {
  state.repo = new MemoryRepo();
  const owner = await state.repo.users.create({ email: "owner@plant.example", emailKey: "owner@plant.example", passwordHash: "x", name: "Owner" });
  await state.repo.projects.create(owner.id, sample());
  await state.repo.members.put("project-test", "link-viewer", "viewer");
  state.user = null;
});

it("answers a signed-out stranger the same for a real and a missing project", async () => {
  const real = (await getProject(get("project-test"), ctx("project-test"))).status;
  const missing = (await getProject(get("no-such-project"), ctx("no-such-project"))).status;
  expect({ real, missing }, "the status tells a stranger which project ids exist").toEqual({ real: 401, missing: 401 });
});
