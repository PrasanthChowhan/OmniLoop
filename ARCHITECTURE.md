# Long-Running Agent OmniLoop Architecture

## Overview
This project implements a multi-agent omniloop for long-running, autonomous application development. It is heavily inspired by Anthropic's research on [OmniLoop Design for Long-Running Apps](https://www.anthropic.com/engineering/omniloop-design-long-running-apps) and [Effective OmniLoopes for Long-Running Agents](https://www.anthropic.com/engineering/effective-omniloopes-for-long-running-agents).

The goal of this omniloop is to solve common failure modes of LLMs when dealing with complex, multi-step engineering tasks, such as:
1. **Context Exhaustion & One-Shotting:** Trying to do too much in a single context window and running out of space, leaving code in a broken state.
2. **Context Anxiety:** Prematurely wrapping up tasks as the context limit approaches.
3. **False Completions:** Marking Features as complete without sufficient empirical testing.
4. **Self-Evaluation Bias:** Agents grading their own generated outputs too generously, leading to generic or non-functional products.

To achieve this, the omniloop separates concerns across a GAN-inspired (Generative Adversarial Network) multi-agent architecture with a strict workflow: **Planner -> (Contractor ↔ Reviewer) -> (Generator ↔ Evaluator)**.

## Core Concepts & "The Why" (Ubiquitous Language)

### 1. Separation of Concerns (The GAN Pattern)
**Why:** When asked to evaluate work they've produced, agents tend to respond by confidently praising it—even when the quality is mediocre.
**How:** By separating the **Generator** (who writes the code) from the **Evaluator** (who tests and critiques it), we create a feedback loop that drives the **Generator** toward stronger, more polished outputs. The **Evaluator** acts as an adversarial check with hard quality thresholds for both functionality and aesthetics.

### 2. Incremental Progress (The Ralph Loop)
**Why:** Models lose coherence on lengthy tasks. We must avoid monolithic generation.
**How:** We break the project down into atomic **Features** via a durable **Blueprint** (`.omniloop/blueprint.json`). The agent works on only one **Feature** at a time, branching in the **VCS**, and committing changes. This ensures the environment is left in a clean, mergeable state after every step.

### 3. Contract Negotiation Before Code
**Why:** Vague requirements lead to divergent implementations and testing failures, cascading errors down the pipeline.
**How:** Before writing code for a **Sprint**, a **Contractor** agent proposes a `.omniloop/sprint_contract.md` detailing implementation and success metrics. A **Reviewer** reviews this. Only when approved (`.omniloop/contract_approved.txt`) does the **Generator** start coding. This bridges the gap between high-level specs and testable code.

### 4. Empirical Testing & Meta-Evaluation (Chaos Testing)
**Why:** Agents often verify code statically or perform shallow tests, marking broken features as "done".
**How:** The **Evaluator** is forced to write actual UI automation tests (e.g., Playwright/Puppeteer) and behave like a human user. Furthermore, in the first **Cycle** of a **Sprint**, the omniloop injects a blatant syntax bug (**Chaos Test**). The **Evaluator** MUST fail the build. If it passes the broken build, it fails the meta-evaluation, preventing "false passes" due to lazy testing.

### 5. Durable State and Handoffs
**Why:** Each context window starts fresh (context resets). The agent needs to quickly understand what happened previously without a massive context history overhead.
**How:** We maintain durable artifacts:
- `.omniloop/blueprint.json`: The source of truth for all **Project** requirements and **Sprint** states.
- `.omniloop/omniloop-progress.txt`: A living log of what has been done.
- **VCS Commit History:** Provides exact code diffs and rollback capabilities if an agent goes off the rails.

## Directory Map & Decision Table

The codebase has been refactored to eliminate "God Modules" and enforce a single-responsibility architecture. All new files must be placed according to the following decision table:

