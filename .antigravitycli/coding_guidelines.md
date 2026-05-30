## Note to the Coder
This codebase will outlive you. Every shortcut you take becomes
someone else's burden. Every hack compounds into technical debt
that slows the whole team down.

You are not just writing code. You are shaping the future of this
project. The patterns you establish will be copied. The corners
you cut will be cut again.

Fight entropy. Leave the codebase better than you found it.


## Architectural Principles

We follow the principles of **Deep Modules** to ensure long-term maintainability and AI-navigability.

- **Depth**: We prefer modules with simple **Interfaces** that hide significant **Implementation** complexity. A high ratio of "behavior provided" to "interface surface" is our primary measure of quality (**Leverage**).
- **Locality**: Related logic (e.g., the orchestration of a multi-step analysis) must live in a single **Module** to ensure bugs and changes are concentrated rather than scattered.
- **Seams**: We identify clear interfaces where implementations can be swapped or tested in isolation. We use **Adapters** to connect external dependencies (like Tauri commands or editor engines) to our domain logic.
- **Deletion Test**: A module earns its keep if deleting it would force its complexity to reappear across multiple callers. Pass-through modules are deleted.


### Test-Driven Development 
1. Write the test first - define expected behavior
2. Run test - confirm it fails correctly  
3. Write minimal code to pass
4. Run all tests - ensure nothing broke
5. Refactor while keeping tests green
6. Repeat

Never commit without passing tests.

### Production Code Standards

**Maintainability requirements:**
- Clear, self-documenting code with meaningful names
- Small, focused functions (single responsibility)
- Comprehensive test coverage (unit + integration)
- Proper error handling for edge cases
- No type shortcuts (`any`, `unknown` without guards)
- Follow existing patterns and architecture
- Comments only for complex logic

**Before every commit, ALL must pass:**
- Type checking: Zero errors
- Tests: 100% passing, no skipped
- Linting: Zero warnings  
- Build: Successful

If any check fails, fix it first.