# Agent Instructions

## Stack Context
TypeScript (ESNext/CommonJS) · Node.js v20+ · ts-node/tsc.
DO NOT use custom/obsolete build systems, CRA, or backend framework patterns outside processes specified in [ARCHITECTURE.md](file:///E:/00_HeadQuaters/50_Projects/ominiloop/ARCHITECTURE.md).

## Commands
- Dev Run: `npm start`
- Build: `npm run build`
- Install: `npm install`
- Test: Use scripts defined or run with standard runner checks

## Boundary Rules (Ask First)
- RULE-A1: **Ask before** modifying `package.json` or `tsconfig.json`. Never install dependencies autonomously.
- RULE-A2: **Ask before** adding any new top-level command arguments or features in `src/cli/` or orchestrators in `src/core/`. Verify placement in [ARCHITECTURE.md](file:///E:/00_HeadQuaters/50_Projects/ominiloop/ARCHITECTURE.md) first.
- RULE-A3: **Ask before** creating new root-level documentation files. Use `docs/` or update existing files.
- RULE-A4: **Ask before** committing code or pushing changes.

## Shared Rules
- RULE-D1: Never duplicate utility/helper functions. Check [src/utils/](file:///E:/00_HeadQuaters/50_Projects/ominiloop/src/utils/) or existing state/VCS modules first.
- RULE-D2: Never duplicate information across docs. Write once, link to it.
- RULE-F1: Enforce strictly one responsibility per file. No "God Modules". Use size (>250 lines for TypeScript files) as a diagnostic signal to review for split, not a hard barrier.
- RULE-IO: All state I/O must go through [Workspace.ts](file:///E:/00_HeadQuaters/50_Projects/ominiloop/src/state/Workspace.ts). No implicit `fs.readFileSync` or `fs.existsSync` in orchestrators.
- RULE-LOG: Do not use `console.log` for execution state/tracing. Use standard logger methods from [logger.ts](file:///E:/00_HeadQuaters/50_Projects/ominiloop/src/utils/logger.ts).
- RULE-ERR: NO silent failures. Unhandled exceptions must not be swallowed. Catch and log appropriately.

## Key Docs (read on-demand, not every turn)
- Domain & glossary: [CONTEXT.md](file:///E:/00_HeadQuaters/50_Projects/ominiloop/CONTEXT.md)
- Component map & architecture: [ARCHITECTURE.md](file:///E:/00_HeadQuaters/50_Projects/ominiloop/ARCHITECTURE.md)
- Agent Rules & Guardrails: [AGENTS.md](file:///E:/00_HeadQuaters/50_Projects/ominiloop/AGENTS.md)
- Root Readme: [README.md](file:///E:/00_HeadQuaters/50_Projects/ominiloop/README.md)
