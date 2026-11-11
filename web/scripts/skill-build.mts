/**
 * Writes skills/hmi-copilot/SKILL.md (repo root) from the connector's guide,
 * so the claude.ai Skill and the `guide` tool can never say different things.
 *
 *   npm run skill:build
 *
 * Then zip the folder skills/hmi-copilot and upload it in claude.ai:
 * Settings > Capabilities > Skills > Upload skill.
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { guideMarkdown } from "../src/lib/mcp/guide";

const here = dirname(fileURLToPath(import.meta.url));
const out = resolve(here, "../../skills/hmi-copilot/SKILL.md");

const front = `---
name: hmi-copilot
description: Prior knowledge for building EcoStruxure Operator Terminal Expert (OTE) HMI projects through the HMI Copilot connector - what the engineer wants, what a complete project is, how PLC tags are named and created, how to bind the engineer's words to tags, what OTE refuses, how to replace a screen given again, and how to import and export projects. Use whenever the HMI Copilot connector's tools are available, or the user asks for HMI screens, OTE projects, PLC tags, bindings, alarms or an .eote file.
---

# HMI Copilot

This file is generated from web/src/lib/mcp/guide.ts by \`npm run skill:build\`. Edit the guide, not this file.
The connector serves the same text through its \`guide\` tool.
`;

mkdirSync(dirname(out), { recursive: true });
writeFileSync(out, `${front}\n${guideMarkdown()}\n`, "utf8");
console.log(`wrote ${out}`);
