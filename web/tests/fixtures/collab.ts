/** Minimal persisted project for repository and route contract tests. */
import type { Snapshot } from "@/lib/server/repo";
import { DEFAULT_STANDARDS } from "@/store/types";
export const sample = (id = "project-test"): Snapshot => ({ v: 3, id, name: "Station", target: { model: "HMIST6", width: 800, height: 480 }, screens: [], variables: [], alarms: [], bindings: [], objectMeta: {}, screenPlacement: {}, standards: DEFAULT_STANDARDS, versions: [], chat: [], savedAt: 0 });
