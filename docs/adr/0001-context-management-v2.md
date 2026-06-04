# ADR 0001: Context Management V2 and Truncation Strategies

## Status
Accepted

## Context
Our OmniLoop was suffering from severe token inefficiency and a phenomenon known as "Context Urgency" (where an LLM rushes to finish a task because its input prompt is nearing the token limit). 

The primary causes were unbounded context growth in `ContextSynthesizer.ts` and `SprintOrchestrator.ts`:
1. Recursive injection of documentation directories (`.agents`, `.gemini`, etc.) without size limits.
2. Injecting raw `git diff main`, which scales linearly as the sprint branch progresses, eventually consuming the entire context window.
3. Blindly appending output from `ctags -x` on all modified files.
4. Passing large `sprintContract.md` and evaluator feedback files from cycle to cycle without pruning.

## Decision
We have upgraded to a **V2 Context Management System** that prioritizes high signal-to-noise ratio and structural limits over comprehensive historical injection.

Specific implementation details:
1. **Context Appending Safeguards**: Introduced an `appendContext(label, content, maxLength)` helper that enforces hard character limits per injected file (e.g., 5,000 for single docs, 8,000 for directories/CTAGS).
2. **Diff Summarization**: Replaced `git diff main` with `git diff main --stat`. The agent now receives the names and magnitude of modified files rather than the full raw code diff.
3. **Sprint Artifact Truncation**: Enforced character limits when `SprintOrchestrator.ts` reads `feedbackFile` (max 5,000 chars) and `sprintContractFile` (max 8,000 chars).
4. **Global Hard Limit**: Implemented a global `MAX_CONTEXT_LENGTH` (40,000 chars) on the synthesized context string. If exceeded, the context is strictly truncated from the bottom to explicitly prevent Context Urgency.

## Consequences
- **Positive:** Agents will no longer exhaust their context windows. Cost per sprint will decrease, and output quality will increase since the LLM will not feel "rushed".
- **Negative:** If a specific global instruction is placed at the end of a very large documentation set, it might get truncated. Documentation should prioritize brevity, and explicit commands should be routed through the `human_advice.md` side-channel.
