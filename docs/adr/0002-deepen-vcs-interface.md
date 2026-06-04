# ADR 0002: Deepening the Vcs Interface (No Leaked Shell Commands)

## Status
Accepted

## Context
The `Vcs` interface historically exposed a `runGitCommand(args: string[]): string` method. This resulted in a **shallow module**. Callers of `Vcs` (such as `ContextSynthesizer`, `FeatureSource`, and `SprintOrchestrator`) were forced to construct raw Git CLI arguments (e.g., `['diff', 'main', '--name-only']`).

This tight coupling created several architectural problems:
1. **Lack of Locality:** Git-specific syntax and parsing logic was scattered throughout the codebase rather than being centralized.
2. **Testing Friction:** It was extremely difficult to unit test classes like `ContextSynthesizer` because mocking `runGitCommand` required parsing string arrays to determine what Git command the caller was attempting to run.
3. **Fragility in State Reversal:** Reverting state (such as after a Chaos Test) relied on brittle, file-specific checkouts (`git checkout -- <file>`) invoked by the orchestrator, which could fail if the working tree was left in an unexpected state.

## Decision
We will enforce a strict, **deep interface** for the `Vcs` module. 

1. **No Raw Shell Access:** The `runGitCommand` method MUST remain `private` inside the `GitVcs` adapter implementation. It cannot be exposed on the public `Vcs` interface.
2. **Domain-Level Operations:** Callers must ask the `Vcs` for domain-level operations (e.g., `getChangedFilesFromBase()`, `getDiffStatFromBase()`, `getRecentCommitHistory()`).
3. **Encapsulated Base Branch:** The `Vcs` abstraction owns the concept of the default/base branch (e.g., `main`). Callers do not specify it.
4. **Hard State Reversals:** For reverting uncommitted state (like after a chaos test), callers must use `discardUncommittedChanges()`, which performs a hard reset and clean (`git reset --hard` & `git clean -fd`), rather than trying to track and revert specific files.

## Consequences
- **Positive:** Massive increase in Leverage and Locality. All Git logic lives exactly in one file (`GitVcs.ts`).
- **Positive:** High testability. Callers like `ContextSynthesizer` can easily be unit tested using a `MockVcs` adapter.
- **Negative (Minor):** If a new, highly specific Git command is needed in the future, a developer must explicitly add a new, well-named method to the `Vcs` interface rather than just blindly shelling out. This adds a minor speed bump, but ensures architectural integrity.
