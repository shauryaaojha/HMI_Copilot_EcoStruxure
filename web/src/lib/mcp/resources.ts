/**
 * The engineer's projects, as resources.
 *
 * `list_projects` answers a model that thought to ask. A resource is what the
 * person sees: every project they are a member of appears by name in the
 * host's own picker, and attaching one puts its screens, their objects and
 * the tag behind each in the conversation - which is how an existing project
 * becomes the example a new one is drawn from.
 *
 * Nothing here is a second way in. The listing is the membership list
 * `list_projects` walks, a read goes through `openProject` like every tool's
 * does, and the text leaves inside the same fence (lib/mcp/data.ts).
 */
import { ResourceTemplate, type McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { repo } from "@/lib/server/repo";
import type { Caller } from "./caller";
import { capped, field, limited, projectData, RESULT_LIMIT } from "./data";
import { openProject, screenLines } from "./project";

const SCHEME = "hmi-copilot://project/";
/** The same ceiling as `list_projects`. */
const PROJECT_LIMIT = 50;

/** A narrowed credential reads only with a read or write scope, as the read tools do. */
const mayRead = (caller: Caller) => !caller.scopes?.length || caller.scopes.includes("mcp:read") || caller.scopes.includes("mcp:write");

/** One project, summarised the way `get_screens` summarises it, under its own name. */
export async function projectSummary(caller: Caller, projectId: string): Promise<string> {
  const { project, doc } = await openProject(caller, projectId, "read");
  const lines = [
    `project ${project._id} "${field(project.name, 120)}" | panel ${field(project.target?.model, 40)} ${project.target?.width}x${project.target?.height}`,
    `${doc.screens.length} screens, ${doc.variables.length} tags, ${doc.alarms.length} alarms`,
    ...screenLines(doc).flatMap((screen) => [
      `${screen.handle} "${field(screen.name, 80)}" ${screen.width}x${screen.height}, ${screen.objects.length} objects`,
      ...screen.objects.map((o) => `  ${o.handle} ${field(o.name, 80)} [${o.type}, ${o.tag ? `shows ${field(o.tag, 80)}` : "unbound"}]`),
    ]),
  ];
  return capped(projectData("project", limited(lines, RESULT_LIMIT - 1_000)));
}

export function registerProjects(server: McpServer, caller: Caller): void {
  server.registerResource(
    "project",
    new ResourceTemplate(`${SCHEME}{id}`, {
      list: async () => {
        if (!mayRead(caller)) return { resources: [] };
        const projects = (await repo().projects.list(caller.userId)).slice(0, PROJECT_LIMIT);
        return {
          resources: projects.map((project) => ({
            uri: `${SCHEME}${project._id}`,
            name: field(project.name, 120) || project._id,
            description: `HMI project, ${field(project.target?.model, 40)} ${project.target?.width}x${project.target?.height}, last changed ${new Date(project.updatedAt).toISOString().slice(0, 10)}`,
            mimeType: "text/plain",
          })),
        };
      },
    }),
    { title: "HMI project", description: "One of the engineer's HMI projects: its screens, the objects on each and the tag behind every object. Read one to follow its conventions in another.", mimeType: "text/plain" },
    async (uri, variables) => {
      if (!mayRead(caller)) throw new Error("This connection was not granted the mcp:read scope.");
      const id = String(Array.isArray(variables.id) ? variables.id[0] : variables.id);
      return { contents: [{ uri: uri.href, mimeType: "text/plain", text: await projectSummary(caller, id) }] };
    },
  );
}