| Directory | Purpose / Allowed Files | Examples |
|-----------|-------------------------|----------|
| `src/cli/` | CLI parsing, argument handling, terminal UI | `args.ts`, `index.ts` (entrypoint) |
| `src/core/` | High-level business logic, orchestrators, workflows | `SprintOrchestrator.ts`, `PlannerOrchestrator.ts`, `AgentRunner.ts` |
| `src/state/` | File system I/O wrappers, durable state persistence | `Workspace.ts`, `BlueprintRepository.ts`, `ContextSynthesizer.ts` |
| `src/vcs/` | Git and version control abstractions | `Vcs.ts` |
| `src/utils/` | Centralized helpers, common parsers, logging | `logger.ts`, `PromptResolver.ts`, `StructuredOutput.ts` |

## Architecture & Agent Personas

### 1. Planner Agent (`.omniloop/planner_prompt.md`)
- **Role:** The Architect & Visionary.
- **Task:** Expands a simple user prompt into a high-fidelity **Blueprint**. Focuses on product context and high-level technical design rather than granular implementation.
- **Output:** Creates `.omniloop/blueprint.json` and an `.omniloop/init.sh` script to set up the environment. *It does NOT write app logic.*

### 2. Contractor Agent (`.omniloop/contractor_prompt.md`)
- **Role:** The Specifier.
- **Task:** Defines the specific implementation details for the upcoming **Sprint**.
- **Output:** Creates `.omniloop/sprint_contract.md`.

### 3. Reviewer Agent (`.omniloop/reviewer_prompt.md`)
- **Role:** The Blueprint Reviewer (formerly Contract Evaluator).
- **Task:** Reviews the **Contractor's** proposal to ensure architectural soundness and alignment with the **Blueprint**.
- **Output:** Approves with `.omniloop/contract_approved.txt` or rejects with detailed feedback in `.omniloop/sprint_feedback.md`.

### 4. Generator Agent (`.omniloop/generator_prompt.md`)
- **Role:** The Craftsman (Lead Developer).
- **Task:** Implements the **Feature** exactly as specified in the approved **Contract**. Focuses on code quality, type safety, and UI fidelity.
- **Output:** Commits code to the **VCS**, appends progress to `omniloop-progress.txt`.

### 5. Evaluator Agent (`.omniloop/evaluator_prompt.md`)
- **Role:** The Critic & Guardian (Head of QA and Design).
- **Task:** Tests the **Generator's** work empirically against functionality, aesthetics, and robustness. Fails the build if it doesn't meet the high bar.
- **Output:** Updates the **Blueprint** to passing upon success, or writes gritty critique back into `sprint_feedback.md` upon failure.

## Workflow Lifecycle

The omniloop is modularized into several key directories:

1. **`src/state/Workspace`**: Owns the knowledge of the omniloop directory structure (`.omniloop`) and provides a deep interface for state persistence (metrics, traces, features). All explicit `fs` interactions regarding state belong here.
2. **`src/vcs/Vcs` (GitVcs)**: Abstracts source control operations, providing a clean interface for branch management and state checkpoints.
3. **`src/state/ContextSynthesizer`**: Decouples the complex logic of gathering surgical context (VCS diffs, Ctags, project files) from the orchestration logic.
4. **`src/core/SprintOrchestrator` & `PlannerOrchestrator`**: The business logic of the app, running loops and coordinating state and I/O.

### The Loop
1. **Initialization:** The CLI initializes the modules and either fetches **Features** from a **FeatureSource** or runs the **Planner** to generate the **Blueprint**.
2. **Sprint Loop:** The `SprintOrchestrator` manages the lifecycle for each unpassed **Feature**:
   - Git checkout a new feature branch via the **VCS**.
   - **Contract Phase:** **Contractor** and **Reviewer** iterate until a **Sprint Contract** is approved.
   - **Implementation Phase:** **Generator** writes code. **Evaluator** tests it.
     - *Note: On the first Cycle, a chaos bug is injected to test the Evaluator's honesty.*
   - Once the **Evaluator** passes the **Feature**, the branch is merged via the **VCS** and the durable state is committed.
3. **Completion:** The loop continues until all **Features** in the **Blueprint** pass.

This document serves as the foundational context for any future AI agent or human developer interacting with, maintaining, or improving this omniloop.
