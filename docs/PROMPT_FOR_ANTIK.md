# Prompt for Antik's Claude

Paste everything inside the block below into Antik's Claude session, in the HMI Copilot repo.

```
You are working on HMI Copilot, a Next.js app (code in web/) that generates Schneider
EcoStruxure Operator Terminal Expert (OTE) 4.4 projects (.eote files) from PLC tags or
from a plant description. Repo: https://github.com/shauryaaojha/HMI_Copilot_EcoStruxure

Your job is the architecture work in docs/PLAN_FULL_ARCHITECTURE.md: finish splitting
the code into modules, then move storage onto Supabase behind the existing interfaces.
You are doing phases 1 and 2 of that plan. Do not start phases 3 to 6.

Read these first, in order:
1. docs/PLAN_FULL_ARCHITECTURE.md (the whole plan; sections 1 and 2 are your scope)
2. docs/PLAN_SERVICE_SPLIT.md (why we split modules, not services)
3. web/src/lib/refs/index.ts (the reference and cascade rules, already split out)
4. web/src/lib/server/storage.ts (the Data and Storage interfaces you will implement against)

Branch: start from main at 62f4f85 (every feature branch is merged into it; the
baseline is 1184 passing). Create your branch from there, for example
feat/split-and-supabase. Do not start from any older feature branch.

PHASE 1: finish the split (no behaviour change)
- Split web/src/store/project.ts into Zustand slices by domain: screens, objects,
  tags and bindings, alarms and composites, collaboration. One store stays, so undo and
  collab still see one history.
- Move the write path (applyOps in web/src/lib/ai/applier.ts and the Op union in
  web/src/lib/ai/ops.ts) behind a core/ops module. It must be the only way to change
  project state from chat, the inspector, or later the MCP server.
- Target: web/src/store/project.ts under 400 lines.
- Every existing test must pass unchanged. Do not edit a test to make it pass. If a
  test fails, the refactor changed behaviour: fix the refactor.

PHASE 2: Postgres behind the Data interface (Supabase)
- Implement the Data and Storage.bytes interfaces from web/src/lib/server/storage.ts
  against Supabase Postgres, selected by an environment flag. The Mongo and filesystem
  implementations stay as they are.
- Run the existing repository tests (web/tests/*repo*, *collab*, *versions*, and any
  that use Repo) against both backends. The results must match.
- Write a one-off migration from the Mongo collections to Postgres, with a dry-run
  mode that prints row counts per table and the last revision per project. The
  migration must keep revision order and the op log.
- Verify the Supabase facts yourself before you rely on them: the Realtime limits and
  pricing page, the connection string to use from Vercel functions (pooler or direct),
  and the Storage upload limits. The plan marks these as unverified. Write what you
  find into docs/SUPABASE_FACTS.md with the source URL and the date.

RULES
- Keep the suite green. Baseline: 1184 passing, 17 skipped, typecheck clean. Run
  `cd web && npx vitest run` and `npx tsc --noEmit -p .` before each commit.
- Never commit web/skeleton/ or web/src/lib/ote/graphics-index.json. They are
  Schneider's files and are gitignored; keep them that way.
- Commit messages are plain sentences in the same style as `git log`. Do not add any
  Co-Authored-By or "Generated with" line. Commits carry the author's name only.
- Never commit or push secrets. Supabase keys go in environment variables; the
  service-role key is server-side only and never in client code.
- Do not push, open a PR, or merge without asking Shaurya first.
- Do not run `npm run build` while a `next dev` server is running; it corrupts .next.
- Do not decide these; they belong to Shaurya (see section 6 of the plan): auth
  provider (NextAuth or Supabase Auth), the Supabase plan, and the claude.ai account
  type. If your work depends on one of them, stop at that point and ask.

REPORT when you finish each phase, in this order:
1. What is done and tested, with the exact test counts before and after.
2. What is blocked, and on which decision.
3. Any place where the plan was wrong or a fact did not match the code. Name the file
   and line.
4. The branch name and the commits (hashes and subjects). Do not push.
```

## Notes for Shaurya

- Antik's Claude needs access to the repo and the environment variables for Supabase before phase 2 can be tested. Phase 1 needs no keys.
- Decisions 1 and 2 in the plan must be answered before phase 2 starts. Phase 1 can start now, on the branch you name.
