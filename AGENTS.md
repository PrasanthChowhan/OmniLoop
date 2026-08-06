# AI Agent Guardrails & Guidelines

This document outlines the strict behavioral constraints, coding standards, and architectural rules for AI agents operating within the OmniLoop codebase.

## Hard Rules (Zero Tolerance)

1. **NO "God Modules"**: Do not create or append to monolithic files. Every module MUST have a single responsibility.
2. **NO Implicit I/O**: Do not sprinkle `fs.readFileSync` or `fs.existsSync` in orchestration logic. All state I/O must go through `src/state/Workspace.ts`.
3. **NO Console Logs for State**: Use standard logger methods from `src/utils/logger.ts` for tracing execution.
4. **NO Silent Failures**: Unhandled exceptions must not be swallowed. Catch and log appropriately.
5. **Ask First**: DO NOT add new runtime dependencies (e.g., `npm install`) without explicitly asking the user for permission.

## Patterns & Snippets

### ✅ Expected: Clean Dependency Injection & Separation of Concerns

```typescript
// src/core/MyOrchestrator.ts
import { Workspace } from '../state/Workspace';
import { Logger } from '../utils/logger';

export class MyOrchestrator {
  constructor(private workspace: Workspace, private logger: Logger) {}

  public execute() {
    if (this.workspace.hasFeedbackFile()) {
      const feedback = this.workspace.readFeedbackFile();
      this.logger.info(`Feedback found: ${feedback}`);
    }
  }
}
```

### ❌ Anti-Pattern: Mixed Concerns & Direct I/O

```typescript
// src/core/MyOrchestrator.ts (BAD)
import * as fs from 'fs';
import * as path from 'path';

export class MyOrchestrator {
  public execute() {
    // ❌ Direct FS check mixed with business logic
    if (fs.existsSync(path.join('.omniloop', 'feedback.md'))) {
      const feedback = fs.readFileSync(path.join('.omniloop', 'feedback.md'), 'utf-8');
      console.log(`Feedback found: ${feedback}`); // ❌ console.log instead of Logger
    }
  }
}
```
