/**
 * Export through a link: the connector cannot hand Claude a file worth
 * having, so `export_project` hands back a short-lived signed URL the
 * engineer opens, and this module builds the same .eote the Export panel does.
 *
 * The link carries the project, the revision and the user it was made for,
 * signed with AUTH_SECRET and good for 15 minutes. Opening it runs the same
 * access check as the export route, as that user, so a forwarded link is no
 * wider than the person who asked for it.
 */
import { createHmac, timingSafeEqual } from "node:crypto";
import { packageInputOf } from "@/lib/collab/package";
import { backendFor } from "@/lib/backend";
import { readProject } from "@/lib/ote/reader";
import { getImport, importGoneMessage } from "@/lib/ote/imports";
import { preflight, selfCheck, type PreflightProblem } from "@/lib/ote/preflight";
import { readSource, requireAccess } from "./access";
import { ServerError } from "./errors";
import { repo, type User } from "./repo";

export const LINK_MS = 15 * 60 * 1000;

interface LinkClaims {
  p: string;
  r: number;
  u: string;
  e: number;
}

function secret(): string {
  const value = process.env.AUTH_SECRET?.trim();
  if (!value) throw new ServerError(503, "configuration", "AUTH_SECRET is not set, so export links cannot be signed");
  return value;
}

const b64 = (data: Buffer | string) => Buffer.from(data).toString("base64url");
const sign = (payload: string) => b64(createHmac("sha256", secret()).update(`export-link:${payload}`).digest());

export function signExportLink(projectId: string, rev: number, userId: string, now = Date.now()): string {
  const payload = b64(JSON.stringify({ p: projectId, r: rev, u: userId, e: now + LINK_MS } satisfies LinkClaims));
  return `${payload}.${sign(payload)}`;
}

export function readExportLink(token: string, now = Date.now()): LinkClaims {
  const [payload, mac] = token.split(".");
  if (!payload || !mac) throw new ServerError(400, "invalid", "That export link is not complete");
  const want = Buffer.from(sign(payload));
  const got = Buffer.from(mac);
  if (want.length !== got.length || !timingSafeEqual(want, got)) throw new ServerError(403, "forbidden", "That export link was not made here");
  let claims: LinkClaims;
  try {
    claims = JSON.parse(Buffer.from(payload, "base64url").toString("utf8"));
  } catch {
    throw new ServerError(400, "invalid", "That export link is not readable");
  }
  if (!claims || typeof claims.p !== "string" || typeof claims.u !== "string" || !Number.isSafeInteger(claims.r)) throw new ServerError(400, "invalid", "That export link is not readable");
  if (claims.e < now) throw new ServerError(410, "expired", "That export link has expired; ask Claude for a new one, or export from the app");
  return claims;
}

const safeName = (name: string) => name.replace(/[^A-Za-z0-9._-]+/g, "_").replace(/^_+|_+$/g, "") || "project";

/** The problems that stop a project exporting, before any link is made. */
export async function exportProblems(projectId: string, rev: number): Promise<PreflightProblem[]> {
  const snapshot = await repo().live.at(projectId, rev);
  if (!snapshot) throw new ServerError(409, "rev-gone", "That revision is no longer available");
  if (!snapshot.screens?.length) return [{ where: "project", problem: "A project needs at least one screen before it can be exported" }];
  return preflight(packageInputOf(snapshot));
}

/** The .eote for one revision, as the user would get it from the Export panel. */
export async function exportBytes(user: User, projectId: string, rev: number): Promise<{ bytes: Uint8Array; fileName: string }> {
  await requireAccess(user, projectId, "export");
  const snapshot = await repo().live.at(projectId, rev);
  if (!snapshot) throw new ServerError(409, "rev-gone", "That revision is no longer available; ask for a new link");
  const input = packageInputOf(snapshot);
  if (!input.screens.length) throw new ServerError(400, "invalid", "A project needs at least one screen");
  const problems = preflight(input);
  if (problems.length) throw new ServerError(422, "preflight", `The project has ${problems.length} problem(s) to fix before it can be exported: ${problems[0].where}: ${problems[0].problem}`);
  const backend = backendFor("eote");
  let bytes: Uint8Array;
  if (input.source && /^[0-9a-f-]{36}$/i.test(input.source)) {
    const stored = await readSource(input.source, user, "export");
    const original = stored?.bytes ?? (await getImport(input.source));
    if (!original) throw new ServerError(409, "source-gone", importGoneMessage());
    const read = await readProject(original);
    bytes = await backend.write(input, read.preserved);
  } else {
    bytes = await backend.write(input);
  }
  await selfCheck(bytes, input);
  return { bytes, fileName: `${safeName(snapshot.name ?? "project")}.eote` };
}
